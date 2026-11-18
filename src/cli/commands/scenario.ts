import path from "node:path";
import pc from "picocolors";
import { ConfigLoader } from "../../config/loader/config-loader.js";
import { ScenarioDiscovery } from "../../core/scenarios/discovery.js";
import { BUILT_IN_SCENARIO_TEMPLATES } from "../../core/scenarios/templates.js";

export async function runScenarioListCommand(options: {
  config?: string;
  json?: boolean;
  cwd?: string;
}): Promise<void> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const { config } = await ConfigLoader.load({ cwd, configPath: options.config });
  const files = await ScenarioDiscovery.discoverFiles(config.scenarios, cwd);
  const items: Array<{ name: string; source: string; mode: string; description: string }> = [];

  for (const file of files) {
    const scenario = await ScenarioDiscovery.loadScenarioFile(file);
    items.push({
      name: scenario.name,
      source: path.relative(cwd, file),
      mode: scenario.mode ?? config.mode,
      description: scenario.description ?? "",
    });
  }

  if (options.json) {
    console.log(JSON.stringify(items, null, 2));
    return;
  }

  if (items.length === 0) {
    console.log(`No scenarios found matching: ${config.scenarios.join(", ")}`);
    console.log("Run `offlinelab init` to create starter scenarios, or `offlinelab scenario templates` to view built-in templates.");
    return;
  }

  const useColor = Boolean(process.stdout.isTTY) && !("NO_COLOR" in process.env);
  const bold = (s: string) => (useColor ? pc.bold(s) : s);
  const dim = (s: string) => (useColor ? pc.dim(s) : s);

  console.log(bold(`Discovered ${items.length} scenario(s):`));
  console.log("");
  for (const item of items) {
    console.log(`  ${bold(item.name)} ${dim(`[${item.mode}]`)} (${dim(item.source)})`);
    if (item.description) {
      console.log(`    ${item.description}`);
    }
  }
}

export async function runScenarioValidateCommand(
  files: string[],
  options: { config?: string; json?: boolean; cwd?: string },
): Promise<boolean> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  let targetFiles: string[];

  if (files.length > 0) {
    targetFiles = files.map((f) => path.resolve(cwd, f));
  } else {
    const { config } = await ConfigLoader.load({ cwd, configPath: options.config });
    targetFiles = await ScenarioDiscovery.discoverFiles(config.scenarios, cwd);
  }

  const results = await ScenarioDiscovery.validateFiles(targetFiles);
  const allValid = results.every((r) => r.valid);

  if (options.json) {
    console.log(JSON.stringify({ valid: allValid, results }, null, 2));
    return allValid;
  }

  if (results.length === 0) {
    console.log("No scenario files found to validate.");
    return true;
  }

  const useColor = Boolean(process.stdout.isTTY) && !("NO_COLOR" in process.env);
  const paint = (fn: (s: string) => string, s: string) => (useColor ? fn(s) : s);

  for (const res of results) {
    const rel = path.relative(cwd, res.filePath);
    if (res.valid) {
      console.log(`${paint(pc.green, "VALID")}    ${rel} (${res.scenarioName})`);
    } else {
      console.log(`${paint(pc.red, "INVALID")}  ${rel}`);
      console.log(`         ${res.error}`);
    }
  }

  return allValid;
}

export function runScenarioTemplatesCommand(options: { json?: boolean }): void {
  if (options.json) {
    console.log(
      JSON.stringify(
        BUILT_IN_SCENARIO_TEMPLATES.map((t) => ({
          id: t.id,
          category: t.category,
          description: t.description,
          requirements: t.requirements,
          requiredAppContracts: t.requiredAppContracts,
        })),
        null,
        2,
      ),
    );
    return;
  }

  console.log(`Built-in Scenario Templates (${BUILT_IN_SCENARIO_TEMPLATES.length}):`);
  console.log("");
  for (const tpl of BUILT_IN_SCENARIO_TEMPLATES) {
    console.log(`  ${tpl.id.padEnd(36)} [${tpl.category}] ${tpl.description}`);
  }
}
