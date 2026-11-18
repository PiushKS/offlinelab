import path from "node:path";
import { OFFLINELAB_TOOL_VERSION } from "../../config/defaults/defaults.js";
import { ConfigLoader } from "../../config/loader/config-loader.js";
import {
  ConfigValidationError,
  ExitCode,
  type ExitCodeValue,
} from "../../core/errors/index.js";
import { OfflineLabRunner } from "../../core/runner/runner.js";
import { TerminalRenderer } from "../../reporters/terminal/terminal-renderer.js";
import type {
  BrowserName,
  LogLevel,
  OfflineLabConfigInput,
  ReportFormat,
  UnsupportedCapabilityPolicy,
} from "../../types/index.js";

export interface RunCommandOptions {
  url?: string;
  scenario?: string[];
  pattern?: string;
  browser?: string[];
  profile?: string;
  device?: string;
  headed?: boolean;
  headless?: boolean;
  workers?: string;
  retries?: string;
  timeout?: string;
  config?: string;
  reportDir?: string;
  reporter?: string;
  unsupportedPolicy?: string;
  ci?: boolean;
  quiet?: boolean;
  verbose?: boolean;
  debug?: boolean;
  json?: boolean;
  cwd?: string;
}

function parseBrowsers(raw?: string[]): BrowserName[] | undefined {
  if (!raw || raw.length === 0) return undefined;
  const valid = new Set<BrowserName>(["chromium", "firefox", "webkit"]);
  const out: BrowserName[] = [];
  for (const item of raw) {
    for (const part of item.split(",")) {
      const trimmed = part.trim().toLowerCase() as BrowserName;
      if (!trimmed) continue;
      if (!valid.has(trimmed)) {
        throw new ConfigValidationError(
          `Unsupported browser "${trimmed}". Allowed values: chromium, firefox, webkit.`,
        );
      }
      if (!out.includes(trimmed)) out.push(trimmed);
    }
  }
  return out.length > 0 ? out : undefined;
}

function parseReporters(raw?: string): ReportFormat[] | undefined {
  if (!raw) return undefined;
  const valid = new Set<ReportFormat>(["html", "json", "junit", "terminal"]);
  const out: ReportFormat[] = [];
  for (const part of raw.split(",")) {
    const trimmed = part.trim().toLowerCase() as ReportFormat;
    if (!trimmed) continue;
    if (!valid.has(trimmed)) {
      throw new ConfigValidationError(
        `Unknown reporter "${trimmed}". Allowed values: html, json, junit, terminal.`,
      );
    }
    if (!out.includes(trimmed)) out.push(trimmed);
  }
  return out.length > 0 ? out : undefined;
}

function parsePositiveInt(val: string | undefined, name: string, allowZero = false): number | undefined {
  if (val === undefined) return undefined;
  const n = Number(val);
  const min = allowZero ? 0 : 1;
  if (!Number.isInteger(n) || n < min) {
    throw new ConfigValidationError(`Option --${name} must be an integer >= ${min}, got "${val}".`);
  }
  return n;
}

