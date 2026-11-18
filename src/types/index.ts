import type { BrowserContext, Locator, Page, Response, Request } from "playwright";

export type BrowserName = "chromium" | "firefox" | "webkit";

export type ExecutionMode = "pwa" | "interception" | "auto";

export type ServiceWorkerPolicy = "allow" | "block";

export type UnsupportedCapabilityPolicy = "skip" | "fail" | "warn";

export type BuiltInNetworkProfileName =
  | "online"
  | "offline"
  | "wifi"
  | "slow-4g"
  | "fast-3g"
  | "slow-3g"
  | "2g"
  | "high-latency"
  | "flaky"
  | "unstable"
  | "custom";

export type NetworkProfileName = BuiltInNetworkProfileName | (string & {});

export type ReportFormat = "html" | "json" | "junit" | "terminal";

export type TraceMode = "on-failure" | "always" | "never";

export type ScreenshotMode = "on-failure" | "always" | "never";

export type LogLevel = "quiet" | "normal" | "verbose" | "debug";

export type ScenarioStatus = "passed" | "failed" | "skipped" | "unsupported";

export type EventSeverity = "info" | "warning" | "error";

export type FaultType =
  | "connection-failed"
  | "dns-failed"
  | "timeout"
  | "delay"
  | "http-400"
  | "http-401"
  | "http-403"
  | "http-408"
  | "http-429"
  | "http-500"
  | "http-502"
  | "http-503"
  | "http-504"
  | "http-status"
  | "empty-response"
  | "malformed-json"
  | "truncated-response";

export interface NetworkProfileConfig {
  name: string;
  description?: string;
  offline: boolean;
  /** Simulated round-trip latency in milliseconds */
  latencyMs: number;
  /** Download throughput in kilobits per second (0 or undefined = unlimited) */
  downloadKbps?: number;
  /** Upload throughput in kilobits per second (0 or undefined = unlimited) */
  uploadKbps?: number;
  /** Connection type hint for CDP emulation */
  connectionType?: "none" | "cellular2g" | "cellular3g" | "cellular4g" | "wifi" | "ethernet" | "other";
  /** Deterministic failure probability between 0 and 1 */
  failureRate?: number;
  /** Deterministic PRNG seed for intermittent failure profiles */
  seed?: number;
  /** Optional unstable toggle interval in ms for alternating connectivity */
  toggleIntervalMs?: number;
  /** Optional URL pattern scope */
  urlPattern?: string;
}

export interface FaultRuleConfig {
  id?: string;
  /** URL glob or regex string (prefixed with /.../) */
  url: string;
  /** HTTP methods to match (e.g. ['GET', 'POST']) */
  methods?: string[];
  /** Playwright resource types (e.g. ['fetch', 'xhr', 'document']) */
  resourceTypes?: string[];
  /** Fault behavior to inject */
  fault: FaultType;
  /** Custom HTTP status code when fault === 'http-status' */
  statusCode?: number;
  /** Custom response body for mock/status/truncated faults */
  body?: string;
  /** Custom response headers */
  headers?: Record<string, string>;
  /** Content type header */
  contentType?: string;
  /** Artificial delay in ms before fulfilling or aborting */
  delayMs?: number;
  /** Probability between 0 and 1 (strictly validated) */
  probability?: number;
  /** Seed for deterministic probability evaluation */
  seed?: number;
  /** Fail only once */
  once?: boolean;
  /** Fail only the first N matching requests */
  firstN?: number;
  /** Fail every Nth matching request (1-based: N, 2N, 3N...) */
  everyNth?: number;
  /** Active only for configured duration in ms after rule registration */
  durationMs?: number;
  /** Active only while the named phase matches */
  phase?: string;
  /** Rule priority (higher wins; default 0, ties broken by insertion order) */
  priority?: number;
}

export interface NetworkScheduleStep {
  /** Offset in milliseconds from schedule start */
  atMs: number;
  /** Profile name or inline custom network config */
  profile: NetworkProfileName | Partial<NetworkProfileConfig>;
  /** Optional label for the timeline */
  label?: string;
}

