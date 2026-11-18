import { performance } from "node:perf_hooks";
import type { BrowserContext, Page, Request, Route, WebSocket } from "playwright";
import type { BrowserAdapter, ChromiumCdpNetworkAdapter } from "../../browser/adapters/browser-adapter.js";
import { UnsupportedCapabilityError } from "../../core/errors/index.js";
import type { EventRecorder } from "../../core/events/event-recorder.js";
import { NetworkScheduler } from "../../core/scheduler/network-scheduler.js";
import type {
  BrowserCapabilities,
  FaultRuleConfig,
  FaultType,
  NetworkProfileConfig,
  NetworkProfileName,
  NetworkScheduleStep,
  ScenarioNetworkAPI,
} from "../../types/index.js";
import { FaultInjectionEngine, faultToHttpStatus } from "../faults/fault-engine.js";
import { NetworkProfileRegistry } from "../profiles/registry.js";

export interface NetworkControllerOptions {
  context: BrowserContext;
  page: Page;
  adapter: BrowserAdapter;
  eventRecorder: EventRecorder;
  profileRegistry?: NetworkProfileRegistry;
  enableRouteInterception?: boolean;
  signal?: AbortSignal;
}

/**
 * Coordinates browser offline emulation, CDP bandwidth/latency throttling,
 * Playwright route-level fault/latency injection, request recording, and scheduled transitions.
 */
export class NetworkController implements ScenarioNetworkAPI {
  private readonly context: BrowserContext;
  private readonly page: Page;
  private readonly adapter: BrowserAdapter;
  private readonly eventRecorder: EventRecorder;
  private readonly profileRegistry: NetworkProfileRegistry;
  private readonly faultEngine = new FaultInjectionEngine();
  private readonly scheduler = new NetworkScheduler();
  private readonly cdpAdapter: ChromiumCdpNetworkAdapter | null;
  private readonly signal?: AbortSignal;

  private offlineState = false;
  private activeProfileName = "online";
  private activeProfileLatencyMs = 0;
  private profilesUsed = new Set<string>(["online"]);
  private flakyRuleId: string | undefined;
  private unstableTimer: ReturnType<typeof setInterval> | undefined;
  private routeInstalled = false;
  private routeHandler?: (route: Route) => Promise<void>;
  private requestTimingMap = new WeakMap<Request, { id: string; startMs: number }>();
  private disposed = false;

  // Bound Playwright event listeners per attached page for multi-tab/popup observability & clean disposal
  private readonly observedPages = new Set<Page>();
  private onContextPageListener?: (newPage: Page) => void;
  private onRequestListener?: (req: Request) => void;
  private onRequestFinishedListener?: (req: Request) => void;
  private onRequestFailedListener?: (req: Request) => void;
  private onConsoleListener?: (msg: { type(): string; text(): string; location(): { url?: string } }) => void;
  private onPageErrorListener?: (err: Error) => void;
  private onWebSocketListener?: (ws: WebSocket) => void;

  constructor(options: NetworkControllerOptions) {
    this.context = options.context;
    this.page = options.page;
    this.adapter = options.adapter;
    this.eventRecorder = options.eventRecorder;
    this.profileRegistry = options.profileRegistry ?? new NetworkProfileRegistry();
    this.cdpAdapter = this.adapter.createCdpAdapter(this.context, this.page);
    this.signal = options.signal;

    this.attachObservers();
  }

  private attachPageObservers(targetPage: Page): void {
    if (this.observedPages.has(targetPage)) return;
    this.observedPages.add(targetPage);
    if (this.onRequestListener) targetPage.on("request", this.onRequestListener);
    if (this.onRequestFinishedListener)
      targetPage.on("requestfinished", this.onRequestFinishedListener);
    if (this.onRequestFailedListener) targetPage.on("requestfailed", this.onRequestFailedListener);
    if (this.onConsoleListener) targetPage.on("console", this.onConsoleListener);
    if (this.onPageErrorListener) targetPage.on("pageerror", this.onPageErrorListener);
    if (this.onWebSocketListener) targetPage.on("websocket", this.onWebSocketListener);
  }

