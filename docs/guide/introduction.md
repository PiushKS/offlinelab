# Introduction

**OfflineLab** is a local-first, open-source CLI and TypeScript testing framework built on [Playwright](https://playwright.dev/) for verifying how web applications and Progressive Web Apps (PWAs) behave under real network disruptions.

## Why OfflineLab?

Modern web applications fail in subtle ways when networks degrade:

- Cached app shells fail to load because the Service Worker wasn't controlling the page yet.
- Offline form submissions silently lose user data on reload.
- Retries after dropped responses create duplicate backend records.
- Transient HTTP 500, 503, or 429 errors freeze loading indicators or crash UI state.
- High-latency or alternating connectivity exposes race conditions that never appear on localhost.

OfflineLab gives developers three complementary workflows powered by one deterministic execution engine:

1. **Zero-config CLI inspection** (`npx offlinelab run --url http://localhost:3000`) for rapid baseline and offline reload probing with honest scope reporting.
2. **Configuration-driven YAML & TypeScript scenarios** (`npx offlinelab init` + `npx offlinelab run`) for repeatable automated suites in local dev and CI.
3. **Programmatic TypeScript SDK** (`import { OfflineLab, defineConfig, defineScenario } from "offlinelab"`) for embedding offline and fault simulation directly into existing test suites.

## Core Principles

- **Local-first & offline-capable:** Runs completely locally with zero cloud services or hidden telemetry.
- **Honest capability reporting:** Never silently pretends unsupported browser throttling occurred or marks a site "offline-ready" merely because a page opened.
- **Privacy by default:** Automatically redacts URL query parameters, cookies, authorization headers, and common secret tokens from logs and reports.
