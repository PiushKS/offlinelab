import { ConfigValidationError } from "../../core/errors/index.js";
import { NetworkProfileSchema } from "../../config/schemas/config-schema.js";
import type { BuiltInNetworkProfileName, NetworkProfileConfig } from "../../types/index.js";

/**
 * Reproducible built-in simulation presets.
 * Throughput is specified in kilobits per second (Kbps); 0 / undefined means unlimited.
 * Note: These are reproducible test presets, not guarantees of matching physical cellular hardware.
 */
export const BUILT_IN_NETWORK_PROFILES: Record<BuiltInNetworkProfileName, NetworkProfileConfig> = {
  online: {
    name: "online",
    description: "Normal unrestricted network connectivity",
    offline: false,
    latencyMs: 0,
    connectionType: "ethernet",
  },
  offline: {
    name: "offline",
    description: "No external network connectivity (browser-level offline emulation)",
    offline: true,
    latencyMs: 0,
    downloadKbps: 0,
    uploadKbps: 0,
    connectionType: "none",
  },
  wifi: {
    name: "wifi",
    description: "Typical local Wi-Fi conditions (low latency, high throughput)",
    offline: false,
    latencyMs: 15,
    downloadKbps: 30_000,
    uploadKbps: 15_000,
    connectionType: "wifi",
  },
  "slow-4g": {
    name: "slow-4g",
    description: "Constrained 4G mobile connection",
    offline: false,
    latencyMs: 150,
    downloadKbps: 4_000,
    uploadKbps: 1_500,
    connectionType: "cellular4g",
  },
  "fast-3g": {
    name: "fast-3g",
    description: "Moderate 3G mobile constraints",
    offline: false,
    latencyMs: 300,
    downloadKbps: 1_600,
    uploadKbps: 750,
    connectionType: "cellular3g",
  },
  "slow-3g": {
    name: "slow-3g",
    description: "High-latency, low-bandwidth 3G mobile connection",
    offline: false,
    latencyMs: 600,
    downloadKbps: 500,
    uploadKbps: 250,
    connectionType: "cellular3g",
  },
  "2g": {
    name: "2g",
    description: "Severely constrained 2G/EDGE network",
    offline: false,
    latencyMs: 1_200,
    downloadKbps: 150,
    uploadKbps: 50,
    connectionType: "cellular2g",
  },
  "high-latency": {
    name: "high-latency",
    description: "High round-trip latency with moderate throughput",
    offline: false,
    latencyMs: 2_000,
    downloadKbps: 5_000,
    uploadKbps: 2_000,
    connectionType: "other",
  },
  flaky: {
    name: "flaky",
    description: "Intermittent request failures (25% deterministic seeded failure rate + 250ms latency)",
    offline: false,
    latencyMs: 250,
    downloadKbps: 2_000,
    uploadKbps: 1_000,
    connectionType: "cellular3g",
    failureRate: 0.25,
    seed: 1337,
  },
  unstable: {
    name: "unstable",
    description: "Alternating online/offline connectivity every 2000ms",
    offline: false,
    latencyMs: 200,
    downloadKbps: 1_500,
    uploadKbps: 750,
    connectionType: "cellular3g",
    toggleIntervalMs: 2_000,
  },
  custom: {
    name: "custom",
    description: "Base template for user-defined custom network profiles",
    offline: false,
    latencyMs: 0,
    connectionType: "other",
  },
};

/**
 * Converts kilobits per second (Kbps) to bytes per second (B/s) for CDP emulation.
 * Returns -1 when unlimited (undefined or <= 0 when not offline).
 */
export function kbpsToBytesPerSecond(kbps: number | undefined, offline = false): number {
  if (offline) return 0;
  if (kbps === undefined || kbps <= 0) return -1;
  return Math.round((kbps * 1000) / 8);
}

export class NetworkProfileRegistry {
  private readonly profiles = new Map<string, NetworkProfileConfig>();

  constructor(customProfiles?: Record<string, Partial<NetworkProfileConfig>>) {
    for (const [name, profile] of Object.entries(BUILT_IN_NETWORK_PROFILES)) {
      this.profiles.set(name, { ...profile });
    }
    if (customProfiles) {
      for (const [name, partial] of Object.entries(customProfiles)) {
        this.register({
          name,
          offline: partial.offline ?? false,
          latencyMs: partial.latencyMs ?? 0,
          ...partial,
        });
      }
    }
  }

  register(profile: NetworkProfileConfig): void {
    const parsed = NetworkProfileSchema.safeParse(profile);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `${i.path.join(".") || "(profile)"}: ${i.message}`)
        .join("; ");
      throw new ConfigValidationError(`Invalid network profile "${profile.name}": ${issues}`);
    }
    this.profiles.set(parsed.data.name, parsed.data);
  }

  has(name: string): boolean {
    return this.profiles.has(name);
  }

  get(name: string): NetworkProfileConfig {
    const found = this.profiles.get(name);
    if (!found) {
      throw new ConfigValidationError(
        `Unknown network profile "${name}".`,
        { profile: name, available: this.listNames() },
        `Available profiles: ${this.listNames().join(", ")}. Run \`offlinelab preset list\` to inspect them.`,
      );
    }
    return { ...found };
  }

  resolve(
    nameOrPartial: string | Partial<NetworkProfileConfig>,
    override?: Partial<NetworkProfileConfig>,
  ): NetworkProfileConfig {
    if (typeof nameOrPartial === "string") {
      const base = this.get(nameOrPartial);
      if (!override) return base;
      const merged: NetworkProfileConfig = {
        ...base,
        ...override,
        name: override.name ?? base.name,
      };
      const parsed = NetworkProfileSchema.safeParse(merged);
      if (!parsed.success) {
        const issues = parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ");
        throw new ConfigValidationError(`Invalid custom network profile override: ${issues}`);
      }
      return parsed.data;
    }

    const candidate: NetworkProfileConfig = {
      name: nameOrPartial.name ?? "custom",
      offline: nameOrPartial.offline ?? false,
      latencyMs: nameOrPartial.latencyMs ?? 0,
      ...nameOrPartial,
      ...override,
    };
    const parsed = NetworkProfileSchema.safeParse(candidate);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      throw new ConfigValidationError(`Invalid custom network profile: ${issues}`);
    }
    return parsed.data;
  }

  list(): NetworkProfileConfig[] {
    return Array.from(this.profiles.values()).map((p) => ({ ...p }));
  }

  listNames(): string[] {
    return Array.from(this.profiles.keys());
  }
}
