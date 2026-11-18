import pc from "picocolors";
import type { LogLevel, RunReport, ScenarioResult } from "../../types/index.js";

export interface TerminalRendererOptions {
  logLevel?: LogLevel;
  jsonMode?: boolean;
  isTTY?: boolean;
  colorEnabled?: boolean;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
}

export class TerminalRenderer {
  private readonly logLevel: LogLevel;
  private readonly jsonMode: boolean;
  private readonly colorEnabled: boolean;
  private readonly stdout: NodeJS.WritableStream;
  private readonly stderr: NodeJS.WritableStream;

  constructor(options?: TerminalRendererOptions) {
    this.logLevel = options?.logLevel ?? "normal";
    this.jsonMode = options?.jsonMode ?? false;
    const isTTY = options?.isTTY ?? Boolean(process.stdout.isTTY);
    const noColorEnv = "NO_COLOR" in process.env || process.env.TERM === "dumb";
    this.colorEnabled = options?.colorEnabled ?? (isTTY && !noColorEnv && !this.jsonMode);
    this.stdout = options?.stdout ?? process.stdout;
    this.stderr = options?.stderr ?? process.stderr;
  }

  private style(fn: (s: string) => string, text: string): string {
    return this.colorEnabled ? fn(text) : text;
  }

  writeHeader(toolVersion: string, baseURL: string | undefined, browsers: string[], count: number): void {
    if (this.jsonMode || this.logLevel === "quiet") return;
    const lines = [
      this.style(pc.bold, `OfflineLab v${toolVersion}`),
      this.style(pc.dim, "Break the network. Not your app."),
      "",
    ];
    if (baseURL) {
      lines.push(`Application: ${baseURL}`);
    }
    lines.push(`Browser:     ${browsers.join(", ")}`);
    lines.push("");
    lines.push(`Running ${count} scenario${count === 1 ? "" : "s"}...`);
    lines.push("");
    this.stdout.write(lines.join("\n") + "\n");
  }

  writeProgress(message: string): void {
    if (this.jsonMode || this.logLevel === "quiet") return;
    if (this.logLevel === "verbose" || this.logLevel === "debug") {
      this.stderr.write(this.style(pc.dim, `[offlinelab] ${message}\n`));
    }
  }

  writeScenarioResult(result: ScenarioResult): void {
    if (this.jsonMode || this.logLevel === "quiet") return;

    const statusLabel = this.formatStatusBadge(result.status);
    const duration = this.formatDuration(result.durationMs);
    const browserTag = this.style(pc.dim, `[${result.browser}]`);
    const line = `${statusLabel}  ${result.name} ${browserTag} ${this.style(pc.dim, duration)}`;
    this.stdout.write(line + "\n");

    if (result.status === "failed" && result.error) {
      this.stdout.write(`      ${this.style(pc.red, result.error.message)}\n`);
    } else if (result.status === "unsupported" && result.reason) {
      this.stdout.write(`      ${this.style(pc.yellow, result.reason)}\n`);
    }

    if (this.logLevel === "verbose" || this.logLevel === "debug") {
      for (const step of result.steps) {
        const sLabel = step.status === "passed" ? "ok" : step.status;
        this.stdout.write(
          this.style(pc.dim, `      - [${sLabel}] ${step.action} (${step.durationMs}ms)\n`),
        );
      }
    }
  }

  writeSummary(report: RunReport, reportPaths: { html?: string; json?: string; junit?: string }): void {
    if (this.jsonMode) {
      this.stdout.write(JSON.stringify(report, null, 2) + "\n");
      return;
    }

    if (this.logLevel === "quiet") {
      if (report.summary.failed > 0) {
        this.stderr.write(
          `OfflineLab: ${report.summary.failed}/${report.summary.total} scenarios failed.\n`,
        );
      }
      return;
    }

    const divider = "─".repeat(36);
    const lines = [
      "",
      this.style(pc.bold, "Results"),
      divider,
      `Total scenarios       ${report.summary.total}`,
      `Passed                ${this.style(pc.green, String(report.summary.passed))}`,
      `Failed                ${report.summary.failed > 0 ? this.style(pc.red, String(report.summary.failed)) : "0"}`,
    ];

    if (report.summary.skipped > 0) {
      lines.push(`Skipped               ${report.summary.skipped}`);
    }
    if (report.summary.unsupported > 0) {
      lines.push(`Unsupported           ${this.style(pc.yellow, String(report.summary.unsupported))}`);
    }

    lines.push(`Duration              ${this.formatDuration(report.durationMs)}`);

    if (report.notes && report.notes.length > 0) {
      lines.push("");
      lines.push(this.style(pc.bold, "Notes"));
      for (const note of report.notes) {
        lines.push(`  - ${note}`);
      }
    }

    if (reportPaths.html) {
      lines.push("", "HTML report:", `  ${reportPaths.html}`);
    }
    if (reportPaths.json && (this.logLevel === "verbose" || this.logLevel === "debug")) {
      lines.push("JSON report:", `  ${reportPaths.json}`);
    }
    if (reportPaths.junit && (this.logLevel === "verbose" || this.logLevel === "debug")) {
      lines.push("JUnit report:", `  ${reportPaths.junit}`);
    }

    this.stdout.write(lines.join("\n") + "\n");
  }

  private formatStatusBadge(status: ScenarioResult["status"]): string {
    switch (status) {
      case "passed":
        return this.style(pc.green, "PASS");
      case "failed":
        return this.style(pc.red, "FAIL");
      case "unsupported":
        return this.style(pc.yellow, "UNSP");
      case "skipped":
        return this.style(pc.dim, "SKIP");
    }
  }

  private formatDuration(ms: number): string {
    if (ms >= 1000) {
      return `${(ms / 1000).toFixed(1)}s`;
    }
    return `${Math.round(ms)}ms`;
  }
}
