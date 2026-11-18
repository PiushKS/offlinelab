# Security Policy

## Supported Versions

Security fixes are applied to the latest minor release line of `offlinelab`.

## Security & Privacy Design

OfflineLab is designed to be safe for running against private, local, and staging web applications:

- **Zero telemetry by default:** OfflineLab does not embed analytics SDKs, collect credentials, or upload reports to remote services.
- **No external report assets:** Generated HTML reports are fully standalone and make no network calls to CDNs or external font hosts.
- **Redaction by default:** URL query parameters, URL embedded credentials, `Authorization` / `Cookie` / API-key headers, JWTs, and common token patterns are redacted in recorded events, request logs, JSON reports, JUnit XML, and HTML reports.
- **Privacy-by-default storage inspection:** Storage snapshots redact sensitive keys and omit raw values unless explicitly opted in.
- **Safe YAML parsing:** YAML scenarios are parsed in strict mode without JavaScript code evaluation and with prototype-pollution keys (`__proto__`, `constructor`, `prototype`) stripped.
- **Safe artifact cleanup:** `offlinelab clean` verifies path containment and refuses to operate outside dedicated OfflineLab-managed report directories.
- **XSS-safe HTML reports:** Captured page titles, URLs, console output, and error messages are HTML-escaped and JSON-encoded against `<script>` breakouts.

## Trust Model

- Local TypeScript configuration files (`offlinelab.config.ts`), custom TypeScript scenario files, `webServer.command`, and explicitly configured plugins execute developer-supplied code with your local process permissions.
- Treat third-party scenario files and configs as untrusted until reviewed.
- OfflineLab never auto-discovers or executes arbitrary external plugin packages.

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities. Instead, report vulnerabilities privately through GitHub Security Advisories for this repository and include:

1. A clear description of the vulnerability and impact
2. Minimal reproduction steps or proof-of-concept
3. Affected OfflineLab version and Node.js / OS environment

We aim to acknowledge security reports within 72 hours and provide a remediation timeline once verified.
