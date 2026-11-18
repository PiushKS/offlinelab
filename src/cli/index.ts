import * as prompts from "@clack/prompts";
import { Command } from "commander";
import pc from "picocolors";
import { OFFLINELAB_TOOL_VERSION } from "../config/defaults/defaults.js";
import {
  ExitCode,
  formatErrorForUser,
  mapErrorToExitCode,
} from "../core/errors/index.js";
import { runCleanCommand } from "./commands/clean.js";
import { runDoctorCommand } from "./commands/doctor.js";
import { runInitCommand } from "./commands/init.js";
import { runPresetListCommand, runPresetShowCommand } from "./commands/preset.js";
import {
  runReportCompareCommand,
  runReportListCommand,
  runReportOpenCommand,
} from "./commands/report.js";
import { runExecuteCommand } from "./commands/run.js";
import {
  runScenarioListCommand,
  runScenarioTemplatesCommand,
  runScenarioValidateCommand,
} from "./commands/scenario.js";

function collectList(value: string, previous: string[]): string[] {
  return [...previous, value];
}

export function createCliProgram(): Command {
  const program = new Command();

  program
    .name("offlinelab")
    .description("OfflineLab: Break the network. Not your app.")
    .version(OFFLINELAB_TOOL_VERSION, "-v, --version", "Output the current OfflineLab version")
    .showHelpAfterError("(run with --help for usage information)");

  program
    .command("init")
    .description("Initialize OfflineLab configuration and starter scenarios")
    .option("-y, --yes", "Skip interactive prompts and use defaults")
    .option("-t, --template <type>", "Project template: web, pwa, or api")
    .option("-u, --url <url>", "Target application base URL")
    .option("-f, --force", "Overwrite existing OfflineLab files")
    .action(async (opts) => {
      await runInitCommand(opts);
    });

  program
    .command("doctor")
    .description("Diagnose environment, browser binaries, configuration, and PWA readiness")
    .option("-c, --config <path>", "Path to OfflineLab config file")
    .option("--json", "Output diagnostics as JSON")
    .option("--skip-launch-check", "Skip launching browser binaries during checks")
    .action(async (opts) => {
      const ok = await runDoctorCommand(opts);
      if (!ok) {
        process.exitCode = ExitCode.INFRASTRUCTURE_ERROR;
      }
    });

  program
    .command("run")
    .description("Run offline resilience scenarios or zero-config URL inspection")
    .option("-u, --url <url>", "Target application URL (triggers zero-config inspection if no scenarios specified)")
    .option("-s, --scenario <name>", "Run specific scenario by name (repeatable)", collectList, [])
    .option("-p, --pattern <regex>", "Filter scenarios by regex pattern")
    .option("-b, --browser <name>", "Browser(s): chromium, firefox, webkit (repeatable or comma-separated)", collectList, [])
    .option("--profile <name>", "Override initial network profile")
    .option("--device <name>", "Playwright mobile device descriptor (e.g. 'iPhone 15')")
    .option("--headed", "Run browser in headed (visible) mode")
    .option("--headless", "Run browser in headless mode")
    .option("-w, --workers <count>", "Number of parallel worker contexts")
    .option("-r, --retries <count>", "Number of retries for failed scenarios")
    .option("--timeout <ms>", "Default timeout in milliseconds")
    .option("-c, --config <path>", "Path to OfflineLab configuration file")
    .option("--report-dir <dir>", "Override report output directory")
    .option("--reporter <formats>", "Comma-separated report formats: html,json,junit,terminal")
    .option("--unsupported-policy <policy>", "Policy for unsupported browser capabilities: skip, fail, warn")
    .option("--ci", "Run in non-interactive headless CI mode")
    .option("-q, --quiet", "Minimize terminal output")
    .option("--verbose", "Print detailed progress and step output")
    .option("--debug", "Print debug output and full error stack traces")
    .option("--json", "Output machine-readable JSON report to stdout")
    .action(async (opts) => {
      const exitCode = await runExecuteCommand(opts);
      process.exitCode = exitCode;
    });

  const scenarioCmd = program
    .command("scenario")
    .description("Discover, validate, and inspect test scenarios");

  scenarioCmd
    .command("list")
    .description("List discovered scenarios")
    .option("-c, --config <path>", "Path to OfflineLab config file")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      await runScenarioListCommand(opts);
    });

  scenarioCmd
    .command("validate [files...]")
    .description("Validate scenario YAML or TypeScript files")
    .option("-c, --config <path>", "Path to OfflineLab config file")
    .option("--json", "Output validation results as JSON")
    .action(async (files: string[], opts) => {
      const valid = await runScenarioValidateCommand(files, opts);
      if (!valid) {
        process.exitCode = ExitCode.INVALID_CONFIG;
      }
    });

  scenarioCmd
    .command("templates")
    .description("List built-in offline and network resilience scenario templates")
    .option("--json", "Output as JSON")
    .action((opts) => {
      runScenarioTemplatesCommand(opts);
    });

  const presetCmd = program
    .command("preset")
    .description("Inspect built-in and custom network simulation profiles");

  presetCmd
    .command("list")
    .description("List available network profiles")
    .option("-c, --config <path>", "Path to OfflineLab config file")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      await runPresetListCommand(opts);
    });

  presetCmd
    .command("show <name>")
    .description("Show detailed settings and browser capabilities for a network profile")
    .option("-c, --config <path>", "Path to OfflineLab config file")
    .option("--json", "Output as JSON")
    .action(async (name: string, opts) => {
      await runPresetShowCommand(name, opts);
    });

  const reportCmd = program
    .command("report")
    .description("Open, list, and compare stored OfflineLab reports");

  reportCmd
    .command("list")
    .description("List stored run reports")
    .option("-c, --config <path>", "Path to OfflineLab config file")
    .option("--report-dir <dir>", "Report directory")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      await runReportListCommand(opts);
    });

  reportCmd
    .command("open")
    .description("Open a generated HTML report in the default browser")
    .option("--run <id>", "Run ID or 'latest'", "latest")
    .option("-c, --config <path>", "Path to OfflineLab config file")
    .option("--report-dir <dir>", "Report directory")
    .option("--no-open", "Print the report path without launching a browser")
    .action(async (opts) => {
      await runReportOpenCommand({ ...opts, noOpen: opts.open === false });
    });

  reportCmd
    .command("compare <runA> <runB>")
    .description("Compare two stored runs to inspect status, duration, and request regressions")
    .option("-c, --config <path>", "Path to OfflineLab config file")
    .option("--report-dir <dir>", "Report directory")
    .option("--json", "Output comparison as JSON")
    .action(async (runA: string, runB: string, opts) => {
      await runReportCompareCommand(runA, runB, opts);
    });

  program
    .command("clean")
    .description("Safely delete OfflineLab-generated run artifacts")
    .option("--older-than <duration>", "Only delete runs older than duration (e.g. 14d, 24h)")
    .option("-c, --config <path>", "Path to OfflineLab config file")
    .option("--report-dir <dir>", "Report directory")
    .option("--json", "Output cleanup summary as JSON")
    .action(async (opts) => {
      await runCleanCommand(opts);
    });

  return program;
}

