# Troubleshooting

## Missing Browser Binaries

**Symptom:** `BrowserLaunchError` or `offlinelab doctor` reports missing browser executable.

**Fix:** Run:
```bash
npx playwright install chromium
```
On Linux, also install OS libraries: `npx playwright install-deps chromium`.

## Service Worker Is Not Controlling the Page

**Symptom:** `waitForServiceWorker` times out with `controlled: false`.

**Causes & Fixes:**
1. Service Workers require HTTPS or `localhost` / `127.0.0.1`. Check your `baseURL`.
2. Verify `serviceWorkers: "allow"` is set (not `"block"` or `mode: "interception"`).
3. On first visit, a newly activated Service Worker only controls the page after `self.clients.claim()` or after navigating/reloading once.

## Route Interception Not Firing in PWA Mode

**Symptom:** `injectFailure` doesn't intercept requests handled by your Service Worker cache.

**Fix:** Service Workers can satisfy requests internally without hitting the browser network layer. Use `mode: "interception"` (`serviceWorkers: "block"`) for deterministic API fault injection tests.

## Invalid Probability Value

**Symptom:** `ConfigValidationError: Probability / failureRate must be a fraction between 0 and 1`.

**Fix:** Use `0.15` for 15% rather than `15`.

## Target Server Unavailable

**Symptom:** `ERR_CONNECTION_REFUSED`.

**Fix:** Start your local dev server first, or configure `webServer` in `offlinelab.config.ts` so OfflineLab manages startup and teardown automatically.
