# Events & Machine-Readable Reports

## Event Schema (`OfflineLabEvent`)

Every recorded timeline event uses monotonic elapsed time (`performance.now()`) and is automatically redacted:

```ts
interface OfflineLabEvent {
  id: string;
  timestamp: string;
  elapsedMs: number;
  runId: string;
  scenarioId: string;
  type: string;
  severity: "info" | "warning" | "error";
  details: Record<string, unknown>;
}
```

Common event types: `browser.launched`, `page.navigated`, `page.reloaded`, `serviceWorker.ready`, `serviceWorker.activated`, `network.offline`, `network.online`, `network.profile.changed`, `network.schedule.started`, `network.schedule.step`, `fault.rule.added`, `fault.injected`, `request.started`, `request.completed`, `request.failed`, `console.error`, `assertion.started`, `assertion.passed`, `assertion.failed`, `screenshot.captured`, `timeline.mark`, `scenario.completed`.

## JSON Report Schema (`report.json`, v1.0.0)

```ts
interface RunReport {
  schemaVersion: "1.0.0";
  runId: string;
  toolVersion: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  environment: Record<string, unknown>;
  summary: RunSummary;
  scenarios: ScenarioResult[];
  artifacts: ArtifactReference[];
  notes?: string[];
}
```

## Artifact Directory Layout

```text
offlinelab-results/
├── report.html
├── report.json
├── junit.xml
├── latest.json
└── runs/
    └── run-<timestamp>-<hash>/
        ├── report.html
        ├── report.json
        ├── junit.xml
        ├── metadata.json
        ├── screenshots/
        ├── traces/
        └── logs/
```
