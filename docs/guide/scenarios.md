# Scenarios (YAML & TypeScript)

OfflineLab executes both declarative **YAML scenarios** and programmatic **TypeScript scenarios** through the same execution engine.

## YAML Scenarios

```yaml
name: offline-navigation
description: Verify cached PWA navigation
mode: pwa
browser: chromium

steps:
  - action: navigate
    path: /
  - action: waitForServiceWorker
    controlled: true
    timeoutMs: 15000
  - action: navigate
    path: /
  - action: setNetwork
    profile: offline
  - action: reload
  - action: expectVisible
    selector: "[data-testid='app-shell']"
  - action: expectText
    selector: "[data-testid='network-status']"
    text: "Offline"
  - action: screenshot
    name: offline-home
  - action: setNetwork
    profile: online
```

### Supported YAML Actions

- **Navigation & Interaction:** `navigate`, `reload`, `click`, `fill`, `press`, `select`, `waitForSelector`, `waitForURL`, `waitForResponse`, `waitForRequest`, `wait`
- **Network Control:** `setNetwork`, `setOffline`, `setOnline`, `injectFailure`, `removeFailure`, `delayRequests`, `mockResponse`, `startNetworkSchedule`, `stopNetworkSchedule`
- **PWA & Storage:** `waitForServiceWorker`, `inspectCache`, `inspectIndexedDB`, `inspectLocalStorage`, `captureStorageSnapshot`
- **Assertions:** `expectVisible`, `expectHidden`, `expectText`, `expectURL`, `expectRequestCount`, `expectResponseStatus`, `expectNoConsoleErrors`, `expectStorageValue`, `expectCacheContains`, `expectIndexedDBRecord`, `customAssertion`
- **Artifacts & Timeline:** `screenshot`, `snapshot`, `markTimelineEvent`

## TypeScript Scenarios

```ts
import { defineScenario } from "offlinelab";

export default defineScenario({
  name: "offline-form-submit",
  mode: "pwa",
  async run({ page, network, expect, waitForServiceWorker }) {
    await page.goto("/");
    await waitForServiceWorker({ controlled: true, timeoutMs: 15_000 });

    await network.offline();
    await page.getByTestId("note-title-input").fill("Offline Task");
    await page.getByTestId("save-note-btn").click();
    await expect(page.getByTestId("sync-status")).toContainText("Saved locally");

    await network.online();
    await expect(page.getByTestId("sync-status")).toHaveText("Synced");
  },
});
```

## Built-In Scenario Library

OfflineLab ships with **24 validated scenario templates** covering connectivity disruptions, API resilience, and offline-first sync patterns. List them anytime:

```bash
npx offlinelab scenario templates
```