export interface BrowserCapabilities {
  browser: BrowserName;
  contextOffline: boolean;
  cdpNetworkThrottling: boolean;
  cdpNetworkRules: boolean;
  requestInterception: boolean;
  requestLatencyInjection: boolean;
  serviceWorkerInspection: boolean;
  cacheStorageInspection: boolean;
  indexedDBInspection: boolean;
  notes: string[];
}

export interface OfflineLabEvent {
  id: string;
  timestamp: string;
  elapsedMs: number;
  runId: string;
  scenarioId: string;
  type: string;
  severity: EventSeverity;
  details: Record<string, unknown>;
}

export interface RecordedRequest {
  id: string;
  timestamp: string;
  elapsedMs: number;
  method: string;
  url: string;
  resourceType: string;
  status?: number;
  durationMs?: number;
  failed: boolean;
  failureReason?: string;
  injectedRuleId?: string;
  injectedFault?: string;
  fromServiceWorker?: boolean;
  headers?: Record<string, string>;
}

export interface ConsoleEntry {
  timestamp: string;
  elapsedMs: number;
  type: string;
  text: string;
  location?: string;
}

export interface ServiceWorkerRegistrationInfo {
  scope: string;
  activeState?: string;
  activeScriptURL?: string;
  waitingState?: string;
  waitingScriptURL?: string;
  installingState?: string;
  installingScriptURL?: string;
  updateViaCache?: string;
}

export interface ServiceWorkerSnapshot {
  supported: boolean;
  controlled: boolean;
  controllerScriptURL?: string;
  controllerState?: string;
  registrations: ServiceWorkerRegistrationInfo[];
  errors: string[];
  capturedAt: string;
}

export interface CacheEntryMetadata {
  url: string;
  status?: number;
  contentType?: string;
}

export interface CacheStorageSnapshot {
  supported: boolean;
  caches: Array<{
    name: string;
    entryCount: number;
    entries: CacheEntryMetadata[];
  }>;
  totalEntries: number;
  capturedAt: string;
}

export interface IndexedDBDatabaseSnapshot {
  name: string;
  version?: number;
  objectStores: Array<{
    name: string;
    recordCount: number;
    records?: unknown[];
  }>;
}

export interface StorageSnapshot {
  localStorage?: Record<string, string>;
  sessionStorage?: Record<string, string>;
  indexedDB?: IndexedDBDatabaseSnapshot[];
  cacheStorage?: CacheStorageSnapshot;
  capturedAt: string;
}

export interface StorageInspectionOptions {
  includeLocalStorage?: boolean;
  includeSessionStorage?: boolean;
  includeIndexedDB?: boolean;
  includeCacheStorage?: boolean;
  /** Specific keys or fields allowed to be included (default redacts raw values unless specified) */
  allowedKeys?: string[];
  /** Keys or fields to always redact */
  redactKeys?: string[];
  /** Whether to include raw values (false by default for privacy) */
  includeValues?: boolean;
  /** Specific IndexedDB database names to inspect */
  databases?: string[];
  /** Specific IndexedDB object stores to inspect */
  stores?: string[];
  /** Max records per IndexedDB store */
  maxRecords?: number;
}

export interface InspectionSnapshot {
  url: string;
  title: string;
  online: boolean;
  activeProfile: string;
  serviceWorker: ServiceWorkerSnapshot;
  cacheStorage: CacheStorageSnapshot;
  storage?: StorageSnapshot;
  consoleErrorCount: number;
  requestCount: number;
  failedRequestCount: number;
  capturedAt: string;
}

export interface DeviceConfig {
  name?: string;
  viewport?: { width: number; height: number };
  deviceScaleFactor?: number;
  isMobile?: boolean;
  hasTouch?: boolean;
  userAgent?: string;
  orientation?: "portrait" | "landscape";
}

export interface WebServerConfig {
  command: string;
  url: string;
  cwd?: string;
  timeoutMs?: number;
  reuseExistingServer?: boolean;
  env?: Record<string, string>;
  gracefulShutdownMs?: number;
}

