import type { BrowserContext, Page } from "playwright";
import { BrowserManager, type ManagedBrowserSession } from "../browser/context/browser-manager.js";
import { ServiceWorkerInspector } from "../browser/service-workers/sw-inspector.js";
import { StorageInspector } from "../browser/storage/storage-inspector.js";
import { ConfigValidator } from "../config/schemas/config-schema.js";
import { AssertionEngine } from "../core/assertions/assertion-engine.js";
import { EventRecorder, type EventListener } from "../core/events/event-recorder.js";
import { OfflineLabRunner, type RunnerExecutionOptions, type RunnerExecutionOutput } from "../core/runner/runner.js";
import { NetworkController } from "../network/controller/network-controller.js";
import { NetworkProfileRegistry } from "../network/profiles/registry.js";
import { PluginManager } from "../plugins/plugin-manager.js";
import { Redactor } from "../security/redactor.js";
import type {
  BrowserName,
  CacheStorageSnapshot,
  ConsoleEntry,
  CustomAssertionDefinition,
  DeviceConfig,
  InspectionSnapshot,
  NetworkProfileConfig,
  OfflineLabConfig,
  OfflineLabConfigInput,
  OfflineLabEvent,
  OfflineLabExpect,
  OfflineLabPlugin,
  ProgrammaticScenarioDefinition,
  RecordedRequest,
  RedactionConfig,
  ScenarioDefinition,
  ScenarioNetworkAPI,
  ServiceWorkerPolicy,
  ServiceWorkerSnapshot,
  StorageInspectionOptions,
  StorageSnapshot,
  YamlScenarioDefinition,
} from "../types/index.js";

/**
 * Strongly-typed configuration helper for `offlinelab.config.ts`.
 */
export function defineConfig(config: OfflineLabConfigInput): OfflineLabConfigInput {
  return config;
}

/**
 * Strongly-typed scenario definition helper for TypeScript scenarios.
 */
export function defineScenario(
  scenario: ProgrammaticScenarioDefinition,
): ProgrammaticScenarioDefinition;
export function defineScenario(scenario: YamlScenarioDefinition): YamlScenarioDefinition;
export function defineScenario(scenario: ScenarioDefinition): ScenarioDefinition {
  return scenario;
}

export interface OfflineLabOptions {
  browser?: BrowserName;
  baseURL?: string;
  headless?: boolean;
  serviceWorkers?: ServiceWorkerPolicy;
  device?: string | DeviceConfig;
  storageState?: string;
  timeoutMs?: number;
  networkProfiles?: Record<string, Partial<NetworkProfileConfig>>;
  redaction?: Partial<RedactionConfig>;
  plugins?: OfflineLabPlugin[];
  signal?: AbortSignal;
}

/**
 * High-level programmatic SDK for controlling a browser, simulating network conditions,
 * inspecting Service Workers / Cache / Storage, and running assertions in existing test suites.
 */
export class OfflineLab {
  private readonly options: OfflineLabOptions;
  private readonly browserManager = new BrowserManager();
  private readonly profileRegistry: NetworkProfileRegistry;
  private readonly pluginManager = new PluginManager();
  private readonly redactor: Redactor;
  private readonly swInspector: ServiceWorkerInspector;
  private readonly storageInspector: StorageInspector;
  private readonly customAssertions = new Map<string, CustomAssertionDefinition>();
  private readonly externalListeners = new Set<EventListener>();

  private session: ManagedBrowserSession | null = null;
  private networkController: NetworkController | null = null;
  private eventRecorder: EventRecorder | null = null;
  private assertionEngine: AssertionEngine | null = null;
  private expectFn: OfflineLabExpect | null = null;

  constructor(options: OfflineLabOptions = {}) {
    this.options = options;
    this.profileRegistry = new NetworkProfileRegistry(options.networkProfiles);
    this.redactor = new Redactor(options.redaction);
    this.swInspector = new ServiceWorkerInspector(this.redactor);
    this.storageInspector = new StorageInspector(this.redactor, this.swInspector);
  }

