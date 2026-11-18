import { OfflineLab } from "../../src/index.js";

/**
 * Runnable programmatic SDK example.
 * Start the demo PWA first (`PORT=4173 node fixtures/offline-demo-app/server.ts`),
 * then run `npx jiti examples/typed-sdk/run-sdk.ts`.
 */
async function main(): Promise<void> {
  const lab = new OfflineLab({
    browser: "chromium",
    baseURL: process.env.OFFLINELAB_URL ?? "http://localhost:4173",
  });

  try {
    await lab.start();
    await lab.page.goto("/");
    await lab.waitForServiceWorker({ controlled: true, timeoutMs: 15_000 });
    await lab.page.goto("/");

    await lab.network.offline();
    await lab.page.reload();

    const snapshot = await lab.inspect();
    console.log("Offline snapshot:", JSON.stringify(snapshot, null, 2));

    await lab.network.online();
  } finally {
    await lab.stop();
  }
}

void main();