export interface RedactionConfig {
  redactQueryParams?: boolean;
  allowedQueryParams?: string[];
  redactHeaders?: string[];
  secretPatterns?: string[];
  customReplacer?: (input: string) => string;
}

export interface ReportsConfig {
  directory: string;
  formats: ReportFormat[];
  retentionDays?: number;
  maxRuns?: number;
}

export interface ArtifactsConfig {
  screenshots: ScreenshotMode;
  traces: TraceMode;
  baselineScreenshot?: boolean;
  captureBeforeAfter?: boolean;
  maxNetworkEvents?: number;
  includeBodies?: boolean;
}

export interface TimeoutsConfig {
  browserLaunchMs?: number;
  navigationMs?: number;
  stepMs?: number;
  assertionMs?: number;
  scenarioMs?: number;
  runMs?: number;
}

export interface AuthConfig {
  storageState?: string;
  persistentProfileDir?: string;
  setup?: (context: BrowserContext, page: Page) => Promise<void>;
  teardown?: (context: BrowserContext) => Promise<void>;
}

export interface OfflineLabConfig {
  baseURL?: string;
  browsers: BrowserName[];
  scenarios: string[];
  serviceWorkers: ServiceWorkerPolicy;
  mode: ExecutionMode;
  workers: number;
  retries: number;
  timeoutMs: number;
  timeouts?: TimeoutsConfig;
  headless: boolean;
  device?: string | DeviceConfig;
  networkProfiles?: Record<string, Partial<NetworkProfileConfig>>;
  unsupportedPolicy: UnsupportedCapabilityPolicy;
  reports: ReportsConfig;
  artifacts: ArtifactsConfig;
  redaction: RedactionConfig;
  webServer?: WebServerConfig;
  auth?: AuthConfig;
  plugins?: OfflineLabPlugin[];
  cwd?: string;
}

export type OfflineLabConfigInput = {
  baseURL?: string;
  browsers?: BrowserName[];
  scenarios?: string[];
  serviceWorkers?: ServiceWorkerPolicy;
  mode?: ExecutionMode;
  workers?: number;
  retries?: number;
  timeoutMs?: number;
  timeouts?: TimeoutsConfig;
  headless?: boolean;
  device?: string | DeviceConfig;
  networkProfiles?: Record<string, Partial<NetworkProfileConfig>>;
  unsupportedPolicy?: UnsupportedCapabilityPolicy;
  reports?: Partial<ReportsConfig>;
  artifacts?: Partial<ArtifactsConfig>;
  redaction?: Partial<RedactionConfig>;
  webServer?: WebServerConfig;
  auth?: AuthConfig;
  plugins?: OfflineLabPlugin[];
  cwd?: string;
};

