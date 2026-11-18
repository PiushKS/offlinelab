import crypto from "node:crypto";
import { performance } from "node:perf_hooks";
import type {
  ArtifactManager,
  RunArtifactLayout,
} from "../../artifacts/artifact-manager.js";
import { BrowserAdapter } from "../../browser/adapters/browser-adapter.js";
import type { BrowserManager, ManagedBrowserSession } from "../../browser/context/browser-manager.js";
import { ServiceWorkerInspector } from "../../browser/service-workers/sw-inspector.js";
import { StorageInspector } from "../../browser/storage/storage-inspector.js";
import { NetworkController } from "../../network/controller/network-controller.js";
import { matchesUrlPattern } from "../../network/faults/fault-engine.js";
import type { NetworkProfileRegistry } from "../../network/profiles/registry.js";
import type { PluginManager } from "../../plugins/plugin-manager.js";
import { Redactor } from "../../security/redactor.js";
import type {
  ArtifactReference,
  BrowserName,
  DiagnosticItem,
  ExecutionMode,
  InspectionSnapshot,
  OfflineLabConfig,
  ScenarioDefinition,
  ScenarioResult,
  ScenarioRuntimeContext,
  ScenarioStep,
  ServiceWorkerPolicy,
  StepResult,
  StorageSnapshot,
} from "../../types/index.js";
import { AssertionEngine } from "../assertions/assertion-engine.js";
import {
  OfflineLabError,
  TimeoutError,
  UnsupportedCapabilityError,
} from "../errors/index.js";
import { EventRecorder } from "../events/event-recorder.js";
import { isProgrammaticScenario } from "./discovery.js";

export interface ScenarioExecutionInput {
  runId: string;
  scenario: ScenarioDefinition;
  browser: BrowserName;
  config: OfflineLabConfig;
  browserManager: BrowserManager;
  profileRegistry: NetworkProfileRegistry;
  artifactManager: ArtifactManager;
  artifactLayout: RunArtifactLayout;
  pluginManager?: PluginManager;
  profileOverride?: string;
  signal?: AbortSignal;
}

