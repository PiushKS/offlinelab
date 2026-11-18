# Browser Capability Matrix & Limitations

OfflineLab explicitly distinguishes between what browser automation can simulate reliably and what differs from physical network/device testing.

## Browser Capability Matrix

| Capability | Chromium | Firefox | WebKit |
|---|---|---|---|
| Browser-context offline/online (`context.setOffline`) | Supported | Supported | Supported |
| Request failure & HTTP fault injection (Playwright routing) | Supported | Supported | Supported |
| Request-level latency injection | Supported | Supported | Supported |
| CDP upload/download bandwidth throttling | Supported | Unsupported | Unsupported |
| Service Worker lifecycle & Cache Storage inspection | Supported | Supported | Limited (headless WebKit restrictions) |
| IndexedDB inspection | Supported | Supported | Supported |
| Screenshots & Playwright traces | Supported | Supported | Supported |

When a scenario requires an unsupported capability (such as `requires: { cdpThrottling: true }` on Firefox), OfflineLab **never silently passes**. Depending on `unsupportedPolicy`, it marks the scenario `unsupported` (`"skip"`) or `failed` (`"fail"`, nonzero exit code).

## Important Simulation Boundaries

1. **Browser offline mode ≠ physical NIC disconnection:** `context.setOffline(true)` emulates offline connectivity inside the Playwright browser context; it does not disable your host computer's Wi-Fi/Ethernet adapter.
2. **Latency injection ≠ bandwidth throttling:** Delaying a response via route interception does not simulate TCP packet pacing or constrained upload/download throughput. Use Chromium CDP throttling when bandwidth constraints matter.
3. **Mobile emulation ≠ physical devices:** `--device "iPhone 15"` emulates viewport, DPR, touch, and user agent in desktop browser engines. It is not equivalent to testing physical iOS Safari or Android Chrome radio hardware, OS background suspension, or native mobile apps.
4. **Zero-config inspection scope:** `offlinelab run --url <url>` verifies online baseline loading, Service Worker/Cache observations, an offline reload probe, and online recovery. It cannot automatically verify your application's private offline workflows, queue durability, or backend sync integrity without application-specific scenarios.
