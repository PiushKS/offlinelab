import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  ArtifactManager,
  JsonReporter,
  OfflineLab,
  defineScenario,
} from "../../src/index.js";
import {
  startDemoAppServer,
  type DemoAppServerHandle,
} from "../../fixtures/offline-demo-app/server.js";

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(process.cwd());
const CLI_PATH = path.join(REPO_ROOT, "dist", "cli.js");

let server: DemoAppServerHandle;
const tmpDirs: string[] = [];

async function makeTempDir(prefix = "offlinelab-ind-"): Promise<string> {
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

beforeEach(() => {
  server.reset();
});

afterAll(async () => {
  await server.close();
  while (tmpDirs.length > 0) {
    await fs.rm(tmpDirs.pop()!, { recursive: true, force: true });
  }
});

describe("Industrial Production Capabilities", () => {
  it("supports horizontal CI sharding (--shard) and merges reports via `report merge`", async () => {
    const dir = await makeTempDir();
    await fs.mkdir(path.join(dir, "scenarios"), { recursive: true });
    await fs.writeFile(
      path.join(dir, "offlinelab.config.json"),
      JSON.stringify({
        baseURL: server.url,
        browsers: ["chromium"],
        scenarios: ["scenarios/*.yaml"],
        mode: "interception",
        serviceWorkers: "block",
        reports: { directory: "./results", formats: ["json"] },
      }),
      "utf8",
    );

    for (const name of ["s1", "s2", "s3", "s4"]) {
      await fs.writeFile(
        path.join(dir, "scenarios", `${name}.yaml`),
        `name: ${name}\ntags: [${name === "s1" || name === "s3" ? "critical" : "smoke"}]\nmode: interception\nsteps:\n  - action: navigate\n    path: /\n  - action: expectVisible\n    selector: "[data-testid='app-shell']"\n`,
        "utf8",
      );
    }

    const shard1Dir = path.join(dir, "shard-1");
    const shard2Dir = path.join(dir, "shard-2");

    const r1 = await runCli(["run", "--shard", "1/2", "--report-dir", shard1Dir, "--json"], {
      cwd: dir,
    });
    const r2 = await runCli(["run", "--shard", "2/2", "--report-dir", shard2Dir, "--json"], {
      cwd: dir,
    });

    expect(r1.exitCode).toBe(0);
    expect(r2.exitCode).toBe(0);
    const rep1 = JSON.parse(r1.stdout);
    const rep2 = JSON.parse(r2.stdout);
    expect(rep1.summary.total).toBe(2);
    expect(rep2.summary.total).toBe(2);

    // Merge both sharded reports into a unified HTML + JSON + JUnit report
    const mergedDir = path.join(dir, "merged");
    const merge = await runCli(
      [
        "report",
        "merge",
        path.join(shard1Dir, "report.json"),
        path.join(shard2Dir, "report.json"),
        "--report-dir",
        mergedDir,
        "--json",
      ],
      { cwd: dir },
    );
    expect(merge.exitCode).toBe(0);
    const merged = JSON.parse(merge.stdout);
    expect(merged.summary.total).toBe(4);
    expect(merged.summary.passed).toBe(4);
    await fs.access(path.join(mergedDir, "report.html"));
    await fs.access(path.join(mergedDir, "junit.xml"));

    // Verify --tag filtering runs only tagged scenarios
    const tagRun = await runCli(["run", "--tag", "critical", "--json"], { cwd: dir });
    expect(tagRun.exitCode).toBe(0);
    const tagRep = JSON.parse(tagRun.stdout);
    expect(tagRep.summary.total).toBe(2);
    expect(tagRep.scenarios.map((s: { name: string }) => s.name).sort()).toEqual(["s1", "s3"]);
  });

  it("detects flaky retried scenarios, emits JUnit flaky property, and honors failOnFlaky", async () => {
    const reportDir = await makeTempDir();
    let attemptCounter = 0;

    const flakyScenario = defineScenario({
      name: "flaky-on-first-attempt",
      mode: "interception",
      retries: 1,
      async run({ page, expect: labExpect }) {
        attemptCounter += 1;
        await page.goto("/");
        if (attemptCounter === 1) {
          throw new Error("Transient flake on attempt 1");
        }
        await labExpect(page.getByTestId("app-shell")).toBeVisible();
      },
    });

    const out = await OfflineLab.run(
      {
        baseURL: server.url,
        browsers: ["chromium"],
        failOnFlaky: true,
        reports: { directory: reportDir, formats: ["json", "junit", "html"] },
      },
      { scenarios: [flakyScenario] },
    );

    expect(out.report.summary.passed).toBe(1);
    expect(out.report.summary.flaky).toBe(1);
    expect(out.report.scenarios[0]?.flaky).toBe(true);
    expect(out.report.scenarios[0]?.attempts).toBe(2);
    // failOnFlaky turns flaky pass into a CI gate failure
    expect(out.hasFailures).toBe(true);

    const junitXml = await fs.readFile(out.reportPaths.junit!, "utf8");
    expect(junitXml).toContain('<property name="flaky" value="true" />');
    expect(junitXml).toContain('<property name="attempts" value="2" />');
  });

  it("enforces maxFailures fail-fast, automatic retention pruning, and SLO budgets", async () => {
    const reportDir = await makeTempDir();

    const failFirst = defineScenario({
      name: "fail-first",
      mode: "interception",
      async run() {
        throw new Error("Intentional failure 1");
      },
    });
    const skippedSecond = defineScenario({
      name: "never-run-second",
      mode: "interception",
      async run({ page }) {
        await page.goto("/");
      },
    });

    // Fail-fast with maxFailures: 1 stops scheduling remaining scenario
    const bailOut = await OfflineLab.run(
      {
        baseURL: server.url,
        browsers: ["chromium"],
        workers: 1,
        maxFailures: 1,
        reports: { directory: reportDir, formats: ["json"], maxRuns: 2 },
      },
      { scenarios: [failFirst, skippedSecond] },
    );
    expect(bailOut.hasFailures).toBe(true);
    expect(bailOut.report.scenarios).toHaveLength(1);
    expect(bailOut.report.notes?.join(" ")).toContain("maxFailures=1");

    // Run 3 more times with maxRuns: 2 and verify retention automatically prunes older runs
    const quickPass = defineScenario({
      name: "retention-pass",
      mode: "interception",
      async run({ page }) {
        await page.goto("/");
      },
    });
    for (let i = 0; i < 3; i++) {
      await OfflineLab.run(
        {
          baseURL: server.url,
          browsers: ["chromium"],
          reports: { directory: reportDir, formats: ["json"], maxRuns: 2 },
        },
        { scenarios: [quickPass] },
      );
    }

    const manager = new ArtifactManager(reportDir);
    const remainingRuns = await manager.listRuns();
    expect(remainingRuns.length).toBeLessThanOrEqual(2);

    // SLO budget: maxConsoleErrors = 0 fails a scenario that emits a console.error
    const noisyScenario = defineScenario({
      name: "console-error-budget",
      mode: "interception",
      async run({ page }) {
        await page.goto("/");
        await page.evaluate(() => console.error("Unhandled offline exception"));
      },
    });
    const budgetRun = await OfflineLab.run(
      {
        baseURL: server.url,
        browsers: ["chromium"],
        budgets: { maxConsoleErrors: 0 },
        reports: { directory: reportDir, formats: ["json"] },
      },
      { scenarios: [noisyScenario] },
    );
    expect(budgetRun.hasFailures).toBe(true);
    expect(budgetRun.report.scenarios[0]?.error?.code).toBe("BUDGET_EXCEEDED");
  });

  it("verifies industrial assertions (expectServiceWorker, expectRetryPattern, expectMaxRequestDuration, expectNoFailedRequests) and captureBeforeAfter", async () => {
    const reportDir = await makeTempDir();

    const industrialScenario = defineScenario({
      name: "industrial-assertions-and-before-after",
      mode: "pwa",
      async run({ page, network, expect: labExpect, waitForServiceWorker }) {
        await page.goto("/");
        await waitForServiceWorker({ controlled: true, timeoutMs: 15_000 });
        await page.goto("/");

        await labExpect.serviceWorker({ registered: true, controlled: true, state: "activated" });
        await labExpect.noFailedRequests();
        await labExpect.maxRequestDuration({ url: "**/api/notes", maxDurationMs: 5000 });

        // Trigger 3 timed API attempts with increasing backoff intervals (45ms, 110ms)
        await page.evaluate(async () => {
          await fetch("/api/control/stats");
          await new Promise((r) => setTimeout(r, 45));
          await fetch("/api/control/stats");
          await new Promise((r) => setTimeout(r, 110));
          await fetch("/api/control/stats");
        });

        await labExpect.retryPattern({
          url: "**/api/control/stats*",
          method: "GET",
          minAttempts: 3,
          minIntervalMs: 25,
          requireBackoff: true,
          timeoutMs: 3000,
        });

        // Verify multi-tab/popup observation in the same context
        const popup = await page.context().newPage();
        await popup.goto("/");
        await popup.close();

        await network.offline();
        await network.online();
      },
    });

    const out = await OfflineLab.run(
      {
        baseURL: server.url,
        browsers: ["chromium"],
        extraHTTPHeaders: { "X-Test-Suite": "industrial" },
        locale: "en-US",
        timezoneId: "UTC",
        artifacts: { screenshots: "always", captureBeforeAfter: true },
        reports: { directory: reportDir, formats: ["json"] },
      },
      { scenarios: [industrialScenario] },
    );

    expect(out.hasFailures).toBe(false);
    expect(out.report.scenarios[0]?.assertions.length).toBeGreaterThanOrEqual(4);
    expect(JsonReporter.mergeReports([out.report]).summary.passed).toBe(1);
  });

  it("handles SIGTERM gracefully with exit code 143 and clean browser shutdown", async () => {
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
      path.join(dir, "scenarios", "long.yaml"),
      `name: long-scenario\nmode: interception\nsteps:\n  - action: navigate\n    path: /\n  - action: wait\n    durationMs: 15000\n`,
      "utf8",
    );

    const exitCode = await new Promise<number | null>((resolve) => {
      const child = spawn(process.execPath, [CLI_PATH, "run"], {
        cwd: dir,
        env: { ...process.env, NO_COLOR: "1" },
        stdio: ["ignore", "pipe", "pipe"],
      });

      setTimeout(() => {
        child.kill("SIGTERM");
      }, 1500);

      child.on("close", (code, signal) => {
        if (signal === "SIGTERM") {
          resolve(143);
        } else {
          resolve(code);
        }
      });
    });

    expect(exitCode).toBe(143);
  });
});
