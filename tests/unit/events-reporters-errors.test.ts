import { describe, expect, it } from "vitest";
import {
  AssertionFailedError,
  BUILT_IN_SCENARIO_TEMPLATES,
  BrowserLaunchError,
  ConfigValidationError,
  EventRecorder,
  ExitCode,
  HtmlReporter,
  JUnitReporter,
  JsonReporter,
  PluginManager,
  TimeoutError,
  formatErrorForUser,
  getBrowserCapabilities,
  mapErrorToExitCode,
  renderScenarioTemplateYaml,
  validateYamlScenario,
} from "../../src/index.js";
import type { RunReport } from "../../src/index.js";
import { parse as parseYaml } from "yaml";

function makeSampleReport(overrides?: Partial<RunReport>): RunReport {
  return {
    schemaVersion: "1.0.0",
    runId: "run-sample-1",
    toolVersion: "0.1.0",
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:05.000Z",
    durationMs: 5000,
    environment: {
      nodeVersion: "v24.0.0",
      platform: "darwin",
      arch: "arm64",
      playwrightVersion: "1.51.1",
      baseURL: "http://localhost:4173",
      browsers: ["chromium"],
      ci: false,
    },
    summary: {
      total: 3,
      passed: 1,
      failed: 1,
      skipped: 0,
      unsupported: 1,
      totalAssertions: 2,
      passedAssertions: 1,
      failedAssertions: 1,
      totalRequests: 2,
      failedRequests: 1,
      injectedFaults: 1,
    },
    scenarios: [
      {
        id: "sc-1",
        name: "offline-navigation",
        browser: "chromium",
        mode: "pwa",
        status: "passed",
        startedAt: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T00:00:02.000Z",
        durationMs: 2000,
        attempts: 1,
        profilesUsed: ["online", "offline"],
        steps: [],
        assertions: [{ id: "a1", name: "expectVisible(#app)", status: "passed", elapsedMs: 500 }],
        events: [],
        requests: [
          {
            id: "r1",
            timestamp: "2026-01-01T00:00:01.000Z",
            elapsedMs: 100,
            method: "GET",
            url: "http://localhost:4173/",
            resourceType: "document",
            status: 200,
            durationMs: 25,
            failed: false,
          },
        ],
        consoleErrors: [],
        artifacts: [],
        diagnostics: [],
        capabilities: getBrowserCapabilities("chromium"),
      },
      {
        id: "sc-2",
        name: "api-500-check",
        browser: "chromium",
        mode: "interception",
        status: "failed",
        reason: "Expected banner visible",
        startedAt: "2026-01-01T00:00:02.000Z",
        completedAt: "2026-01-01T00:00:04.000Z",
        durationMs: 2000,
        attempts: 1,
        profilesUsed: ["online"],
        steps: [],
        assertions: [
          {
            id: "a2",
            name: "expectVisible(.error)",
            status: "failed",
            elapsedMs: 1900,
            message: "Element not found",
          },
        ],
        events: [],
        requests: [
          {
            id: "r2",
            timestamp: "2026-01-01T00:00:03.000Z",
            elapsedMs: 200,
            method: "POST",
            url: "http://localhost:4173/api/notes",
            resourceType: "fetch",
            status: 500,
            durationMs: 15,
            failed: true,
            injectedRuleId: "rule-1",
            injectedFault: "http-500",
          },
        ],
        consoleErrors: [{ timestamp: "2026-01-01T00:00:03.500Z", elapsedMs: 300, type: "error", text: "HTTP 500" }],
        artifacts: [],
        diagnostics: [],
        capabilities: getBrowserCapabilities("chromium"),
        error: { name: "AssertionFailedError", message: "Expected banner visible", code: "ASSERTION_FAILED" },
      },
      {
        id: "sc-3",
        name: "cdp-throttle-only",
        browser: "firefox",
        mode: "auto",
        status: "unsupported",
        reason: "Firefox does not support CDP bandwidth throttling",
        startedAt: "2026-01-01T00:00:04.000Z",
        completedAt: "2026-01-01T00:00:05.000Z",
        durationMs: 50,
        attempts: 1,
        profilesUsed: [],
        steps: [],
        assertions: [],
        events: [],
        requests: [],
        consoleErrors: [],
        artifacts: [],
        diagnostics: [],
        capabilities: getBrowserCapabilities("firefox"),
      },
    ],
    artifacts: [],
    ...overrides,
  };
}

