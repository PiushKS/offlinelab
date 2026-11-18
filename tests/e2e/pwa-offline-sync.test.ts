import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  OfflineLab,
  defineScenario,
  validateYamlScenario,
} from "../../src/index.js";
import { startDemoAppServer, type DemoAppServerHandle } from "../../fixtures/offline-demo-app/server.js";

let server: DemoAppServerHandle;
const tmpDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "offlinelab-e2e-"));
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

describe("End-to-End PWA, IndexedDB, Reconnection Sync & Reporting (A12–A16, A20–A25, A27)", () => {
  it("verifies warm-cache offline navigation via YAML scenario (A12)", async () => {
    const reportDir = await makeTempDir();
    const yamlScenario = validateYamlScenario({
      name: "offline-navigation",
      description: "Verify cached PWA navigation",
      mode: "pwa",
      browser: "chromium",
      steps: [
        { action: "navigate", path: "/" },
        { action: "waitForServiceWorker", controlled: true, timeoutMs: 15000 },
        { action: "navigate", path: "/" },
        { action: "inspectCache" },
        { action: "expectCacheContains", urlPattern: "**/offline.html" },
        { action: "setNetwork", profile: "offline" },
        { action: "reload" },
        { action: "expectVisible", selector: "[data-testid='app-shell']" },
        { action: "expectText", selector: "[data-testid='network-status']", text: "Offline" },
        { action: "screenshot", name: "offline-home" },
        { action: "navigate", path: "/uncached-subpage" },
        { action: "expectVisible", selector: "[data-testid='offline-fallback']" },
        { action: "setNetwork", profile: "online" },
      ],
    });

    const out = await OfflineLab.run(
      {
        baseURL: server.url,
        browsers: ["chromium"],
        reports: { directory: reportDir, formats: ["html", "json", "junit"] },
      },
      { scenarios: [yamlScenario] },
    );

    expect(out.hasFailures).toBe(false);
    const sc = out.report.scenarios[0]!;
    expect(sc.status).toBe("passed");
    expect(sc.serviceWorker?.controlled).toBe(true);
    expect(sc.cacheStorage?.totalEntries).toBeGreaterThanOrEqual(5);
    expect(sc.artifacts.some((a) => a.type === "screenshot" && a.name === "offline-home")).toBe(
      true,
    );

    // Verify all 3 report formats exist and contain real measured results (A20, A21, A22, A23)
    const jsonRaw = await fs.readFile(out.reportPaths.json!, "utf8");
    const htmlRaw = await fs.readFile(out.reportPaths.html!, "utf8");
    const junitRaw = await fs.readFile(out.reportPaths.junit!, "utf8");
    expect(JSON.parse(jsonRaw).summary.passed).toBe(1);
    expect(htmlRaw).toContain("offline-navigation");
    expect(junitRaw).toContain('tests="1" failures="0"');

    // Open the generated standalone HTML report in a real browser and verify zero page errors + rendered content (A22)
    const reportLab = new OfflineLab({ browser: "chromium", headless: true });
    try {
      await reportLab.start();
      const pageErrors: string[] = [];
      reportLab.page.on("pageerror", (e) => pageErrors.push(e.message));
      await reportLab.page.goto(`file://${out.reportPaths.html!}`);
      await reportLab.page.waitForSelector(".kpi-grid");
      expect(pageErrors).toEqual([]);
      const overviewText = await reportLab.page.locator("#panel-overview").textContent();
      expect(overviewText).toContain("offline-navigation");
    } finally {
      await reportLab.stop();
    }
  });

  it("reports cold-cache offline navigation accurately (A13)", async () => {
    const reportDir = await makeTempDir();
    const coldScenario = validateYamlScenario({
      name: "cold-cache-offline",
      mode: "pwa",
      steps: [
        { action: "setOffline" },
        { action: "navigate", path: "/", expectFailure: true },
        { action: "setOnline" },
      ],
    });

    const out = await OfflineLab.run(
      {
        baseURL: server.url,
        browsers: ["chromium"],
        reports: { directory: reportDir, formats: ["json"] },
      },
      { scenarios: [coldScenario] },
    );

    expect(out.hasFailures).toBe(false);
    expect(out.report.scenarios[0]?.steps[1]?.details?.failedAsExpected).toBe(true);
  });

  it("verifies IndexedDB persistence across offline reload and real backend sync on reconnect (A14, A15)", async () => {
    const reportDir = await makeTempDir();
    const fullSyncScenario = defineScenario({
      name: "offline-persistence-and-sync",
      mode: "pwa",
      async run({ page, network, expect: labExpect, waitForServiceWorker }) {
        await page.goto("/");
        await waitForServiceWorker({ controlled: true, timeoutMs: 15000 });
        await page.goto("/");

        // Disconnect
        await network.offline();
        await labExpect(page.getByTestId("network-status")).toHaveText("Offline");

        // Create item while offline
        await page.getByTestId("note-title-input").fill("Buy offline groceries");
        await page.getByTestId("note-body-input").fill("Milk, coffee, bread");
        await page.getByTestId("save-note-btn").click();

        await labExpect(page.getByTestId("sync-status")).toContainText("Saved locally");
        await labExpect(page.getByTestId("pending-count")).toHaveText("1");
        await labExpect.indexedDBRecord({
          database: "offlinelab-demo-db",
          store: "notes",
          count: 1,
          match: { title: "Buy offline groceries", syncStatus: "pending" },
        });

        // Reload while still offline (A14)
        await page.reload();
        await labExpect(page.getByTestId("notes-list")).toContainText("Buy offline groceries");
        await labExpect(page.getByTestId("pending-count")).toHaveText("1");

        // Backend must still have 0 records while offline
        expect(server.getStats().recordCount).toBe(0);

        // Reconnect and verify real sync to backend (A15)
        await network.online();
        await labExpect(page.getByTestId("network-status")).toHaveText("Online");
        await labExpect(page.getByTestId("sync-status")).toHaveText("Synced");
        await labExpect(page.getByTestId("pending-count")).toHaveText("0");
      },
    });

    const out = await OfflineLab.run(
      {
        baseURL: server.url,
        browsers: ["chromium"],
        reports: { directory: reportDir, formats: ["json"] },
      },
      { scenarios: [fullSyncScenario] },
    );

    expect(out.hasFailures).toBe(false);
    const stats = server.getStats();
    expect(stats.recordCount).toBe(1);
    expect(stats.records[0]?.title).toBe("Buy offline groceries");
  });

  it("prevents duplicate backend records when response drops after server persistence (A16)", async () => {
    const reportDir = await makeTempDir();
    // Configure backend to persist the POST then abruptly destroy the socket before responding
    server.configureFaults({ dropResponseAfterPersist: true });

    const dedupScenario = defineScenario({
      name: "idempotent-retry-no-duplicates",
      mode: "interception",
      async run({ page, expect: labExpect }) {
        await page.goto("/");

        // Submit online -> server persists record, then drops TCP connection
        await page.getByTestId("note-title-input").fill("Idempotent Order #42");
        await page.getByTestId("save-note-btn").click();

        // Client detects failure and retains item in pending queue
        await labExpect(page.getByTestId("sync-status")).toHaveText("Sync failed");
        await labExpect(page.getByTestId("pending-count")).toHaveText("1");

        // Trigger retry -> client resends with same Idempotency-Key
        await page.getByTestId("retry-sync-btn").click();
        await labExpect(page.getByTestId("sync-status")).toHaveText("Synced");
        await labExpect(page.getByTestId("pending-count")).toHaveText("0");
      },
    });

    const out = await OfflineLab.run(
      {
        baseURL: server.url,
        browsers: ["chromium"],
        reports: { directory: reportDir, formats: ["json"] },
      },
      { scenarios: [dedupScenario] },
    );

    expect(out.hasFailures).toBe(false);
    const stats = server.getStats();
    // Backend received 2 POST attempts, deduplicated the 2nd, and stored EXACTLY 1 logical record!
    expect(stats.postAttempts).toBe(2);
    expect(stats.deduplicatedCount).toBe(1);
    expect(stats.recordCount).toBe(1);
    expect(stats.records[0]?.title).toBe("Idempotent Order #42");
  });

  it("captures failure trace, failure screenshot, and redacts sensitive URLs in reports (A23, A24, A25)", async () => {
    const reportDir = await makeTempDir();
    const failingScenario = defineScenario({
      name: "secret-redaction-and-failure-trace",
      mode: "interception",
      async run({ page, expect: labExpect }) {
        await page.goto("/?api_key=SUPER_SECRET_KEY_999&token=JWT_SECRET_TOKEN");
        // Deliberate assertion failure to trigger failure screenshot & trace capture
        await labExpect(page.getByTestId("does-not-exist")).toBeVisible({ timeout: 500 });
      },
    });

    const out = await OfflineLab.run(
      {
        baseURL: server.url,
        browsers: ["chromium"],
        artifacts: { screenshots: "on-failure", traces: "on-failure" },
        reports: { directory: reportDir, formats: ["html", "json", "junit"] },
      },
      { scenarios: [failingScenario] },
    );

    expect(out.hasFailures).toBe(true);
    const sc = out.report.scenarios[0]!;
    expect(sc.status).toBe("failed");

    // Verify failure screenshot & trace artifact exist on disk (A23, A24)
    const failShot = sc.artifacts.find((a) => a.type === "screenshot" && a.name === "failure");
    const trace = sc.artifacts.find((a) => a.type === "trace");
    expect(failShot).toBeDefined();
    expect(trace).toBeDefined();
    expect((await fs.stat(failShot!.path)).size).toBeGreaterThan(0);
    expect((await fs.stat(trace!.path)).size).toBeGreaterThan(0);

    // Verify secrets do NOT appear anywhere in JSON, HTML, or JUnit reports (A25)
    const jsonContent = await fs.readFile(out.reportPaths.json!, "utf8");
    const htmlContent = await fs.readFile(out.reportPaths.html!, "utf8");
    const junitContent = await fs.readFile(out.reportPaths.junit!, "utf8");

    for (const content of [jsonContent, htmlContent, junitContent]) {
      expect(content).not.toContain("SUPER_SECRET_KEY_999");
      expect(content).not.toContain("JWT_SECRET_TOKEN");
    }
  });

  it("runs parallel scenarios in isolated browser contexts without state leakage (A27)", async () => {
    const reportDir = await makeTempDir();

    const scenarioA = defineScenario({
      name: "parallel-isolation-a",
      mode: "interception",
      async run({ page, expect: labExpect }) {
        await page.goto("/");
        await page.evaluate(() => localStorage.setItem("isolation_marker", "from-A"));
        await new Promise((r) => setTimeout(r, 200));
        await labExpect.storageValue({
          storage: "localStorage",
          key: "isolation_marker",
          value: "from-A",
        });
      },
    });

    const scenarioB = defineScenario({
      name: "parallel-isolation-b",
      mode: "interception",
      async run({ page, expect: labExpect }) {
        await page.goto("/");
        // Must NOT see marker written by parallel scenario A
        await labExpect.storageValue({
          storage: "localStorage",
          key: "isolation_marker",
          exists: false,
        });
        await page.evaluate(() => localStorage.setItem("isolation_marker", "from-B"));
        await labExpect.storageValue({
          storage: "localStorage",
          key: "isolation_marker",
          value: "from-B",
        });
      },
    });

    const out = await OfflineLab.run(
      {
        baseURL: server.url,
        browsers: ["chromium"],
        workers: 2,
        reports: { directory: reportDir, formats: ["json"] },
      },
      { scenarios: [scenarioA, scenarioB] },
    );

    expect(out.hasFailures).toBe(false);
    expect(out.report.summary.passed).toBe(2);
  });

  it("supports mobile browser device emulation alongside offline simulation", async () => {
    const reportDir = await makeTempDir();
    const mobileScenario = defineScenario({
      name: "mobile-viewport-offline",
      mode: "interception",
      device: "iPhone 15",
      async run({ page, network, expect: labExpect }) {
        await page.goto("/");
        const width = await page.evaluate(() => window.innerWidth);
        expect(width).toBeLessThan(500);
        await network.offline();
        await labExpect(page.getByTestId("network-status")).toHaveText("Offline");
        await network.online();
      },
    });

    const out = await OfflineLab.run(
      {
        baseURL: server.url,
        browsers: ["chromium"],
        reports: { directory: reportDir, formats: ["json"] },
      },
      { scenarios: [mobileScenario] },
    );

    expect(out.hasFailures).toBe(false);
    expect(out.report.scenarios[0]?.status).toBe("passed");
  });
});