async function runInteractiveWelcome(program: Command): Promise<void> {
  const useColor = !("NO_COLOR" in process.env);
  prompts.intro(useColor ? pc.bold(`OfflineLab v${OFFLINELAB_TOOL_VERSION}`) : `OfflineLab v${OFFLINELAB_TOOL_VERSION}`);
  const action = await prompts.select({
    message: "Break the network. Not your app. What would you like to do?",
    options: [
      { value: "run", label: "Run scenarios", hint: "Execute configured offline resilience tests" },
      { value: "init", label: "Initialize project", hint: "Create offlinelab.config.ts and starter scenarios" },
      { value: "doctor", label: "Run diagnostics", hint: "Check Node, Playwright browsers, and config" },
      { value: "preset", label: "List network presets", hint: "View built-in throttling and fault profiles" },
      { value: "help", label: "Show CLI help", hint: "Display all commands and options" },
    ],
  });

  if (prompts.isCancel(action)) {
    prompts.cancel("Bye!");
    return;
  }

  switch (action) {
    case "init":
      await runInitCommand({});
      break;
    case "doctor": {
      const ok = await runDoctorCommand({});
      if (!ok) process.exitCode = ExitCode.INFRASTRUCTURE_ERROR;
      break;
    }
    case "preset":
      await runPresetListCommand({});
      break;
    case "run": {
      const code = await runExecuteCommand({});
      process.exitCode = code;
      break;
    }
    default:
      program.outputHelp();
      break;
  }
}

async function main(): Promise<void> {
  const program = createCliProgram();
  const argv = process.argv.slice(2);

  if (argv.length === 0) {
    if (process.stdout.isTTY && process.stdin.isTTY && !process.env.CI) {
      await runInteractiveWelcome(program);
    } else {
      program.outputHelp();
    }
    return;
  }

  await program.parseAsync(process.argv);
}

main().catch((err: unknown) => {
  const debug = process.argv.includes("--debug");
  const jsonMode = process.argv.includes("--json");
  const exitCode = mapErrorToExitCode(err);

  if (jsonMode) {
    console.error(
      JSON.stringify(
        {
          error: true,
          exitCode,
          message: err instanceof Error ? err.message : String(err),
          ...(debug && err instanceof Error ? { stack: err.stack } : {}),
        },
        null,
        2,
      ),
    );
  } else {
    console.error(formatErrorForUser(err, debug));
  }
  process.exitCode = exitCode;
});
