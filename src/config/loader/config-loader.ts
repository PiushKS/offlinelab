import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { ConfigValidationError } from "../../core/errors/index.js";
import { sanitizeParsedObject } from "../../security/redactor.js";
import type { OfflineLabConfig, OfflineLabConfigInput } from "../../types/index.js";
import { CONFIG_FILE_CANDIDATES } from "../defaults/defaults.js";
import { ConfigValidator } from "../schemas/config-schema.js";
import { createOfflineLabJiti } from "./jiti-helper.js";

export interface LoadedConfigResult {
  config: OfflineLabConfig;
  configPath?: string;
}

export class ConfigLoader {
  static async findConfigFile(cwd: string): Promise<string | undefined> {
    for (const candidate of CONFIG_FILE_CANDIDATES) {
      const fullPath = path.resolve(cwd, candidate);
      try {
        const stat = await fs.stat(fullPath);
        if (stat.isFile()) {
          return fullPath;
        }
      } catch {
        // continue searching
      }
    }
    return undefined;
  }

  static async load(options?: {
    cwd?: string;
    configPath?: string;
    overrides?: Partial<OfflineLabConfigInput>;
  }): Promise<LoadedConfigResult> {
    const cwd = path.resolve(options?.cwd ?? process.cwd());
    let resolvedConfigPath: string | undefined;

    if (options?.configPath) {
      resolvedConfigPath = path.resolve(cwd, options.configPath);
      try {
        const stat = await fs.stat(resolvedConfigPath);
        if (!stat.isFile()) {
          throw new ConfigValidationError(`Config path is not a file: ${resolvedConfigPath}`);
        }
      } catch (err) {
        if (err instanceof ConfigValidationError) throw err;
        throw new ConfigValidationError(
          `Configuration file not found: ${resolvedConfigPath}`,
          { configPath: resolvedConfigPath },
          "Pass a valid path with --config or run `offlinelab init` to create offlinelab.config.ts.",
        );
      }
    } else {
      resolvedConfigPath = await ConfigLoader.findConfigFile(cwd);
    }

    let fileConfig: OfflineLabConfigInput = {};

    if (resolvedConfigPath) {
      fileConfig = await ConfigLoader.loadConfigFile(resolvedConfigPath);
    }

    const merged = ConfigLoader.mergeConfigs(fileConfig, options?.overrides ?? {}, cwd);
    const validated = ConfigValidator.validate(merged);

    return {
      config: validated,
      configPath: resolvedConfigPath,
    };
  }

  private static async loadConfigFile(filePath: string): Promise<OfflineLabConfigInput> {
    const ext = path.extname(filePath).toLowerCase();

    if (ext === ".yaml" || ext === ".yml") {
      const raw = await fs.readFile(filePath, "utf8");
      try {
        const parsed = parseYaml(raw, { strict: true, uniqueKeys: true });
        if (parsed === null || parsed === undefined) {
          return {};
        }
        if (typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new ConfigValidationError(
            `YAML configuration file must contain a mapping object: ${filePath}`,
          );
        }
        return sanitizeParsedObject(parsed) as OfflineLabConfigInput;
      } catch (err) {
        if (err instanceof ConfigValidationError) throw err;
        throw new ConfigValidationError(
          `Failed to parse YAML config ${filePath}: ${(err as Error).message}`,
          { filePath },
        );
      }
    }

    if (ext === ".json") {
      const raw = await fs.readFile(filePath, "utf8");
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          throw new ConfigValidationError(
            `JSON configuration file must contain a top-level object: ${filePath}`,
          );
        }
        return sanitizeParsedObject(parsed) as OfflineLabConfigInput;
      } catch (err) {
        if (err instanceof ConfigValidationError) throw err;
        throw new ConfigValidationError(
          `Failed to parse JSON config ${filePath}: ${(err as Error).message}`,
          { filePath },
        );
      }
    }

    if (ext === ".ts" || ext === ".mts" || ext === ".js" || ext === ".mjs") {
      try {
        const jiti = createOfflineLabJiti();
        const mod = await jiti.import(filePath);
        const exported =
          mod && typeof mod === "object" && "default" in mod
            ? (mod as { default: unknown }).default
            : mod;
        const resolved = typeof exported === "function" ? await exported() : exported;
        if (typeof resolved !== "object" || resolved === null || Array.isArray(resolved)) {
          throw new ConfigValidationError(
            `Configuration module ${filePath} must default-export a configuration object.`,
          );
        }
        return resolved as OfflineLabConfigInput;
      } catch (err) {
        if (err instanceof ConfigValidationError) throw err;
        throw new ConfigValidationError(
          `Failed to load configuration module ${filePath}: ${(err as Error).message}`,
          { filePath },
        );
      }
    }

    throw new ConfigValidationError(
      `Unsupported configuration file extension "${ext}" for ${filePath}.`,
      { filePath, ext },
    );
  }

  private static mergeConfigs(
    base: OfflineLabConfigInput,
    override: Partial<OfflineLabConfigInput>,
    cwd: string,
  ): OfflineLabConfigInput {
    return {
      ...base,
      ...override,
      cwd: override.cwd ?? base.cwd ?? cwd,
      reports:
        base.reports || override.reports
          ? {
              ...base.reports,
              ...override.reports,
            }
          : undefined,
      artifacts:
        base.artifacts || override.artifacts
          ? {
              ...base.artifacts,
              ...override.artifacts,
            }
          : undefined,
      timeouts:
        base.timeouts || override.timeouts
          ? {
              ...base.timeouts,
              ...override.timeouts,
            }
          : undefined,
      redaction:
        base.redaction || override.redaction
          ? {
              ...base.redaction,
              ...override.redaction,
            }
          : undefined,
      networkProfiles:
        base.networkProfiles || override.networkProfiles
          ? {
              ...base.networkProfiles,
              ...override.networkProfiles,
            }
          : undefined,
    };
  }
}