  async start(): Promise<void> {
    if (this.session) return;

    await this.pluginManager.loadPlugins(this.options.plugins, this.profileRegistry);

    const browser = this.options.browser ?? "chromium";
    const headless = this.options.headless ?? true;

    this.eventRecorder = new EventRecorder({
      runId: "sdk",
      scenarioId: `sdk-${browser}`,
      redactor: this.redactor,
      listeners: [
        ...this.pluginManager.getEventListeners(),
        ...Array.from(this.externalListeners),
      ],
    });

    this.session = await this.browserManager.createSession({
      browser,
      headless,
      baseURL: this.options.baseURL,
      serviceWorkers: this.options.serviceWorkers ?? "allow",
      device: this.options.device,
      storageState: this.options.storageState,
      timeoutMs: this.options.timeoutMs ?? 30_000,
    });

    this.eventRecorder.record("browser.launched", {
      browser,
      headless,
      sdk: true,
    });

    this.networkController = new NetworkController({
      context: this.session.context,
      page: this.session.page,
      adapter: this.session.adapter,
      eventRecorder: this.eventRecorder,
      profileRegistry: this.profileRegistry,
      signal: this.options.signal,
    });

    this.assertionEngine = new AssertionEngine({
      page: this.session.page,
      eventRecorder: this.eventRecorder,
      swInspector: this.swInspector,
      storageInspector: this.storageInspector,
      pluginManager: this.pluginManager,
      defaultTimeoutMs: this.options.timeoutMs ?? 10_000,
    });
    this.expectFn = this.assertionEngine.createExpectFunction();
  }

  get page(): Page {
    if (!this.session) {
      throw new Error("OfflineLab has not been started. Call `await lab.start()` first.");
    }
    return this.session.page;
  }

  get context(): BrowserContext {
    if (!this.session) {
      throw new Error("OfflineLab has not been started. Call `await lab.start()` first.");
    }
    return this.session.context;
  }

  get network(): ScenarioNetworkAPI {
    if (!this.networkController) {
      throw new Error("OfflineLab has not been started. Call `await lab.start()` first.");
    }
    return this.networkController;
  }

  get expect(): OfflineLabExpect {
    if (!this.expectFn) {
      throw new Error("OfflineLab has not been started. Call `await lab.start()` first.");
    }
    return this.expectFn;
  }

  registerNetworkProfile(profile: NetworkProfileConfig): void {
    this.profileRegistry.register(profile);
  }

  registerAssertion(assertion: CustomAssertionDefinition): void {
    this.customAssertions.set(assertion.name, assertion);
  }

  onEvent(listener: (event: OfflineLabEvent) => void | Promise<void>): () => void {
    this.externalListeners.add(listener);
    const unsubscribe = this.eventRecorder?.onEvent(listener);
    return () => {
      this.externalListeners.delete(listener);
      unsubscribe?.();
    };
  }

  async inspect(): Promise<InspectionSnapshot> {
    const sw = await this.inspectServiceWorker();
    const cache = await this.inspectCache();
    const requests = this.getRequests();
    return {
      url: this.redactor.redactUrl(this.page.url()),
      title: await this.page.title().catch(() => ""),
      online: !this.network.isOffline(),
      activeProfile: this.network.getActiveProfile(),
      serviceWorker: sw,
      cacheStorage: cache,
      consoleErrorCount: this.getConsoleErrors().length,
      requestCount: requests.length,
      failedRequestCount: requests.filter((r) => r.failed).length,
      capturedAt: new Date().toISOString(),
    };
  }

  async inspectServiceWorker(): Promise<ServiceWorkerSnapshot> {
    return this.swInspector.inspect(this.page);
  }

  async waitForServiceWorker(options?: {
    controlled?: boolean;
    state?: "installing" | "installed" | "activating" | "activated";
    timeoutMs?: number;
  }): Promise<ServiceWorkerSnapshot> {
    return this.swInspector.waitForServiceWorker(this.page, options);
  }

  async inspectCache(): Promise<CacheStorageSnapshot> {
    return this.swInspector.inspectCacheStorage(this.page);
  }

  async inspectStorage(options?: StorageInspectionOptions): Promise<StorageSnapshot> {
    return this.storageInspector.inspect(this.page, options);
  }

  getEvents(): OfflineLabEvent[] {
    return this.eventRecorder?.getEvents() ?? [];
  }

  getRequests(): RecordedRequest[] {
    return this.eventRecorder?.getRequests() ?? [];
  }

  getConsoleErrors(): ConsoleEntry[] {
    return this.eventRecorder?.getConsoleErrors() ?? [];
  }

  async stop(): Promise<void> {
    if (this.networkController) {
      await this.networkController.dispose();
      this.networkController = null;
    }
    if (this.session) {
      await this.session.close();
      this.session = null;
    }
    await this.browserManager.closeAll();
    await this.pluginManager.teardown();
    this.assertionEngine = null;
    this.expectFn = null;
  }

  /**
   * Executes configured or programmatic scenarios using the full OfflineLabRunner engine
   * and returns the structured RunReport + artifact paths.
   */
  static async run(
    configInput: OfflineLabConfigInput,
    options?: RunnerExecutionOptions,
  ): Promise<RunnerExecutionOutput> {
    const config: OfflineLabConfig = ConfigValidator.validate(configInput);
    const runner = new OfflineLabRunner(config);
    return runner.run(options);
  }
}
