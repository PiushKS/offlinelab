# Installation

## Requirements

- **Node.js 22+**
- Supported platforms: **macOS**, **Linux**, and **Windows**

## Install OfflineLab

```bash
npm install -D offlinelab
```

## Install Playwright Browsers

OfflineLab never silently downloads browser binaries during ordinary CLI execution. Install the browsers you intend to test:

```bash
npx playwright install chromium
```

For cross-browser testing:

```bash
npx playwright install chromium firefox webkit
```

On Linux CI runners, include OS system dependencies:

```bash
npx playwright install --with-deps chromium
```

## Verify Your Environment

Run `doctor` to verify Node.js, Playwright, browser binaries, launch capability, and directory permissions:

```bash
npx offlinelab doctor
```
