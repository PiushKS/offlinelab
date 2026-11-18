import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Page } from "playwright";
import {
  assertPathWithin,
  assertSafeReportDirectory,
  sanitizeFileSlug,
} from "../security/path-safety.js";
import type { ArtifactReference, RunReport } from "../types/index.js";

export const OFFLINELAB_MARKER_FILE = ".offlinelab-artifacts";

export interface RunArtifactLayout {
  runId: string;
  baseReportDir: string;
  runDir: string;
  screenshotsDir: string;
  tracesDir: string;
  logsDir: string;
}

export class ArtifactManager {
  public readonly baseReportDir: string;
  private readonly cwd: string;

  constructor(reportDir: string, cwd = process.cwd()) {
    this.cwd = path.resolve(cwd);
    this.baseReportDir = path.resolve(this.cwd, reportDir);
  }

  static generateRunId(): string {
    const now = new Date();
    const pad = (n: number, len = 2) => String(n).padStart(len, "0");
    const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
    const suffix = crypto.randomBytes(3).toString("hex");
    return `run-${stamp}-${suffix}`;
  }

  async initRun(runId = ArtifactManager.generateRunId()): Promise<RunArtifactLayout> {
    const safeRunId = sanitizeFileSlug(runId, "run");
    const runsDir = path.join(this.baseReportDir, "runs");
    const runDir = assertPathWithin(this.baseReportDir, path.join("runs", safeRunId));
    const screenshotsDir = path.join(runDir, "screenshots");
    const tracesDir = path.join(runDir, "traces");
    const logsDir = path.join(runDir, "logs");

    await fs.mkdir(screenshotsDir, { recursive: true });
    await fs.mkdir(tracesDir, { recursive: true });
    await fs.mkdir(logsDir, { recursive: true });
    await fs.mkdir(runsDir, { recursive: true });

    // Write marker file so `clean` can verify this directory is OfflineLab-managed
    const markerPath = path.join(this.baseReportDir, OFFLINELAB_MARKER_FILE);
    await fs.writeFile(
      markerPath,
      JSON.stringify({ managedBy: "offlinelab", updatedAt: new Date().toISOString() }, null, 2),
      "utf8",
    );

    return {
      runId: safeRunId,
      baseReportDir: this.baseReportDir,
      runDir,
      screenshotsDir,
      tracesDir,
      logsDir,
    };
  }

  async captureScreenshot(
    page: Page,
    layout: RunArtifactLayout,
    scenarioId: string,
    name: string,
    fullPage = false,
  ): Promise<ArtifactReference> {
    const safeScenario = sanitizeFileSlug(scenarioId, "scenario");
    const safeName = sanitizeFileSlug(name, "screenshot");
    const fileName = `${safeScenario}--${safeName}-${Date.now().toString(36)}.png`;
    const filePath = assertPathWithin(layout.screenshotsDir, fileName);

    await page.screenshot({ path: filePath, fullPage });
    const stat = await fs.stat(filePath);

    return {
      id: `art_${crypto.randomUUID().slice(0, 10)}`,
      type: "screenshot",
      name,
      path: filePath,
      relativePath: path.relative(layout.runDir, filePath).split(path.sep).join("/"),
      scenarioId,
      mimeType: "image/png",
      sizeBytes: stat.size,
      createdAt: new Date().toISOString(),
    };
  }

  getTracePath(layout: RunArtifactLayout, scenarioId: string): string {
    const safeScenario = sanitizeFileSlug(scenarioId, "scenario");
    const fileName = `${safeScenario}.zip`;
    return assertPathWithin(layout.tracesDir, fileName);
  }

  async registerTraceArtifact(
    layout: RunArtifactLayout,
    scenarioId: string,
    tracePath: string,
  ): Promise<ArtifactReference | undefined> {
    try {
      const stat = await fs.stat(tracePath);
      return {
        id: `art_${crypto.randomUUID().slice(0, 10)}`,
        type: "trace",
        name: `${scenarioId} trace`,
        path: tracePath,
        relativePath: path.relative(layout.runDir, tracePath).split(path.sep).join("/"),
        scenarioId,
        mimeType: "application/zip",
        sizeBytes: stat.size,
        createdAt: new Date().toISOString(),
      };
    } catch {
      return undefined;
    }
  }

