import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import type { WebServerConfig } from "../../types/index.js";
import { InfrastructureError } from "../errors/index.js";

/**
 * Manages the lifecycle of an explicitly configured local development server.
 * Supports readiness polling, early exit detection, existing server reuse, and cross-platform cleanup.
 */
export class AppServerManager {
  private child: ChildProcess | null = null;
  private startedByUs = false;
  private stderrChunks: string[] = [];
  private stdoutChunks: string[] = [];

  async start(config: WebServerConfig, defaultCwd: string): Promise<{ reused: boolean }> {
    const timeoutMs = config.timeoutMs ?? 30_000;
    const reuse = config.reuseExistingServer ?? true;

    if (reuse && (await this.isReachable(config.url))) {
      this.startedByUs = false;
      return { reused: true };
    }

    const cwd = config.cwd ? path.resolve(defaultCwd, config.cwd) : defaultCwd;
    const isWindows = process.platform === "win32";

    this.stderrChunks = [];
    this.stdoutChunks = [];

    const child = spawn(config.command, {
      cwd,
      shell: true,
      detached: !isWindows,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        ...config.env,
      },
    });

    this.child = child;
    this.startedByUs = true;

    let earlyExitCode: number | null = null;
    let earlyExitSignal: NodeJS.Signals | null = null;
    let spawnError: Error | null = null;

    child.stdout?.on("data", (chunk: Buffer) => {
      this.stdoutChunks.push(chunk.toString("utf8"));
      if (this.stdoutChunks.length > 40) this.stdoutChunks.shift();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      this.stderrChunks.push(chunk.toString("utf8"));
      if (this.stderrChunks.length > 40) this.stderrChunks.shift();
    });

    child.on("error", (err) => {
      spawnError = err;
    });
    child.on("exit", (code, signal) => {
      earlyExitCode = code;
      earlyExitSignal = signal;
    });

    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (spawnError) {
        await this.stop();
        throw new InfrastructureError(
          `Failed to start webServer command "${config.command}": ${(spawnError as Error).message}`,
          "Verify that the configured webServer.command and cwd are valid.",
          spawnError,
        );
      }

      if (earlyExitCode !== null || earlyExitSignal !== null) {
        const stderrTail = this.stderrChunks.join("").trim().slice(-1200);
        await this.stop();
        throw new InfrastructureError(
          `webServer process exited early (code=${earlyExitCode}, signal=${earlyExitSignal}) before ${config.url} became reachable.${stderrTail ? `\nServer stderr:\n${stderrTail}` : ""}`,
          "Run the webServer command directly to diagnose why the application failed to start.",
        );
      }

      if (await this.isReachable(config.url)) {
        return { reused: false };
      }

      await new Promise((r) => setTimeout(r, 250));
    }

    const stderrTail = this.stderrChunks.join("").trim().slice(-1200);
    await this.stop();
    throw new InfrastructureError(
      `Timed out after ${timeoutMs}ms waiting for webServer at ${config.url}.${stderrTail ? `\nServer stderr:\n${stderrTail}` : ""}`,
      `Increase webServer.timeoutMs or verify that "${config.command}" listens on ${config.url}.`,
    );
  }

  async stop(gracefulMs = 3000): Promise<void> {
    if (!this.child || !this.startedByUs) {
      this.child = null;
      return;
    }

    const child = this.child;
    this.child = null;
    this.startedByUs = false;

    if (child.exitCode !== null || child.killed) {
      return;
    }

    const isWindows = process.platform === "win32";

    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(killTimer);
        resolve();
      };

      child.once("exit", finish);

      const killTimer = setTimeout(() => {
        try {
          if (isWindows && child.pid) {
            spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
          } else if (child.pid) {
            process.kill(-child.pid, "SIGKILL");
          } else {
            child.kill("SIGKILL");
          }
        } catch {
          // Process may have already exited
        }
        finish();
      }, gracefulMs);

      try {
        if (isWindows && child.pid) {
          spawn("taskkill", ["/pid", String(child.pid), "/T"], { stdio: "ignore" });
        } else if (child.pid) {
          process.kill(-child.pid, "SIGTERM");
        } else {
          child.kill("SIGTERM");
        }
      } catch {
        finish();
      }
    });
  }

  async isReachable(url: string): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1500);
      const res = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        redirect: "manual",
      });
      clearTimeout(timer);
      return res.status > 0;
    } catch {
      return false;
    }
  }
}
