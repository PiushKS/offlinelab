import { z } from "zod";
import { ScenarioValidationError } from "../../core/errors/index.js";
import type { YamlScenarioDefinition } from "../../types/index.js";
import {
  BrowserNameSchema,
  DeviceConfigSchema,
  ExecutionModeSchema,
  NetworkProfileSchema,
  ProbabilityFractionSchema,
  ServiceWorkerPolicySchema,
} from "./config-schema.js";

export const FaultTypeSchema = z.enum([
  "connection-failed",
  "dns-failed",
  "timeout",
  "delay",
  "http-400",
  "http-401",
  "http-403",
  "http-408",
  "http-429",
  "http-500",
  "http-502",
  "http-503",
  "http-504",
  "http-status",
  "empty-response",
  "malformed-json",
  "truncated-response",
]);

const WaitUntilSchema = z.enum(["load", "domcontentloaded", "networkidle", "commit"]);

const NetworkScheduleStepSchema = z
  .object({
    atMs: z.number().min(0).max(3_600_000),
    profile: z.union([z.string().min(1), NetworkProfileSchema.partial()]),
    label: z.string().optional(),
  })
  .strict();

export const ScenarioStepSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("navigate"),
      path: z.string().optional(),
      url: z.string().optional(),
      waitUntil: WaitUntilSchema.optional(),
      timeoutMs: z.number().int().min(100).max(300_000).optional(),
      expectFailure: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("reload"),
      waitUntil: WaitUntilSchema.optional(),
      timeoutMs: z.number().int().min(100).max(300_000).optional(),
      expectFailure: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("click"),
      selector: z.string().min(1),
      timeoutMs: z.number().int().min(100).max(300_000).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("fill"),
      selector: z.string().min(1),
      value: z.string(),
      timeoutMs: z.number().int().min(100).max(300_000).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("press"),
      selector: z.string().min(1).optional(),
      key: z.string().min(1),
      timeoutMs: z.number().int().min(100).max(300_000).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("select"),
      selector: z.string().min(1),
      value: z.union([z.string(), z.array(z.string())]),
      timeoutMs: z.number().int().min(100).max(300_000).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("waitForSelector"),
      selector: z.string().min(1),
      state: z.enum(["attached", "detached", "visible", "hidden"]).optional(),
      timeoutMs: z.number().int().min(100).max(300_000).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("waitForURL"),
      url: z.string().min(1),
      timeoutMs: z.number().int().min(100).max(300_000).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("waitForResponse"),
      url: z.string().min(1),
      status: z.number().int().min(100).max(599).optional(),
      timeoutMs: z.number().int().min(100).max(300_000).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("waitForRequest"),
      url: z.string().min(1),
      method: z.string().min(1).optional(),
      timeoutMs: z.number().int().min(100).max(300_000).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("wait"),
      durationMs: z.number().int().min(1).max(60_000),
      reason: z.string().optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("setNetwork"),
      profile: z.string().min(1),
      custom: NetworkProfileSchema.partial().optional(),
      requireBandwidthThrottling: z.boolean().optional(),
    })
    .strict(),
  z.object({ action: z.literal("setOffline") }).strict(),
  z.object({ action: z.literal("setOnline") }).strict(),
  z
    .object({
      action: z.literal("injectFailure"),
      id: z.string().min(1).optional(),
      url: z.string().min(1),
      fault: FaultTypeSchema,
      methods: z.array(z.string().min(1)).optional(),
      resourceTypes: z.array(z.string().min(1)).optional(),
      statusCode: z.number().int().min(100).max(599).optional(),
      body: z.string().optional(),
      headers: z.record(z.string()).optional(),
      contentType: z.string().optional(),
      delayMs: z.number().int().min(0).max(120_000).optional(),
      probability: ProbabilityFractionSchema.optional(),
      seed: z.number().int().optional(),
      once: z.boolean().optional(),
      firstN: z.number().int().min(1).optional(),
      everyNth: z.number().int().min(1).optional(),
      durationMs: z.number().int().min(1).optional(),
      phase: z.string().min(1).optional(),
      priority: z.number().int().optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("removeFailure"),
      id: z.string().min(1).optional(),
      all: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("delayRequests"),
      id: z.string().min(1).optional(),
      url: z.string().min(1),
      delayMs: z.number().int().min(1).max(120_000),
      methods: z.array(z.string().min(1)).optional(),
      resourceTypes: z.array(z.string().min(1)).optional(),
      probability: ProbabilityFractionSchema.optional(),
      seed: z.number().int().optional(),
      once: z.boolean().optional(),
      firstN: z.number().int().min(1).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("mockResponse"),
      id: z.string().min(1).optional(),
      url: z.string().min(1),
      status: z.number().int().min(100).max(599).optional(),
      body: z.string().optional(),
      json: z.unknown().optional(),
      headers: z.record(z.string()).optional(),
      contentType: z.string().optional(),
      methods: z.array(z.string().min(1)).optional(),
      delayMs: z.number().int().min(0).max(120_000).optional(),
      once: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("startNetworkSchedule"),
      steps: z.array(NetworkScheduleStepSchema).min(1),
      repeat: z.boolean().optional(),
    })
    .strict(),
  z.object({ action: z.literal("stopNetworkSchedule") }).strict(),
  z
    .object({
      action: z.literal("waitForServiceWorker"),
      controlled: z.boolean().optional(),
      state: z.enum(["installing", "installed", "activating", "activated"]).optional(),
      timeoutMs: z.number().int().min(100).max(120_000).optional(),
    })
    .strict(),
  z.object({ action: z.literal("inspectCache") }).strict(),
  z
    .object({
      action: z.literal("inspectIndexedDB"),
      databases: z.array(z.string()).optional(),
      stores: z.array(z.string()).optional(),
      includeValues: z.boolean().optional(),
      maxRecords: z.number().int().min(1).max(1000).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("inspectLocalStorage"),
      allowedKeys: z.array(z.string()).optional(),
      includeValues: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("captureStorageSnapshot"),
      name: z.string().optional(),
      includeLocalStorage: z.boolean().optional(),
      includeSessionStorage: z.boolean().optional(),
      includeIndexedDB: z.boolean().optional(),
      includeCacheStorage: z.boolean().optional(),
      includeValues: z.boolean().optional(),
      allowedKeys: z.array(z.string()).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("expectVisible"),
      selector: z.string().min(1),
      timeoutMs: z.number().int().min(100).max(300_000).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("expectHidden"),
      selector: z.string().min(1),
      timeoutMs: z.number().int().min(100).max(300_000).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("expectText"),
      selector: z.string().min(1),
      text: z.string(),
      exact: z.boolean().optional(),
      timeoutMs: z.number().int().min(100).max(300_000).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("expectURL"),
      url: z.string().min(1),
      exact: z.boolean().optional(),
      timeoutMs: z.number().int().min(100).max(300_000).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("expectRequestCount"),
      url: z.string().min(1),
      count: z.number().int().min(0).optional(),
      min: z.number().int().min(0).optional(),
      max: z.number().int().min(0).optional(),
      method: z.string().optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("expectResponseStatus"),
      url: z.string().min(1),
      status: z.number().int().min(100).max(599),
      method: z.string().optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("expectNoConsoleErrors"),
      ignorePatterns: z.array(z.string()).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("expectStorageValue"),
      storage: z.enum(["localStorage", "sessionStorage"]),
      key: z.string().min(1),
      value: z.string().optional(),
      exists: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("expectCacheContains"),
      urlPattern: z.string().min(1),
      cacheName: z.string().optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("expectIndexedDBRecord"),
      database: z.string().min(1),
      store: z.string().min(1),
      minCount: z.number().int().min(0).optional(),
      count: z.number().int().min(0).optional(),
      match: z.record(z.unknown()).optional(),
      timeoutMs: z.number().int().min(100).max(120_000).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("screenshot"),
      name: z.string().min(1),
      fullPage: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("snapshot"),
      name: z.string().optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("markTimelineEvent"),
      label: z.string().min(1),
      details: z.record(z.unknown()).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("customAssertion"),
      name: z.string().min(1),
      options: z.record(z.unknown()).optional(),
    })
    .strict(),
]);

