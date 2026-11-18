# Network Profiles

OfflineLab includes 11 built-in reproducible network profiles and supports custom user-defined profiles.

Inspect effective values from the CLI:

```bash
npx offlinelab preset list
npx offlinelab preset show slow-3g
```

## Built-In Profiles

| Profile | Offline | Latency | Download (Kbps) | Upload (Kbps) | Notes |
|---|---|---|---|---|---|
| `online` | `false` | `0ms` | unlimited | unlimited | Normal unrestricted network |
| `offline` | `true` | `0ms` | `0` | `0` | Browser-context offline emulation |
| `wifi` | `false` | `15ms` | `30000` | `15000` | Low latency, high bandwidth |
| `slow-4g` | `false` | `150ms` | `4000` | `1500` | Constrained 4G mobile |
| `fast-3g` | `false` | `300ms` | `1600` | `750` | Moderate 3G mobile |
| `slow-3g` | `false` | `600ms` | `500` | `250` | High-latency, low-bandwidth 3G |
| `2g` | `false` | `1200ms` | `150` | `50` | Severely constrained 2G/EDGE |
| `high-latency` | `false` | `2000ms` | `5000` | `2000` | Elevated RTT latency |
| `flaky` | `false` | `250ms` | `2000` | `1000` | 25% deterministic seeded request failures (`seed: 1337`) |
| `unstable` | `false` | `200ms` | `1500` | `750` | Alternates online/offline every `2000ms` |
| `custom` | `false` | `0ms` | unlimited | unlimited | Base template for custom overrides |

> **Note:** These are deterministic test presets, not guarantees of matching physical cellular hardware. Full upload/download bandwidth throttling uses Chrome DevTools Protocol (`Network.emulateNetworkConditionsByRule` / `Network.overrideNetworkState` with fallback to `Network.emulateNetworkConditions`) on **Chromium**. On Firefox and WebKit, OfflineLab applies offline emulation and request-level latency injection and explicitly warns or reports unsupported capabilities when bandwidth throttling is required.

## Custom Profiles

Define custom profiles in `offlinelab.config.ts` or inline in a `setNetwork` step:

```ts
networkProfiles: {
  "custom-mobile": {
    name: "custom-mobile",
    latencyMs: 800,
    downloadKbps: 250,
    uploadKbps: 100,
    failureRate: 0.15, // Must be a 0..1 fraction (not 15)
    seed: 42,
  },
}
```

## Network Transition Schedules

Simulate real-world connectivity changes over time using monotonic timers:

```yaml
- action: startNetworkSchedule
  steps:
    - atMs: 0
      profile: online
      label: ONLINE
    - atMs: 3000
      profile: slow-3g
      label: SLOW_3G
    - atMs: 6000
      profile: offline
      label: OFFLINE
    - atMs: 11000
      profile: online
      label: ONLINE
```
