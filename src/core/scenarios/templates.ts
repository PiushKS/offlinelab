import { stringify as stringifyYaml } from "yaml";
import type { YamlScenarioDefinition } from "../../types/index.js";

export interface ScenarioTemplate {
  id: string;
  category: "connectivity" | "api-resilience" | "offline-first";
  name: string;
  description: string;
  requirements: string[];
  expectedObservations: string[];
  requiredAppContracts?: string[];
  build: (params?: Record<string, string>) => YamlScenarioDefinition;
}

export const BUILT_IN_SCENARIO_TEMPLATES: ScenarioTemplate[] = [
  // === CONNECTIVITY SCENARIOS (1-10) ===
  {
    id: "complete-connection-loss",
    category: "connectivity",
    name: "complete-connection-loss",
    description: "Disconnect the browser completely after initial load and verify the app stays responsive.",
    requirements: ["Reachable application URL"],
    expectedObservations: [
      "Initial page loads online",
      "Offline event is dispatched to the application",
      "Root shell remains visible without unhandled exceptions",
    ],
    requiredAppContracts: ["rootSelector (default: body)"],
    build: (p = {}) => ({
      name: "complete-connection-loss",
      description: "Verify application remains stable when network connectivity is completely lost",
      mode: "auto",
      steps: [
        { action: "navigate", path: p.path ?? "/" },
        { action: "expectVisible", selector: p.rootSelector ?? "body" },
        { action: "setOffline" },
        { action: "markTimelineEvent", label: "Connection dropped" },
        { action: "expectVisible", selector: p.rootSelector ?? "body" },
        { action: "screenshot", name: "after-connection-loss" },
        { action: "setOnline" },
      ],
    }),
  },
  {
    id: "offline-initial-navigation",
    category: "connectivity",
    name: "offline-initial-navigation",
    description: "Attempt cold-cache navigation while already offline and report actual behavior.",
    requirements: ["Fresh browser context with empty cache"],
    expectedObservations: [
      "Cold-cache offline navigation fails as expected when no Service Worker cache exists",
    ],
    build: (p = {}) => ({
      name: "offline-initial-navigation",
      description: "Verify cold-cache offline navigation fails predictably before any cache warm-up",
      mode: "pwa",
      steps: [
        { action: "setOffline" },
        { action: "navigate", path: p.path ?? "/", expectFailure: true },
        { action: "setOnline" },
      ],
    }),
  },
  {
    id: "offline-cached-navigation",
    category: "connectivity",
    name: "offline-cached-navigation",
    description: "Warm the Service Worker cache online, disconnect, and reload the cached application shell.",
    requirements: ["PWA with active Service Worker caching the app shell", "Chromium or Firefox"],
    expectedObservations: [
      "Service Worker activates and controls the page",
      "Reload succeeds while offline",
      "App shell and offline indicator are visible",
    ],
    requiredAppContracts: ["appShellSelector", "networkStatusSelector"],
    build: (p = {}) => ({
      name: "offline-cached-navigation",
      description: "Verify cached PWA navigation works after Service Worker activation",
      mode: "pwa",
      steps: [
        { action: "navigate", path: p.path ?? "/" },
        { action: "waitForServiceWorker", controlled: true, timeoutMs: 15000 },
        { action: "navigate", path: p.path ?? "/" },
        { action: "setNetwork", profile: "offline" },
        { action: "reload" },
        { action: "expectVisible", selector: p.appShellSelector ?? "[data-testid='app-shell']" },
        {
          action: "expectText",
          selector: p.networkStatusSelector ?? "[data-testid='network-status']",
          text: p.offlineText ?? "Offline",
        },
        { action: "screenshot", name: "offline-home" },
        { action: "setNetwork", profile: "online" },
      ],
    }),
  },
  {
    id: "temporary-disconnection",
    category: "connectivity",
    name: "temporary-disconnection",
    description: "Drop connectivity briefly during an active session and verify recovery upon reconnect.",
    requirements: ["Reachable application URL"],
    expectedObservations: [
      "Offline transition is handled cleanly",
      "Online indicator restores after reconnection",
    ],
    requiredAppContracts: ["networkStatusSelector"],
    build: (p = {}) => ({
      name: "temporary-disconnection",
      description: "Verify application recovers smoothly after a brief disconnection",
      mode: "auto",
      steps: [
        { action: "navigate", path: p.path ?? "/" },
        { action: "setOffline" },
        { action: "wait", durationMs: 1500, reason: "Simulate brief tunnel/signal drop" },
        { action: "setOnline" },
        {
          action: "expectText",
          selector: p.networkStatusSelector ?? "[data-testid='network-status']",
          text: p.onlineText ?? "Online",
        },
      ],
    }),
  },
  {
    id: "reconnect-after-5-seconds",
    category: "connectivity",
    name: "reconnect-after-5-seconds",
    description: "Hold offline state for 5 seconds, then restore connectivity and verify UI recovery.",
    requirements: ["Reachable application URL"],
    expectedObservations: ["Application stays stable for 5s offline and restores online status"],
    requiredAppContracts: ["networkStatusSelector"],
    build: (p = {}) => ({
      name: "reconnect-after-5-seconds",
      description: "Verify resilience across a 5-second disconnection window",
      mode: "auto",
      steps: [
        { action: "navigate", path: p.path ?? "/" },
        { action: "setOffline" },
        { action: "markTimelineEvent", label: "Offline window started (5s)" },
        { action: "wait", durationMs: 5000, reason: "5-second outage window" },
        { action: "setOnline" },
        { action: "markTimelineEvent", label: "Connectivity restored" },
        {
          action: "expectText",
          selector: p.networkStatusSelector ?? "[data-testid='network-status']",
          text: p.onlineText ?? "Online",
        },
      ],
    }),
  },
  {
    id: "multiple-network-transitions",
    category: "connectivity",
    name: "multiple-network-transitions",
    description: "Execute a scripted multi-stage network schedule (online -> slow-3g -> offline -> online -> high-latency -> online).",
    requirements: ["Reachable application URL"],
    expectedObservations: [
      "Application handles rapid profile transitions without crashing or console errors",
    ],
    build: (p = {}) => ({
      name: "multiple-network-transitions",
      description: "Exercise scripted transitions across online, slow-3g, offline, and high-latency profiles",
      mode: "auto",
      steps: [
        { action: "navigate", path: p.path ?? "/" },
        {
          action: "startNetworkSchedule",
          steps: [
            { atMs: 0, profile: "online", label: "ONLINE" },
            { atMs: 500, profile: "slow-3g", label: "SLOW_3G" },
            { atMs: 1200, profile: "offline", label: "OFFLINE" },
            { atMs: 2000, profile: "online", label: "ONLINE" },
            { atMs: 2600, profile: "high-latency", label: "HIGH_LATENCY" },
            { atMs: 3200, profile: "online", label: "ONLINE" },
          ],
        },
        { action: "wait", durationMs: 3500, reason: "Allow network schedule to finish" },
        { action: "stopNetworkSchedule" },
        { action: "expectVisible", selector: p.rootSelector ?? "body" },
      ],
    }),
  },
  {
    id: "slow-connection",
    category: "connectivity",
    name: "slow-connection",
    description: "Load and interact with the application under the slow-3g network profile.",
    requirements: ["Chromium recommended for full bandwidth throttling"],
    expectedObservations: ["Page loads completely under slow-3g without timing out"],
    build: (p = {}) => ({
      name: "slow-connection",
      description: "Verify page usability under slow-3g conditions",
      mode: "auto",
      steps: [
        { action: "setNetwork", profile: "slow-3g" },
        { action: "navigate", path: p.path ?? "/" },
        { action: "expectVisible", selector: p.rootSelector ?? "body" },
        { action: "setNetwork", profile: "online" },
      ],
    }),
  },
  {
    id: "high-latency-connection",
    category: "connectivity",
    name: "high-latency-connection",
    description: "Verify application behavior under sustained 2000ms round-trip latency.",
    requirements: ["Reachable application URL"],
    expectedObservations: ["Requests succeed after elevated latency without crashing"],
    build: (p = {}) => ({
      name: "high-latency-connection",
      description: "Verify page handles high-latency (2000ms) connections gracefully",
      mode: "auto",
      steps: [
        { action: "setNetwork", profile: "high-latency" },
        { action: "navigate", path: p.path ?? "/" },
        { action: "expectVisible", selector: p.rootSelector ?? "body" },
        { action: "setNetwork", profile: "online" },
      ],
    }),
  },
  {
    id: "intermittent-request-failures",
    category: "connectivity",
    name: "intermittent-request-failures",
    description: "Inject deterministic seeded intermittent API failures (30% failure rate, seed 42).",
    requirements: ["Interception mode enabled", "Target API pattern"],
    expectedObservations: ["Deterministic subset of matching API requests fails and is recorded"],
    requiredAppContracts: ["apiPattern (default: **/api/**)"],
    build: (p = {}) => ({
      name: "intermittent-request-failures",
      description: "Inject deterministic seeded request failures on API traffic",
      mode: "interception",
      steps: [
        { action: "navigate", path: p.path ?? "/" },
        {
          action: "injectFailure",
          url: p.apiPattern ?? "**/api/**",
          fault: "connection-failed",
          probability: 0.3,
          seed: 42,
        },
        { action: "markTimelineEvent", label: "Flaky API fault active" },
        { action: "expectVisible", selector: p.rootSelector ?? "body" },
        { action: "removeFailure", all: true },
      ],
    }),
  },
  {
    id: "network-interruption-during-navigation",
    category: "connectivity",
    name: "network-interruption-during-navigation",
    description: "Drop connectivity after loading the entry route and verify fallback or graceful error handling.",
    requirements: ["Reachable application URL"],
    expectedObservations: [
      "Online navigation succeeds",
      "Offline uncached route either shows fallback or fails predictably",
    ],
    build: (p = {}) => ({
      name: "network-interruption-during-navigation",
      description: "Test behavior when connectivity drops mid-session before navigating",
      mode: "auto",
      steps: [
        { action: "navigate", path: p.path ?? "/" },
        { action: "setOffline" },
        { action: "navigate", path: p.uncachedPath ?? "/uncached-route", expectFailure: true },
        { action: "setOnline" },
        { action: "navigate", path: p.path ?? "/" },
        { action: "expectVisible", selector: p.rootSelector ?? "body" },
      ],
    }),
  },

  // === API RESILIENCE SCENARIOS (11-16) ===
  {
    id: "api-500-error",
    category: "api-resilience",
    name: "api-500-error",
    description: "Inject HTTP 500 Internal Server Error on matching API requests and verify UI error handling.",
    requirements: ["Interception mode", "API endpoint and error UI selector"],
    expectedObservations: ["HTTP 500 response recorded", "Error UI or fallback state displayed"],
    requiredAppContracts: ["apiPattern", "triggerSelector", "errorSelector"],
    build: (p = {}) => ({
      name: "api-500-error",
      description: "Verify graceful handling of HTTP 500 API responses",
      mode: "interception",
      steps: [
        { action: "navigate", path: p.path ?? "/" },
        { action: "injectFailure", url: p.apiPattern ?? "**/api/items*", fault: "http-500" },
        ...(p.triggerSelector ? [{ action: "click" as const, selector: p.triggerSelector }] : []),
        { action: "expectVisible", selector: p.errorSelector ?? "body" },
        { action: "removeFailure", all: true },
      ],
    }),
  },
  {
    id: "api-503-error",
    category: "api-resilience",
    name: "api-503-error",
    description: "Inject HTTP 503 Service Unavailable for the first request, then verify retry succeeds.",
    requirements: ["Interception mode", "Retry-capable API client"],
    expectedObservations: ["First API request receives 503", "Subsequent retry succeeds"],
    requiredAppContracts: ["apiPattern"],
    build: (p = {}) => ({
      name: "api-503-error",
      description: "Verify recovery from transient HTTP 503 Service Unavailable responses",
      mode: "interception",
      steps: [
        { action: "navigate", path: p.path ?? "/" },
        {
          action: "injectFailure",
          url: p.apiPattern ?? "**/api/items*",
          fault: "http-503",
          once: true,
        },
        { action: "expectVisible", selector: p.rootSelector ?? "body" },
      ],
    }),
  },
  {
    id: "api-429-rate-limiting",
    category: "api-resilience",
    name: "api-429-rate-limiting",
    description: "Inject HTTP 429 Too Many Requests with Retry-After header.",
    requirements: ["Interception mode", "API endpoint pattern"],
    expectedObservations: ["429 response injected and recorded in timeline"],
    requiredAppContracts: ["apiPattern"],
    build: (p = {}) => ({
      name: "api-429-rate-limiting",
      description: "Verify application behavior when API returns HTTP 429 rate-limit errors",
      mode: "interception",
      steps: [
        { action: "navigate", path: p.path ?? "/" },
        {
          action: "injectFailure",
          url: p.apiPattern ?? "**/api/**",
          fault: "http-429",
          headers: { "retry-after": "2" },
        },
        { action: "expectVisible", selector: p.rootSelector ?? "body" },
        { action: "removeFailure", all: true },
      ],
    }),
  },
  {
    id: "delayed-api-response",
    category: "api-resilience",
    name: "delayed-api-response",
    description: "Delay API responses by 1500ms to test loading indicators and client timeout handling.",
    requirements: ["Interception mode", "API endpoint pattern"],
    expectedObservations: ["API response is observably delayed by >= 1500ms"],
    requiredAppContracts: ["apiPattern"],
    build: (p = {}) => ({
      name: "delayed-api-response",
      description: "Verify loading and timeout handling under delayed API responses",
      mode: "interception",
      steps: [
        { action: "navigate", path: p.path ?? "/" },
        { action: "delayRequests", url: p.apiPattern ?? "**/api/**", delayMs: 1500 },
        { action: "expectVisible", selector: p.rootSelector ?? "body" },
        { action: "removeFailure", all: true },
      ],
    }),
  },
  {
    id: "failed-background-request",
    category: "api-resilience",
    name: "failed-background-request",
    description: "Fail background fetch/XHR requests while keeping main page interactive.",
    requirements: ["Interception mode"],
    expectedObservations: ["Background fetch fails without breaking primary UI"],
    requiredAppContracts: ["apiPattern"],
    build: (p = {}) => ({
      name: "failed-background-request",
      description: "Ensure failing background fetch requests do not crash foreground UI",
      mode: "interception",
      steps: [
        { action: "navigate", path: p.path ?? "/" },
        {
          action: "injectFailure",
          url: p.apiPattern ?? "**/api/**",
          fault: "connection-failed",
          resourceTypes: ["fetch", "xhr"],
        },
        { action: "expectVisible", selector: p.rootSelector ?? "body" },
        { action: "removeFailure", all: true },
      ],
    }),
  },
  {
    id: "malformed-api-response",
    category: "api-resilience",
    name: "malformed-api-response",
    description: "Return invalid JSON from an API endpoint and verify the UI handles parse failures safely.",
    requirements: ["Interception mode", "API endpoint pattern"],
    expectedObservations: ["Malformed JSON response injected", "App remains usable without crashing"],
    requiredAppContracts: ["apiPattern"],
    build: (p = {}) => ({
      name: "malformed-api-response",
      description: "Verify resilience against corrupted/malformed JSON API responses",
      mode: "interception",
      steps: [
        { action: "navigate", path: p.path ?? "/" },
        {
          action: "injectFailure",
          url: p.apiPattern ?? "**/api/**",
          fault: "malformed-json",
        },
        { action: "expectVisible", selector: p.rootSelector ?? "body" },
        { action: "removeFailure", all: true },
      ],
    }),
  },

  // === OFFLINE-FIRST SCENARIOS (17-24) ===
  {
    id: "offline-form-submission",
    category: "offline-first",
    name: "offline-form-submission",
    description: "Submit a form while offline and verify local confirmation and persistence.",
    requirements: ["Offline-capable form with local storage or IndexedDB queue"],
    expectedObservations: ["Form submits while offline", "Local save confirmation is rendered"],
    requiredAppContracts: ["inputSelector", "submitSelector", "savedText"],
    build: (p = {}) => ({
      name: "offline-form-submission",
      description: "Verify form submissions save locally when the browser is offline",
      mode: "pwa",
      steps: [
        { action: "navigate", path: p.path ?? "/" },
        { action: "waitForServiceWorker", controlled: true, timeoutMs: 15000 },
        { action: "setOffline" },
        { action: "fill", selector: p.inputSelector ?? "[data-testid='note-title-input']", value: "Offline Task" },
        { action: "click", selector: p.submitSelector ?? "[data-testid='save-note-btn']" },
        {
          action: "expectText",
          selector: p.statusSelector ?? "[data-testid='sync-status']",
          text: p.savedText ?? "Saved locally",
        },
        { action: "setOnline" },
      ],
    }),
  },
  {
    id: "data-persistence-after-reload",
    category: "offline-first",
    name: "data-persistence-after-reload",
    description: "Create data while offline, reload the page while still offline, and confirm data survives in IndexedDB and UI.",
    requirements: ["PWA with Service Worker shell cache and IndexedDB persistence"],
    expectedObservations: ["Record persists in IndexedDB", "Reloaded offline UI still displays the record"],
    requiredAppContracts: ["database", "store", "inputSelector", "submitSelector", "listSelector"],
    build: (p = {}) => ({
      name: "data-persistence-after-reload",
      description: "Verify offline-created records survive a full offline page reload",
      mode: "pwa",
      steps: [
        { action: "navigate", path: p.path ?? "/" },
        { action: "waitForServiceWorker", controlled: true, timeoutMs: 15000 },
        { action: "setOffline" },
        { action: "fill", selector: p.inputSelector ?? "[data-testid='note-title-input']", value: "Persisted Offline Note" },
        { action: "click", selector: p.submitSelector ?? "[data-testid='save-note-btn']" },
        {
          action: "expectIndexedDBRecord",
          database: p.database ?? "offlinelab-demo-db",
          store: p.store ?? "notes",
          minCount: 1,
        },
        { action: "reload" },
        {
          action: "expectText",
          selector: p.listSelector ?? "[data-testid='notes-list']",
          text: "Persisted Offline Note",
        },
        { action: "setOnline" },
      ],
    }),
  },
  {
    id: "queue-and-reconnect-sync",
    category: "offline-first",
    name: "queue-and-reconnect-sync",
    description: "Queue a mutation offline, reconnect, and verify synchronization completes with zero pending items.",
    requirements: ["PWA with offline mutation queue and reconnection sync"],
    expectedObservations: ["Pending queue increments offline", "Queue drains to 0 after reconnection"],
    requiredAppContracts: ["inputSelector", "submitSelector", "pendingCountSelector", "syncStatusSelector"],
    build: (p = {}) => ({
      name: "queue-and-reconnect-sync",
      description: "Verify offline queued mutations synchronize automatically after reconnecting",
      mode: "pwa",
      steps: [
        { action: "navigate", path: p.path ?? "/" },
        { action: "waitForServiceWorker", controlled: true, timeoutMs: 15000 },
        { action: "setOffline" },
        { action: "fill", selector: p.inputSelector ?? "[data-testid='note-title-input']", value: "Queued Sync Item" },
        { action: "click", selector: p.submitSelector ?? "[data-testid='save-note-btn']" },
        { action: "expectText", selector: p.pendingCountSelector ?? "[data-testid='pending-count']", text: "1" },
        { action: "setOnline" },
        { action: "expectText", selector: p.syncStatusSelector ?? "[data-testid='sync-status']", text: "Synced" },
        { action: "expectText", selector: p.pendingCountSelector ?? "[data-testid='pending-count']", text: "0" },
      ],
    }),
  },
  {
    id: "retry-without-duplicate-records",
    category: "offline-first",
    name: "retry-without-duplicate-records",
    description: "Verify idempotent retry logic avoids creating duplicate records when responses drop after server persistence.",
    requirements: ["Idempotency-key enabled API endpoint", "Retryable client"],
    expectedObservations: ["Client retries safely", "Exactly one logical record exists on server"],
    requiredAppContracts: ["apiPattern", "inputSelector", "submitSelector"],
    build: (p = {}) => ({
      name: "retry-without-duplicate-records",
      description: "Verify retrying a mutation does not duplicate records on the backend",
      mode: "interception",
      steps: [
        { action: "navigate", path: p.path ?? "/" },
        {
          action: "injectFailure",
          url: p.apiPattern ?? "**/api/notes",
          methods: ["POST"],
          fault: "connection-failed",
          once: true,
        },
        { action: "fill", selector: p.inputSelector ?? "[data-testid='note-title-input']", value: "Idempotent Item" },
        { action: "click", selector: p.submitSelector ?? "[data-testid='save-note-btn']" },
        { action: "expectText", selector: p.syncStatusSelector ?? "[data-testid='sync-status']", text: "Synced" },
      ],
    }),
  },
  {
    id: "cache-fallback",
    category: "offline-first",
    name: "cache-fallback",
    description: "Inspect Cache Storage to confirm expected shell assets are cached and offline fallback renders.",
    requirements: ["PWA with Service Worker Cache Storage"],
    expectedObservations: ["Cache Storage contains app shell asset", "Offline fallback page renders for uncached routes"],
    requiredAppContracts: ["cachedUrlPattern", "fallbackRoute", "fallbackSelector"],
    build: (p = {}) => ({
      name: "cache-fallback",
      description: "Verify Cache Storage entries and offline fallback UI",
      mode: "pwa",
      steps: [
        { action: "navigate", path: p.path ?? "/" },
        { action: "waitForServiceWorker", controlled: true, timeoutMs: 15000 },
        { action: "inspectCache" },
        { action: "expectCacheContains", urlPattern: p.cachedUrlPattern ?? "**/offline.html" },
        { action: "setOffline" },
        { action: "navigate", path: p.fallbackRoute ?? "/non-existent-offline-page" },
        { action: "expectVisible", selector: p.fallbackSelector ?? "[data-testid='offline-fallback']" },
        { action: "setOnline" },
      ],
    }),
  },
  {
    id: "service-worker-update",
    category: "offline-first",
    name: "service-worker-update",
    description: "Verify Service Worker registers, activates, and maintains page control across reloads.",
    requirements: ["PWA with Service Worker"],
    expectedObservations: ["Service Worker reaches activated state and controls the page"],
    build: (p = {}) => ({
      name: "service-worker-update",
      description: "Verify Service Worker lifecycle activation and controller retention",
      mode: "pwa",
      steps: [
        { action: "navigate", path: p.path ?? "/" },
        { action: "waitForServiceWorker", controlled: true, state: "activated", timeoutMs: 15000 },
        { action: "reload" },
        { action: "waitForServiceWorker", controlled: true, state: "activated", timeoutMs: 10000 },
        { action: "inspectCache" },
      ],
    }),
  },
  {
    id: "offline-auth-state-preservation",
    category: "offline-first",
    name: "offline-auth-state-preservation",
    description: "Verify non-secret user session indicators persist in storage across an offline reload.",
    requirements: ["Application storing session state locally"],
    expectedObservations: ["Session state key remains present across offline reload"],
    requiredAppContracts: ["storageKey"],
    build: (p = {}) => ({
      name: "offline-auth-state-preservation",
      description: "Verify local session state is preserved when reloading offline",
      mode: "pwa",
      steps: [
        { action: "navigate", path: p.path ?? "/" },
        { action: "waitForServiceWorker", controlled: true, timeoutMs: 15000 },
        {
          action: "expectStorageValue",
          storage: "localStorage",
          key: p.storageKey ?? "offlinelab_demo_user",
          exists: true,
        },
        { action: "setOffline" },
        { action: "reload" },
        {
          action: "expectStorageValue",
          storage: "localStorage",
          key: p.storageKey ?? "offlinelab_demo_user",
          exists: true,
        },
        { action: "setOnline" },
      ],
    }),
  },
  {
    id: "recovery-after-failed-sync",
    category: "offline-first",
    name: "recovery-after-failed-sync",
    description: "Fail the initial synchronization attempt with HTTP 500, then trigger retry and verify recovery.",
    requirements: ["Offline-first app with recoverable failed sync queue"],
    expectedObservations: [
      "Failed sync preserves record locally without data loss",
      "Manual or automatic retry completes sync after fault removal",
    ],
    requiredAppContracts: ["apiPattern", "inputSelector", "submitSelector", "retrySelector", "syncStatusSelector"],
    build: (p = {}) => ({
      name: "recovery-after-failed-sync",
      description: "Verify failed synchronization preserves local data and recovers on retry",
      mode: "interception",
      steps: [
        { action: "navigate", path: p.path ?? "/" },
        {
          action: "injectFailure",
          id: "sync-fail-500",
          url: p.apiPattern ?? "**/api/notes",
          methods: ["POST"],
          fault: "http-500",
        },
        { action: "fill", selector: p.inputSelector ?? "[data-testid='note-title-input']", value: "Recoverable Sync Note" },
        { action: "click", selector: p.submitSelector ?? "[data-testid='save-note-btn']" },
        { action: "expectText", selector: p.syncStatusSelector ?? "[data-testid='sync-status']", text: "Sync failed" },
        { action: "removeFailure", id: "sync-fail-500" },
        { action: "click", selector: p.retrySelector ?? "[data-testid='retry-sync-btn']" },
        { action: "expectText", selector: p.syncStatusSelector ?? "[data-testid='sync-status']", text: "Synced" },
      ],
    }),
  },
];

export function getScenarioTemplate(id: string): ScenarioTemplate | undefined {
  return BUILT_IN_SCENARIO_TEMPLATES.find((t) => t.id === id);
}

export function renderScenarioTemplateYaml(id: string, params?: Record<string, string>): string {
  const tpl = getScenarioTemplate(id);
  if (!tpl) {
    throw new Error(`Unknown built-in scenario template: ${id}`);
  }
  const def = tpl.build(params);
  return `# ${tpl.description}\n${stringifyYaml(def)}`;
}