export const YamlScenarioSchema = z
  .object({
    name: z.string().min(1).max(128),
    description: z.string().optional(),
    mode: ExecutionModeSchema.optional(),
    browser: BrowserNameSchema.optional(),
    browsers: z.array(BrowserNameSchema).min(1).optional(),
    tags: z.array(z.string().min(1)).optional(),
    timeoutMs: z.number().int().min(1000).max(600_000).optional(),
    retries: z.number().int().min(0).max(10).optional(),
    serviceWorkers: ServiceWorkerPolicySchema.optional(),
    device: z.union([z.string().min(1), DeviceConfigSchema]).optional(),
    baseURL: z.string().url().optional(),
    storageState: z.string().min(1).optional(),
    requires: z
      .object({
        cdpThrottling: z.boolean().optional(),
        serviceWorkers: z.boolean().optional(),
        requestInterception: z.boolean().optional(),
      })
      .strict()
      .optional(),
    steps: z.array(ScenarioStepSchema).min(1),
  })
  .strict();

export function validateYamlScenario(
  raw: unknown,
  sourcePath?: string,
): YamlScenarioDefinition {
  const parsed = YamlScenarioSchema.safeParse(raw);
  if (!parsed.success) {
    const label = sourcePath ? ` in ${sourcePath}` : "";
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new ScenarioValidationError(`Invalid scenario definition${label}:\n${issues}`, {
      sourcePath,
      issues: parsed.error.issues,
    });
  }

  const scenario = parsed.data as YamlScenarioDefinition;
  const effectiveMode = scenario.mode ?? "auto";

  // Validate mode incompatibilities explicitly before execution
  if (effectiveMode === "pwa" && scenario.serviceWorkers === "block") {
    throw new ScenarioValidationError(
      `Scenario "${scenario.name}" uses mode "pwa" with serviceWorkers "block", which is contradictory.`,
      { sourcePath, scenario: scenario.name },
      "Allow Service Workers in PWA mode or switch the scenario mode to 'interception'.",
    );
  }

  if (effectiveMode === "interception") {
    const swSteps = scenario.steps.filter(
      (s) => s.action === "waitForServiceWorker" || s.action === "expectCacheContains",
    );
    if (swSteps.length > 0) {
      throw new ScenarioValidationError(
        `Scenario "${scenario.name}" is in "interception" mode (Service Workers blocked) but includes PWA-only step "${swSteps[0]?.action}".`,
        { sourcePath, scenario: scenario.name },
        "Switch the scenario mode to 'pwa' to test real Service Worker and Cache Storage behavior.",
      );
    }
  }

  // Validate navigate steps have url or path
  for (let i = 0; i < scenario.steps.length; i++) {
    const step = scenario.steps[i]!;
    if (step.action === "navigate" && !step.path && !step.url) {
      throw new ScenarioValidationError(
        `Scenario "${scenario.name}" step ${i + 1} (navigate) must specify either "path" or "url".`,
        { sourcePath, stepIndex: i },
      );
    }
    if (step.action === "injectFailure" && step.fault === "http-status" && step.statusCode === undefined) {
      throw new ScenarioValidationError(
        `Scenario "${scenario.name}" step ${i + 1} (injectFailure) uses fault "http-status" without "statusCode".`,
        { sourcePath, stepIndex: i },
      );
    }
  }

  return {
    ...scenario,
    sourcePath,
  };
}
