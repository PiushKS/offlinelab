import fs from "node:fs/promises";
import path from "node:path";
import type { RunComparison, RunReport, ScenarioResult } from "../../types/index.js";

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
}
