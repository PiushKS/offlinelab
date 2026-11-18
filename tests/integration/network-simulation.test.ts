import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  OfflineLab,
  defineScenario,
} from "../../src/index.js";
import { startDemoAppServer, type DemoAppServerHandle } from "../../fixtures/offline-demo-app/server.js";

let server: DemoAppServerHandle;
const tmpDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "offlinelab-int-"));
  tmpDirs.push(dir);
  return dir;
}

beforeAll(async () => {
  server = await startDemoAppServer(0);
});

beforeEach(() => {
  server.reset();
});

afterAll(async () => {
  await server.close();
  while (tmpDirs.length > 0) {
    await fs.rm(tmpDirs.pop()!, { recursive: true, force: true });
  }
});

describe("Playwright Network Simulation Integration (A05–A10, A18)", () => {
  it("starts browser, toggles offline/online, and verifies observable connectivity (A05, A06, A07)", async () => {
    const lab = new OfflineLab({
      browser: "chromium",
      baseURL: server.url,
      serviceWorkers: "block",
    });

    try {
      await lab.start();
      await lab.page.goto("/");
      expect(await lab.page.evaluate(() => navigator.onLine)).toBe(true);

      // Go offline (A06)
      await lab.network.offline();
      expect(lab.network.isOffline()).toBe(true);
      expect(await lab.page.evaluate(() => navigator.onLine)).toBe(false);

      const fetchFailed = await lab.page.evaluate(async () => {
        try {
          await fetch("/api/notes");
          return false;
        } catch {
          return true;
        }
      });
      expect(fetchFailed).toBe(true);

      // Restore online (A07)
      await lab.network.online();
      expect(lab.network.isOffline()).toBe(false);
      expect(await lab.page.evaluate(() => navigator.onLine)).toBe(true);

      const status = await lab.page.evaluate(async () => {
        const res = await fetch("/api/notes");
        return res.status;
      });
      expect(status).toBe(200);
    } finally {
      await lab.stop();
    }
  });

  it("injects connection failure, HTTP 500, malformed JSON, and observable request latency (A08, A09, A10)", async () => {
    const lab = new OfflineLab({
      browser: "chromium",
      baseURL: server.url,
      serviceWorkers: "block",
    });

    try {
      await lab.start();
      await lab.page.goto("/");

      // A08: Request failure
      const failId = await lab.network.failRequests({
        url: "**/api/notes",
        fault: "connection-failed",
      });
      const failed = await lab.page.evaluate(async () => {
        try {
          await fetch("/api/notes");
          return false;
        } catch {
          return true;
        }
      });
      expect(failed).toBe(true);
      await lab.network.removeRule(failId);

      // A09: HTTP 500 injection
      const err500Id = await lab.network.failRequests({
        url: "**/api/notes",
        fault: "http-500",
      });
      const status500 = await lab.page.evaluate(async () => {
        const res = await fetch("/api/notes");
        return res.status;
      });
      expect(status500).toBe(500);
      await lab.network.removeRule(err500Id);

      // Malformed JSON injection
      const malId = await lab.network.failRequests({
        url: "**/api/notes",
        fault: "malformed-json",
      });
      const parseFailed = await lab.page.evaluate(async () => {
        const res = await fetch("/api/notes");
        try {
          await res.json();
          return false;
        } catch {
          return true;
        }
      });
      expect(parseFailed).toBe(true);
      await lab.network.removeRule(malId);

      // A10: Observable latency injection (>= 400ms)
      const delayId = await lab.network.delayRequests({
        url: "**/api/notes",
        delayMs: 450,
      });
      const elapsed = await lab.page.evaluate(async () => {
        const t0 = performance.now();
        const res = await fetch("/api/notes");
        await res.json();
        return performance.now() - t0;
      });
      expect(elapsed).toBeGreaterThanOrEqual(380);
      await lab.network.removeRule(delayId);

      // Chromium CDP profile switching
      await lab.network.setProfile("slow-3g");
      expect(lab.network.getActiveProfile()).toBe("slow-3g");
      await lab.network.online();

      // Verify fault events were recorded in timeline
      const faultEvents = lab.getEvents().filter((e) => e.type === "fault.injected");
      expect(faultEvents.length).toBeGreaterThanOrEqual(4);
    } finally {
      await lab.stop();
    }
  });

  it("handles unexpected browser/context crash cleanly as controlled failure (A18)", async () => {
    const reportDir = await makeTempDir();
    const crashScenario = defineScenario({
      name: "simulated-browser-crash",
      mode: "interception",
      async run({ page, context }) {
        await page.goto("/");
        // Simulate abrupt crash by closing the browser context mid-scenario
        await context.close();
        await page.goto("/");
      },
    });

    const out = await OfflineLab.run(
      {
        baseURL: server.url,
        browsers: ["chromium"],
        reports: { directory: reportDir, formats: ["json"] },
      },
      { scenarios: [crashScenario] },
    );

    expect(out.hasFailures).toBe(true);
    expect(out.report.scenarios[0]?.status).toBe("failed");
    expect(out.report.scenarios[0]?.error?.message).toMatch(/closed/i);
    expect(out.report.scenarios[0]?.diagnostics.length).toBeGreaterThan(0);
  });
});
