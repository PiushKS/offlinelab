import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ConfigLoader,
  ConfigValidationError,
  ConfigValidator,
  ScenarioDiscovery,
  ScenarioValidationError,
  validateYamlScenario,
} from "../../src/index.js";

const tmpDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "offlinelab-unit-cfg-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()!;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

describe("ConfigValidator & ConfigLoader", () => {
  it("applies safe defaults for minimal config", () => {
    const cfg = ConfigValidator.validate({ baseURL: "http://localhost:4173" });
    expect(cfg.browsers).toEqual(["chromium"]);
    expect(cfg.serviceWorkers).toBe("allow");
    expect(cfg.workers).toBe(1);
    expect(cfg.retries).toBe(0);
    expect(cfg.reports.formats).toEqual(["html", "json", "junit"]);
    expect(cfg.redaction.redactQueryParams).toBe(true);
  });

  it("rejects incompatible pwa mode + blocked serviceWorkers", () => {
    expect(() =>
      ConfigValidator.validate({
        mode: "pwa",
        serviceWorkers: "block",
      }),
    ).toThrow(ConfigValidationError);
  });

  it("rejects invalid failureRate percentage (>1) in custom profile", () => {
    expect(() =>
      ConfigValidator.validate({
        networkProfiles: {
          bad: {
            name: "bad",
            failureRate: 25,
          },
        },
      }),
    ).toThrow(ConfigValidationError);
  });

  it("loads YAML and JSON config files safely and strips prototype pollution keys", async () => {
    const dir = await makeTempDir();
    const yamlPath = path.join(dir, "offlinelab.config.yaml");
    await fs.writeFile(
      yamlPath,
      [
        "baseURL: http://localhost:3000",
        "workers: 3",
        "__proto__:",
        "  polluted: true",
      ].join("\n"),
      "utf8",
    );

    const { config, configPath } = await ConfigLoader.load({ cwd: dir });
    expect(configPath).toBe(yamlPath);
    expect(config.workers).toBe(3);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("loads TypeScript config via defineConfig", async () => {
    const dir = await makeTempDir();
    const tsPath = path.join(dir, "offlinelab.config.ts");
    await fs.writeFile(
      tsPath,
      `export default { baseURL: "http://localhost:4173", browsers: ["chromium"], workers: 2 };`,
      "utf8",
    );

    const { config } = await ConfigLoader.load({ cwd: dir });
    expect(config.baseURL).toBe("http://localhost:4173");
    expect(config.workers).toBe(2);
  });

  it("throws helpful ConfigValidationError when explicit config path is missing", async () => {
    const dir = await makeTempDir();
    await expect(
      ConfigLoader.load({ cwd: dir, configPath: "does-not-exist.ts" }),
    ).rejects.toThrow(ConfigValidationError);
  });
});

describe("YAML & TS Scenario Validation (A04)", () => {
  it("validates a complete PWA YAML scenario", () => {
    const scenario = validateYamlScenario({
      name: "offline-navigation",
      description: "Verify cached PWA navigation",
      mode: "pwa",
      browser: "chromium",
      steps: [
        { action: "navigate", path: "/" },
        { action: "waitForServiceWorker", controlled: true, timeoutMs: 15000 },
        { action: "setNetwork", profile: "offline" },
        { action: "reload" },
        { action: "expectVisible", selector: "[data-testid='app-shell']" },
      ],
    });
    expect(scenario.name).toBe("offline-navigation");
    expect(scenario.steps).toHaveLength(5);
  });

  it("rejects invalid YAML syntax with ScenarioValidationError", async () => {
    const dir = await makeTempDir();
    const badYaml = path.join(dir, "broken.yaml");
    await fs.writeFile(badYaml, "name: broken\nsteps:\n  - action: [unclosed", "utf8");

    await expect(ScenarioDiscovery.loadScenarioFile(badYaml)).rejects.toThrow(
      ScenarioValidationError,
    );
  });

  it("rejects interception mode scenarios containing PWA-only steps", () => {
    expect(() =>
      validateYamlScenario({
        name: "bad-mode",
        mode: "interception",
        steps: [
          { action: "navigate", path: "/" },
          { action: "waitForServiceWorker", controlled: true },
        ],
      }),
    ).toThrow(ScenarioValidationError);
  });

  it("rejects probability > 1 (percentage instead of 0-1 fraction)", () => {
    expect(() =>
      validateYamlScenario({
        name: "bad-prob",
        steps: [
          {
            action: "injectFailure",
            url: "**/api/**",
            fault: "connection-failed",
            probability: 50,
          },
        ],
      }),
    ).toThrow(ScenarioValidationError);
  });

  it("rejects http-status fault without statusCode", () => {
    expect(() =>
      validateYamlScenario({
        name: "missing-status",
        steps: [
          {
            action: "injectFailure",
            url: "**/api/**",
            fault: "http-status",
          },
        ],
      }),
    ).toThrow(ScenarioValidationError);
  });

  it("validates multiple files and reports invalid ones cleanly", async () => {
    const dir = await makeTempDir();
    const good = path.join(dir, "good.yaml");
    const bad = path.join(dir, "bad.yaml");
    await fs.writeFile(good, "name: good\nsteps:\n  - action: setOffline\n", "utf8");
    await fs.writeFile(bad, "name: bad\nsteps:\n  - action: unknownAction\n", "utf8");

    const reports = await ScenarioDiscovery.validateFiles([good, bad]);
    expect(reports).toHaveLength(2);
    expect(reports[0]?.valid).toBe(true);
    expect(reports[1]?.valid).toBe(false);
    expect(reports[1]?.error).toContain("Invalid scenario definition");
  });
});
