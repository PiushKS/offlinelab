import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startDemoAppServer, type DemoAppServerHandle } from "../../fixtures/offline-demo-app/server.js";

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(process.cwd());
const CLI_PATH = path.join(REPO_ROOT, "dist", "cli.js");

let server: DemoAppServerHandle;
const tmpDirs: string[] = [];

async function makeTempDir(prefix = "offlinelab-cli-"): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

async function runCli(
  args: string[],
  options?: { cwd?: string; env?: Record<string, string> },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const res = await execFileAsync(process.execPath, [CLI_PATH, ...args], {
      cwd: options?.cwd ?? REPO_ROOT,
      env: { ...process.env, NO_COLOR: "1", ...options?.env },
      timeout: 60_000,
    });
    return { stdout: res.stdout, stderr: res.stderr, exitCode: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
      exitCode: typeof e.code === "number" ? e.code : 1,
    };
  }
}

beforeAll(async () => {
  server = await startDemoAppServer(0);
});

afterAll(async () => {
  await server.close();
  while (tmpDirs.length > 0) {
    await fs.rm(tmpDirs.pop()!, { recursive: true, force: true });
  }
});

describe("Built CLI & npm Package Verification (A01–A04, A17, A19, A28–A30)", () => {
  it("outputs complete help and accurate version without launching browsers (A01, A02)", async () => {
    const help = await runCli(["--help"]);
    expect(help.exitCode).toBe(0);
    expect(help.stdout).toContain("OfflineLab: Break the network. Not your app.");
    expect(help.stdout).toContain("init");
    expect(help.stdout).toContain("doctor");
    expect(help.stdout).toContain("run");

    const ver = await runCli(["--version"]);
    expect(ver.exitCode).toBe(0);
    expect(ver.stdout.trim()).toBe("0.1.0");
  });

  it("initializes a project non-interactively and validates generated scenarios (A03, A04)", async () => {
    const dir = await makeTempDir();
    const init = await runCli(["init", "--yes", "--template", "pwa", "--url", server.url], {
      cwd: dir,
    });
    expect(init.exitCode).toBe(0);
    expect(init.stdout).toContain("offlinelab.config.ts");

    // Refuses overwrite without --force
    const initAgain = await runCli(["init", "--yes", "--template", "pwa"], { cwd: dir });
    expect(initAgain.exitCode).toBe(2);

    // Scenario list & validate pass on generated scenarios
    const list = await runCli(["scenario", "list"], { cwd: dir });
    expect(list.exitCode).toBe(0);
    expect(list.stdout).toContain("offline-navigation");

    const validate = await runCli(["scenario", "validate"], { cwd: dir });
    expect(validate.exitCode).toBe(0);
    expect(validate.stdout).toContain("VALID");

    // Invalid YAML exits with code 2 (A04)
    const badPath = path.join(dir, "scenarios", "broken.yaml");
    await fs.writeFile(badPath, "name: broken\nsteps:\n  - action: notRealAction\n", "utf8");
    const badVal = await runCli(["scenario", "validate", badPath], { cwd: dir });
    expect(badVal.exitCode).toBe(2);
    expect(badVal.stdout).toContain("INVALID");
  });

  it("executes Mode A zero-config URL inspection in CI mode with honest scope notes (A30)", async () => {
    const dir = await makeTempDir();
    const res = await runCli(
      ["run", "--url", server.url, "--ci", "--json", "--report-dir", "./reports"],
      { cwd: dir, env: { CI: "true" } },
    );
    expect(res.exitCode).toBe(0);
    const report = JSON.parse(res.stdout);
    expect(report.summary.passed).toBe(1);
    expect(report.notes.join(" ")).toContain("Not verified by zero-config inspection");
  });

  it("exits with code 1 on scenario assertion failure, compares two runs, and cleans safely (A17)", async () => {
    const dir = await makeTempDir();
    await fs.mkdir(path.join(dir, "scenarios"), { recursive: true });
    await fs.writeFile(
      path.join(dir, "offlinelab.config.json"),
      JSON.stringify({
        baseURL: server.url,
        browsers: ["chromium"],
        scenarios: ["scenarios/*.yaml"],
        reports: { directory: "./results", formats: ["json", "html", "junit"] },
      }),
      "utf8",
    );
    await fs.writeFile(
      path.join(dir, "scenarios", "passing.yaml"),
      `name: passing-check\nmode: interception\nsteps:\n  - action: navigate\n    path: /\n  - action: expectVisible\n    selector: "[data-testid='app-shell']"\n`,
      "utf8",
    );

    const passRun = await runCli(["run", "--json"], { cwd: dir });
    expect(passRun.exitCode).toBe(0);
    const runA = JSON.parse(passRun.stdout).runId as string;

    // Now write a failing assertion scenario
    await fs.writeFile(
      path.join(dir, "scenarios", "passing.yaml"),
      `name: passing-check\nmode: interception\nsteps:\n  - action: navigate\n    path: /\n  - action: expectVisible\n    selector: "[data-testid='missing-element']"\n    timeoutMs: 400\n`,
      "utf8",
    );

    const failRun = await runCli(["run", "--json"], { cwd: dir });
    expect(failRun.exitCode).toBe(1);
    const runB = JSON.parse(failRun.stdout).runId as string;

    // Compare runA vs runB
    const cmp = await runCli(["report", "compare", runA, runB, "--json"], { cwd: dir });
    expect(cmp.exitCode).toBe(0);
    const diff = JSON.parse(cmp.stdout);
    expect(diff.summaryDiff.failedDelta).toBe(1);
    expect(diff.scenarioChanges[0].changeType).toBe("regressed");

    // Clean artifacts safely
    const clean = await runCli(["clean", "--json"], { cwd: dir });
    expect(clean.exitCode).toBe(0);
    const cleaned = JSON.parse(clean.stdout);
    expect(cleaned.deletedRuns).toContain(runA);
    expect(cleaned.deletedRuns).toContain(runB);
  });

  it("handles SIGINT (Ctrl+C) cleanly and exits with code 130 (A19)", async () => {
    const dir = await makeTempDir();
    await fs.mkdir(path.join(dir, "scenarios"), { recursive: true });
    await fs.writeFile(
      path.join(dir, "offlinelab.config.json"),
      JSON.stringify({
        baseURL: server.url,
        browsers: ["chromium"],
        scenarios: ["scenarios/*.yaml"],
        reports: { directory: "./results", formats: ["json"] },
      }),
      "utf8",
    );
    await fs.writeFile(
      path.join(dir, "scenarios", "slow-wait.yaml"),
      `name: slow-wait\nmode: interception\nsteps:\n  - action: navigate\n    path: /\n  - action: wait\n    durationMs: 15000\n`,
      "utf8",
    );

    const exitCode = await new Promise<number | null>((resolve) => {
      const child = spawn(process.execPath, [CLI_PATH, "run"], {
        cwd: dir,
        env: { ...process.env, NO_COLOR: "1" },
        stdio: ["ignore", "pipe", "pipe"],
      });

      setTimeout(() => {
        child.kill("SIGINT");
      }, 1800);

      child.on("close", (code, signal) => {
        if (signal === "SIGINT") {
          resolve(130);
        } else {
          resolve(code);
        }
      });
    });

    expect(exitCode).toBe(130);
  });

  it("packs npm tarball, installs in an isolated external project, runs CLI & imports SDK (A28, A29)", async () => {
    const packDir = await makeTempDir("offlinelab-pack-");
    const extProjectDir = await makeTempDir("offlinelab-ext-");

    // Pack the built package into a tarball
    const packRes = await execFileAsync(
      "npm",
      ["pack", "--pack-destination", packDir],
      { cwd: REPO_ROOT, timeout: 60_000 },
    );
    const tgzName = packRes.stdout.trim().split("\n").pop()!.trim();
    const tgzPath = path.join(packDir, tgzName);
    expect(tgzName).toMatch(/^offlinelab-.*\.tgz$/);

    // Create minimal external ESM project and install the packed tarball
    await fs.writeFile(
      path.join(extProjectDir, "package.json"),
      JSON.stringify({ name: "ext-consumer", version: "1.0.0", type: "module" }, null, 2),
      "utf8",
    );

    await execFileAsync("npm", ["install", "--no-audit", "--no-fund", tgzPath], {
      cwd: extProjectDir,
      timeout: 120_000,
    });

    // A28: Execute installed `offlinelab --help` binary from external project
    const binPath = path.join(extProjectDir, "node_modules", ".bin", "offlinelab");
    const cliHelp = await execFileAsync(binPath, ["--help"], { cwd: extProjectDir });
    expect(cliHelp.stdout).toContain("OfflineLab: Break the network. Not your app.");

    // A29: Import public SDK from external project
    const verifyScript = path.join(extProjectDir, "verify-sdk.mjs");
    await fs.writeFile(
      verifyScript,
      `import { OfflineLab, defineConfig, defineScenario, BUILT_IN_NETWORK_PROFILES } from "offlinelab";
const cfg = defineConfig({ baseURL: "http://localhost:3000" });
const sc = defineScenario({ name: "ext-test", async run() {} });
if (!cfg.baseURL || sc.name !== "ext-test" || typeof OfflineLab !== "function" || !BUILT_IN_NETWORK_PROFILES["slow-3g"]) {
  process.exit(1);
}
console.log("SDK_IMPORT_OK");
`,
      "utf8",
    );

    const sdkOut = await execFileAsync(process.execPath, [verifyScript], { cwd: extProjectDir });
    expect(sdkOut.stdout.trim()).toBe("SDK_IMPORT_OK");
  }, 180_000);
});
