# CLI Reference

Every command respects `NO_COLOR`, non-TTY streams, and returns deterministic exit codes (`0`, `1`, `2`, `3`, `130`).

## `offlinelab`

- Interactive terminal (TTY): displays a welcome menu of common actions.
- Non-interactive terminal / CI: prints CLI help and exits `0` without hanging.
- Flags: `-v, --version`, `-h, --help`.

## `offlinelab init`

Initialize `offlinelab.config.ts` and starter scenarios.

```bash
offlinelab init
offlinelab init --yes --template pwa --url http://localhost:4173
offlinelab init --template api --force
```

Options:
- `-y, --yes`: Non-interactive initialization using defaults
- `-t, --template <type>`: `web`, `pwa`, or `api`
- `-u, --url <url>`: Target application base URL
- `-f, --force`: Overwrite existing files (prints warning)

## `offlinelab doctor`

Verify Node.js version, OS, Playwright version, installed browser binaries, live browser launch, config validity, scenario discovery, report directory permissions, target URL reachability, and Service Worker compatibility.

```bash
offlinelab doctor
offlinelab doctor --json
```

Options:
- `-c, --config <path>`: Config file path
- `--json`: Machine-readable JSON output
- `--skip-launch-check`: Skip live browser launch test

## `offlinelab run`

Run configured scenarios or zero-config URL inspection.

```bash
offlinelab run
offlinelab run --url http://localhost:3000
offlinelab run --scenario offline-navigation --browser chromium --workers 2 --retries 1
offlinelab run --device "iPhone 15" --reporter html,json,junit --ci
```

Options:
- `-u, --url <url>`: Target URL (triggers Mode A zero-config inspection when no scenarios/config are passed)
- `-s, --scenario <name>`: Run named scenario (repeatable)
- `-p, --pattern <regex>`: Filter scenarios by name, description, or tag
- `-b, --browser <name>`: `chromium`, `firefox`, or `webkit` (repeatable or comma-separated)
- `--profile <name>`: Override initial network profile
- `--device <name>`: Playwright mobile device descriptor (e.g. `"iPhone 15"`)
- `--headed` / `--headless`: Browser visibility mode
- `-w, --workers <count>`: Parallel browser context workers
- `-r, --retries <count>`: Retry count on failure
- `--timeout <ms>`: Default timeout
- `-c, --config <path>`: Config file path
- `--report-dir <dir>`: Override report directory
- `--reporter <formats>`: Comma-separated formats (`html,json,junit,terminal`)
- `--unsupported-policy <policy>`: `skip`, `fail`, or `warn`
- `--ci`: Non-interactive headless CI mode
- `-q, --quiet`, `--verbose`, `--debug`, `--json`: Output verbosity and JSON stdout mode

## `offlinelab scenario`

- `offlinelab scenario list [--config <path>] [--json]`: List discovered scenarios
- `offlinelab scenario validate [files...] [--config <path>] [--json]`: Validate YAML/TS scenarios
- `offlinelab scenario templates [--json]`: List the 24 built-in scenario templates

## `offlinelab preset`

- `offlinelab preset list [--config <path>] [--json]`: Display built-in and custom network presets
- `offlinelab preset show <name> [--config <path>] [--json]`: Inspect preset values and browser capability support

## `offlinelab report`

- `offlinelab report list [--report-dir <dir>] [--json]`: List stored runs
- `offlinelab report open [--run latest|<id>] [--no-open]`: Open standalone HTML report
- `offlinelab report compare <runA> <runB> [--json]`: Compare status, duration, and failed requests between two runs

## `offlinelab clean`

Safely delete only OfflineLab-managed artifacts within the configured report directory.

```bash
offlinelab clean
offlinelab clean --older-than 14d
```