  private attachObservers(): void {
    this.onRequestListener = (req: Request) => {
      const recorded = this.eventRecorder.recordRequest({
        method: req.method(),
        url: req.url(),
        resourceType: req.resourceType(),
        failed: false,
      });
      this.requestTimingMap.set(req, { id: recorded.id, startMs: performance.now() });
      this.eventRecorder.record("request.started", {
        requestId: recorded.id,
        method: req.method(),
        url: req.url(),
        resourceType: req.resourceType(),
      });
    };

    this.onRequestFinishedListener = (req: Request) => {
      const tracked = this.requestTimingMap.get(req);
      const durationMs = tracked
        ? Math.round((performance.now() - tracked.startMs) * 100) / 100
        : undefined;
      req
        .response()
        .then((res) => {
          const status = res?.status();
          const fromServiceWorker = res?.fromServiceWorker() ?? false;
          if (tracked) {
            this.eventRecorder.updateRequest(tracked.id, {
              status,
              durationMs,
              failed: status !== undefined && status >= 400,
              fromServiceWorker,
            });
          }
          this.eventRecorder.record(
            "request.completed",
            {
              requestId: tracked?.id,
              method: req.method(),
              url: req.url(),
              status,
              durationMs,
              fromServiceWorker,
            },
            status !== undefined && status >= 500 ? "error" : status !== undefined && status >= 400 ? "warning" : "info",
          );
        })
        .catch(() => {
          // Response may not be available if context closed
        });
    };

    this.onRequestFailedListener = (req: Request) => {
      const tracked = this.requestTimingMap.get(req);
      const durationMs = tracked
        ? Math.round((performance.now() - tracked.startMs) * 100) / 100
        : undefined;
      const reason = req.failure()?.errorText ?? "Request failed";
      if (tracked) {
        this.eventRecorder.updateRequest(tracked.id, {
          durationMs,
          failed: true,
          failureReason: reason,
        });
      }
      this.eventRecorder.record(
        "request.failed",
        {
          requestId: tracked?.id,
          method: req.method(),
          url: req.url(),
          durationMs,
          reason,
        },
        "warning",
      );
    };

    this.onConsoleListener = (msg) => {
      this.eventRecorder.recordConsole(msg.type(), msg.text(), msg.location()?.url);
    };

    this.onPageErrorListener = (err) => {
      this.eventRecorder.recordConsole("pageerror", err.message);
    };

    this.onWebSocketListener = (ws: WebSocket) => {
      this.eventRecorder.record("websocket.opened", { url: ws.url() });
      ws.on("close", () => {
        this.eventRecorder.record("websocket.closed", { url: ws.url() });
      });
      ws.on("socketerror", (errText) => {
        this.eventRecorder.record(
          "websocket.error",
          { url: ws.url(), error: errText },
          "warning",
        );
      });
    };

    this.attachPageObservers(this.page);
    this.onContextPageListener = (newPage: Page) => {
      this.attachPageObservers(newPage);
    };
    this.context.on("page", this.onContextPageListener);
  }

  private async ensureRouteInterception(): Promise<void> {
    if (this.routeInstalled || this.disposed) return;

    this.routeHandler = async (route: Route) => {
      if (this.disposed) {
        await route.continue().catch(() => {});
        return;
      }

      const req = route.request();
      const tracked = this.requestTimingMap.get(req);

      // Evaluate explicit fault rules first
      const decision = this.faultEngine.evaluate({
        url: req.url(),
        method: req.method(),
        resourceType: req.resourceType(),
      });

      if (decision) {
        await this.executeFaultDecision(route, req, tracked?.id, decision);
        return;
      }

      // Non-Chromium request-level latency simulation fallback when CDP throttling is unavailable
      if (!this.cdpAdapter && this.activeProfileLatencyMs > 0) {
        await this.delayWithAbort(this.activeProfileLatencyMs);
        if (this.disposed) {
          await route.abort("aborted").catch(() => {});
          return;
        }
      }

      await route.continue().catch(() => {});
    };

    await this.context.route("**/*", this.routeHandler);
    this.routeInstalled = true;
  }

