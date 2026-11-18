import fs from "node:fs/promises";
import path from "node:path";
import { ArtifactManager } from "../../artifacts/artifact-manager.js";
import {
  OFFLINELAB_SCHEMA_VERSION,
  OFFLINELAB_TOOL_VERSION,
} from "../../config/defaults/defaults.js";
import type {
  BrowserName,
  RunComparison,
  RunReport,
  ScenarioResult,
} from "../../types/index.js";

export class JsonReporter {
  async write(report: RunReport, outputPath: string): Promise<string> {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, JSON.stringify(report, null, 2), "utf8");
    return outputPath;
  }

  static async read(reportPath: string): Promise<RunReport> {
    const raw = await fs.readFile(reportPath, "utf8");
    return JSON.parse(raw) as RunReport;
  }

  static compareRuns(reportA: RunReport, reportB: RunReport): RunComparison {
    const mapA = new Map<string, ScenarioResult>();
    const mapB = new Map<string, ScenarioResult>();

    for (const s of reportA.scenarios) {
      mapA.set(`${s.name}::${s.browser}`, s);
    }
    for (const s of reportB.scenarios) {
      mapB.set(`${s.name}::${s.browser}`, s);
    }

    const keys = new Set([...mapA.keys(), ...mapB.keys()]);
    const scenarioChanges: RunComparison["scenarioChanges"] = [];

    for (const key of Array.from(keys).sort()) {
      const a = mapA.get(key);
      const b = mapB.get(key);

      if (!a && b) {
        scenarioChanges.push({
          name: b.name,
          browser: b.browser,
          statusB: b.status,
          failedRequestsB: b.requests.filter((r) => r.failed).length,
          changeType: "added",
        });
        continue;
      }

      if (a && !b) {
        scenarioChanges.push({
          name: a.name,
          browser: a.browser,
          statusA: a.status,
          failedRequestsA: a.requests.filter((r) => r.failed).length,
          changeType: "removed",
        });
        continue;
      }

      if (a && b) {
        const failedA = a.requests.filter((r) => r.failed).length;
        const failedB = b.requests.filter((r) => r.failed).length;
        const durationDeltaMs = b.durationMs - a.durationMs;

        let changeType: RunComparison["scenarioChanges"][number]["changeType"] = "unchanged";
        if (a.status === "passed" && b.status === "failed") {
          changeType = "regressed";
        } else if (a.status === "failed" && b.status === "passed") {
          changeType = "fixed";
        } else if (a.status !== b.status || failedA !== failedB) {
          changeType = "changed";
        }

        scenarioChanges.push({
          name: b.name,
          browser: b.browser,
          statusA: a.status,
          statusB: b.status,
          durationDeltaMs,
          failedRequestsA: failedA,
          failedRequestsB: failedB,
          changeType,
        });
      }
    }

    return {
      runA: {
        runId: reportA.runId,
        startedAt: reportA.startedAt,
        durationMs: reportA.durationMs,
      },
      runB: {
        runId: reportB.runId,
        startedAt: reportB.startedAt,
        durationMs: reportB.durationMs,
      },
      summaryDiff: {
        passedDelta: reportB.summary.passed - reportA.summary.passed,
        failedDelta: reportB.summary.failed - reportA.summary.failed,
        durationDeltaMs: reportB.durationMs - reportA.durationMs,
        failedRequestsDelta: reportB.summary.failedRequests - reportA.summary.failedRequests,
      },
      scenarioChanges,
    };
  }

  /**
   * Merges multiple sharded RunReports into a single unified RunReport for consolidated CI reporting.
   */
  static mergeReports(reports: RunReport[], mergedRunId = ArtifactManager.generateRunId()): RunReport {
    if (reports.length === 0) {
      const now = new Date().toISOString();
      return {
        schemaVersion: OFFLINELAB_SCHEMA_VERSION,
        runId: mergedRunId,
        toolVersion: OFFLINELAB_TOOL_VERSION,
        startedAt: now,
        completedAt: now,
        durationMs: 0,
        environment: {
          nodeVersion: process.version,
          platform: process.platform,
          arch: process.arch,
          playwrightVersion: "unknown",
          browsers: [],
          ci: Boolean(process.env.CI),
        },
        summary: {
          total: 0,
          passed: 0,
          failed: 0,
          flaky: 0,
          skipped: 0,
          unsupported: 0,
          totalAssertions: 0,
          passedAssertions: 0,
          failedAssertions: 0,
          totalRequests: 0,
          failedRequests: 0,
          injectedFaults: 0,
        },
        scenarios: [],
        artifacts: [],
      };
    }

    const scenarios = reports.flatMap((r) => r.scenarios);
    const artifacts = reports.flatMap((r) => r.artifacts);
    const notes = reports.flatMap((r) => r.notes ?? []);
    notes.unshift(`Merged ${reports.length} sharded report(s): ${reports.map((r) => r.runId).join(", ")}`);

    const startedAt = reports.map((r) => r.startedAt).sort()[0]!;
    const completedAt = reports.map((r) => r.completedAt).sort().pop()!;
    const durationMs = reports.reduce((acc, r) => acc + r.durationMs, 0);
    const browsers = Array.from(
      new Set<BrowserName>(reports.flatMap((r) => r.environment.browsers)),
    );

    const passed = scenarios.filter((s) => s.status === "passed").length;
    const failed = scenarios.filter((s) => s.status === "failed").length;
    const flaky = scenarios.filter((s) => s.status === "passed" && s.flaky).length;
    const skipped = scenarios.filter((s) => s.status === "skipped").length;
    const unsupported = scenarios.filter((s) => s.status === "unsupported").length;
    const totalAssertions = scenarios.reduce((a, s) => a + s.assertions.length, 0);
    const passedAssertions = scenarios.reduce(
      (a, s) => a + s.assertions.filter((x) => x.status === "passed").length,
      0,
    );
    const failedAssertions = scenarios.reduce(
      (a, s) => a + s.assertions.filter((x) => x.status === "failed").length,
      0,
    );
    const totalRequests = scenarios.reduce((a, s) => a + s.requests.length, 0);
    const failedRequests = scenarios.reduce(
      (a, s) => a + s.requests.filter((r) => r.failed).length,
      0,
    );
    const injectedFaults = scenarios.reduce(
      (a, s) => a + s.requests.filter((r) => Boolean(r.injectedRuleId)).length,
      0,
    );

    const firstEnv = reports[0]!.environment;
    return {
      schemaVersion: OFFLINELAB_SCHEMA_VERSION,
      runId: mergedRunId,
      toolVersion: OFFLINELAB_TOOL_VERSION,
      startedAt,
      completedAt,
      durationMs,
      environment: {
        ...firstEnv,
        browsers,
      },
      summary: {
        total: scenarios.length,
        passed,
        failed,
        flaky,
        skipped,
        unsupported,
        totalAssertions,
        passedAssertions,
        failedAssertions,
        totalRequests,
        failedRequests,
        injectedFaults,
      },
      scenarios,
      artifacts,
      notes,
    };
  }
}
