# Fault Injection

OfflineLab's `FaultInjectionEngine` intercepts matching requests via Playwright routing with deterministic rule precedence (`priority` descending, then insertion order) and seeded randomness.

## Supported Fault Types

- `connection-failed`: Aborts request with network failure
- `dns-failed`: Aborts request with `namenotresolved`
- `timeout`: Aborts request with network-layer `timedout` (distinct from delayed fulfillment)
- `delay`: Delays forwarding the real request by `delayMs`
- `http-400`, `http-401`, `http-403`, `http-408`, `http-429`, `http-500`, `http-502`, `http-503`, `http-504`
- `http-status`: Custom HTTP status code via `statusCode`
- `empty-response`: Empty HTTP body
- `malformed-json`: Syntactically broken JSON response body
- `truncated-response`: Deliberately partial body with `x-offlinelab-fault` header

## Timing & Scoping Filters

- `url`: Glob (`**/api/**`, `/api/notes`) or regex literal (`/\/api\/v\d+\//`)
- `methods`: e.g. `["POST", "PUT"]`
- `resourceTypes`: e.g. `["fetch", "xhr"]`
- `once`: Fail only the first matching request
- `firstN`: Fail the first `N` matching requests
- `everyNth`: Fail every `N`th matching request
- `durationMs`: Rule expires after `durationMs`
- `phase`: Active only while `network.setPhase(name)` matches
- `probability` + `seed`: Deterministic seeded PRNG (`0..1` fraction strictly validated)

## Programmatic Example

```ts
const ruleId = await network.failRequests({
  url: "**/api/notes",
  methods: ["POST"],
  fault: "http-503",
  probability: 0.3,
  seed: 42,
});

// Remove later
await network.removeRule(ruleId);
```
