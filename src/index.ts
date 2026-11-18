// Public OfflineLab SDK exports

export {
  OfflineLab,
  defineConfig,
  defineScenario,
  type OfflineLabOptions,
} from "./sdk/offlinelab.js";

// Core runner & engines
export {
  OfflineLabRunner,
  getInstalledPlaywrightVersion,
  type RunnerExecutionOptions,
  type RunnerExecutionOutput,
  type ShardConfig,
} from "./core/runner/runner.js";
export { AppServerManager } from "./core/runner/app-server-manager.js";
export {
  ScenarioDiscovery,
  isProgrammaticScenario,
  isYamlScenario,
  type ScenarioValidationReport,
} from "./core/scenarios/discovery.js";
export { ScenarioExecutor } from "./core/scenarios/executor.js";
export {
  BUILT_IN_SCENARIO_TEMPLATES,
  getScenarioTemplate,
  renderScenarioTemplateYaml,
  type ScenarioTemplate,
} from "./core/scenarios/templates.js";
export { AssertionEngine } from "./core/assertions/assertion-engine.js";
export { EventRecorder, type EventListener } from "./core/events/event-recorder.js";
export { NetworkScheduler } from "./core/scheduler/network-scheduler.js";

// Configuration
export { ConfigLoader, type LoadedConfigResult } from "./config/loader/config-loader.js";
export { ConfigValidator, OfflineLabConfigSchema } from "./config/schemas/config-schema.js";
export { YamlScenarioSchema, validateYamlScenario } from "./config/schemas/scenario-schema.js";
export {
  DEFAULT_CONFIG,
  OFFLINELAB_SCHEMA_VERSION,
  OFFLINELAB_TOOL_VERSION,
} from "./config/defaults/defaults.js";

// Browser & PWA
export { BrowserManager, resolveDeviceContextOptions } from "./browser/context/browser-manager.js";
export {
  BrowserAdapter,
  ChromiumCdpNetworkAdapter,
  getBrowserCapabilities,
} from "./browser/adapters/browser-adapter.js";
export { ServiceWorkerInspector } from "./browser/service-workers/sw-inspector.js";
export { StorageInspector } from "./browser/storage/storage-inspector.js";

// Network
export { NetworkController } from "./network/controller/network-controller.js";
export {
  NetworkProfileRegistry,
  BUILT_IN_NETWORK_PROFILES,
  kbpsToBytesPerSecond,
} from "./network/profiles/registry.js";
export {
  FaultInjectionEngine,
  compileUrlPattern,
  matchesUrlPattern,
  createSeededRng,
  faultToHttpStatus,
} from "./network/faults/fault-engine.js";

// Reporters & Artifacts
export { ArtifactManager, parseDurationString } from "./artifacts/artifact-manager.js";
export { ReportGenerator, type GeneratedReportPaths } from "./reporters/report-generator.js";
export { JsonReporter } from "./reporters/json/json-reporter.js";
export { JUnitReporter } from "./reporters/junit/junit-reporter.js";
export { HtmlReporter, safeJsonForHtml } from "./reporters/html/html-reporter.js";
export { TerminalRenderer } from "./reporters/terminal/terminal-renderer.js";

// Plugins & Security
export { PluginManager } from "./plugins/plugin-manager.js";
export {
  Redactor,
  REDACTED,
  escapeHtml,
  escapeXml,
  sanitizeParsedObject,
} from "./security/redactor.js";
export {
  assertPathWithin,
  assertSafeReportDirectory,
  sanitizeFileSlug,
} from "./security/path-safety.js";

// Stable error classes & exit codes
export {
  ExitCode,
  OfflineLabError,
  ConfigValidationError,
  ScenarioValidationError,
  BrowserLaunchError,
  UnsupportedCapabilityError,
  AssertionFailedError,
  TimeoutError,
  InfrastructureError,
  PathSafetyError,
  mapErrorToExitCode,
  formatErrorForUser,
  type ExitCodeValue,
} from "./core/errors/index.js";

// Public TypeScript types
export type * from "./types/index.js";