  private async executeFaultDecision(
    route: Route,
    req: Request,
    requestId: string | undefined,
    decision: { ruleId: string; fault: FaultType; rule: FaultRuleConfig; matchNumber: number },
  ): Promise<void> {
    const { ruleId, fault, rule } = decision;

    if (requestId) {
      this.eventRecorder.updateRequest(requestId, {
        injectedRuleId: ruleId,
        injectedFault: fault,
      });
    }

    this.eventRecorder.record(
      "fault.injected",
      {
        ruleId,
        fault,
        method: req.method(),
        url: req.url(),
        delayMs: rule.delayMs,
        statusCode: rule.statusCode ?? faultToHttpStatus(fault),
        matchNumber: decision.matchNumber,
      },
      "warning",
    );

    if (rule.delayMs && rule.delayMs > 0) {
      await this.delayWithAbort(rule.delayMs);
      if (this.disposed) {
        await route.abort("aborted").catch(() => {});
        return;
      }
    }

    if (fault === "delay") {
      await route.continue().catch(() => {});
      return;
    }

    if (fault === "connection-failed") {
      await route.abort("failed").catch(() => {});
      return;
    }

    if (fault === "dns-failed") {
      await route.abort("namenotresolved").catch(() => {});
      return;
    }

    if (fault === "timeout") {
      // Distinguish explicit network-layer timeout from delayed fulfillment
      await route.abort("timedout").catch(() => {});
      return;
    }

    if (fault === "empty-response") {
      await route
        .fulfill({
          status: rule.statusCode ?? 200,
          contentType: rule.contentType ?? "application/json",
          headers: rule.headers,
          body: "",
        })
        .catch(() => {});
      return;
    }

    if (fault === "malformed-json") {
      await route
        .fulfill({
          status: rule.statusCode ?? 200,
          contentType: rule.contentType ?? "application/json",
          headers: rule.headers,
          body: rule.body ?? '{"malformed": true, "broken": [1, 2,',
        })
        .catch(() => {});
      return;
    }

    if (fault === "truncated-response") {
      await route
        .fulfill({
          status: rule.statusCode ?? 200,
          contentType: rule.contentType ?? "application/octet-stream",
          headers: {
            ...rule.headers,
            "x-offlinelab-fault": "truncated-response",
          },
          body: rule.body ?? '{"partial":',
        })
        .catch(() => {});
      return;
    }

    const httpStatus = faultToHttpStatus(fault, rule.statusCode);
    if (httpStatus !== undefined) {
      const defaultBody = JSON.stringify({
        error: `Injected HTTP ${httpStatus}`,
        source: "offlinelab",
        ruleId,
      });
      await route
        .fulfill({
          status: httpStatus,
          contentType: rule.contentType ?? "application/json",
          headers: rule.headers,
          body: rule.body ?? defaultBody,
        })
        .catch(() => {});
      return;
    }

    await route.continue().catch(() => {});
  }

