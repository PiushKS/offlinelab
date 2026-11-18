import type { OfflineLabConfig } from "../../types/index.js";

export const OFFLINELAB_SCHEMA_VERSION = "1.0.0";
export const OFFLINELAB_TOOL_VERSION = "0.1.0";

export const DEFAULT_CONFIG: OfflineLabConfig = {
  browsers: ["chromium"],
  scenarios: ["scenarios/**/*.{yaml,yml,ts,mjs,js}"],
  serviceWorkers: "allow",
  mode: "auto",
  workers: 1,
  retries: 0,
  timeoutMs: 30_000,
  timeouts: {
    browserLaunchMs: 30_000,
    navigationMs: 20_000,
    stepMs: 15_000,
    assertionMs: 10_000,
    scenarioMs: 60_000,
  },
  headless: true,
  unsupportedPolicy: "skip",
  reports: {
    directory: "./offlinelab-results",
    formats: ["html", "json", "junit"],
    retentionDays: 30,
    maxRuns: 50,
  },
  artifacts: {
    screenshots: "on-failure",
    traces: "on-failure",
    baselineScreenshot: true,
    captureBeforeAfter: false,
    maxNetworkEvents: 1000,
    includeBodies: false,
  },
  redaction: {
    redactQueryParams: true,
    allowedQueryParams: [],
    redactHeaders: [],
    secretPatterns: [],
  },
};

export const CONFIG_FILE_CANDIDATES = [
  "offlinelab.config.ts",
  "offlinelab.config.mts",
  "offlinelab.config.js",
  "offlinelab.config.mjs",
  "offlinelab.config.yaml",
  "offlinelab.config.yml",
  "offlinelab.config.json",
];
