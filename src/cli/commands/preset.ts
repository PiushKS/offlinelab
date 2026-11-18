import path from "node:path";
import pc from "picocolors";
import { getBrowserCapabilities } from "../../browser/adapters/browser-adapter.js";
import { ConfigLoader } from "../../config/loader/config-loader.js";
import { NetworkProfileRegistry } from "../../network/profiles/registry.js";

export async function runPresetListCommand(options: {
  config?: string;
  json?: boolean;
  cwd?: string;
}): Promise<void> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  let customProfiles;
  try {
    const { config } = await ConfigLoader.load({ cwd, configPath: options.config });
    customProfiles = config.networkProfiles;
  } catch {
    customProfiles = undefined;
  }

  const registry = new NetworkProfileRegistry(customProfiles);
  const profiles = registry.list();

  if (options.json) {
    console.log(JSON.stringify(profiles, null, 2));
    return;
  }

  const useColor = Boolean(process.stdout.isTTY) && !("NO_COLOR" in process.env);
  const bold = (s: string) => (useColor ? pc.bold(s) : s);

  console.log(bold("OfflineLab Network Profiles"));
  console.log("─".repeat(78));
  console.log(
    `${"Profile".padEnd(16)} ${"Offline".padEnd(9)} ${"Latency".padEnd(10)} ${"Down/Up (Kbps)".padEnd(18)} Behavior`,
  );
  for (const p of profiles) {
    const bw =
      p.offline
        ? "0 / 0"
        : p.downloadKbps || p.uploadKbps
          ? `${p.downloadKbps ?? "∞"} / ${p.uploadKbps ?? "∞"}`
          : "unlimited";
    const latency = `${p.latencyMs}ms`;
    console.log(
      `${p.name.padEnd(16)} ${String(p.offline).padEnd(9)} ${latency.padEnd(10)} ${bw.padEnd(18)} ${p.description ?? ""}`,
    );
  }
  console.log("");
  console.log(
    "Note: Full upload/download bandwidth throttling uses CDP on Chromium. Firefox and WebKit apply offline emulation and request-level latency/fault injection.",
  );
}

export async function runPresetShowCommand(
  name: string,
  options: { config?: string; json?: boolean; cwd?: string },
): Promise<void> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  let customProfiles;
  try {
    const { config } = await ConfigLoader.load({ cwd, configPath: options.config });
    customProfiles = config.networkProfiles;
  } catch {
    customProfiles = undefined;
  }

  const registry = new NetworkProfileRegistry(customProfiles);
  const profile = registry.get(name);
  const capabilities = {
    chromium: getBrowserCapabilities("chromium"),
    firefox: getBrowserCapabilities("firefox"),
    webkit: getBrowserCapabilities("webkit"),
  };

  if (options.json) {
    console.log(JSON.stringify({ profile, capabilities }, null, 2));
    return;
  }

  console.log(`Network Profile: ${profile.name}`);
  console.log("─".repeat(40));
  if (profile.description) console.log(`Description:      ${profile.description}`);
  console.log(`Offline:          ${profile.offline}`);
  console.log(`Latency:          ${profile.latencyMs}ms`);
  console.log(`Download Kbps:    ${profile.downloadKbps ?? "unlimited"}`);
  console.log(`Upload Kbps:      ${profile.uploadKbps ?? "unlimited"}`);
  console.log(`Connection Type:  ${profile.connectionType ?? "other"}`);
  if (profile.failureRate !== undefined) {
    console.log(`Failure Rate:     ${(profile.failureRate * 100).toFixed(1)}% (seed=${profile.seed ?? 1337})`);
  }
  if (profile.toggleIntervalMs !== undefined) {
    console.log(`Toggle Interval:  ${profile.toggleIntervalMs}ms`);
  }
  console.log("");
  console.log("Browser Capabilities:");
  for (const [b, cap] of Object.entries(capabilities)) {
    const bwSupport = cap.cdpNetworkThrottling
      ? "CDP bandwidth + latency"
      : "offline + request-level latency only";
    console.log(`  - ${b.padEnd(10)}: ${bwSupport}`);
  }
}
