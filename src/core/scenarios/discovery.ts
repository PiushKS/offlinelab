import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import { parse as parseYaml } from "yaml";
import { createOfflineLabJiti } from "../../config/loader/jiti-helper.js";
import { validateYamlScenario } from "../../config/schemas/scenario-schema.js";
import { sanitizeParsedObject } from "../../security/redactor.js";
import type {
  ProgrammaticScenarioDefinition,
  ScenarioDefinition,
  YamlScenarioDefinition,
} from "../../types/index.js";
import { ScenarioValidationError } from "../errors/index.js";

export function isProgrammaticScenario(
  scenario: ScenarioDefinition,
): scenario is ProgrammaticScenarioDefinition {
  return "run" in scenario && typeof scenario.run === "function";
}

export function isYamlScenario(
  scenario: ScenarioDefinition,
): scenario is YamlScenarioDefinition {
  return "steps" in scenario && Array.isArray(scenario.steps);
}

export interface ScenarioValidationReport {
  filePath: string;
  valid: boolean;
  scenarioName?: string;
  error?: string;
}

export class ScenarioDiscovery {
  static async discoverFiles(patterns: string[], cwd: string): Promise<string[]> {
    const resolvedCwd = path.resolve(cwd);
    const matches = await fg(patterns, {
      cwd: resolvedCwd,
      absolute: true,
      onlyFiles: true,
      ignore: ["**/node_modules/**", "**/dist/**", "**/offlinelab-results/**"],
    });
    return matches.sort();
  }

  static async loadScenarioFile(filePath: string): Promise<ScenarioDefinition> {
    const resolved = path.resolve(filePath);
    const ext = path.extname(resolved).toLowerCase();

    if (ext === ".yaml" || ext === ".yml") {
      const raw = await fs.readFile(resolved, "utf8");
      let parsed: unknown;
      try {
        // Strict YAML parsing: no JS evaluation, no duplicate keys, prototype-pollution stripped
        parsed = parseYaml(raw, { strict: true, uniqueKeys: true });
      } catch (err) {
        throw new ScenarioValidationError(
          `Failed to parse YAML scenario ${resolved}: ${(err as Error).message}`,
          { filePath: resolved },
          "Fix the YAML syntax error and re-run `offlinelab scenario validate`.",
        );
      }

      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new ScenarioValidationError(
          `YAML scenario file ${resolved} must define a top-level mapping object.`,
          { filePath: resolved },
        );
      }

      const safe = sanitizeParsedObject(parsed);
      return validateYamlScenario(safe, resolved);
    }

    if (ext === ".ts" || ext === ".mts" || ext === ".js" || ext === ".mjs") {
      try {
        const jiti = createOfflineLabJiti();
        const mod = await jiti.import(resolved);
        const exported =
          mod && typeof mod === "object" && "default" in mod
            ? (mod as { default: unknown }).default
            : mod;

        if (!exported || typeof exported !== "object") {
          throw new ScenarioValidationError(
            `Scenario module ${resolved} must default-export a scenario definition created with defineScenario().`,
            { filePath: resolved },
          );
        }

        const candidate = exported as Record<string, unknown>;
        if (typeof candidate.name !== "string" || candidate.name.trim().length === 0) {
          throw new ScenarioValidationError(
            `Scenario module ${resolved} is missing a valid string "name" property.`,
            { filePath: resolved },
          );
        }

        if (typeof candidate.run === "function") {
          return {
            ...(candidate as unknown as ProgrammaticScenarioDefinition),
            sourcePath: resolved,
          };
        }

        if (Array.isArray(candidate.steps)) {
          return validateYamlScenario(candidate, resolved);
        }

        throw new ScenarioValidationError(
          `Scenario module ${resolved} must provide either a \`run(ctx)\` function or a \`steps\` array.`,
          { filePath: resolved },
        );
      } catch (err) {
        if (err instanceof ScenarioValidationError) throw err;
        throw new ScenarioValidationError(
          `Failed to load TypeScript/JS scenario ${resolved}: ${(err as Error).message}`,
          { filePath: resolved },
        );
      }
    }

    throw new ScenarioValidationError(
      `Unsupported scenario file extension "${ext}" for ${resolved}.`,
      { filePath: resolved, ext },
    );
  }

  static async discover(options: {
    patterns: string[];
    cwd: string;
    filterNames?: string[];
    filterPattern?: string;
  }): Promise<ScenarioDefinition[]> {
    const files = await ScenarioDiscovery.discoverFiles(options.patterns, options.cwd);
    const scenarios: ScenarioDefinition[] = [];

    for (const file of files) {
      const scenario = await ScenarioDiscovery.loadScenarioFile(file);
      scenarios.push(scenario);
    }

    return ScenarioDiscovery.filterScenarios(scenarios, options.filterNames, options.filterPattern);
  }

  static filterScenarios(
    scenarios: ScenarioDefinition[],
    filterNames?: string[],
    filterPattern?: string,
  ): ScenarioDefinition[] {
    let result = scenarios;

    if (filterNames && filterNames.length > 0) {
      const nameSet = new Set(filterNames.map((n) => n.toLowerCase()));
      result = result.filter(
        (s) =>
          nameSet.has(s.name.toLowerCase()) ||
          (s.sourcePath ? nameSet.has(path.basename(s.sourcePath).toLowerCase()) : false),
      );
    }

    if (filterPattern) {
      const re = new RegExp(filterPattern, "i");
      result = result.filter(
        (s) =>
          re.test(s.name) ||
          (s.description ? re.test(s.description) : false) ||
          (s.tags ? s.tags.some((t) => re.test(t)) : false),
      );
    }

    return result;
  }

  static async validateFiles(files: string[]): Promise<ScenarioValidationReport[]> {
    const reports: ScenarioValidationReport[] = [];
    for (const file of files) {
      try {
        const scenario = await ScenarioDiscovery.loadScenarioFile(file);
        reports.push({
          filePath: file,
          valid: true,
          scenarioName: scenario.name,
        });
      } catch (err) {
        reports.push({
          filePath: file,
          valid: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return reports;
  }
}
