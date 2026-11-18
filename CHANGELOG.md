# Changelog

All notable changes to OfflineLab will be documented in this file.

This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) and uses Changesets for release management.

## [0.1.0] - 2026-11-18

### Added

- Core CLI (`offlinelab`) with `init`, `doctor`, `run`, `scenario`, `preset`, `report`, and `clean` commands.
- Zero-config URL inspection mode (`offlinelab run --url <url>`) with explicit scope reporting.
- Configuration loader supporting TypeScript, JavaScript, YAML, and JSON with Zod validation.
- Network simulation engine with browser-context offline/online toggling, 11 built-in profiles, custom profiles, Chromium CDP throttling adapter (`Network.emulateNetworkConditionsByRule` / `Network.overrideNetworkState` with fallback), deterministic seeded fault injection, HTTP/body fault rules, and monotonic `NetworkScheduler`.
- Scenario execution engine supporting YAML scenarios and strongly typed TypeScript scenarios (`defineScenario`) with isolated browser contexts, retries, timeouts, parallel workers, and mobile device emulation.
- PWA & storage testing subsystem with `ServiceWorkerInspector`, `StorageInspector` (localStorage, sessionStorage, IndexedDB, Cache Storage), and strict `pwa` vs `interception` mode validation.
- 24 built-in working scenario templates across connectivity, API resilience, and offline-first workflows.
- Standalone responsive accessible HTML report, versioned JSON report, JUnit XML report, terminal reporter, and `report compare`.
- Reusable programmatic SDK (`OfflineLab`, `defineConfig`, `defineScenario`) and plugin architecture (`OfflineLabPlugin`).
- Secret redaction engine and path-safety guards.
- Real offline-first PWA fixture and controllable test backend (`fixtures/offline-demo-app`).