function resolveTargetUrl(stepUrl: string | undefined, stepPath: string | undefined, baseURL?: string): string {
  if (stepUrl) return stepUrl;
  if (!stepPath) return baseURL ?? "about:blank";
  if (/^https?:\/\//i.test(stepPath)) return stepPath;
  if (!baseURL) return stepPath;
  return new URL(stepPath, baseURL).toString();
}

export class ScenarioExecutor {
  async execute(input: ScenarioExecutionInput): Promise<ScenarioResult> {
    const maxAttempts = (input.scenario.retries ?? input.config.retries ?? 0) + 1;
    let lastResult: ScenarioResult | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (input.signal?.aborted) {
        break;
      }
      lastResult = await this.executeAttempt(input, attempt);
      if (lastResult.status === "passed" && attempt > 1) {
        lastResult.flaky = true;
      }
      if (
        lastResult.status === "passed" ||
        lastResult.status === "skipped" ||
        lastResult.status === "unsupported"
      ) {
        return lastResult;
      }
    }

    return lastResult!;
  }

  private async executeAttempt(
    input: ScenarioExecutionInput,
    attempt: number,
  ): Promise<ScenarioResult> {
    const {
      runId,
      scenario,
      browser,
      config,
      browserManager,
      profileRegistry,
      artifactManager,
      artifactLayout,
      pluginManager,
    } = input;

    const scenarioId = `${scenario.name}-${browser}-${crypto.randomUUID().slice(0, 6)}`;
    const startedAt = new Date().toISOString();
    const startHr = performance.now();
    const adapter = new BrowserAdapter(browser);
    const effectiveMode: ExecutionMode = scenario.mode ?? config.mode ?? "auto";
    const effectiveSwPolicy: ServiceWorkerPolicy =
      scenario.serviceWorkers ??
      (effectiveMode === "interception" ? "block" : effectiveMode === "pwa" ? "allow" : config.serviceWorkers);

    const redactor = new Redactor(config.redaction);
    const eventRecorder = new EventRecorder({
      runId,
      scenarioId,
      maxRequests: config.artifacts.maxNetworkEvents ?? 1000,
      redactor,
      listeners: pluginManager?.getEventListeners(),
    });

    const swInspector = new ServiceWorkerInspector(redactor);
    const storageInspector = new StorageInspector(redactor, swInspector);

    const steps: StepResult[] = [];
    const artifacts: ArtifactReference[] = [];
    const diagnostics: DiagnosticItem[] = [];
    const storageSnapshots: Array<{ name: string; snapshot: StorageSnapshot }> = [];

    // Pre-flight capability checks
    const unsupportedReason = this.checkPreFlightCapabilities(scenario, effectiveMode, adapter);
    if (unsupportedReason) {
      if (config.unsupportedPolicy === "skip") {
        eventRecorder.record("scenario.unsupported", { reason: unsupportedReason }, "warning");
        return {
          id: scenarioId,
          name: scenario.name,
          description: scenario.description,
          sourcePath: scenario.sourcePath,
          browser,
          mode: effectiveMode,
          status: "unsupported",
          reason: unsupportedReason,
          startedAt,
          completedAt: new Date().toISOString(),
          durationMs: Math.round(performance.now() - startHr),
          attempts: attempt,
          profilesUsed: [],
          steps: [],
          assertions: [],
          events: eventRecorder.getEvents(),
          requests: [],
          consoleErrors: [],
          artifacts: [],
          diagnostics: [
            {
              code: "UNSUPPORTED_CAPABILITY",
              severity: "warning",
              title: `Unsupported capability on ${browser}`,
              explanation: unsupportedReason,
              suggestion: "Execute this scenario on Chromium or adjust capability requirements.",
            },
          ],
          capabilities: adapter.capabilities,
        };
      }
      if (config.unsupportedPolicy === "fail") {
        const err = new UnsupportedCapabilityError(unsupportedReason, { browser });
        return {
          id: scenarioId,
          name: scenario.name,
          description: scenario.description,
          sourcePath: scenario.sourcePath,
          browser,
          mode: effectiveMode,
          status: "failed",
          reason: unsupportedReason,
          startedAt,
          completedAt: new Date().toISOString(),
          durationMs: Math.round(performance.now() - startHr),
          attempts: attempt,
          profilesUsed: [],
          steps: [],
          assertions: [],
          events: eventRecorder.getEvents(),
          requests: [],
          consoleErrors: [],
          artifacts: [],
          diagnostics: [
            {
              code: "UNSUPPORTED_CAPABILITY",
              severity: "error",
              title: `Unsupported capability on ${browser}`,
              explanation: unsupportedReason,
              suggestion: "Execute this scenario on Chromium or set unsupportedPolicy: 'skip'.",
            },
          ],
          capabilities: adapter.capabilities,
          error: {
            name: err.name,
            message: err.message,
            code: err.code,
          },
        };
      }
      // warn policy: record diagnostic and continue
      diagnostics.push({
        code: "UNSUPPORTED_CAPABILITY_WARNING",
        severity: "warning",
        title: `Partial browser capability on ${browser}`,
        explanation: unsupportedReason,
        suggestion: "Verify this scenario on Chromium for complete capability coverage.",
      });
    }

    const scenarioAbort = new AbortController();
    const scenarioTimeoutMs =
      scenario.timeoutMs ?? config.timeouts?.scenarioMs ?? Math.max(config.timeoutMs * 2, 60_000);
    let timedOut = false;

    const scenarioTimer = setTimeout(() => {
      timedOut = true;
      scenarioAbort.abort(
        new TimeoutError(`Scenario "${scenario.name}" exceeded timeout of ${scenarioTimeoutMs}ms.`, scenarioTimeoutMs),
      );
    }, scenarioTimeoutMs);

    const onParentAbort = () => scenarioAbort.abort(input.signal?.reason);
    if (input.signal) {
      if (input.signal.aborted) {
        clearTimeout(scenarioTimer);
        scenarioAbort.abort(input.signal.reason);
      } else {
        input.signal.addEventListener("abort", onParentAbort, { once: true });
      }
    }

    let session: ManagedBrowserSession | undefined;
    let networkController: NetworkController | undefined;
    let tracingStarted = false;
    let status: ScenarioResult["status"] = "passed";
    let caughtError: unknown;
    let latestSwSnapshot: ScenarioResult["serviceWorker"];
    let latestCacheSnapshot: ScenarioResult["cacheStorage"];
    let assertionEngine: AssertionEngine | undefined;
    let baselineCaptured = false;

    try {
      session = await browserManager.createSession({
        browser,
        headless: config.headless,
        baseURL: scenario.baseURL ?? config.baseURL,
        serviceWorkers: effectiveSwPolicy,
        device: scenario.device ?? config.device,
        proxy: config.proxy,
        ignoreHTTPSErrors: config.ignoreHTTPSErrors,
        extraHTTPHeaders: config.extraHTTPHeaders,
        locale: config.locale,
        timezoneId: config.timezoneId,
        storageState: scenario.storageState ?? config.auth?.storageState,
        persistentProfileDir: config.auth?.persistentProfileDir,
        timeoutMs: config.timeouts?.browserLaunchMs ?? 30_000,
      });

      eventRecorder.record("browser.launched", {
        browser,
        headless: config.headless,
        mode: effectiveMode,
        serviceWorkers: effectiveSwPolicy,
      });

      // Start tracing if configured
      if (config.artifacts.traces === "always" || config.artifacts.traces === "on-failure") {
        await session.context.tracing.start({
          screenshots: true,
          snapshots: true,
          sources: false,
        });
        tracingStarted = true;
      }

      if (config.auth?.setup) {
        await config.auth.setup(session.context, session.page);
      }

      networkController = new NetworkController({
        context: session.context,
        page: session.page,
        adapter: session.adapter,
        eventRecorder,
        profileRegistry,
        signal: scenarioAbort.signal,
      });

      if (input.profileOverride) {
        await networkController.setProfile(input.profileOverride);
      }

      const runtimeContextBox: { current?: ScenarioRuntimeContext } = {};

      assertionEngine = new AssertionEngine({
        page: session.page,
        eventRecorder,
        swInspector,
        storageInspector,
        pluginManager,
        defaultTimeoutMs: config.timeouts?.assertionMs ?? 10_000,
        getRuntimeContext: () => runtimeContextBox.current!,
      });

      const captureScreenshotHelper = async (
        name: string,
        opts?: { fullPage?: boolean },
      ): Promise<string> => {
        const ref = await artifactManager.captureScreenshot(
          session!.page,
          artifactLayout,
          scenarioId,
          name,
          opts?.fullPage ?? false,
        );
        artifacts.push(ref);
        eventRecorder.record("screenshot.captured", {
          name,
          relativePath: ref.relativePath,
        });
        return ref.path;
      };

      const inspectHelper = async (): Promise<InspectionSnapshot> => {
        const sw = await swInspector.inspect(session!.page);
        const cache = await swInspector.inspectCacheStorage(session!.page);
        latestSwSnapshot = sw;
        latestCacheSnapshot = cache;
        return {
          url: redactor.redactUrl(session!.page.url()),
          title: await session!.page.title().catch(() => ""),
          online: !networkController!.isOffline(),
          activeProfile: networkController!.getActiveProfile(),
          serviceWorker: sw,
          cacheStorage: cache,
          consoleErrorCount: eventRecorder.getConsoleErrors().length,
          requestCount: eventRecorder.getRequests().length,
          failedRequestCount: eventRecorder.getRequests().filter((r) => r.failed).length,
          capturedAt: new Date().toISOString(),
        };
      };

      const runtimeContext: ScenarioRuntimeContext = {
        page: session.page,
        context: session.context,
        network: networkController,
        expect: assertionEngine.createExpectFunction(),
        baseURL: scenario.baseURL ?? config.baseURL,
        browser,
        mode: effectiveMode,
        signal: scenarioAbort.signal,
        inspect: inspectHelper,
        inspectServiceWorker: async () => {
          const sw = await swInspector.inspect(session!.page);
          latestSwSnapshot = sw;
          return sw;
        },
        inspectCache: async () => {
          const cache = await swInspector.inspectCacheStorage(session!.page);
          latestCacheSnapshot = cache;
          return cache;
        },
        inspectStorage: async (opts) => {
          const snap = await storageInspector.inspect(session!.page, opts);
          storageSnapshots.push({ name: `storage-${storageSnapshots.length + 1}`, snapshot: snap });
          return snap;
        },
        waitForServiceWorker: async (opts) => {
          const sw = await swInspector.waitForServiceWorker(session!.page, {
            controlled: opts?.controlled,
            state: opts?.state as "installing" | "installed" | "activating" | "activated" | undefined,
            timeoutMs: opts?.timeoutMs,
          });
          latestSwSnapshot = sw;
          eventRecorder.record("serviceWorker.ready", {
            controlled: sw.controlled,
            registrations: sw.registrations.length,
          });
          return sw;
        },
        screenshot: captureScreenshotHelper,
        markEvent: (label, details) => {
          eventRecorder.record("timeline.mark", { label, ...(details ?? {}) });
        },
        getRequests: () => eventRecorder.getRequests(),
        getConsoleErrors: () => eventRecorder.getConsoleErrors(),
      };
      runtimeContextBox.current = runtimeContext;

      const activeSession = session;
      const activeNetwork = networkController;
      const activeAssertions = assertionEngine;

      // Execute scenario with race against scenario-level abort/timeout
      const runBody = async () => {
        if (isProgrammaticScenario(scenario)) {
          const stepStart = performance.now();
          const stepStartedAt = new Date().toISOString();
          try {
            await scenario.run(runtimeContext);
            steps.push({
              index: 0,
              action: "run",
              description: "Execute TypeScript scenario function",
              status: "passed",
              startedAt: stepStartedAt,
              durationMs: Math.round(performance.now() - stepStart),
            });
          } catch (err) {
            steps.push({
              index: 0,
              action: "run",
              description: "Execute TypeScript scenario function",
              status: "failed",
              startedAt: stepStartedAt,
              durationMs: Math.round(performance.now() - stepStart),
              error: err instanceof Error ? err.message : String(err),
            });
            throw err;
          }
        } else {
          for (let i = 0; i < scenario.steps.length; i++) {
            if (scenarioAbort.signal.aborted) {
              throw scenarioAbort.signal.reason ?? new Error("Scenario aborted");
            }
            const step = scenario.steps[i]!;
            const stepResult = await this.executeYamlStep({
              index: i,
              step,
              session: activeSession,
              network: activeNetwork,
              assertions: activeAssertions,
              swInspector,
              storageInspector,
              eventRecorder,
              config,
              baseURL: scenario.baseURL ?? config.baseURL,
              signal: scenarioAbort.signal,
              captureScreenshot: captureScreenshotHelper,
              onSwSnapshot: (sw) => {
                latestSwSnapshot = sw;
              },
              onCacheSnapshot: (cache) => {
                latestCacheSnapshot = cache;
              },
              onStorageSnapshot: (name, snap) => {
                storageSnapshots.push({ name, snapshot: snap });
              },
              captureBaselineIfNeeded: async () => {
                if (
                  !baselineCaptured &&
                  config.artifacts.baselineScreenshot &&
                  config.artifacts.screenshots !== "never"
                ) {
                  baselineCaptured = true;
                  await captureScreenshotHelper("baseline").catch(() => {});
                }
              },
            });
            steps.push(stepResult);
          }
        }
      };

      await Promise.race([
        runBody(),
        new Promise<never>((_, reject) => {
          if (scenarioAbort.signal.aborted) {
            reject(scenarioAbort.signal.reason ?? new Error("Scenario aborted"));
            return;
          }
          scenarioAbort.signal.addEventListener(
            "abort",
            () => reject(scenarioAbort.signal.reason ?? new Error("Scenario aborted")),
            { once: true },
          );
        }),
      ]);

      // Final PWA inspection snapshot when page is open and valid
      if (session.page.url() && !session.page.url().startsWith("about:")) {
        if (!latestSwSnapshot && effectiveSwPolicy === "allow") {
          latestSwSnapshot = await swInspector.inspect(session.page).catch(() => undefined);
        }
        if (!latestCacheSnapshot && effectiveSwPolicy === "allow") {
          latestCacheSnapshot = await swInspector
            .inspectCacheStorage(session.page)
            .catch(() => undefined);
        }
        if (config.artifacts.screenshots === "always") {
          await captureScreenshotHelper("final").catch(() => {});
        }
      }
    } catch (err) {
      caughtError = err;
      if (
        err &&
        typeof err === "object" &&
        "__stepResult" in err &&
        (err as { __stepResult?: StepResult }).__stepResult
      ) {
        steps.push((err as { __stepResult: StepResult }).__stepResult);
      }
      if (err instanceof UnsupportedCapabilityError && config.unsupportedPolicy === "skip") {
        status = "unsupported";
      } else {
        status = "failed";
      }

      // Capture failure screenshot while page is still alive (never discard artifacts on failure)
      if (
        session &&
        !session.page.isClosed() &&
        config.artifacts.screenshots !== "never"
      ) {
        try {
          const failRef = await artifactManager.captureScreenshot(
            session.page,
            artifactLayout,
            scenarioId,
            "failure",
            true,
          );
          artifacts.push(failRef);
          eventRecorder.record("screenshot.captured", {
            name: "failure",
            relativePath: failRef.relativePath,
          });
        } catch {
          // Page may have crashed
        }
      }

      // Capture final SW/Cache state if possible for failure diagnostics
      if (session && !session.page.isClosed() && effectiveSwPolicy === "allow") {
        latestSwSnapshot =
          latestSwSnapshot ?? (await swInspector.inspect(session.page).catch(() => undefined));
        latestCacheSnapshot =
          latestCacheSnapshot ??
          (await swInspector.inspectCacheStorage(session.page).catch(() => undefined));
      }
    } finally {
      clearTimeout(scenarioTimer);
      if (input.signal) {
        input.signal.removeEventListener("abort", onParentAbort);
      }

      // Save or discard Playwright trace
      if (session && tracingStarted) {
        const shouldSaveTrace =
          config.artifacts.traces === "always" ||
          (config.artifacts.traces === "on-failure" && status === "failed");

        try {
          if (shouldSaveTrace) {
            const tracePath = artifactManager.getTracePath(artifactLayout, scenarioId);
            await session.context.tracing.stop({ path: tracePath });
            const traceRef = await artifactManager.registerTraceArtifact(
              artifactLayout,
              scenarioId,
              tracePath,
            );
            if (traceRef) {
              artifacts.push(traceRef);
            }
          } else {
            await session.context.tracing.stop();
          }
        } catch {
          // Context may have crashed
        }
      }

      if (networkController) {
        await networkController.dispose();
      }

      if (session && config.auth?.teardown) {
        await config.auth.teardown(session.context).catch(() => {});
      }

      if (session) {
        await session.close();
      }
    }

    // Write redacted logs as artifacts
    const consoleErrors = eventRecorder.getConsoleErrors();
    const requests = eventRecorder.getRequests();
    if (consoleErrors.length > 0) {
      const consoleArt = await artifactManager
        .writeJsonLog(artifactLayout, scenarioId, "console-log", "console-errors", consoleErrors)
        .catch(() => undefined);
      if (consoleArt) artifacts.push(consoleArt);
    }
    if (requests.length > 0) {
      const reqArt = await artifactManager
        .writeJsonLog(artifactLayout, scenarioId, "request-log", "requests", requests)
        .catch(() => undefined);
      if (reqArt) artifacts.push(reqArt);
    }

    // Enforce optional scenario-level SLO budgets if scenario passed
    if (status === "passed" && config.budgets) {
      if (
        config.budgets.maxConsoleErrors !== undefined &&
        consoleErrors.length > config.budgets.maxConsoleErrors
      ) {
        status = "failed";
        caughtError = new OfflineLabError(
          `Budget exceeded: observed ${consoleErrors.length} console error(s), limit is ${config.budgets.maxConsoleErrors}.`,
          {
            code: "BUDGET_EXCEEDED",
            exitCode: 1,
            suggestion: "Fix uncaught console errors or adjust `budgets.maxConsoleErrors`.",
          },
        );
      } else if (config.budgets.maxUninjectedFailedRequests !== undefined) {
        const uninjectedFailed = requests.filter((r) => r.failed && !r.injectedRuleId).length;
        if (uninjectedFailed > config.budgets.maxUninjectedFailedRequests) {
          status = "failed";
          caughtError = new OfflineLabError(
            `Budget exceeded: observed ${uninjectedFailed} uninjected failed request(s), limit is ${config.budgets.maxUninjectedFailedRequests}.`,
            {
              code: "BUDGET_EXCEEDED",
              exitCode: 1,
              suggestion:
                "Investigate unexpected failed network requests or adjust `budgets.maxUninjectedFailedRequests`.",
            },
          );
        }
      }
    }

    // Build evidence-based diagnostics
    diagnostics.push(
      ...this.buildDiagnostics({
        status,
        error: caughtError,
        timedOut,
        consoleErrors,
        requests,
        swSnapshot: latestSwSnapshot,
        mode: effectiveMode,
        browser,
      }),
    );

    const completedAt = new Date().toISOString();
    const durationMs = Math.round(performance.now() - startHr);

    eventRecorder.record(
      "scenario.completed",
      {
        status,
        durationMs,
        attempts: attempt,
      },
      status === "failed" ? "error" : "info",
    );

    const serializedError = caughtError
      ? {
          name: caughtError instanceof Error ? caughtError.name : "Error",
          message: redactor.redactText(
            caughtError instanceof Error ? caughtError.message : String(caughtError),
          ),
          code: caughtError instanceof OfflineLabError ? caughtError.code : undefined,
          stack:
            caughtError instanceof Error && caughtError.stack
              ? redactor.redactText(caughtError.stack)
              : undefined,
        }
      : undefined;

    return {
      id: scenarioId,
      name: scenario.name,
      description: scenario.description,
      sourcePath: scenario.sourcePath,
      browser,
      mode: effectiveMode,
      status,
      reason: serializedError?.message,
      startedAt,
      completedAt,
      durationMs,
      attempts: attempt,
      profilesUsed: networkController?.getProfilesUsed() ?? [],
      steps,
      assertions: assertionEngine?.getResults() ?? [],
      events: eventRecorder.getEvents(),
      requests,
      consoleErrors,
      serviceWorker: latestSwSnapshot,
      cacheStorage: latestCacheSnapshot,
      storageSnapshots: storageSnapshots.length > 0 ? storageSnapshots : undefined,
      artifacts,
      diagnostics,
      capabilities: adapter.capabilities,
      error: serializedError,
    };
  }

  private checkPreFlightCapabilities(
    scenario: ScenarioDefinition,
    mode: ExecutionMode,
    adapter: BrowserAdapter,
  ): string | undefined {
    if (scenario.requires?.cdpThrottling && !adapter.capabilities.cdpNetworkThrottling) {
      return `Scenario "${scenario.name}" requires CDP network bandwidth throttling, which is not supported in ${adapter.browser}.`;
    }
    if (
      (scenario.requires?.serviceWorkers || mode === "pwa") &&
      !adapter.capabilities.serviceWorkerInspection
    ) {
      return `Scenario "${scenario.name}" requires Service Worker inspection/control (mode=${mode}), which is not reliably supported in headless ${adapter.browser}.`;
    }
    return undefined;
  }

  private async executeYamlStep(args: {
    index: number;
    step: ScenarioStep;
    session: ManagedBrowserSession;
    network: NetworkController;
    assertions: AssertionEngine;
    swInspector: ServiceWorkerInspector;
    storageInspector: StorageInspector;
    eventRecorder: EventRecorder;
    config: OfflineLabConfig;
    baseURL?: string;
    signal: AbortSignal;
    captureScreenshot: (name: string, opts?: { fullPage?: boolean }) => Promise<string>;
    onSwSnapshot: (sw: ScenarioResult["serviceWorker"]) => void;
    onCacheSnapshot: (cache: ScenarioResult["cacheStorage"]) => void;
    onStorageSnapshot: (name: string, snap: StorageSnapshot) => void;
    captureBaselineIfNeeded: () => Promise<void>;
  }): Promise<StepResult> {
    const { index, step, session, network, assertions, config, eventRecorder } = args;
    const { page } = session;
    const startedAt = new Date().toISOString();
    const startHr = performance.now();
    const stepTimeout = config.timeouts?.stepMs ?? 15_000;
    const navTimeout = config.timeouts?.navigationMs ?? 20_000;

    try {
      let details: Record<string, unknown> | undefined;

      switch (step.action) {
        case "navigate": {
          const targetUrl = resolveTargetUrl(step.url, step.path, args.baseURL);
          if (step.expectFailure) {
            let failedAsExpected = false;
            let errorMessage = "";
            try {
              await page.goto(targetUrl, {
                waitUntil: step.waitUntil ?? "domcontentloaded",
                timeout: step.timeoutMs ?? navTimeout,
              });
            } catch (err) {
              failedAsExpected = true;
              errorMessage = err instanceof Error ? err.message : String(err);
            }
            eventRecorder.record("page.navigated", {
              url: targetUrl,
              expectFailure: true,
              failedAsExpected,
              error: errorMessage || undefined,
            });
            details = { url: targetUrl, failedAsExpected, error: errorMessage || undefined };
            if (!failedAsExpected) {
              throw new Error(
                `Expected navigation to "${targetUrl}" to fail while offline, but it succeeded.`,
              );
            }
          } else {
            const response = await page.goto(targetUrl, {
              waitUntil: step.waitUntil ?? "load",
              timeout: step.timeoutMs ?? navTimeout,
            });
            eventRecorder.record("page.navigated", {
              url: targetUrl,
              status: response?.status(),
              fromServiceWorker: response?.fromServiceWorker() ?? false,
            });
            details = {
              url: targetUrl,
              status: response?.status(),
              fromServiceWorker: response?.fromServiceWorker() ?? false,
            };
            await args.captureBaselineIfNeeded();
          }
          break;
        }

        case "reload": {
          if (step.expectFailure) {
            let failedAsExpected = false;
            try {
              await page.reload({
                waitUntil: step.waitUntil ?? "domcontentloaded",
                timeout: step.timeoutMs ?? navTimeout,
              });
            } catch {
              failedAsExpected = true;
            }
            details = { failedAsExpected };
            if (!failedAsExpected) {
              throw new Error("Expected reload to fail, but it succeeded.");
            }
          } else {
            const response = await page.reload({
              waitUntil: step.waitUntil ?? "load",
              timeout: step.timeoutMs ?? navTimeout,
            });
            eventRecorder.record("page.reloaded", {
              url: page.url(),
              status: response?.status(),
              fromServiceWorker: response?.fromServiceWorker() ?? false,
            });
            details = {
              status: response?.status(),
              fromServiceWorker: response?.fromServiceWorker() ?? false,
            };
          }
          break;
        }

        case "click":
          await page.locator(step.selector).first().click({ timeout: step.timeoutMs ?? stepTimeout });
          break;

        case "fill":
          await page
            .locator(step.selector)
            .first()
            .fill(step.value, { timeout: step.timeoutMs ?? stepTimeout });
          break;

        case "press":
          if (step.selector) {
            await page
              .locator(step.selector)
              .first()
              .press(step.key, { timeout: step.timeoutMs ?? stepTimeout });
          } else {
            await page.keyboard.press(step.key);
          }
          break;

        case "select":
          await page
            .locator(step.selector)
            .first()
            .selectOption(step.value, { timeout: step.timeoutMs ?? stepTimeout });
          break;

        case "waitForSelector":
          await page.locator(step.selector).first().waitFor({
            state: step.state ?? "visible",
            timeout: step.timeoutMs ?? stepTimeout,
          });
          break;

        case "waitForURL":
          await page.waitForURL((u) => matchesUrlPattern(u.toString(), step.url) || u.toString().includes(step.url), {
            timeout: step.timeoutMs ?? stepTimeout,
          });
          break;

        case "waitForResponse":
          await page.waitForResponse(
            (res) => {
              const urlMatch =
                matchesUrlPattern(res.url(), step.url) || res.url().includes(step.url);
              const statusMatch = step.status === undefined || res.status() === step.status;
              return urlMatch && statusMatch;
            },
            { timeout: step.timeoutMs ?? stepTimeout },
          );
          break;

        case "waitForRequest":
          await page.waitForRequest(
            (req) => {
              const urlMatch =
                matchesUrlPattern(req.url(), step.url) || req.url().includes(step.url);
              const methodMatch =
                step.method === undefined ||
                req.method().toUpperCase() === step.method.toUpperCase();
              return urlMatch && methodMatch;
            },
            { timeout: step.timeoutMs ?? stepTimeout },
          );
          break;

        case "wait":
          await new Promise<void>((resolve, reject) => {
            if (args.signal.aborted) {
              reject(args.signal.reason ?? new Error("Scenario aborted"));
              return;
            }
            const timer = setTimeout(() => {
              args.signal.removeEventListener("abort", onAbort);
              resolve();
            }, step.durationMs);
            const onAbort = () => {
              clearTimeout(timer);
              reject(args.signal.reason ?? new Error("Scenario aborted"));
            };
            args.signal.addEventListener("abort", onAbort, { once: true });
          });
          details = { durationMs: step.durationMs, reason: step.reason };
          break;

        case "setNetwork":
          if (config.artifacts.captureBeforeAfter && config.artifacts.screenshots !== "never") {
            await args.captureScreenshot(`step-${index + 1}-setNetwork-before`).catch(() => {});
          }
          if (step.custom) {
            await network.setProfile(
              { ...step.custom, name: step.custom.name ?? step.profile },
              { requireBandwidthThrottling: step.requireBandwidthThrottling },
            );
          } else {
            await network.setProfile(step.profile, {
              requireBandwidthThrottling: step.requireBandwidthThrottling,
            });
          }
          if (config.artifacts.captureBeforeAfter && config.artifacts.screenshots !== "never") {
            await args.captureScreenshot(`step-${index + 1}-setNetwork-after`).catch(() => {});
          }
          details = { profile: step.profile };
          break;

        case "setOffline":
          if (config.artifacts.captureBeforeAfter && config.artifacts.screenshots !== "never") {
            await args.captureScreenshot(`step-${index + 1}-offline-before`).catch(() => {});
          }
          await network.offline();
          if (config.artifacts.captureBeforeAfter && config.artifacts.screenshots !== "never") {
            await args.captureScreenshot(`step-${index + 1}-offline-after`).catch(() => {});
          }
          break;

        case "setOnline":
          if (config.artifacts.captureBeforeAfter && config.artifacts.screenshots !== "never") {
            await args.captureScreenshot(`step-${index + 1}-online-before`).catch(() => {});
          }
          await network.online();
          if (config.artifacts.captureBeforeAfter && config.artifacts.screenshots !== "never") {
            await args.captureScreenshot(`step-${index + 1}-online-after`).catch(() => {});
          }
          break;

        case "injectFailure": {
          const ruleId = await network.failRequests({
            id: step.id,
            url: step.url,
            fault: step.fault,
            methods: step.methods,
            resourceTypes: step.resourceTypes,
            statusCode: step.statusCode,
            body: step.body,
            headers: step.headers,
            contentType: step.contentType,
            delayMs: step.delayMs,
            probability: step.probability,
            seed: step.seed,
            once: step.once,
            firstN: step.firstN,
            everyNth: step.everyNth,
            durationMs: step.durationMs,
            phase: step.phase,
            priority: step.priority,
          });
          details = { ruleId, fault: step.fault, url: step.url };
          break;
        }

        case "removeFailure":
          if (step.all || !step.id) {
            await network.clearRules();
          } else {
            await network.removeRule(step.id);
          }
          break;

        case "delayRequests": {
          const ruleId = await network.delayRequests({
            id: step.id,
            url: step.url,
            delayMs: step.delayMs,
            methods: step.methods,
            resourceTypes: step.resourceTypes,
            probability: step.probability,
            seed: step.seed,
            once: step.once,
            firstN: step.firstN,
          });
          details = { ruleId, delayMs: step.delayMs, url: step.url };
          break;
        }

        case "mockResponse": {
          const ruleId = await network.mockResponse({
            id: step.id,
            url: step.url,
            status: step.status,
            body: step.body,
            json: step.json,
            headers: step.headers,
            contentType: step.contentType,
            methods: step.methods,
            delayMs: step.delayMs,
            once: step.once,
          });
          details = { ruleId, status: step.status ?? 200, url: step.url };
          break;
        }

        case "startNetworkSchedule":
          network.startSchedule(step.steps, { repeat: step.repeat });
          details = { scheduledSteps: step.steps.length };
          break;

        case "stopNetworkSchedule":
          network.stopSchedule();
          break;

        case "waitForServiceWorker": {
          const sw = await args.swInspector.waitForServiceWorker(page, {
            controlled: step.controlled,
            state: step.state,
            timeoutMs: step.timeoutMs,
          });
          args.onSwSnapshot(sw);
          eventRecorder.record("serviceWorker.activated", {
            controlled: sw.controlled,
            registrations: sw.registrations.length,
          });
          details = { controlled: sw.controlled, registrations: sw.registrations.length };
          break;
        }

        case "inspectCache": {
          const cache = await args.swInspector.inspectCacheStorage(page);
          args.onCacheSnapshot(cache);
          details = { caches: cache.caches.length, totalEntries: cache.totalEntries };
          break;
        }

        case "inspectIndexedDB": {
          const dbs = await args.storageInspector.inspectIndexedDB(page, {
            databases: step.databases,
            stores: step.stores,
            includeValues: step.includeValues,
            maxRecords: step.maxRecords,
          });
          args.onStorageSnapshot(`indexeddb-${index + 1}`, {
            indexedDB: dbs,
            capturedAt: new Date().toISOString(),
          });
          details = { databases: dbs.map((d) => d.name) };
          break;
        }

        case "inspectLocalStorage": {
          const snap = await args.storageInspector.inspect(page, {
            includeLocalStorage: true,
            includeSessionStorage: false,
            includeIndexedDB: false,
            includeCacheStorage: false,
            allowedKeys: step.allowedKeys,
            includeValues: step.includeValues,
          });
          args.onStorageSnapshot(`localStorage-${index + 1}`, snap);
          details = { keyCount: Object.keys(snap.localStorage ?? {}).length };
          break;
        }

        case "captureStorageSnapshot": {
          const snap = await args.storageInspector.inspect(page, {
            includeLocalStorage: step.includeLocalStorage ?? true,
            includeSessionStorage: step.includeSessionStorage ?? true,
            includeIndexedDB: step.includeIndexedDB ?? true,
            includeCacheStorage: step.includeCacheStorage ?? true,
            includeValues: step.includeValues ?? false,
            allowedKeys: step.allowedKeys,
          });
          args.onStorageSnapshot(step.name ?? `snapshot-${index + 1}`, snap);
          break;
        }

        case "expectVisible":
          await assertions.expectVisible(step.selector, step.timeoutMs);
          break;

        case "expectHidden":
          await assertions.expectHidden(step.selector, step.timeoutMs);
          break;

        case "expectText":
          await assertions.expectText(step.selector, step.text, {
            exact: step.exact,
            timeoutMs: step.timeoutMs,
          });
          break;

        case "expectURL":
          await assertions.expectURL(step.url, {
            exact: step.exact,
            timeoutMs: step.timeoutMs,
          });
          break;

        case "expectRequestCount":
          await assertions.expectRequestCount({
            url: step.url,
            count: step.count,
            min: step.min,
            max: step.max,
            method: step.method,
            timeoutMs: step.timeoutMs,
          });
          break;

        case "expectResponseStatus":
          await assertions.expectResponseStatus({
            url: step.url,
            status: step.status,
            method: step.method,
            timeoutMs: step.timeoutMs,
          });
          break;

        case "expectNoConsoleErrors":
          await assertions.expectNoConsoleErrors(step.ignorePatterns);
          break;

        case "expectNoFailedRequests":
          await assertions.expectNoFailedRequests({
            ignorePatterns: step.ignorePatterns,
            includeInjected: step.includeInjected,
          });
          break;

        case "expectServiceWorker":
          await assertions.expectServiceWorker({
            registered: step.registered,
            controlled: step.controlled,
            state: step.state,
          });
          break;

        case "expectRetryPattern":
          await assertions.expectRetryPattern({
            url: step.url,
            method: step.method,
            minAttempts: step.minAttempts,
            maxAttempts: step.maxAttempts,
            minIntervalMs: step.minIntervalMs,
            requireBackoff: step.requireBackoff,
            timeoutMs: step.timeoutMs,
          });
          break;

        case "expectMaxRequestDuration":
          await assertions.expectMaxRequestDuration({
            url: step.url,
            maxDurationMs: step.maxDurationMs,
            method: step.method,
          });
          break;

        case "expectStorageValue":
          await assertions.expectStorageValue({
            storage: step.storage,
            key: step.key,
            value: step.value,
            exists: step.exists,
          });
          break;

        case "expectCacheContains":
          await assertions.expectCacheContains(step.urlPattern, step.cacheName);
          break;

        case "expectIndexedDBRecord":
          await assertions.expectIndexedDBRecord({
            database: step.database,
            store: step.store,
            minCount: step.minCount,
            count: step.count,
            match: step.match,
            timeoutMs: step.timeoutMs,
          });
          break;

        case "screenshot":
          await args.captureScreenshot(step.name, { fullPage: step.fullPage });
          break;

        case "snapshot": {
          const sw = await args.swInspector.inspect(page);
          const cache = await args.swInspector.inspectCacheStorage(page);
          args.onSwSnapshot(sw);
          args.onCacheSnapshot(cache);
          eventRecorder.record("snapshot.captured", {
            name: step.name ?? `snapshot-${index + 1}`,
            url: page.url(),
            online: !network.isOffline(),
            swControlled: sw.controlled,
            cachedEntries: cache.totalEntries,
          });
          break;
        }

        case "markTimelineEvent":
          eventRecorder.record("timeline.mark", {
            label: step.label,
            ...(step.details ?? {}),
          });
          break;

        case "customAssertion":
          await assertions.runCustomAssertion(step.name, step.options);
          break;
      }

      return {
        index,
        action: step.action,
        status: "passed",
        startedAt,
        durationMs: Math.round(performance.now() - startHr),
        details,
      };
    } catch (err) {
      const result: StepResult = {
        index,
        action: step.action,
        status: err instanceof UnsupportedCapabilityError ? "unsupported" : "failed",
        startedAt,
        durationMs: Math.round(performance.now() - startHr),
        error: err instanceof Error ? err.message : String(err),
      };
      // Attach failed step before rethrowing so result array preserves it
      throw Object.assign(err instanceof Error ? err : new Error(String(err)), {
        __stepResult: result,
      });
    }
  }

  private buildDiagnostics(input: {
    status: ScenarioResult["status"];
    error: unknown;
    timedOut: boolean;
    consoleErrors: ScenarioResult["consoleErrors"];
    requests: ScenarioResult["requests"];
    swSnapshot?: ScenarioResult["serviceWorker"];
    mode: ExecutionMode;
    browser: BrowserName;
  }): DiagnosticItem[] {
    const items: DiagnosticItem[] = [];

    if (input.timedOut) {
      items.push({
        code: "SCENARIO_TIMEOUT",
        severity: "error",
        title: "Scenario timed out",
        explanation: "The scenario did not complete within its configured timeout.",
        suggestion:
          "Check for unresolved network waits, missing UI selectors, or Service Worker activation stalls.",
      });
    }

    if (input.error instanceof OfflineLabError && input.error.suggestion) {
      items.push({
        code: input.error.code,
        severity: "error",
        title: input.error.name,
        explanation: input.error.message,
        suggestion: input.error.suggestion,
      });
    } else if (input.status === "failed" && input.error instanceof Error) {
      const msg = input.error.message;
      let suggestion = "Inspect the failed step, screenshot, and Playwright trace for details.";
      if (/ERR_INTERNET_DISCONNECTED|NS_ERROR_OFFLINE/i.test(msg)) {
        suggestion =
          "The page attempted a live network load while offline without a cached Service Worker response. Verify the Service Worker caches this route or set `expectFailure: true` for cold-cache tests.";
      } else if (/ERR_CONNECTION_REFUSED|ECONNREFUSED/i.test(msg)) {
        suggestion =
          "The target application server is unreachable. Start your local server or configure `webServer` in offlinelab.config.ts.";
      } else if (/Target page, context or browser has been closed/i.test(msg)) {
        suggestion =
          "The browser or page terminated unexpectedly during the scenario (possible crash or external close).";
      }

      items.push({
        code: "SCENARIO_FAILURE",
        severity: "error",
        title: "Scenario execution failed",
        explanation: msg,
        suggestion,
      });
    }

    if (
      input.mode === "pwa" &&
      input.swSnapshot &&
      input.swSnapshot.supported &&
      !input.swSnapshot.controlled
    ) {
      items.push({
        code: "SW_NOT_CONTROLLING",
        severity: "warning",
        title: "Page is not controlled by a Service Worker",
        explanation: `Found ${input.swSnapshot.registrations.length} registration(s), but navigator.serviceWorker.controller is null.`,
        suggestion:
          "Call `self.clients.claim()` in the Service Worker activate event or reload the page after activation before going offline.",
      });
    }

    const unexpectedFailedReqs = input.requests.filter(
      (r) => r.failed && !r.injectedRuleId,
    );
    if (input.status === "failed" && unexpectedFailedReqs.length > 0) {
      items.push({
        code: "FAILED_NETWORK_REQUESTS",
        severity: "warning",
        title: `${unexpectedFailedReqs.length} uninjected network request(s) failed`,
        explanation: "One or more requests failed without an explicit OfflineLab fault injection rule.",
        suggestion:
          "Inspect the Request Explorer to see which assets or API endpoints failed during offline/degraded states.",
        evidence: unexpectedFailedReqs
          .slice(0, 5)
          .map((r) => `${r.method} ${r.url} (${r.status ?? r.failureReason ?? "failed"})`),
      });
    }

    if (input.consoleErrors.length > 0) {
      items.push({
        code: "CONSOLE_ERRORS_OBSERVED",
        severity: input.status === "failed" ? "error" : "warning",
        title: `${input.consoleErrors.length} browser console error(s) observed`,
        explanation: "The application emitted uncaught errors or console.error messages during the run.",
        suggestion: "Review the Console Errors section to verify whether these errors indicate unhandled offline exceptions.",
        evidence: input.consoleErrors.slice(0, 5).map((e) => `[${e.type}] ${e.text}`),
      });
    }

    return items;
  }
}