// Scenario Step definitions (YAML & programmatic)
export type ScenarioStep =
  | { action: "navigate"; path?: string; url?: string; waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit"; timeoutMs?: number; expectFailure?: boolean }
  | { action: "reload"; waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit"; timeoutMs?: number; expectFailure?: boolean }
  | { action: "click"; selector: string; timeoutMs?: number }
  | { action: "fill"; selector: string; value: string; timeoutMs?: number }
  | { action: "press"; selector?: string; key: string; timeoutMs?: number }
  | { action: "select"; selector: string; value: string | string[]; timeoutMs?: number }
  | { action: "waitForSelector"; selector: string; state?: "attached" | "detached" | "visible" | "hidden"; timeoutMs?: number }
  | { action: "waitForURL"; url: string; timeoutMs?: number }
  | { action: "waitForResponse"; url: string; status?: number; timeoutMs?: number }
  | { action: "waitForRequest"; url: string; method?: string; timeoutMs?: number }
  | { action: "wait"; durationMs: number; reason?: string }
  | { action: "setNetwork"; profile: NetworkProfileName; custom?: Partial<NetworkProfileConfig>; requireBandwidthThrottling?: boolean }
  | { action: "setOffline" }
  | { action: "setOnline" }
  | { action: "injectFailure"; id?: string; url: string; fault: FaultType; methods?: string[]; resourceTypes?: string[]; statusCode?: number; body?: string; headers?: Record<string, string>; contentType?: string; delayMs?: number; probability?: number; seed?: number; once?: boolean; firstN?: number; everyNth?: number; durationMs?: number; phase?: string; priority?: number }
  | { action: "removeFailure"; id?: string; all?: boolean }
  | { action: "delayRequests"; id?: string; url: string; delayMs: number; methods?: string[]; resourceTypes?: string[]; probability?: number; seed?: number; once?: boolean; firstN?: number }
  | { action: "mockResponse"; id?: string; url: string; status?: number; body?: string; json?: unknown; headers?: Record<string, string>; contentType?: string; methods?: string[]; delayMs?: number; once?: boolean }
  | { action: "startNetworkSchedule"; steps: NetworkScheduleStep[]; repeat?: boolean }
  | { action: "stopNetworkSchedule" }
  | { action: "waitForServiceWorker"; controlled?: boolean; state?: "installing" | "installed" | "activating" | "activated"; timeoutMs?: number }
  | { action: "inspectCache" }
  | { action: "inspectIndexedDB"; databases?: string[]; stores?: string[]; includeValues?: boolean; maxRecords?: number }
  | { action: "inspectLocalStorage"; allowedKeys?: string[]; includeValues?: boolean }
  | { action: "captureStorageSnapshot"; name?: string; includeLocalStorage?: boolean; includeSessionStorage?: boolean; includeIndexedDB?: boolean; includeCacheStorage?: boolean; includeValues?: boolean; allowedKeys?: string[] }
  | { action: "expectVisible"; selector: string; timeoutMs?: number }
  | { action: "expectHidden"; selector: string; timeoutMs?: number }
  | { action: "expectText"; selector: string; text: string; exact?: boolean; timeoutMs?: number }
  | { action: "expectURL"; url: string; exact?: boolean; timeoutMs?: number }
  | { action: "expectRequestCount"; url: string; count?: number; min?: number; max?: number; method?: string }
  | { action: "expectResponseStatus"; url: string; status: number; method?: string }
  | { action: "expectNoConsoleErrors"; ignorePatterns?: string[] }
  | { action: "expectStorageValue"; storage: "localStorage" | "sessionStorage"; key: string; value?: string; exists?: boolean }
  | { action: "expectCacheContains"; urlPattern: string; cacheName?: string }
  | { action: "expectIndexedDBRecord"; database: string; store: string; minCount?: number; count?: number; match?: Record<string, unknown>; timeoutMs?: number }
  | { action: "screenshot"; name: string; fullPage?: boolean }
  | { action: "snapshot"; name?: string }
  | { action: "markTimelineEvent"; label: string; details?: Record<string, unknown> }
  | { action: "customAssertion"; name: string; options?: Record<string, unknown> };

export interface ScenarioNetworkAPI {
  offline(): Promise<void>;
  online(): Promise<void>;
  setProfile(profile: NetworkProfileName | Partial<NetworkProfileConfig>, options?: { requireBandwidthThrottling?: boolean }): Promise<void>;
  failRequests(rule: Omit<FaultRuleConfig, "fault"> & { fault?: FaultType }): Promise<string>;
  delayRequests(rule: { id?: string; url: string; delayMs: number; methods?: string[]; resourceTypes?: string[]; probability?: number; seed?: number; once?: boolean; firstN?: number }): Promise<string>;
  mockResponse(rule: { id?: string; url: string; status?: number; body?: string; json?: unknown; headers?: Record<string, string>; contentType?: string; methods?: string[]; delayMs?: number; once?: boolean }): Promise<string>;
  removeRule(id: string): Promise<void>;
  clearRules(): Promise<void>;
  setPhase(phase: string | undefined): void;
  startSchedule(steps: NetworkScheduleStep[], options?: { repeat?: boolean }): void;
  stopSchedule(): void;
  isOffline(): boolean;
  getActiveProfile(): string;
  getCapabilities(): BrowserCapabilities;
}

export interface ExpectMatcher {
  toBeVisible(options?: { timeout?: number }): Promise<void>;
  toBeHidden(options?: { timeout?: number }): Promise<void>;
  toHaveText(expected: string | RegExp, options?: { timeout?: number; exact?: boolean }): Promise<void>;
  toContainText(expected: string | RegExp, options?: { timeout?: number }): Promise<void>;
  toHaveValue(expected: string | RegExp, options?: { timeout?: number }): Promise<void>;
  toHaveCount(count: number, options?: { timeout?: number }): Promise<void>;
}

export interface PageExpectMatcher {
  toHaveURL(expected: string | RegExp, options?: { timeout?: number }): Promise<void>;
  toHaveTitle(expected: string | RegExp, options?: { timeout?: number }): Promise<void>;
}

export interface ValueExpectMatcher<T> {
  toBe(expected: T): void;
  toEqual(expected: unknown): void;
  toBeTruthy(): void;
  toBeFalsy(): void;
  toContain(expected: unknown): void;
  toBeGreaterThan(expected: number): void;
  toBeGreaterThanOrEqual(expected: number): void;
  toBeLessThan(expected: number): void;
  toHaveLength(length: number): void;
}

export interface OfflineLabExpect {
  (target: Locator): ExpectMatcher;
  (target: Page): PageExpectMatcher;
  <T>(target: T): ValueExpectMatcher<T>;
  noConsoleErrors(ignorePatterns?: string[]): Promise<void>;
  cacheContains(urlPattern: string, cacheName?: string): Promise<void>;
  indexedDBRecord(options: { database: string; store: string; minCount?: number; count?: number; match?: Record<string, unknown>; timeoutMs?: number }): Promise<void>;
  requestCount(options: { url: string; count?: number; min?: number; max?: number; method?: string }): Promise<void>;
  responseStatus(options: { url: string; status: number; method?: string }): Promise<void>;
  storageValue(options: { storage: "localStorage" | "sessionStorage"; key: string; value?: string; exists?: boolean }): Promise<void>;
  custom(name: string, options?: Record<string, unknown>): Promise<void>;
}

export interface ScenarioRuntimeContext {
  page: Page;
  context: BrowserContext;
  network: ScenarioNetworkAPI;
  expect: OfflineLabExpect;
  baseURL?: string;
  browser: BrowserName;
  mode: ExecutionMode;
  signal: AbortSignal;
  inspect(): Promise<InspectionSnapshot>;
  inspectServiceWorker(): Promise<ServiceWorkerSnapshot>;
  inspectCache(): Promise<CacheStorageSnapshot>;
  inspectStorage(options?: StorageInspectionOptions): Promise<StorageSnapshot>;
  waitForServiceWorker(options?: { controlled?: boolean; state?: string; timeoutMs?: number }): Promise<ServiceWorkerSnapshot>;
  screenshot(name: string, options?: { fullPage?: boolean }): Promise<string>;
  markEvent(label: string, details?: Record<string, unknown>): void;
  getRequests(): RecordedRequest[];
  getConsoleErrors(): ConsoleEntry[];
}

export interface YamlScenarioDefinition {
  name: string;
  description?: string;
  mode?: ExecutionMode;
  browser?: BrowserName;
  browsers?: BrowserName[];
  tags?: string[];
  timeoutMs?: number;
  retries?: number;
  serviceWorkers?: ServiceWorkerPolicy;
  device?: string | DeviceConfig;
  baseURL?: string;
  storageState?: string;
  requires?: {
    cdpThrottling?: boolean;
    serviceWorkers?: boolean;
    requestInterception?: boolean;
  };
  steps: ScenarioStep[];
  sourcePath?: string;
}

export interface ProgrammaticScenarioDefinition {
  name: string;
  description?: string;
  mode?: ExecutionMode;
  browser?: BrowserName;
  browsers?: BrowserName[];
  tags?: string[];
  timeoutMs?: number;
  retries?: number;
  serviceWorkers?: ServiceWorkerPolicy;
  device?: string | DeviceConfig;
  baseURL?: string;
  storageState?: string;
  requires?: {
    cdpThrottling?: boolean;
    serviceWorkers?: boolean;
    requestInterception?: boolean;
  };
  run: (ctx: ScenarioRuntimeContext) => Promise<void>;
  sourcePath?: string;
}

export type ScenarioDefinition = YamlScenarioDefinition | ProgrammaticScenarioDefinition;

export interface StepResult {
  index: number;
  action: string;
  description?: string;
  status: ScenarioStatus;
  startedAt: string;
  durationMs: number;
  error?: string;
  details?: Record<string, unknown>;
}

export interface AssertionResult {
  id: string;
  name: string;
  status: "passed" | "failed";
  elapsedMs: number;
  expected?: unknown;
  actual?: unknown;
  message?: string;
}

export interface ArtifactReference {
  id: string;
  type: "screenshot" | "trace" | "console-log" | "request-log" | "storage-snapshot" | "report";
  name: string;
  path: string;
  relativePath: string;
  scenarioId?: string;
  mimeType: string;
  sizeBytes?: number;
  createdAt: string;
}

export interface DiagnosticItem {
  code: string;
  severity: EventSeverity;
  title: string;
  explanation: string;
  suggestion: string;
  evidence?: string[];
}

export interface ScenarioResult {
  id: string;
  name: string;
  description?: string;
  sourcePath?: string;
  browser: BrowserName;
  mode: ExecutionMode;
  status: ScenarioStatus;
  reason?: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  attempts: number;
  profilesUsed: string[];
  steps: StepResult[];
  assertions: AssertionResult[];
  events: OfflineLabEvent[];
  requests: RecordedRequest[];
  consoleErrors: ConsoleEntry[];
  serviceWorker?: ServiceWorkerSnapshot;
  cacheStorage?: CacheStorageSnapshot;
  storageSnapshots?: Array<{ name: string; snapshot: StorageSnapshot }>;
  artifacts: ArtifactReference[];
  diagnostics: DiagnosticItem[];
  capabilities: BrowserCapabilities;
  error?: {
    name: string;
    message: string;
    code?: string;
    stack?: string;
  };
}

export interface RunSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  unsupported: number;
  totalAssertions: number;
  passedAssertions: number;
  failedAssertions: number;
  totalRequests: number;
  failedRequests: number;
  injectedFaults: number;
}

export interface RunReport {
  schemaVersion: string;
  runId: string;
  toolVersion: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  environment: {
    nodeVersion: string;
    platform: string;
    arch: string;
    playwrightVersion: string;
    baseURL?: string;
    browsers: BrowserName[];
    ci: boolean;
  };
  summary: RunSummary;
  scenarios: ScenarioResult[];
  artifacts: ArtifactReference[];
  notes?: string[];
}

export interface CustomAssertionDefinition {
  name: string;
  description?: string;
  execute: (context: ScenarioRuntimeContext, options?: Record<string, unknown>) => Promise<void>;
}

export interface CustomReporterDefinition {
  name: string;
  generate: (report: RunReport, outputDir: string) => Promise<string | void>;
}

export interface PluginAPI {
  registerAssertion(assertion: CustomAssertionDefinition): void;
  registerNetworkProfile(profile: NetworkProfileConfig): void;
  registerReporter(reporter: CustomReporterDefinition): void;
  onEvent(listener: (event: OfflineLabEvent) => void | Promise<void>): void;
}

export interface OfflineLabPlugin {
  name: string;
  version?: string;
  setup: (api: PluginAPI) => void | Promise<void>;
  teardown?: () => void | Promise<void>;
}

export interface RunComparison {
  runA: { runId: string; startedAt: string; durationMs: number };
  runB: { runId: string; startedAt: string; durationMs: number };
  summaryDiff: {
    passedDelta: number;
    failedDelta: number;
    durationDeltaMs: number;
    failedRequestsDelta: number;
  };
  scenarioChanges: Array<{
    name: string;
    browser: BrowserName;
    statusA?: ScenarioStatus;
    statusB?: ScenarioStatus;
    durationDeltaMs?: number;
    failedRequestsA?: number;
    failedRequestsB?: number;
    changeType: "added" | "removed" | "regressed" | "fixed" | "changed" | "unchanged";
  }>;
}

export type PlaywrightRequest = Request;
export type PlaywrightResponse = Response;
