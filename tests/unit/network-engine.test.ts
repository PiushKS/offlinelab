import { describe, expect, it } from "vitest";
import {
  BUILT_IN_NETWORK_PROFILES,
  ConfigValidationError,
  FaultInjectionEngine,
  NetworkProfileRegistry,
  NetworkScheduler,
  compileUrlPattern,
  createSeededRng,
  faultToHttpStatus,
  kbpsToBytesPerSecond,
  matchesUrlPattern,
} from "../../src/index.js";

describe("NetworkProfileRegistry & Unit Conversion", () => {
  it("registers all 11 built-in profiles with documented defaults", () => {
    const registry = new NetworkProfileRegistry();
    const names = registry.listNames();
    for (const expected of [
      "online",
      "offline",
      "wifi",
      "slow-4g",
      "fast-3g",
      "slow-3g",
      "2g",
      "high-latency",
      "flaky",
      "unstable",
      "custom",
    ]) {
      expect(names).toContain(expected);
      expect(BUILT_IN_NETWORK_PROFILES[expected as keyof typeof BUILT_IN_NETWORK_PROFILES]).toBeDefined();
    }
  });

  it("converts Kbps to bytes/sec accurately", () => {
    expect(kbpsToBytesPerSecond(undefined, false)).toBe(-1);
    expect(kbpsToBytesPerSecond(0, true)).toBe(0);
    expect(kbpsToBytesPerSecond(800, false)).toBe(100_000);
    expect(kbpsToBytesPerSecond(500, false)).toBe(62_500);
  });

  it("resolves custom profile overrides and rejects unknown profiles", () => {
    const registry = new NetworkProfileRegistry();
    const custom = registry.resolve("slow-3g", { latencyMs: 900, downloadKbps: 300 });
    expect(custom.latencyMs).toBe(900);
    expect(custom.downloadKbps).toBe(300);
    expect(() => registry.get("nonexistent-profile")).toThrow(ConfigValidationError);
  });
});