describe("EventRecorder, Reporters, Errors, Plugins, and Scenario Templates", () => {
  it("records bounded events in monotonic order and redacts sensitive fields", () => {
    const recorder = new EventRecorder({
      runId: "r1",
      scenarioId: "s1",
      maxEvents: 3,
      maxRequests: 2,
    });
    recorder.record("step.1", { token: "secret-abc" });
    recorder.record("step.2", { url: "https://example.com?api_key=12345" });
    recorder.record("step.3", {});
    recorder.record("step.4", {});

    const events = recorder.getEvents();
    expect(events).toHaveLength(3);
    expect(recorder.getDroppedCounts().events).toBe(1);
    expect(events[0]?.details.token).toBe("[REDACTED]");
    expect(String(events[1]?.details.url)).not.toContain("12345");
    expect(events[1]!.elapsedMs).toBeGreaterThanOrEqual(events[0]!.elapsedMs);
  });

  it("serializes JUnit XML with proper failure and unsupported/skipped mapping (A21)", () => {
    const report = makeSampleReport();
    const xml = new JUnitReporter().serialize(report);
    expect(xml).toContain('tests="3" failures="1" skipped="1"');
    expect(xml).toContain('<testcase classname="offlinelab.chromium.pwa" name="offline-navigation"');
    expect(xml).toContain('<failure message="Expected banner visible"');
    expect(xml).toContain('<skipped type="unsupported"');
    expect(xml).toContain("<system-err>[error] HTTP 500</system-err>");
  });

  it("renders standalone XSS-safe HTML report (A22)", () => {
    const report = makeSampleReport();
    report.scenarios[0]!.description = '</script><script>alert("xss")</script>';
    const html = new HtmlReporter().render(report);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("OfflineLab Report");
    expect(html).not.toContain('</script><script>alert("xss")');
    expect(html).toContain("panel-timeline");
    expect(html).toContain("panel-pwa");
  });

  it("compares two JSON runs accurately", () => {
    const runA = makeSampleReport({ runId: "run-a" });
    const runB = makeSampleReport({
      runId: "run-b",
      durationMs: 4200,
      summary: { ...runA.summary, passed: 2, failed: 0 },
      scenarios: [
        runA.scenarios[0]!,
        { ...runA.scenarios[1]!, status: "passed", durationMs: 1500, requests: [] },
        runA.scenarios[2]!,
      ],
    });
    const diff = JsonReporter.compareRuns(runA, runB);
    expect(diff.summaryDiff.passedDelta).toBe(1);
    expect(diff.summaryDiff.failedDelta).toBe(-1);
    expect(diff.summaryDiff.durationDeltaMs).toBe(-800);
    const fixed = diff.scenarioChanges.find((c) => c.name === "api-500-check");
    expect(fixed?.changeType).toBe("fixed");
  });

  it("maps typed errors to stable exit codes", () => {
    expect(mapErrorToExitCode(new AssertionFailedError("fail"))).toBe(ExitCode.ASSERTION_FAILURE);
    expect(mapErrorToExitCode(new ConfigValidationError("bad"))).toBe(ExitCode.INVALID_CONFIG);
    expect(mapErrorToExitCode(new BrowserLaunchError("missing", "chromium"))).toBe(
      ExitCode.INFRASTRUCTURE_ERROR,
    );
    expect(mapErrorToExitCode(new TimeoutError("slow", 5000))).toBe(ExitCode.ASSERTION_FAILURE);
    expect(formatErrorForUser(new ConfigValidationError("bad config"))).toContain("Hint:");
  });

  it("loads plugins, registers custom assertions/profiles, and rejects duplicates", async () => {
    const pm = new PluginManager();
    await pm.loadPlugins([
      {
        name: "my-plugin",
        setup(api) {
          api.registerAssertion({
            name: "custom-check",
            execute: async () => {},
          });
        },
      },
    ]);
    expect(pm.getAssertion("custom-check")).toBeDefined();

    await expect(
      pm.loadPlugins([{ name: "my-plugin", setup: () => {} }]),
    ).rejects.toThrow(ConfigValidationError);

    await pm.teardown();
  });

  it("provides at least 20 valid built-in scenario templates that pass YAML validation", () => {
    expect(BUILT_IN_SCENARIO_TEMPLATES.length).toBeGreaterThanOrEqual(24);
    for (const tpl of BUILT_IN_SCENARIO_TEMPLATES) {
      const yamlStr = renderScenarioTemplateYaml(tpl.id);
      const parsed = parseYaml(yamlStr);
      const validated = validateYamlScenario(parsed);
      expect(validated.name).toBe(tpl.name);
      expect(validated.steps.length).toBeGreaterThan(0);
    }
  });
});
