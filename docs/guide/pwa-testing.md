# PWA & Service Worker Testing

OfflineLab enforces an explicit separation between **PWA mode** and **Interception mode** so tests never produce misleading results.

## Execution Modes

### `mode: "pwa"`
- Service Workers are allowed (`serviceWorkers: "allow"`).
- Exercises genuine Cache Storage responses and offline navigation.
- Enables `waitForServiceWorker`, `inspectCache`, and `expectCacheContains`.
- Note: Requests satisfied internally by a Service Worker may bypass Playwright route interception.

### `mode: "interception"`
- Service Workers are blocked (`serviceWorkers: "block"`) so every HTTP request reliably passes through Playwright route interception for deterministic API fault injection.
- Validation explicitly rejects PWA-only steps (`waitForServiceWorker`, `expectCacheContains`) in interception mode.

## Warm-Cache vs. Cold-Cache Offline Navigation

- **Warm-cache:** Load the page online, call `waitForServiceWorker` with `controlled: true`, reload or revisit so the controller handles navigations, switch offline, and reload.
- **Cold-cache:** Switch offline *before* any page visit and use `expectFailure: true` on `navigate` to assert the expected failure rather than treating an expected browser offline error as a test harness crash.

```yaml
- action: setOffline
- action: navigate
  path: /
  expectFailure: true
- action: setOnline
```

## Service Worker & Cache Storage Assertions

- `waitForServiceWorker` waits until a registration reaches the requested state (`activated`, etc.) and optionally controls `navigator.serviceWorker.controller`.
- `expectCacheContains` inspects `caches.keys()` and cached request URLs. Note that Cache Storage containing entries does **not** prove offline readiness on its own; always combine it with real offline reload and UI assertions.
