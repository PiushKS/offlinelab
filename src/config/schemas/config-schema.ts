import { z } from "zod";
import { ConfigValidationError } from "../../core/errors/index.js";
import type { OfflineLabConfig, OfflineLabConfigInput } from "../../types/index.js";
import { DEFAULT_CONFIG } from "../defaults/defaults.js";

export const BrowserNameSchema = z.enum(["chromium", "firefox", "webkit"]);

export const ExecutionModeSchema = z.enum(["pwa", "interception", "auto"]);

export const ServiceWorkerPolicySchema = z.enum(["allow", "block"]);

export const UnsupportedPolicySchema = z.enum(["skip", "fail", "warn"]);

export const ReportFormatSchema = z.enum(["html", "json", "junit", "terminal"]);

export const ProbabilityFractionSchema = z
  .number()
  .refine((val) => !Number.isNaN(val) && val >= 0 && val <= 1, {
    message:
      "Probability / failureRate must be a fraction between 0 and 1 (e.g., 0.15 for 15%, not 15).",
  });

export const NetworkProfileSchema = z
  .object({
    name: z.string().min(1).max(64),
    description: z.string().optional(),
    offline: z.boolean().default(false),
    latencyMs: z.number().min(0).max(120_000).default(0),
    downloadKbps: z.number().min(0).max(10_000_000).optional(),
    uploadKbps: z.number().min(0).max(10_000_000).optional(),
    connectionType: z
      .enum(["none", "cellular2g", "cellular3g", "cellular4g", "wifi", "ethernet", "other"])
      .optional(),
    failureRate: ProbabilityFractionSchema.optional(),
    seed: z.number().int().optional(),
    toggleIntervalMs: z.number().min(100).max(60_000).optional(),
    urlPattern: z.string().min(1).optional(),
  })
  .strict();

export const DeviceConfigSchema = z
  .object({
    name: z.string().min(1).optional(),
    viewport: z
      .object({
        width: z.number().int().min(100).max(7680),
        height: z.number().int().min(100).max(4320),
      })
      .optional(),
    deviceScaleFactor: z.number().min(0.5).max(5).optional(),
    isMobile: z.boolean().optional(),
    hasTouch: z.boolean().optional(),
    userAgent: z.string().min(1).optional(),
    orientation: z.enum(["portrait", "landscape"]).optional(),
  })
  .strict();

export const WebServerSchema = z
  .object({
    command: z.string().min(1),
    url: z.string().url(),
    cwd: z.string().min(1).optional(),
    timeoutMs: z.number().int().min(1000).max(600_000).optional(),
    reuseExistingServer: z.boolean().optional(),
    env: z.record(z.string()).optional(),
    gracefulShutdownMs: z.number().int().min(100).max(30_000).optional(),
  })
  .strict();

export const TimeoutsSchema = z
  .object({
    browserLaunchMs: z.number().int().min(1000).max(300_000).optional(),
    navigationMs: z.number().int().min(500).max(300_000).optional(),
    stepMs: z.number().int().min(500).max(300_000).optional(),
    assertionMs: z.number().int().min(500).max(300_000).optional(),
    scenarioMs: z.number().int().min(1000).max(600_000).optional(),
    runMs: z.number().int().min(1000).max(3_600_000).optional(),
  })
  .strict();

export const ReportsSchema = z
  .object({
    directory: z.string().min(1).optional(),
    formats: z.array(ReportFormatSchema).min(1).optional(),
    retentionDays: z.number().int().min(1).max(3650).optional(),
    maxRuns: z.number().int().min(1).max(10_000).optional(),
  })
  .strict();

export const ArtifactsSchema = z
  .object({
    screenshots: z.enum(["on-failure", "always", "never"]).optional(),
    traces: z.enum(["on-failure", "always", "never"]).optional(),
    baselineScreenshot: z.boolean().optional(),
    captureBeforeAfter: z.boolean().optional(),
    maxNetworkEvents: z.number().int().min(10).max(50_000).optional(),
    includeBodies: z.boolean().optional(),
  })
  .strict();

export const RedactionSchema = z
  .object({
    redactQueryParams: z.boolean().optional(),
    allowedQueryParams: z.array(z.string()).optional(),
    redactHeaders: z.array(z.string()).optional(),
    secretPatterns: z.array(z.string()).optional(),
    customReplacer: z.function().args(z.string()).returns(z.string()).optional(),
  })
  .strict();

export const AuthSchema = z
  .object({
    storageState: z.string().min(1).optional(),
    persistentProfileDir: z.string().min(1).optional(),
    setup: z.function().optional(),
    teardown: z.function().optional(),
  })
  .strict();

