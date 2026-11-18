import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import { ArtifactManager, type RunArtifactLayout } from "../../artifacts/artifact-manager.js";
import { BrowserManager } from "../../browser/context/browser-manager.js";
import {
  OFFLINELAB_SCHEMA_VERSION,
  OFFLINELAB_TOOL_VERSION,
} from "../../config/defaults/defaults.js";
import { NetworkProfileRegistry } from "../../network/profiles/registry.js";
import { PluginManager } from "../../plugins/plugin-manager.js";
import { ReportGenerator, type GeneratedReportPaths } from "../../reporters/report-generator.js";
import type {
  BrowserName,
  OfflineLabConfig,
  ProgrammaticScenarioDefinition,
  RunReport,
  RunSummary,
  ScenarioDefinition,
  ScenarioResult,
} from "../../types/index.js";
import { ScenarioDiscovery } from "../scenarios/discovery.js";
import { ScenarioExecutor } from "../scenarios/executor.js";
import { AppServerManager } from "./app-server-manager.js";

const require = createRequire(import.meta.url);

export function getInstalledPlaywrightVersion(): string {
  try {
    const pkg = require("playwright/package.json") as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

export interface RunnerExecutionOptions {
  scenarios?: ScenarioDefinition[];
  scenarioNames?: string[];
  scenarioPattern?: string;
  profileOverride?: string;
  inspectUrl?: string;
  signal?: AbortSignal;
  onScenarioComplete?: (result: ScenarioResult) => void;
  onProgress?: (message: string) => void;
}

export interface RunnerExecutionOutput {
  report: RunReport;
  reportPaths: GeneratedReportPaths;
  layout: RunArtifactLayout;
  hasFailures: boolean;
}

interface ExecutionTask {
  scenario: ScenarioDefinition;
  browser: BrowserName;
}

export class OfflineLabRunner {
  private readonly config: OfflineLabConfig;
  private readonly browserManager: BrowserManager;
  private readonly appServerManager: AppServerManager;
  private readonly executor: ScenarioExecutor;
  private readonly reportGenerator: ReportGenerator;

  constructor(
    config: OfflineLabConfig,
    deps?: {
      browserManager?: BrowserManager;
      appServerManager?: AppServerManager;
      executor?: ScenarioExecutor;
      reportGenerator?: ReportGenerator;
    },
  ) {
    this.config = config;
    this.browserManager = deps?.browserManager ?? new BrowserManager();
    this.appServerManager = deps?.appServerManager ?? new AppServerManager();
    this.executor = deps?.executor ?? new ScenarioExecutor();
    this.reportGenerator = deps?.reportGenerator ?? new ReportGenerator();
  }

  async run(options: RunnerExecutionOptions = {}): Promise<RunnerExecutionOutput> {
    const cwd = this.config.cwd ?? process.cwd();
    const runId = ArtifactManager.generateRunId();
    const startedAt = new Date().toISOString();
    const startHr = performance.now();

    const artifactManager = new ArtifactManager(this.config.reports.directory, cwd);
    const layout = await artifactManager.initRun(runId);

    const profileRegistry = new NetworkProfileRegistry(this.config.networkProfiles);
    const pluginManager = new PluginManager();
    await pluginManager.loadPlugins(this.config.plugins, profileRegistry);

    const runNotes: string[] = [];
    let scenariosToRun: ScenarioDefinition[] = [];

    if (options.inspectUrl) {
      scenariosToRun = [this.buildZeroConfigInspectionScenario(options.inspectUrl, runNotes)];
    } else if (options.scenarios && options.scenarios.length > 0) {
      scenariosToRun = ScenarioDiscovery.filterScenarios(
        options.scenarios,
        options.scenarioNames,
        options.scenarioPattern,
      );
    } else {
      scenariosToRun = await ScenarioDiscovery.discover({
        patterns: this.config.scenarios,
        cwd,
        filterNames: options.scenarioNames,
        filterPattern: options.scenarioPattern,
      });
    }

    const tasks = this.expandTasks(scenariosToRun);
    const results: ScenarioResult[] = new Array(tasks.length);

    const runAbort = new AbortController();
    const runTimeoutMs = this.config.timeouts?.runMs;
    const runTimer = runTimeoutMs
      ? setTimeout(() => runAbort.abort(new Error(`Run exceeded timeout of ${runTimeoutMs}ms`)), runTimeoutMs)
      : undefined;

    const onExternalAbort = () => runAbort.abort(options.signal?.reason);
    if (options.signal) {
      if (options.signal.aborted) {
        runAbort.abort(options.signal.reason);
      } else {
        options.signal.addEventListener("abort", onExternalAbort, { once: true });
      }
    }

    let serverStarted = false;
    try {
      if (this.config.webServer) {
        options.onProgress?.(`Starting webServer: ${this.config.webServer.command}`);
        const { reused } = await this.appServerManager.start(this.config.webServer, cwd);
        serverStarted = !reused;
        options.onProgress?.(
          reused
            ? `Reusing existing server at ${this.config.webServer.url}`
            : `Started webServer at ${this.config.webServer.url}`,
        );
      }

      const concurrency = Math.max(1, Math.min(this.config.workers, Math.max(1, tasks.length)));
      let cursor = 0;

      const worker = async () => {
        while (true) {
          if (runAbort.signal.aborted) break;
          const idx = cursor++;
          if (idx >= tasks.length) break;
          const task = tasks[idx]!;
          options.onProgress?.(`Running "${task.scenario.name}" on ${task.browser}...`);
          const res = await this.executor.execute({
            runId,
            scenario: task.scenario,
            browser: task.browser,
            config: this.config,
            browserManager: this.browserManager,
            profileRegistry,
            artifactManager,
            artifactLayout: layout,
            pluginManager,
            profileOverride: options.profileOverride,
            signal: runAbort.signal,
          });
          results[idx] = res;
          options.onScenarioComplete?.(res);
        }
      };

      const workers = Array.from({ length: concurrency }, () => worker());
      await Promise.all(workers);
    } finally {
      if (runTimer) clearTimeout(runTimer);
      if (options.signal) options.signal.removeEventListener("abort", onExternalAbort);

      await this.browserManager.closeAll();
      if (serverStarted) {
        await this.appServerManager.stop(this.config.webServer?.gracefulShutdownMs);
      }
      await pluginManager.teardown();
    }

    const completedResults = results.filter((r): r is ScenarioResult => Boolean(r));
    const completedAt = new Date().toISOString();
    const durationMs = Math.round(performance.now() - startHr);
    const summary = this.computeSummary(completedResults);
    const allArtifacts = completedResults.flatMap((r) => r.artifacts);

    const report: RunReport = {
      schemaVersion: OFFLINELAB_SCHEMA_VERSION,
      runId,
      toolVersion: OFFLINELAB_TOOL_VERSION,
      startedAt,
      completedAt,
      durationMs,
      environment: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        playwrightVersion: getInstalledPlaywrightVersion(),
        baseURL: options.inspectUrl ?? this.config.baseURL,
        browsers: Array.from(new Set(tasks.map((t) => t.browser))),
        ci: Boolean(process.env.CI),
      },
      summary,
      scenarios: completedResults,
      artifacts: allArtifacts,
      notes: runNotes.length > 0 ? runNotes : undefined,
    };

    const reportPaths = await this.reportGenerator.generate(
      report,
      layout,
      this.config.reports.formats,
      pluginManager,
    );
    await artifactManager.writeRunMetadata(layout, report);

    const hasUnsupportedFailure =
      this.config.unsupportedPolicy === "fail" && summary.unsupported > 0;
    const hasFailures = summary.failed > 0 || hasUnsupportedFailure;

    return {
      report,
      reportPaths,
      layout,
      hasFailures,
    };
  }

  private expandTasks(scenarios: ScenarioDefinition[]): ExecutionTask[] {
    const tasks: ExecutionTask[] = [];
    for (const scenario of scenarios) {
      const browsers: BrowserName[] = scenario.browsers
        ? scenario.browsers
        : scenario.browser
          ? [scenario.browser]
          : this.config.browsers;

      for (const browser of browsers) {
        tasks.push({ scenario, browser });
      }
    }
    return tasks;
  }

  private computeSummary(scenarios: ScenarioResult[]): RunSummary {
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    let unsupported = 0;
    let totalAssertions = 0;
    let passedAssertions = 0;
    let failedAssertions = 0;
    let totalRequests = 0;
    let failedRequests = 0;
    let injectedFaults = 0;

    for (const s of scenarios) {
      if (s.status === "passed") passed += 1;
      else if (s.status === "failed") failed += 1;
      else if (s.status === "skipped") skipped += 1;
      else if (s.status === "unsupported") unsupported += 1;

      totalAssertions += s.assertions.length;
      passedAssertions += s.assertions.filter((a) => a.status === "passed").length;
      failedAssertions += s.assertions.filter((a) => a.status === "failed").length;

      totalRequests += s.requests.length;
      failedRequests += s.requests.filter((r) => r.failed).length;
      injectedFaults += s.requests.filter((r) => Boolean(r.injectedRuleId)).length;
    }

    return {
      total: scenarios.length,
      passed,
      failed,
      skipped,
      unsupported,
      totalAssertions,
      passedAssertions,
      failedAssertions,
      totalRequests,
      failedRequests,
      injectedFaults,
    };
  }

  /**
   * Mode A: Zero-config URL inspection.
   * Performs real online baseline capture, SW/Cache inspection, offline reload probe, and online restoration.
   * Explicitly states what was observed vs. what still requires app-specific assertions.
   */
  private buildZeroConfigInspectionScenario(
    targetUrl: string,
    runNotes: string[],
  ): ProgrammaticScenarioDefinition {
    return {
      name: "zero-config-offline-inspection",
      description: `Automated zero-config offline inspection of ${targetUrl}`,
      mode: "auto",
      baseURL: targetUrl,
      run: async (ctx) => {
        // 1-3. Navigate online and capture baseline state
        const onlineResponse = await ctx.page.goto(targetUrl, { waitUntil: "load" });
        const onlineStatus = onlineResponse?.status() ?? 0;
        ctx.expect(onlineStatus).toBeGreaterThan(0);
        await ctx.screenshot("baseline-online");

        // 4. Observe initial requests, Service Worker, and Cache Storage
        const swOnline = await ctx.inspectServiceWorker();
        const cacheOnline = await ctx.inspectCache();
        ctx.markEvent("Baseline captured", {
          onlineStatus,
          swRegistered: swOnline.registrations.length > 0,
          swControlled: swOnline.controlled,
          cacheEntries: cacheOnline.totalEntries,
        });

        // 5-6. Go offline and probe offline reload behavior safely
        await ctx.network.offline();
        let offlineReloadSucceeded = false;
        let offlineReloadError: string | undefined;
        try {
          await ctx.page.reload({ waitUntil: "domcontentloaded", timeout: 10_000 });
          offlineReloadSucceeded = true;
        } catch (err) {
          offlineReloadError = err instanceof Error ? err.message : String(err);
        }

        await ctx.screenshot("offline-probe").catch(() => {});
        ctx.markEvent("Offline reload probe completed", {
          offlineReloadSucceeded,
          offlineReloadError,
        });

        // 7. Restore connectivity and verify recovery
        await ctx.network.online();
        const recoveryResponse = await ctx.page.goto(targetUrl, { waitUntil: "domcontentloaded" });
        ctx.expect(recoveryResponse?.status() ?? 0).toBeGreaterThan(0);
        await ctx.screenshot("restored-online");

        // 10. Honest scope reporting: never claim full offline-readiness solely because a page opened
        runNotes.push(
          `Verified: Online load (HTTP ${onlineStatus}), Service Worker registrations (${swOnline.registrations.length}, controlled=${swOnline.controlled}), Cache Storage entries (${cacheOnline.totalEntries}), offline reload probe (${offlineReloadSucceeded ? "rendered while offline" : `failed: ${offlineReloadError ?? "network error"}`}), and online restoration.`,
        );
        runNotes.push(
          "Not verified by zero-config inspection: application-specific offline UI states, offline form submission/persistence, IndexedDB queue integrity, reconnection synchronization, conflict resolution, and API fault recovery. Run `offlinelab init` to author application-specific assertions.",
        );
      },
    };
  }
}
