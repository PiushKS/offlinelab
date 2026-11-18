# Contributing to OfflineLab

Thank you for considering contributing to **OfflineLab**!

## Development Setup

1. Ensure you have **Node.js 22+** and **npm** installed.
2. Install dependencies and Playwright browsers:

```bash
npm install
npx playwright install chromium firefox
```

3. Run validation checks locally:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
npm run docs:build
```

## Architecture Overview

- `src/cli/`: Commander CLI commands and terminal UX
- `src/config/`: Zod schemas, defaults, and TypeScript/YAML/JSON config loading
- `src/core/`: Runner, ScenarioDiscovery, ScenarioExecutor, AssertionEngine, EventRecorder, NetworkScheduler, Errors
- `src/browser/`: BrowserManager, BrowserAdapter (capability matrix + CDP throttling), ServiceWorkerInspector, StorageInspector
- `src/network/`: NetworkController, NetworkProfileRegistry, FaultInjectionEngine
- `src/reporters/`: Terminal, JSON, JUnit XML, and standalone HTML reporters
- `src/artifacts/`: Safe artifact storage, trace/screenshot capture, and cleanup
- `src/plugins/`: Plugin registration and isolation
- `src/security/`: Secret redaction, XSS escaping, and path safety
- `src/sdk/`: Public TypeScript SDK (`OfflineLab`, `defineConfig`, `defineScenario`)
- `fixtures/offline-demo-app/`: Real offline-first PWA and controllable test backend
- `docs/`: VitePress documentation website

## Coding Guidelines

- Keep TypeScript strict mode clean (`npm run typecheck`).
- Avoid `any` except at explicitly justified protocol boundaries.
- Never fabricate test results, skip failing tests, or silently emulate unsupported browser capabilities.
- Every new CLI flag, network fault, or scenario action must include automated tests and accurate documentation.
- Run `npx changeset` for user-facing changes that should be included in the next release notes.

## Documentation Contributions

Documentation lives under `docs/` and builds via VitePress (`npm run docs:dev` / `npm run docs:build`). Ensure any new configuration keys or CLI options are documented accurately with runnable examples.
