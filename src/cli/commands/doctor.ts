import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pc from "picocolors";
import { getBrowserCapabilities } from "../../browser/adapters/browser-adapter.js";
import { getPlaywrightBrowserType } from "../../browser/context/browser-manager.js";
import { ConfigLoader } from "../../config/loader/config-loader.js";
import { getInstalledPlaywrightVersion } from "../../core/runner/runner.js";
import { ScenarioDiscovery } from "../../core/scenarios/discovery.js";
import type { BrowserName } from "../../types/index.js";

export interface DoctorCheckResult {
  id: string;
  name: string;
  status: "pass" | "warn" | "fail";
  message: string;
  suggestion?: string;
  details?: Record<string, unknown>;
}

export interface DoctorReport {
  ok: boolean;
  timestamp: string;
  checks: DoctorCheckResult[];
}

export interface DoctorCommandOptions {
  json?: boolean;
  config?: string;
  cwd?: string;
  skipLaunchCheck?: boolean;
}

export async function runDoctorChecks(options: DoctorCommandOptions = {}): Promise<DoctorReport> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const checks: DoctorCheckResult[] = [];

  // 1. Node.js version
  const nodeMajor = Number(process.versions.node.split(".")[0] ?? "0");
  checks.push({
    id: "node-version",
    name: "Node.js version",
    status: nodeMajor >= 22 ? "pass" : "fail",
    message: `Node.js ${process.version} (required: >=22.0.0)`,
    suggestion:
      nodeMajor < 22 ? "Upgrade Node.js to version 22 LTS or newer." : undefined,
  });

  // 2. Operating system
  const supportedPlatforms = new Set(["darwin", "linux", "win32"]);
  const platform = process.platform;
  checks.push({
    id: "os",
    name: "Operating system",
    status: supportedPlatforms.has(platform) ? "pass" : "warn",
    message: `${platform} (${os.arch()}, ${os.release()})`,
  });

  // 3. Installed Playwright version
  const pwVersion = getInstalledPlaywrightVersion();
  checks.push({
    id: "playwright-version",
    name: "Playwright package",
    status: pwVersion !== "unknown" ? "pass" : "fail",
    message:
      pwVersion !== "unknown" ? `playwright v${pwVersion}` : "Playwright package not found",
    suggestion: pwVersion === "unknown" ? "Install Playwright: npm install -D playwright" : undefined,
  });

  // 4. Configuration validity
  let loadedConfig;
  let configPath: string | undefined;
  try {
    const res = await ConfigLoader.load({ cwd, configPath: options.config });
    loadedConfig = res.config;
    configPath = res.configPath;
    checks.push({
      id: "config",
      name: "Configuration",
      status: "pass",
      message: configPath
        ? `Valid config at ${path.relative(cwd, configPath)}`
        : "No config file found (using defaults)",
    });
  } catch (err) {
    checks.push({
      id: "config",
      name: "Configuration",
      status: "fail",
      message: err instanceof Error ? err.message : String(err),
      suggestion: "Fix the configuration error or run `offlinelab init`.",
    });
  }

  const browsersToCheck: BrowserName[] = loadedConfig?.browsers ?? ["chromium"];

  // 5 & 6. Browser executable availability & launch capability
  for (const browserName of browsersToCheck) {
    const browserType = getPlaywrightBrowserType(browserName);
    let execPath = "";
    let exists = false;
    try {
      execPath = browserType.executablePath();
      await fs.access(execPath);
      exists = true;
    } catch {
      exists = false;
    }

    checks.push({
      id: `browser-binary-${browserName}`,
      name: `Browser binary (${browserName})`,
      status: exists ? "pass" : "fail",
      message: exists ? `Found at ${execPath}` : `Executable not found for ${browserName}`,
      suggestion: exists ? undefined : `Install browser binary: npx playwright install ${browserName}`,
    });

    if (exists && !options.skipLaunchCheck) {
      try {
        const instance = await browserType.launch({ headless: true, timeout: 15_000 });
        await instance.close();
        checks.push({
          id: `browser-launch-${browserName}`,
          name: `Browser launch (${browserName})`,
          status: "pass",
          message: `${browserName} launched and closed cleanly`,
        });
      } catch (err) {
        checks.push({
          id: `browser-launch-${browserName}`,
          name: `Browser launch (${browserName})`,
          status: "fail",
          message: `Failed to launch ${browserName}: ${(err as Error).message}`,
          suggestion: `Run \`npx playwright install ${browserName}\` (and \`npx playwright install-deps ${browserName}\` on Linux).`,
        });
      }
    }

    // Browser capability note
    const caps = getBrowserCapabilities(browserName);
    if (!caps.cdpNetworkThrottling || !caps.serviceWorkerInspection) {
      checks.push({
        id: `browser-caps-${browserName}`,
        name: `Browser capabilities (${browserName})`,
        status: "warn",
        message: caps.notes.join(" "),
      });
    }
  }

  // 7. Scenario discovery
  if (loadedConfig) {
    try {
      const files = await ScenarioDiscovery.discoverFiles(loadedConfig.scenarios, cwd);
      if (files.length === 0) {
        checks.push({
          id: "scenarios",
          name: "Scenario discovery",
          status: "warn",
          message: `No scenarios matched patterns: ${loadedConfig.scenarios.join(", ")}`,
          suggestion: "Run `offlinelab init` to generate starter scenarios or pass --url for zero-config inspection.",
        });
      } else {
        const validation = await ScenarioDiscovery.validateFiles(files);
        const invalid = validation.filter((v) => !v.valid);
        checks.push({
          id: "scenarios",
          name: "Scenario discovery",
          status: invalid.length === 0 ? "pass" : "fail",
          message:
            invalid.length === 0
              ? `Discovered ${files.length} valid scenario file(s)`
              : `${invalid.length} of ${files.length} scenario file(s) have validation errors`,
          suggestion:
            invalid.length > 0 ? "Run `offlinelab scenario validate` to see detailed errors." : undefined,
        });
      }
    } catch (err) {
      checks.push({
        id: "scenarios",
        name: "Scenario discovery",
        status: "fail",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 8. Report directory permissions
  const reportDir = path.resolve(cwd, loadedConfig?.reports.directory ?? "./offlinelab-results");
  try {
    await fs.mkdir(reportDir, { recursive: true });
    const probe = path.join(reportDir, `.doctor-write-test-${Date.now()}`);
    await fs.writeFile(probe, "ok", "utf8");
    await fs.rm(probe, { force: true });
    checks.push({
      id: "report-dir",
      name: "Report directory permissions",
      status: "pass",
      message: `Writable: ${reportDir}`,
    });
  } catch (err) {
    checks.push({
      id: "report-dir",
      name: "Report directory permissions",
      status: "fail",
      message: `Cannot write to report directory ${reportDir}: ${(err as Error).message}`,
      suggestion: "Check filesystem permissions or configure a writable `reports.directory`.",
    });
  }

  // 9. Target application reachability (if configured)
  if (loadedConfig?.baseURL) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3000);
      const res = await fetch(loadedConfig.baseURL, { signal: ctrl.signal, redirect: "manual" });
      clearTimeout(timer);
      checks.push({
        id: "target-app",
        name: "Target application reachability",
        status: "pass",
        message: `${loadedConfig.baseURL} responded with HTTP ${res.status}`,
      });
    } catch {
      checks.push({
        id: "target-app",
        name: "Target application reachability",
        status: loadedConfig.webServer ? "warn" : "warn",
        message: `${loadedConfig.baseURL} is not currently reachable${loadedConfig.webServer ? " (webServer is configured to start it during `run`)" : ""}`,
        suggestion: loadedConfig.webServer
          ? undefined
          : "Start your local dev server before running `offlinelab run`, or configure `webServer` in offlinelab.config.ts.",
      });
    }
  }

  // 10. Potentially incompatible Service Worker settings
  if (loadedConfig) {
    if (loadedConfig.mode === "interception" && loadedConfig.serviceWorkers === "allow") {
      checks.push({
        id: "sw-settings",
        name: "Service Worker settings",
        status: "warn",
        message:
          'mode="interception" with serviceWorkers="allow": Service Workers may serve cached responses before Playwright route interception sees them.',
        suggestion: 'Set `serviceWorkers: "block"` for deterministic API fault injection.',
      });
    } else if (loadedConfig.baseURL) {
      try {
        const parsed = new URL(loadedConfig.baseURL);
        const isSecure =
          parsed.protocol === "https:" ||
          parsed.hostname === "localhost" ||
          parsed.hostname === "127.0.0.1" ||
          parsed.hostname === "[::1]";
        if (!isSecure && loadedConfig.mode === "pwa") {
          checks.push({
            id: "sw-settings",
            name: "Service Worker secure context",
            status: "warn",
            message: `baseURL "${loadedConfig.baseURL}" is not HTTPS or localhost; browsers block Service Worker registration on insecure origins.`,
            suggestion: "Use localhost, 127.0.0.1, or HTTPS when testing Service Workers.",
          });
        }
      } catch {
        // ignore
      }
    }
  }

  const ok = checks.every((c) => c.status !== "fail");
  return {
    ok,
    timestamp: new Date().toISOString(),
    checks,
  };
}

export async function runDoctorCommand(options: DoctorCommandOptions): Promise<boolean> {
  const report = await runDoctorChecks(options);

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return report.ok;
  }

  const useColor = Boolean(process.stdout.isTTY) && !("NO_COLOR" in process.env);
  const paint = (fn: (s: string) => string, s: string) => (useColor ? fn(s) : s);

  console.log(paint(pc.bold, "OfflineLab Environment Diagnostics"));
  console.log("─".repeat(40));

  for (const check of report.checks) {
    const tag =
      check.status === "pass"
        ? paint(pc.green, "PASS")
        : check.status === "warn"
          ? paint(pc.yellow, "WARN")
          : paint(pc.red, "FAIL");
    console.log(`${tag}  ${check.name}: ${check.message}`);
    if (check.suggestion) {
      console.log(`      ${paint(pc.dim, `Hint: ${check.suggestion}`)}`);
    }
  }

  console.log("");
  console.log(
    report.ok
      ? paint(pc.green, "Environment looks ready.")
      : paint(pc.red, "One or more required checks failed."),
  );

  return report.ok;
}
