# Configuration

OfflineLab automatically discovers `offlinelab.config.ts`, `offlinelab.config.mts`, `offlinelab.config.js`, `offlinelab.config.mjs`, `offlinelab.config.yaml`, `offlinelab.config.yml`, or `offlinelab.config.json` in your working directory (or pass `--config <path>`).

## Full TypeScript Example

```ts
import { defineConfig } from "offlinelab";

export default defineConfig({
  baseURL: "http://localhost:4173",
  browsers: ["chromium"],
  scenarios: ["scenarios/**/*.yaml", "scenarios/**/*.ts"],
  mode: "auto",
  serviceWorkers: "allow",
  workers: 2,
  retries: 0,
  timeoutMs: 30_000,
  timeouts: {
    browserLaunchMs: 30_000,
    navigationMs: 20_000,
    stepMs: 15_000,
    assertionMs: 10_000,
    scenarioMs: 60_000,
  },
  headless: true,
  unsupportedPolicy: "skip",
  reports: {
    directory: "./offlinelab-results",
    formats: ["html", "json", "junit"],
    retentionDays: 30,
    maxRuns: 50,
  },
  artifacts: {
    screenshots: "on-failure",
    traces: "on-failure",
    baselineScreenshot: true,
    maxNetworkEvents: 1000,
    includeBodies: false,
  },
  redaction: {
    redactQueryParams: true,
    allowedQueryParams: ["page"],
    redactHeaders: ["x-internal-token"],
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:4173",
    timeoutMs: 30_000,
    reuseExistingServer: true,
  },
});
```

## Configuration Properties

| Property | Type | Default | Description |
|---|---|---|---|
| `baseURL` | `string` | `undefined` | Base URL for relative scenario navigations. |
| `browsers` | `("chromium" \| "firefox" \| "webkit")[]` | `["chromium"]` | Target Playwright browsers. |
| `scenarios` | `string[]` | `["scenarios/**/*.{yaml,yml,ts,mjs,js}"]` | Glob patterns used by `ScenarioDiscovery`. |
| `mode` | `"pwa" \| "interception" \| "auto"` | `"auto"` | Execution mode controlling Service Worker vs interception expectations. |
| `serviceWorkers` | `"allow" \| "block"` | `"allow"` | Playwright context Service Worker policy. Incompatible with `mode: "pwa"` when `"block"`. |
| `workers` | `number` | `1` | Maximum parallel isolated browser contexts (`1..32`). |
| `retries` | `number` | `0` | Retry count for failed scenarios (`0..10`). |
| `timeoutMs` | `number` | `30000` | Base timeout in milliseconds. |
| `timeouts` | `TimeoutsConfig` | See defaults | Fine-grained limits (`browserLaunchMs`, `navigationMs`, `stepMs`, `assertionMs`, `scenarioMs`, `runMs`). |
| `headless` | `boolean` | `true` | Launch browsers headless unless overridden (`--headed`). |
| `device` | `string \| DeviceConfig` | `undefined` | Playwright mobile device descriptor (e.g. `"iPhone 15"`) or custom viewport/touch/orientation config. |
| `networkProfiles` | `Record<string, Partial<NetworkProfileConfig>>` | `undefined` | Custom named network simulation profiles. |
| `unsupportedPolicy` | `"skip" \| "fail" \| "warn"` | `"skip"` | How unsupported browser capabilities are recorded and whether they fail exit code. |
| `reports` | `ReportsConfig` | `./offlinelab-results`, `["html","json","junit"]` | Output directory, formats, and retention settings. |
| `artifacts` | `ArtifactsConfig` | screenshots/traces `on-failure` | Screenshot, trace, and bounded event recording settings. |
| `redaction` | `RedactionConfig` | query/secret redaction on | URL query param, header, regex, and custom redaction rules. |
| `webServer` | `WebServerConfig` | `undefined` | Optional managed local dev server startup and teardown. |
| `auth` | `AuthConfig` | `undefined` | Playwright `storageState`, `persistentProfileDir`, `setup`, and `teardown` hooks. |
| `plugins` | `OfflineLabPlugin[]` | `undefined` | Explicitly trusted local plugins. |

> **Security Note:** TypeScript/JS config files, custom TS scenarios, `webServer.command`, and plugins execute local developer code. Review external files before running them.
