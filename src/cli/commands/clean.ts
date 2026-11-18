import path from "node:path";
import { ArtifactManager, parseDurationString } from "../../artifacts/artifact-manager.js";
import { ConfigLoader } from "../../config/loader/config-loader.js";
import { ConfigValidationError } from "../../core/errors/index.js";

export async function runCleanCommand(options: {
  olderThan?: string;
  reportDir?: string;
  config?: string;
  json?: boolean;
  cwd?: string;
}): Promise<void> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  let reportDir = options.reportDir;

  if (!reportDir) {
    try {
      const { config } = await ConfigLoader.load({ cwd, configPath: options.config });
      reportDir = config.reports.directory;
    } catch {
      reportDir = "./offlinelab-results";
    }
  }

  let olderThanMs: number | undefined;
  if (options.olderThan) {
    olderThanMs = parseDurationString(options.olderThan);
    if (olderThanMs === undefined) {
      throw new ConfigValidationError(
        `Invalid --older-than duration "${options.olderThan}". Use values like 7d, 14d, 24h, or 30m.`,
      );
    }
  }

  const manager = new ArtifactManager(reportDir, cwd);
  const result = await manager.clean({ olderThanMs });

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.skipped) {
    console.log(result.reason ?? "Nothing to clean.");
    return;
  }

  console.log(
    `Removed ${result.deletedRuns.length} run artifact director${result.deletedRuns.length === 1 ? "y" : "ies"} from ${manager.baseReportDir}.`,
  );
}
