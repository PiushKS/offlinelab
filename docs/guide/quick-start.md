# Quick Start

## Mode A: Zero-Config Inspection

Inspect any locally running application immediately without writing configuration:

```bash
npx offlinelab run --url http://localhost:3000
```

OfflineLab opens Chromium, captures a baseline screenshot, inspects Service Workers and Cache Storage, switches the context offline, probes an offline reload, restores connectivity, and writes standalone HTML, JSON, and JUnit reports under `./offlinelab-results/`.

> Zero-config inspection explicitly reports which checks were verified and which application-specific offline behaviors (such as form persistence or sync queues) still require scenario assertions.

## Mode B: Configuration-Driven Scenarios

Initialize a project with starter configuration and two scenarios:

```bash
npx offlinelab init --template pwa --url http://localhost:4173
```

Validate and execute your scenarios:

```bash
npx offlinelab scenario validate
npx offlinelab run
```

Open the standalone HTML report:

```bash
npx offlinelab report open
```

## Mode C: Programmatic TypeScript SDK

```ts
import { OfflineLab } from "offlinelab";

const lab = new OfflineLab({
  browser: "chromium",
  baseURL: "http://localhost:4173",
});

try {
  await lab.start();
  await lab.page.goto("/");
  await lab.network.offline();
  await lab.page.reload();

  const snapshot = await lab.inspect();
  console.log(snapshot);
} finally {
  await lab.stop();
}
```