  async writeJsonLog(
    layout: RunArtifactLayout,
    scenarioId: string,
    kind: "console-log" | "request-log" | "storage-snapshot",
    name: string,
    data: unknown,
  ): Promise<ArtifactReference> {
    const safeScenario = sanitizeFileSlug(scenarioId, "scenario");
    const safeName = sanitizeFileSlug(name, kind);
    const fileName = `${safeScenario}--${safeName}.json`;
    const filePath = assertPathWithin(layout.logsDir, fileName);

    const content = JSON.stringify(data, null, 2);
    await fs.writeFile(filePath, content, "utf8");
    const stat = await fs.stat(filePath);

    return {
      id: `art_${crypto.randomUUID().slice(0, 10)}`,
      type: kind,
      name,
      path: filePath,
      relativePath: path.relative(layout.runDir, filePath).split(path.sep).join("/"),
      scenarioId,
      mimeType: "application/json",
      sizeBytes: stat.size,
      createdAt: new Date().toISOString(),
    };
  }

  async writeRunMetadata(layout: RunArtifactLayout, report: RunReport): Promise<void> {
    const metaPath = assertPathWithin(layout.runDir, "metadata.json");
    const metadata = {
      runId: report.runId,
      schemaVersion: report.schemaVersion,
      toolVersion: report.toolVersion,
      startedAt: report.startedAt,
      completedAt: report.completedAt,
      durationMs: report.durationMs,
      summary: report.summary,
      environment: report.environment,
    };
    await fs.writeFile(metaPath, JSON.stringify(metadata, null, 2), "utf8");

    const latestPointerPath = assertPathWithin(this.baseReportDir, "latest.json");
    await fs.writeFile(
      latestPointerPath,
      JSON.stringify(
        {
          runId: report.runId,
          runDir: layout.runDir,
          updatedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      "utf8",
    );
  }

  async listRuns(): Promise<
    Array<{ runId: string; runDir: string; startedAt?: string; mtimeMs: number }>
  > {
    const runsDir = path.join(this.baseReportDir, "runs");
    try {
      const entries = await fs.readdir(runsDir, { withFileTypes: true });
      const runs: Array<{ runId: string; runDir: string; startedAt?: string; mtimeMs: number }> =
        [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const runDir = path.join(runsDir, entry.name);
        const stat = await fs.stat(runDir);
        let startedAt: string | undefined;
        try {
          const metaRaw = await fs.readFile(path.join(runDir, "metadata.json"), "utf8");
          const meta = JSON.parse(metaRaw) as { startedAt?: string };
          startedAt = meta.startedAt;
        } catch {
          // ignore
        }
        runs.push({
          runId: entry.name,
          runDir,
          startedAt,
          mtimeMs: stat.mtimeMs,
        });
      }
      runs.sort((a, b) => b.mtimeMs - a.mtimeMs);
      return runs;
    } catch {
      return [];
    }
  }

  async resolveRunDir(runIdOrLatest: string): Promise<string | undefined> {
    if (runIdOrLatest === "latest") {
      try {
        const raw = await fs.readFile(path.join(this.baseReportDir, "latest.json"), "utf8");
        const parsed = JSON.parse(raw) as { runId?: string };
        if (parsed.runId) {
          const candidate = assertPathWithin(
            this.baseReportDir,
            path.join("runs", sanitizeFileSlug(parsed.runId)),
          );
          await fs.access(candidate);
          return candidate;
        }
      } catch {
        const runs = await this.listRuns();
        return runs[0]?.runDir;
      }
    }

    const candidate = assertPathWithin(
      this.baseReportDir,
      path.join("runs", sanitizeFileSlug(runIdOrLatest)),
    );
    try {
      const stat = await fs.stat(candidate);
      if (stat.isDirectory()) return candidate;
    } catch {
      return undefined;
    }
    return undefined;
  }

  /**
   * Safely cleans only known OfflineLab-managed artifacts within the configured report directory.
   */
  async clean(options?: { olderThanMs?: number }): Promise<{
    deletedRuns: string[];
    skipped: boolean;
    reason?: string;
  }> {
    const safeDir = assertSafeReportDirectory(this.baseReportDir, this.cwd);

    try {
      await fs.access(safeDir);
    } catch {
      return { deletedRuns: [], skipped: true, reason: "Report directory does not exist." };
    }

    // Verify marker file or known `runs/` structure before removing anything
    const markerPath = path.join(safeDir, OFFLINELAB_MARKER_FILE);
    let hasMarker = false;
    try {
      await fs.access(markerPath);
      hasMarker = true;
    } catch {
      hasMarker = false;
    }

    const runsDir = path.join(safeDir, "runs");
    let hasRunsDir = false;
    try {
      const stat = await fs.stat(runsDir);
      hasRunsDir = stat.isDirectory();
    } catch {
      hasRunsDir = false;
    }

    if (!hasMarker && !hasRunsDir) {
      return {
        deletedRuns: [],
        skipped: true,
        reason: `Refusing to clean "${safeDir}" because it does not appear to be an OfflineLab artifact directory.`,
      };
    }

    const now = Date.now();
    const cutoff = options?.olderThanMs !== undefined ? now - options.olderThanMs : undefined;
    const runs = await this.listRuns();
    const deletedRuns: string[] = [];

    for (const run of runs) {
      const verifiedRunDir = assertPathWithin(safeDir, path.join("runs", run.runId));
      if (cutoff !== undefined && run.mtimeMs > cutoff) {
        continue;
      }
      await fs.rm(verifiedRunDir, { recursive: true, force: true });
      deletedRuns.push(run.runId);
    }

    // If all runs were removed (no cutoff filter), also clean known top-level report files
    if (cutoff === undefined) {
      const knownFiles = ["report.html", "report.json", "junit.xml", "latest.json"];
      for (const fileName of knownFiles) {
        const target = assertPathWithin(safeDir, fileName);
        await fs.rm(target, { force: true }).catch(() => {});
      }
    }

    return { deletedRuns, skipped: false };
  }

  /**
   * Automatically prunes stored runs exceeding `maxRuns` or older than `retentionDays`,
   * preserving `keepRunId` and enforcing strict path safety.
   */
  async enforceRetention(options: {
    retentionDays?: number;
    maxRuns?: number;
    keepRunId?: string;
  }): Promise<string[]> {
    if (options.retentionDays === undefined && options.maxRuns === undefined) {
      return [];
    }

    let safeDir: string;
    try {
      safeDir = assertSafeReportDirectory(this.baseReportDir, this.cwd);
    } catch {
      return [];
    }

    const runs = await this.listRuns();
    const cutoffMs =
      options.retentionDays !== undefined
        ? Date.now() - options.retentionDays * 86_400_000
        : undefined;

    const deleted: string[] = [];
    for (let i = 0; i < runs.length; i++) {
      const run = runs[i]!;
      if (options.keepRunId && run.runId === options.keepRunId) {
        continue;
      }
      const exceedsMax = options.maxRuns !== undefined && i >= options.maxRuns;
      const expired = cutoffMs !== undefined && run.mtimeMs < cutoffMs;
      if (exceedsMax || expired) {
        try {
          const verified = assertPathWithin(safeDir, path.join("runs", run.runId));
          await fs.rm(verified, { recursive: true, force: true });
          deleted.push(run.runId);
        } catch {
          // Ignore individual deletion failure
        }
      }
    }

    return deleted;
  }
}

export function parseDurationString(input: string): number | undefined {
  const match = /^(\d+)\s*(ms|s|m|h|d)$/i.exec(input.trim());
  if (!match) return undefined;
  const amount = Number(match[1]);
  const unit = match[2]!.toLowerCase();
  switch (unit) {
    case "ms":
      return amount;
    case "s":
      return amount * 1000;
    case "m":
      return amount * 60_000;
    case "h":
      return amount * 3_600_000;
    case "d":
      return amount * 86_400_000;
    default:
      return undefined;
  }
}