export const OfflineLabConfigSchema = z
  .object({
    baseURL: z.string().url().optional(),
    browsers: z.array(BrowserNameSchema).min(1).optional(),
    scenarios: z.array(z.string().min(1)).optional(),
    serviceWorkers: ServiceWorkerPolicySchema.optional(),
    mode: ExecutionModeSchema.optional(),
    workers: z.number().int().min(1).max(32).optional(),
    retries: z.number().int().min(0).max(10).optional(),
    timeoutMs: z.number().int().min(1000).max(600_000).optional(),
    timeouts: TimeoutsSchema.optional(),
    headless: z.boolean().optional(),
    device: z.union([z.string().min(1), DeviceConfigSchema]).optional(),
    networkProfiles: z.record(NetworkProfileSchema.partial()).optional(),
    unsupportedPolicy: UnsupportedPolicySchema.optional(),
    reports: ReportsSchema.optional(),
    artifacts: ArtifactsSchema.optional(),
    redaction: RedactionSchema.optional(),
    webServer: WebServerSchema.optional(),
    auth: AuthSchema.optional(),
    plugins: z.array(z.any()).optional(),
    cwd: z.string().min(1).optional(),
  })
  .strict();

export class ConfigValidator {
  static validate(input: OfflineLabConfigInput): OfflineLabConfig {
    const parsed = OfflineLabConfigSchema.safeParse(input);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("\n");
      throw new ConfigValidationError(`Invalid OfflineLab configuration:\n${issues}`, {
        issues: parsed.error.issues,
      });
    }

    const data = parsed.data;
    const mode = data.mode ?? DEFAULT_CONFIG.mode;
    const serviceWorkers = data.serviceWorkers ?? DEFAULT_CONFIG.serviceWorkers;

    if (mode === "pwa" && serviceWorkers === "block") {
      throw new ConfigValidationError(
        "Incompatible configuration: mode 'pwa' cannot be combined with serviceWorkers 'block'.",
        { mode, serviceWorkers },
        "Set `serviceWorkers: 'allow'` for PWA mode, or use `mode: 'interception'` when blocking Service Workers.",
      );
    }

    const timeoutMs = data.timeoutMs ?? DEFAULT_CONFIG.timeoutMs;

    return {
      baseURL: data.baseURL,
      browsers: data.browsers ?? [...DEFAULT_CONFIG.browsers],
      scenarios: data.scenarios ?? [...DEFAULT_CONFIG.scenarios],
      serviceWorkers,
      mode,
      workers: data.workers ?? DEFAULT_CONFIG.workers,
      retries: data.retries ?? DEFAULT_CONFIG.retries,
      timeoutMs,
      timeouts: {
        ...DEFAULT_CONFIG.timeouts,
        scenarioMs: data.timeouts?.scenarioMs ?? Math.max(timeoutMs * 2, 60_000),
        ...data.timeouts,
      },
      headless: data.headless ?? DEFAULT_CONFIG.headless,
      device: data.device,
      networkProfiles: data.networkProfiles,
      unsupportedPolicy: data.unsupportedPolicy ?? DEFAULT_CONFIG.unsupportedPolicy,
      reports: {
        directory: data.reports?.directory ?? DEFAULT_CONFIG.reports.directory,
        formats: data.reports?.formats ?? [...DEFAULT_CONFIG.reports.formats],
        retentionDays: data.reports?.retentionDays ?? DEFAULT_CONFIG.reports.retentionDays,
        maxRuns: data.reports?.maxRuns ?? DEFAULT_CONFIG.reports.maxRuns,
      },
      artifacts: {
        screenshots: data.artifacts?.screenshots ?? DEFAULT_CONFIG.artifacts.screenshots,
        traces: data.artifacts?.traces ?? DEFAULT_CONFIG.artifacts.traces,
        baselineScreenshot:
          data.artifacts?.baselineScreenshot ?? DEFAULT_CONFIG.artifacts.baselineScreenshot,
        captureBeforeAfter:
          data.artifacts?.captureBeforeAfter ?? DEFAULT_CONFIG.artifacts.captureBeforeAfter,
        maxNetworkEvents:
          data.artifacts?.maxNetworkEvents ?? DEFAULT_CONFIG.artifacts.maxNetworkEvents,
        includeBodies: data.artifacts?.includeBodies ?? DEFAULT_CONFIG.artifacts.includeBodies,
      },
      redaction: {
        redactQueryParams:
          data.redaction?.redactQueryParams ?? DEFAULT_CONFIG.redaction.redactQueryParams,
        allowedQueryParams:
          data.redaction?.allowedQueryParams ?? DEFAULT_CONFIG.redaction.allowedQueryParams,
        redactHeaders: data.redaction?.redactHeaders ?? DEFAULT_CONFIG.redaction.redactHeaders,
        secretPatterns: data.redaction?.secretPatterns ?? DEFAULT_CONFIG.redaction.secretPatterns,
        customReplacer: data.redaction?.customReplacer,
      },
      webServer: data.webServer,
      auth: data.auth as OfflineLabConfig["auth"],
      plugins: data.plugins,
      cwd: data.cwd,
    };
  }
}