describe("URL Pattern Matching & FaultInjectionEngine (A11)", () => {
  it("matches glob and regex URL patterns accurately", () => {
    expect(matchesUrlPattern("http://localhost:3000/api/notes/123", "**/api/**")).toBe(true);
    expect(matchesUrlPattern("http://localhost:3000/assets/app.js", "**/api/**")).toBe(false);
    expect(matchesUrlPattern("http://localhost:3000/api/v2/items", "/\\/api\\/v\\d+\\//")).toBe(
      true,
    );
    expect(
      compileUrlPattern("http://localhost:3000/items?id=1").test(
        "http://localhost:3000/items?id=1",
      ),
    ).toBe(true);
    expect(
      compileUrlPattern("http://localhost:3000/items?id=1").test(
        "http://localhost:3000/items/id=1",
      ),
    ).toBe(false);
    expect(matchesUrlPattern("http://localhost:3000/api/items", "/api/items")).toBe(true);
  });

  it("produces repeatable selection for the same seed (A11)", () => {
    const runSequence = (seed: number) => {
      const engine = new FaultInjectionEngine();
      engine.addRule({
        url: "**/api/**",
        fault: "connection-failed",
        probability: 0.35,
        seed,
      });
      const outcomes: boolean[] = [];
      for (let i = 0; i < 40; i++) {
        const decision = engine.evaluate({
          url: `http://localhost:3000/api/item/${i}`,
          method: "GET",
          resourceType: "fetch",
        });
        outcomes.push(Boolean(decision));
      }
      return outcomes;
    };

    const first = runSequence(42);
    const second = runSequence(42);
    const differentSeed = runSequence(9999);

    expect(first).toEqual(second);
    expect(first.some(Boolean)).toBe(true);
    expect(first.some((x) => !x)).toBe(true);
    expect(first).not.toEqual(differentSeed);

    const rngA = createSeededRng(123);
    const rngB = createSeededRng(123);
    expect([rngA(), rngA(), rngA()]).toEqual([rngB(), rngB(), rngB()]);
  });

  it("rejects out-of-range probabilities", () => {
    const engine = new FaultInjectionEngine();
    expect(() =>
      engine.addRule({ url: "**/*", fault: "connection-failed", probability: 1.5 }),
    ).toThrow(ConfigValidationError);
    expect(() =>
      engine.addRule({ url: "**/*", fault: "connection-failed", probability: -0.1 }),
    ).toThrow(ConfigValidationError);
  });

  it("enforces deterministic rule precedence (priority desc, then insertion order)", () => {
    const engine = new FaultInjectionEngine();
    engine.addRule({ id: "low", url: "**/api/**", fault: "http-500", priority: 1 });
    engine.addRule({ id: "high", url: "**/api/**", fault: "http-503", priority: 10 });
    engine.addRule({ id: "high-second", url: "**/api/**", fault: "http-429", priority: 10 });

    const match = engine.evaluate({
      url: "http://localhost:3000/api/test",
      method: "GET",
      resourceType: "fetch",
    });
    expect(match?.ruleId).toBe("high");
    expect(match?.fault).toBe("http-503");
  });

  it("supports once, firstN, everyNth, method, resourceType, phase, and durationMs timing", () => {
    const engine = new FaultInjectionEngine();
    const t0 = 1000;
    engine.addRule(
      {
        id: "first-two-posts",
        url: "**/api/notes",
        methods: ["POST"],
        resourceTypes: ["fetch"],
        fault: "http-500",
        firstN: 2,
        phase: "outage",
        durationMs: 500,
      },
      t0,
    );

    // Wrong phase -> no match
    expect(
      engine.evaluate({
        url: "http://localhost:3000/api/notes",
        method: "POST",
        resourceType: "fetch",
        nowMs: t0 + 50,
      }),
    ).toBeUndefined();

    engine.setPhase("outage");
    // Wrong method -> no match
    expect(
      engine.evaluate({
        url: "http://localhost:3000/api/notes",
        method: "GET",
        resourceType: "fetch",
        nowMs: t0 + 60,
      }),
    ).toBeUndefined();

    // 1st and 2nd POST match; 3rd does not
    expect(
      engine.evaluate({
        url: "http://localhost:3000/api/notes",
        method: "POST",
        resourceType: "fetch",
        nowMs: t0 + 100,
      })?.ruleId,
    ).toBe("first-two-posts");
    expect(
      engine.evaluate({
        url: "http://localhost:3000/api/notes",
        method: "POST",
        resourceType: "fetch",
        nowMs: t0 + 200,
      })?.ruleId,
    ).toBe("first-two-posts");
    expect(
      engine.evaluate({
        url: "http://localhost:3000/api/notes",
        method: "POST",
        resourceType: "fetch",
        nowMs: t0 + 250,
      }),
    ).toBeUndefined();

    // everyNth rule
    const engine2 = new FaultInjectionEngine();
    engine2.addRule({ id: "nth", url: "**/*", fault: "http-429", everyNth: 3 });
    const hits = [1, 2, 3, 4, 5, 6].map((i) =>
      Boolean(engine2.evaluate({ url: `http://x/${i}`, method: "GET", resourceType: "fetch" })),
    );
    expect(hits).toEqual([false, false, true, false, false, true]);
  });

  it("maps fault types to HTTP status codes accurately", () => {
    expect(faultToHttpStatus("http-400")).toBe(400);
    expect(faultToHttpStatus("http-429")).toBe(429);
    expect(faultToHttpStatus("http-503")).toBe(503);
    expect(faultToHttpStatus("http-status", 418)).toBe(418);
    expect(faultToHttpStatus("connection-failed")).toBeUndefined();
  });
});

describe("NetworkScheduler", () => {
  it("executes steps in deterministic time order and supports cancellation", async () => {
    const scheduler = new NetworkScheduler();
    const observed: string[] = [];

    scheduler.start(
      [
        { atMs: 40, profile: "offline", label: "B" },
        { atMs: 10, profile: "slow-3g", label: "A" },
        { atMs: 250, profile: "online", label: "C-cancelled" },
      ],
      {
        applyStep: async (step) => {
          observed.push(step.label ?? String(step.profile));
        },
      },
    );

    await new Promise((r) => setTimeout(r, 110));
    scheduler.stop();
    await scheduler.flush();
    await new Promise((r) => setTimeout(r, 180));

    expect(observed).toEqual(["A", "B"]);
    expect(scheduler.isRunning()).toBe(false);
  });
});
