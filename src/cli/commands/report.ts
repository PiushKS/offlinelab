import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import pc from "picocolors";
import { ArtifactManager } from "../../artifacts/artifact-manager.js";
import { ConfigLoader } from "../../config/loader/config-loader.js";
import { ConfigValidationError } from "../../core/errors/index.js";
import { JsonReporter } from "../../reporters/json/json-reporter.js";

async function resolveReportDir(options: {
  reportDir?: string;
  config?: string;
  cwd?: string;
}): Promise<{ reportDir: string; cwd: string }> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  if (options.reportDir) {
    return { reportDir: options.reportDir, cwd };
  }
  try {
    const { config } = await ConfigLoader.load({ cwd, configPath: options.config });
    return { reportDir: config.reports.directory, cwd };
  } catch {
    return { reportDir: "./offlinelab-results", cwd };
  }
}

function openFileInDefaultBrowser(filePath: string): void {
  const platform = process.platform;
  if (platform === "darwin") {
    const child = spawn("open", [filePath], { detached: true, stdio: "ignore" });
    child.unref();
  } else if (platform === "win32") {
    const child = spawn("cmd", ["/c", "start", "", filePath], { detached: true, stdio: "ignore" });
    child.unref();
  } else {
    const child = spawn("xdg-open", [filePath], { detached: true, stdio: "ignore" });
    child.unref();
  }
}

export async function runReportListCommand(options: {
  reportDir?: string;
  config?: string;
  json?: boolean;
  cwd?: string;
}): Promise<void> {
  const { reportDir, cwd } = await resolveReportDir(options);
  const manager = new ArtifactManager(reportDir, cwd);
  const runs = await manager.listRuns();

  if (options.json) {
    console.log(JSON.stringify(runs, null, 2));
    return;
  }

  if (runs.length === 0) {
    console.log(`No stored runs found in ${path.resolve(cwd, reportDir)}.`);
    return;
  }

  console.log(`Stored Runs (${runs.length}):`);
  for (const run of runs) {
    console.log(`  ${run.runId}  (${run.startedAt ?? new Date(run.mtimeMs).toISOString()})`);
  }
}

export async function runReportOpenCommand(options: {
  run?: string;
  reportDir?: string;
  config?: string;
  noOpen?: boolean;
  cwd?: string;
}): Promise<string> {
  const { reportDir, cwd } = await resolveReportDir(options);
  const manager = new ArtifactManager(reportDir, cwd);
  const targetRun = options.run ?? "latest";
  const runDir = await manager.resolveRunDir(targetRun);

  if (!runDir) {
    throw new ConfigValidationError(
      `Could not find report for run "${targetRun}" in ${path.resolve(cwd, reportDir)}.`,
      { run: targetRun },
      "Execute `offlinelab run` first or run `offlinelab report list` to see available run IDs.",
    );
  }

  const htmlPath = path.join(runDir, "report.html");
  try {
    await fs.access(htmlPath);
  } catch {
    throw new ConfigValidationError(
      `HTML report not found at ${htmlPath}.`,
      { htmlPath },
      'Ensure "html" is enabled in reports.formats when running OfflineLab.',
    );
  }

  console.log(`Report: ${htmlPath}`);
  if (!options.noOpen && !process.env.CI) {
    openFileInDefaultBrowser(htmlPath);
  }
  return htmlPath;
}

export async function runReportCompareCommand(
  runAId: string,
  runBId: string,
  options: { reportDir?: string; config?: string; json?: boolean; cwd?: string },
): Promise<void> {
  const { reportDir, cwd } = await resolveReportDir(options);
  const manager = new ArtifactManager(reportDir, cwd);

  const dirA = await manager.resolveRunDir(runAId);
  const dirB = await manager.resolveRunDir(runBId);

  if (!dirA) {
    throw new ConfigValidationError(`Run "${runAId}" not found in ${path.resolve(cwd, reportDir)}.`);
  }
  if (!dirB) {
    throw new ConfigValidationError(`Run "${runBId}" not found in ${path.resolve(cwd, reportDir)}.`);
  }

  const reportA = await JsonReporter.read(path.join(dirA, "report.json"));
  const reportB = await JsonReporter.read(path.join(dirB, "report.json"));
  const diff = JsonReporter.compareRuns(reportA, reportB);

  if (options.json) {
    console.log(JSON.stringify(diff, null, 2));
    return;
  }

  const useColor = Boolean(process.stdout.isTTY) && !("NO_COLOR" in process.env);
  const paint = (fn: (s: string) => string, s: string) => (useColor ? fn(s) : s);

  console.log(paint(pc.bold, `Comparing ${diff.runA.runId} -> ${diff.runB.runId}`));
  console.log("─".repeat(56));
  const fmtDelta = (n: number, suffix = "") => `${n >= 0 ? "+" : ""}${n}${suffix}`;
  console.log(`Passed delta:          ${fmtDelta(diff.summaryDiff.passedDelta)}`);
  console.log(`Failed delta:          ${fmtDelta(diff.summaryDiff.failedDelta)}`);
  console.log(`Duration delta:        ${fmtDelta(diff.summaryDiff.durationDeltaMs, "ms")}`);
  console.log(`Failed requests delta: ${fmtDelta(diff.summaryDiff.failedRequestsDelta)}`);
  console.log("");

  for (const sc of diff.scenarioChanges) {
    const label =
      sc.changeType === "regressed"
        ? paint(pc.red, "REGRESSED")
        : sc.changeType === "fixed"
          ? paint(pc.green, "FIXED    ")
          : sc.changeType === "added"
            ? paint(pc.cyan, "ADDED    ")
            : sc.changeType === "removed"
              ? paint(pc.yellow, "REMOVED  ")
              : sc.changeType === "changed"
                ? paint(pc.yellow, "CHANGED  ")
                : paint(pc.dim, "SAME     ");
    const durPart =
      sc.durationDeltaMs !== undefined ? ` (${fmtDelta(sc.durationDeltaMs, "ms")})` : "";
    const reqPart =
      sc.failedRequestsA !== undefined && sc.failedRequestsB !== undefined && sc.failedRequestsA !== sc.failedRequestsB
        ? ` [failed reqs: ${sc.failedRequestsA} -> ${sc.failedRequestsB}]`
        : "";
    console.log(
      `${label}  ${sc.name} [${sc.browser}]: ${sc.statusA ?? "-"} -> ${sc.statusB ?? "-"}${durPart}${reqPart}`,
    );
  }
}
