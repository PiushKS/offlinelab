# TypeScript SDK

Import the stable public API from `"offlinelab"`:

```ts
import {
  OfflineLab,
  defineConfig,
  defineScenario,
  OfflineLabRunner,
  BUILT_IN_NETWORK_PROFILES,
} from "offlinelab";
```

## `OfflineLab` Class (Interactive / Test-Suite Usage)

```ts
const lab = new OfflineLab({
  browser: "chromium",
  baseURL: "http://localhost:4173",
  headless: true,
  serviceWorkers: "allow",
});

try {
  await lab.start();
  await lab.page.goto("/");
  await lab.waitForServiceWorker({ controlled: true });

  await lab.network.offline();
  await lab.page.reload();
  await lab.expect(lab.page.getByTestId("network-status")).toHaveText("Offline");

  const snapshot = await lab.inspect();
  console.log(snapshot.serviceWorker.controlled, snapshot.cacheStorage.totalEntries);
} finally {
  await lab.stop();
}
```

### Stable `OfflineLab` Methods & Properties

- `start(): Promise<void>`: Launches browser context and attaches network observers
- `stop(): Promise<void>`: Disposes network rules/schedules, closes context/browser, tears down plugins
- `page: Page`: Playwright `Page`
- `context: BrowserContext`: Playwright `BrowserContext`
- `network: ScenarioNetworkAPI`: `offline()`, `online()`, `setProfile()`, `failRequests()`, `delayRequests()`, `mockResponse()`, `removeRule()`, `clearRules()`, `setPhase()`, `startSchedule()`, `stopSchedule()`, `isOffline()`, `getActiveProfile()`, `getCapabilities()`
- `expect: OfflineLabExpect`: Locator, Page, value, and offline-specific assertions (`noConsoleErrors`, `cacheContains`, `indexedDBRecord`, `requestCount`, `responseStatus`, `storageValue`, `custom`)
- `inspect()`, `inspectServiceWorker()`, `waitForServiceWorker()`, `inspectCache()`, `inspectStorage()`
- `registerNetworkProfile(profile)`, `registerAssertion(assertion)`, `onEvent(listener)`
- `getEvents()`, `getRequests()`, `getConsoleErrors()`
- `OfflineLab.run(config, options)`: Executes full scenario runs and generates reports

## Typed Error Classes

All errors extend `OfflineLabError` with `code`, `exitCode`, and optional `suggestion`:
- `ConfigValidationError` (exit code `2`)
- `ScenarioValidationError` (exit code `2`)
- `PathSafetyError` (exit code `2`)
- `AssertionFailedError` (exit code `1`)
- `TimeoutError` (exit code `1`)
- `UnsupportedCapabilityError` (exit code `1`)
- `BrowserLaunchError` (exit code `3`)
- `InfrastructureError` (exit code `3`)