export async function runExecuteCommand(options: RunCommandOptions): Promise<ExitCodeValue> {
  // Validate incompatible option combinations
  if (options.quiet && (options.verbose || options.debug)) {
    throw new ConfigValidationError("Cannot combine --quiet with --verbose or --debug.");
  }
  if (options.headed && options.headless) {
    throw new ConfigValidationError("Cannot specify both --headed and --headless.");
  }
  if (options.ci && options.headed) {
    throw new ConfigValidationError("Cannot combine --ci with --headed mode.");
  }
  if (options.url) {
    try {
      new URL(options.url);
    } catch {
      throw new ConfigValidationError(`Invalid --url "${options.url}". Provide a full http(s) URL.`);
    }
  }

  const browsers = parseBrowsers(options.browser);
  const reporters = parseReporters(options.reporter);
  const workers = parsePositiveInt(options.workers, "workers");
  const retries = parsePositiveInt(options.retries, "retries", true);
  const timeoutMs = parsePositiveInt(options.timeout, "timeout");

  let unsupportedPolicy: UnsupportedCapabilityPolicy | undefined;
  if (options.unsupportedPolicy) {
    if (
      options.unsupportedPolicy !== "skip" &&
      options.unsupportedPolicy !== "fail" &&
      options.unsupportedPolicy !== "warn"
    ) {
      throw new ConfigValidationError(
        `Invalid --unsupported-policy "${options.unsupportedPolicy}". Expected skip, fail, or warn.`,
      );
    }
    unsupportedPolicy = options.unsupportedPolicy;
  }

  const overrides: Partial<OfflineLabConfigInput> = {};
  if (options.url) overrides.baseURL = options.url;
  if (browsers) overrides.browsers = browsers;
  if (options.device) overrides.device = options.device;
  if (options.headed) overrides.headless = false;
  if (options.headless || options.ci) overrides.headless = true;
  if (workers !== undefined) overrides.workers = workers;
  if (retries !== undefined) overrides.retries = retries;
  if (timeoutMs !== undefined) overrides.timeoutMs = timeoutMs;
  if (unsupportedPolicy) overrides.unsupportedPolicy = unsupportedPolicy;
  if (options.reportDir || reporters) {
    overrides.reports = {
      ...(options.reportDir ? { directory: options.reportDir } : {}),
      ...(reporters ? { formats: reporters } : {}),
    };
  }

  const cwd = path.resolve(options.cwd ?? process.cwd());
  const { config } = await ConfigLoader.load({
    cwd,
    configPath: options.config,
    overrides,
  });

  const logLevel: LogLevel = options.debug
    ? "debug"
    : options.verbose
      ? "verbose"
      : options.quiet
        ? "quiet"
        : "normal";

  const renderer = new TerminalRenderer({
    logLevel,
    jsonMode: Boolean(options.json),
  });

  const abortController = new AbortController();
  let interrupted = false;

  const onSigInt = () => {
    interrupted = true;
    renderer.writeProgress("Received SIGINT, cleaning up browser contexts and child processes...");
    abortController.abort(new Error("Interrupted by SIGINT"));
  };
  process.once("SIGINT", onSigInt);

  try {
    const runner = new OfflineLabRunner(config);

    // Zero-config URL inspection triggers when --url is given without explicit scenario filters and no scenario config overrides
    const useZeroConfigInspect =
      Boolean(options.url) &&
      (!options.scenario || options.scenario.length === 0) &&
      !options.pattern &&
      !options.config;

    let headerPrinted = false;

    const output = await runner.run({
      inspectUrl: useZeroConfigInspect ? options.url : undefined,
      scenarioNames: options.scenario,
      scenarioPattern: options.pattern,
      profileOverride: options.profile,
      signal: abortController.signal,
      onProgress: (msg) => {
        if (!headerPrinted) {
          headerPrinted = true;
          renderer.writeHeader(
            OFFLINELAB_TOOL_VERSION,
            options.url ?? config.baseURL,
            config.browsers,
            useZeroConfigInspect ? 1 : 0,
          );
        }
        renderer.writeProgress(msg);
      },
      onScenarioComplete: (res) => {
        if (!headerPrinted) {
          headerPrinted = true;
          renderer.writeHeader(
            OFFLINELAB_TOOL_VERSION,
            options.url ?? config.baseURL,
            config.browsers,
            1,
          );
        }
        renderer.writeScenarioResult(res);
      },
    });

    if (output.report.scenarios.length === 0 && !interrupted) {
      throw new ConfigValidationError(
        `No scenarios matched (patterns: ${config.scenarios.join(", ")}).`,
        { patterns: config.scenarios, scenarioNames: options.scenario, pattern: options.pattern },
        "Run `offlinelab init` to create example scenarios, or pass `--url http://localhost:3000` for zero-config inspection.",
      );
    }

    const relHtml = output.reportPaths.topLevelHtml
      ? path.relative(cwd, output.reportPaths.topLevelHtml)
      : undefined;
    const relJson = output.reportPaths.topLevelJson
      ? path.relative(cwd, output.reportPaths.topLevelJson)
      : undefined;
    const relJunit = output.reportPaths.topLevelJunit
      ? path.relative(cwd, output.reportPaths.topLevelJunit)
      : undefined;

    renderer.writeSummary(output.report, {
      html: relHtml,
      json: relJson,
      junit: relJunit,
    });

    if (interrupted) {
      return ExitCode.INTERRUPTED;
    }

    return output.hasFailures ? ExitCode.ASSERTION_FAILURE : ExitCode.SUCCESS;
  } finally {
    process.removeListener("SIGINT", onSigInt);
  }
}
