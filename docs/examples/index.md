# Runnable Examples

The repository includes 7 complete, executable examples under `examples/` designed to run against the included offline-first PWA fixture (`fixtures/offline-demo-app`):

1. **`examples/basic-web/`**: Simple online/offline UI transition test in YAML.
2. **`examples/offline-pwa/`**: Warm-cache PWA navigation, Cache Storage check, and offline-to-online reconnection sync.
3. **`examples/request-failures/`**: HTTP 500 fault injection in interception mode with failure retention and retry recovery.
4. **`examples/slow-network/`**: Scripted monotonic `startNetworkSchedule` transitioning `online -> slow-3g -> offline -> online`.
5. **`examples/offline-form/`**: Strongly typed TypeScript scenario (`defineScenario`) verifying IndexedDB persistence and sync.
6. **`examples/typed-sdk/`**: Standalone Node.js script importing `OfflineLab` directly.
7. **`examples/github-actions/`**: Ready-to-copy GitHub Actions CI workflow.

## Running an Example Locally

Start the included demo PWA in one terminal:

```bash
PORT=4173 node fixtures/offline-demo-app/server.ts
```

Run an example in another terminal:

```bash
cd examples/offline-pwa
npx offlinelab run
```