  private delayWithAbort(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.signal?.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(timer);
        resolve();
      };
      if (this.signal) {
        if (this.signal.aborted) {
          clearTimeout(timer);
          resolve();
          return;
        }
        this.signal.addEventListener("abort", onAbort, { once: true });
      }
    });
  }

  private stopUnstableTimer(): void {
    if (this.unstableTimer) {
      clearInterval(this.unstableTimer);
      this.unstableTimer = undefined;
    }
  }

  private clearFlakyProfileRule(): void {
    if (this.flakyRuleId) {
      this.faultEngine.removeRule(this.flakyRuleId);
      this.flakyRuleId = undefined;
    }
  }

  async offline(): Promise<void> {
    this.stopUnstableTimer();
    this.clearFlakyProfileRule();
    this.activeProfileLatencyMs = 0;

    if (this.cdpAdapter) {
      await this.cdpAdapter.reset();
    }

    await this.context.setOffline(true);
    this.offlineState = true;
    this.activeProfileName = "offline";
    this.profilesUsed.add("offline");

    this.eventRecorder.record("network.offline", {
      profile: "offline",
      mechanism: "browser-context-offline",
    });
  }

  async online(): Promise<void> {
    this.stopUnstableTimer();
    this.clearFlakyProfileRule();
    this.activeProfileLatencyMs = 0;

    await this.context.setOffline(false);
    if (this.cdpAdapter) {
      await this.cdpAdapter.reset();
    }
    this.offlineState = false;
    this.activeProfileName = "online";
    this.profilesUsed.add("online");

    this.eventRecorder.record("network.online", {
      profile: "online",
      mechanism: "browser-context-online",
    });
  }

  async setProfile(
    profileInput: NetworkProfileName | Partial<NetworkProfileConfig>,
    options?: { requireBandwidthThrottling?: boolean },
  ): Promise<void> {
    const profile = this.profileRegistry.resolve(profileInput);
    this.stopUnstableTimer();
    this.clearFlakyProfileRule();

    if (profile.offline) {
      await this.offline();
      return;
    }

    const wantsBandwidth =
      (profile.downloadKbps !== undefined && profile.downloadKbps > 0) ||
      (profile.uploadKbps !== undefined && profile.uploadKbps > 0);

    // Explicit capability handling: never silently pretend bandwidth throttling occurred on non-Chromium browsers
    if (wantsBandwidth && !this.cdpAdapter && options?.requireBandwidthThrottling) {
      throw new UnsupportedCapabilityError(
        `Network profile "${profile.name}" requires browser-level bandwidth throttling (download=${profile.downloadKbps ?? "unlimited"}kbps, upload=${profile.uploadKbps ?? "unlimited"}kbps), which is not supported in ${this.adapter.browser}.`,
        {
          browser: this.adapter.browser,
          profile: profile.name,
          capability: "cdpNetworkThrottling",
        },
        "Run on Chromium for CDP bandwidth throttling, or set requireBandwidthThrottling: false to fall back to request-level latency injection.",
      );
    }

    await this.context.setOffline(false);
    this.offlineState = false;
    this.activeProfileName = profile.name;
    this.profilesUsed.add(profile.name);

    let mechanism = "none";
    let bandwidthEmulated = false;
    let warning: string | undefined;

    if (this.cdpAdapter) {
      const applied = await this.cdpAdapter.applyProfile(profile);
      mechanism = applied.mechanism;
      bandwidthEmulated = applied.bandwidthEmulated;
      this.activeProfileLatencyMs = 0;
    } else if (profile.latencyMs > 0) {
      await this.ensureRouteInterception();
      this.activeProfileLatencyMs = profile.latencyMs;
      mechanism = "request-delay";
      if (wantsBandwidth) {
        warning = `${this.adapter.browser} does not support CDP bandwidth throttling; applied ${profile.latencyMs}ms request-level latency only (upload/download throughput limits were not enforced).`;
      }
    } else if (wantsBandwidth) {
      warning = `${this.adapter.browser} does not support CDP bandwidth throttling; throughput limits in profile "${profile.name}" were not enforced.`;
    }

    if (profile.failureRate !== undefined && profile.failureRate > 0) {
      await this.ensureRouteInterception();
      this.flakyRuleId = this.faultEngine.addRule({
        id: "__profile_flaky__",
        url: profile.urlPattern ?? "**/*",
        fault: "connection-failed",
        probability: profile.failureRate,
        seed: profile.seed ?? 1337,
        priority: -100, // Explicit user fault rules take precedence over profile flakiness
      });
    }

    if (profile.toggleIntervalMs && profile.toggleIntervalMs > 0) {
      let toggleOffline = false;
      this.unstableTimer = setInterval(() => {
        if (this.disposed) {
          this.stopUnstableTimer();
          return;
        }
        toggleOffline = !toggleOffline;
        this.offlineState = toggleOffline;
        this.context
          .setOffline(toggleOffline)
          .then(() => {
            this.eventRecorder.record(
              toggleOffline ? "network.offline" : "network.online",
              {
                profile: profile.name,
                mechanism: "unstable-toggle",
              },
              "info",
            );
          })
          .catch(() => {
            this.stopUnstableTimer();
          });
      }, profile.toggleIntervalMs);
    }

    this.eventRecorder.record(
      "network.profile.changed",
      {
        profile: profile.name,
        latencyMs: profile.latencyMs,
        downloadKbps: profile.downloadKbps,
        uploadKbps: profile.uploadKbps,
        failureRate: profile.failureRate,
        mechanism,
        bandwidthEmulated,
        ...(warning ? { warning } : {}),
      },
      warning ? "warning" : "info",
    );
  }

  async failRequests(
    rule: Omit<FaultRuleConfig, "fault"> & { fault?: FaultType },
  ): Promise<string> {
    await this.ensureRouteInterception();
    const id = this.faultEngine.addRule({
      ...rule,
      fault: rule.fault ?? "connection-failed",
    });
    this.eventRecorder.record("fault.rule.added", {
      ruleId: id,
      url: rule.url,
      fault: rule.fault ?? "connection-failed",
      probability: rule.probability,
      seed: rule.seed,
    });
    return id;
  }

  async delayRequests(rule: {
    id?: string;
    url: string;
    delayMs: number;
    methods?: string[];
    resourceTypes?: string[];
    probability?: number;
    seed?: number;
    once?: boolean;
    firstN?: number;
  }): Promise<string> {
    await this.ensureRouteInterception();
    const id = this.faultEngine.addRule({
      ...rule,
      fault: "delay",
    });
    this.eventRecorder.record("fault.rule.added", {
      ruleId: id,
      url: rule.url,
      fault: "delay",
      delayMs: rule.delayMs,
    });
    return id;
  }

  async mockResponse(rule: {
    id?: string;
    url: string;
    status?: number;
    body?: string;
    json?: unknown;
    headers?: Record<string, string>;
    contentType?: string;
    methods?: string[];
    delayMs?: number;
    once?: boolean;
  }): Promise<string> {
    await this.ensureRouteInterception();
    const serializedBody =
      rule.body !== undefined
        ? rule.body
        : rule.json !== undefined
          ? JSON.stringify(rule.json)
          : "";
    const contentType =
      rule.contentType ?? (rule.json !== undefined ? "application/json" : "text/plain");
    const id = this.faultEngine.addRule({
      id: rule.id,
      url: rule.url,
      fault: "http-status",
      statusCode: rule.status ?? 200,
      body: serializedBody,
      contentType,
      headers: rule.headers,
      methods: rule.methods,
      delayMs: rule.delayMs,
      once: rule.once,
    });
    this.eventRecorder.record("fault.rule.added", {
      ruleId: id,
      url: rule.url,
      fault: "mock-response",
      statusCode: rule.status ?? 200,
    });
    return id;
  }

  async removeRule(id: string): Promise<void> {
    const removed = this.faultEngine.removeRule(id);
    if (removed) {
      this.eventRecorder.record("fault.rule.removed", { ruleId: id });
    }
  }

  async clearRules(): Promise<void> {
    this.faultEngine.clearRules();
    this.flakyRuleId = undefined;
    this.eventRecorder.record("fault.rules.cleared", {});
  }

  setPhase(phase: string | undefined): void {
    this.faultEngine.setPhase(phase);
    this.eventRecorder.record("network.phase.changed", { phase: phase ?? null });
  }

  startSchedule(steps: NetworkScheduleStep[], options?: { repeat?: boolean }): void {
    this.eventRecorder.record("network.schedule.started", {
      stepCount: steps.length,
      repeat: Boolean(options?.repeat),
    });

    this.scheduler.start(
      steps,
      {
        applyStep: async (step, elapsedMs) => {
          this.eventRecorder.record("network.schedule.step", {
            atMs: step.atMs,
            actualElapsedMs: elapsedMs,
            label: step.label,
            profile: typeof step.profile === "string" ? step.profile : step.profile.name ?? "custom",
          });
          await this.setProfile(step.profile);
        },
        onError: (err, step) => {
          this.eventRecorder.record(
            "network.schedule.error",
            {
              atMs: step.atMs,
              error: err instanceof Error ? err.message : String(err),
            },
            "error",
          );
        },
      },
      {
        repeat: options?.repeat,
        signal: this.signal,
      },
    );
  }

  stopSchedule(): void {
    if (this.scheduler.isRunning()) {
      this.scheduler.stop();
      this.eventRecorder.record("network.schedule.stopped", {});
    }
  }

  isOffline(): boolean {
    return this.offlineState;
  }

  getActiveProfile(): string {
    return this.activeProfileName;
  }

  getProfilesUsed(): string[] {
    return Array.from(this.profilesUsed);
  }

  getCapabilities(): BrowserCapabilities {
    return { ...this.adapter.capabilities };
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.scheduler.stop();
    this.stopUnstableTimer();
    this.faultEngine.clearRules();

    if (this.onContextPageListener) {
      this.context.off("page", this.onContextPageListener);
    }

    for (const observed of this.observedPages) {
      if (this.onRequestListener) observed.off("request", this.onRequestListener);
      if (this.onRequestFinishedListener)
        observed.off("requestfinished", this.onRequestFinishedListener);
      if (this.onRequestFailedListener) observed.off("requestfailed", this.onRequestFailedListener);
      if (this.onConsoleListener) observed.off("console", this.onConsoleListener);
      if (this.onPageErrorListener) observed.off("pageerror", this.onPageErrorListener);
      if (this.onWebSocketListener) observed.off("websocket", this.onWebSocketListener);
    }
    this.observedPages.clear();

    if (this.routeInstalled && this.routeHandler) {
      await this.context.unroute("**/*", this.routeHandler).catch(() => {});
      this.routeInstalled = false;
    }

    if (this.cdpAdapter) {
      await this.cdpAdapter.detach();
    }

    // Restore online state safely before context closure
    await this.context.setOffline(false).catch(() => {});
  }
}
