# CI Integration

OfflineLab is designed for deterministic, non-interactive Continuous Integration execution.

## GitHub Actions Example

```yaml
name: Offline Resilience Tests
on: [push, pull_request]

jobs:
  offlinelab:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: "npm"
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npx offlinelab run --ci --reporter html,json,junit
      - if: always()
        uses: actions/upload-artifact@v4
        with:
          name: offlinelab-results
          path: offlinelab-results/
```

## Exit Codes

| Code | Meaning |
|---|---|
| `0` | All required scenarios passed |
| `1` | One or more scenario assertions failed (or unsupported capability failed under `unsupportedPolicy: "fail"`) |
| `2` | Invalid configuration, YAML schema, or CLI arguments |
| `3` | Environment or infrastructure failure (e.g. missing browser binary, webServer startup failure) |
| `130` | Interrupted by `SIGINT` (Ctrl+C) |

## Machine-Readable Output

Use `--json` for structured stdout output, and `--reporter html,json,junit` to emit JUnit XML for native CI test summary reporting alongside the standalone HTML report.
