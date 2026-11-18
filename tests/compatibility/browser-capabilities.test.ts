import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OfflineLab, defineScenario } from "../../src/index.js";
import { startDemoAppServer, type DemoAppServerHandle } from "../../fixtures/offline-demo-app/server.js";

let server: DemoAppServerHandle;
const tmpDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "offlinelab-compat-"));
  tmpDirs.push(dir);
  return dir;
}

beforeAll(async () => {
  server = await startDemoAppServer(0);
});

afterAll(async () => {
  await server.close();
  while (tmpDirs.length > 0) {
    await fs.rm(tmpDirs.pop()!, { recursive: true, force: true });
  }
});

describe("Cross-Browser Capability Handling (A26)", () => {
  it("reports Chromium CDP throttling support vs Firefox unsupported capability accurately", async () => {
    const reportDir = await makeTempDir();

    const cdpScenario = defineScenario({
      name: "requires-cdp-bandwidth-throttling",
      mode: "interception",
      requires: { cdpThrottling: true },
      async run({ page, network }) {
        await network.setProfile("slow-3g", { requireBandwidthThrottling: true });
        await page.goto("/");
        await network.online();
      },
    });

    // Under skip policy: Chromium passes, Firefox is accurately marked 'unsupported' (never silently passed!)
    const skipRun = await OfflineLab.run(
      {
        baseURL: server.url,
        browsers: ["chromium", "firefox"],
        unsupportedPolicy: "skip",
        reports: { directory: reportDir, formats: ["json", "junit"] },
      },
      { scenarios: [cdpScenario] },
    );

    expect(skipRun.hasFailures).toBe(false);
    const chromiumRes = skipRun.report.scenarios.find((s) => s.browser === "chromium");
    const firefoxRes = skipRun.report.scenarios.find((s) => s.browser === "firefox");
    expect(chromiumRes?.status).toBe("passed");
    expect(firefoxRes?.status).toBe("unsupported");
    expect(firefoxRes?.reason).toMatch(/CDP/i);

    // Under fail policy: Firefox unsupported capability causes failure (nonzero CLI exit)
    const failRun = await OfflineLab.run(
      {
        baseURL: server.url,
        browsers: ["firefox"],
        unsupportedPolicy: "fail",
        reports: { directory: reportDir, formats: ["json"] },
      },
      { scenarios: [cdpScenario] },
    );

    expect(failRun.hasFailures).toBe(true);
    expect(failRun.report.scenarios[0]?.status).toBe("failed");
  });

  it("runs offline/online toggle and request fault injection on real Firefox", async () => {
    const reportDir = await makeTempDir();

    const ffScenario = defineScenario({
      name: "firefox-offline-and-faults",
      mode: "interception",
      async run({ page, network, expect: labExpect }) {
        await page.goto("/");
        await network.offline();
        await labExpect(page.getByTestId("network-status")).toHaveText("Offline");
        await network.online();
        await labExpect(page.getByTestId("network-status")).toHaveText("Online");

        await network.failRequests({ url: "**/api/notes", fault: "http-503", once: true });
        const status = await page.evaluate(async () => (await fetch("/api/notes")).status);
        expect(status).toBe(503);
      },
    });

    const out = await OfflineLab.run(
      {
        baseURL: server.url,
        browsers: ["firefox"],
        reports: { directory: reportDir, formats: ["json"] },
      },
      { scenarios: [ffScenario] },
    );

    expect(out.hasFailures).toBe(false);
    expect(out.report.scenarios[0]?.status).toBe("passed");
  });
});
