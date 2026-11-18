import { defineScenario } from "../../../src/index.js";

export default defineScenario({
  name: "offline-form-submit",
  description: "Submit a note offline, confirm local persistence, then reconnect and confirm sync",
  mode: "pwa",

  async run({ page, network, expect, waitForServiceWorker }) {
    await page.goto("/");
    await waitForServiceWorker({ controlled: true, timeoutMs: 15_000 });

    await page.getByTestId("note-title-input").fill("Offline Form Submission");

    await network.offline();

    await page.getByTestId("save-note-btn").click();
    await expect(page.getByTestId("sync-status")).toContainText("Saved locally");
    await expect.indexedDBRecord({
      database: "offlinelab-demo-db",
      store: "notes",
      minCount: 1,
    });

    await network.online();
    await expect(page.getByTestId("sync-status")).toHaveText("Synced");
  },
});
