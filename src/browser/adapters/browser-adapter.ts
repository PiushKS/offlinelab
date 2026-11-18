import type { BrowserContext, CDPSession, Page } from "playwright";
import { UnsupportedCapabilityError } from "../../core/errors/index.js";
import { kbpsToBytesPerSecond } from "../../network/profiles/registry.js";
import type { BrowserCapabilities, BrowserName, NetworkProfileConfig } from "../../types/index.js";

export function getBrowserCapabilities(browser: BrowserName): BrowserCapabilities {
  switch (browser) {
    case "chromium":
      return {
        browser: "chromium",
        contextOffline: true,
        cdpNetworkThrottling: true,
        cdpNetworkRules: true,
        requestInterception: true,
        requestLatencyInjection: true,
        serviceWorkerInspection: true,
        cacheStorageInspection: true,
        indexedDBInspection: true,
        notes: [
          "Supports Chrome DevTools Protocol (CDP) bandwidth and latency throttling.",
          "Supports full Service Worker lifecycle, Cache Storage, and IndexedDB inspection.",
        ],
      };
    case "firefox":
      return {
        browser: "firefox",
        contextOffline: true,
        cdpNetworkThrottling: false,
        cdpNetworkRules: false,
        requestInterception: true,
        requestLatencyInjection: true,
        serviceWorkerInspection: true,
        cacheStorageInspection: true,
        indexedDBInspection: true,
        notes: [
          "Does not support CDP upload/download bandwidth throttling; only request-level latency injection and offline mode are available.",
          "Service Worker route interception behavior may differ from Chromium.",
        ],
      };
    case "webkit":
      return {
        browser: "webkit",
        contextOffline: true,
        cdpNetworkThrottling: false,
        cdpNetworkRules: false,
        requestInterception: true,
        requestLatencyInjection: true,
        serviceWorkerInspection: false,
        cacheStorageInspection: true,
        indexedDBInspection: true,
        notes: [
          "Does not support CDP bandwidth throttling; request-level latency injection and context offline mode are available.",
          "Service Worker support in headless WebKit is limited and may not control localhost pages reliably.",
        ],
      };
  }
}

export interface AppliedThrottlingResult {
  mechanism: "cdp-rules" | "cdp-legacy" | "request-delay" | "none";
  bandwidthEmulated: boolean;
  latencyEmulated: boolean;
  warning?: string;
}

/**
 * Capability-checked CDP network throttling adapter for Chromium.
 * Prefers modern CDP commands (`Network.emulateNetworkConditionsByRule` + `Network.overrideNetworkState`)
 * and falls back cleanly to `Network.emulateNetworkConditions` if the Chromium build does not expose them.
 */
export class ChromiumCdpNetworkAdapter {
  private cdpSession: CDPSession | null = null;
  private supportsRuleApi: boolean | null = null;
  private supportsOverrideState: boolean | null = null;
  private enabled = false;

  constructor(
    private readonly context: BrowserContext,
    private readonly page: Page,
  ) {}

  async attach(): Promise<void> {
    if (this.cdpSession) return;
    this.cdpSession = await this.context.newCDPSession(this.page);
    await this.cdpSession.send("Network.enable");
    this.enabled = true;
  }

  async applyProfile(profile: NetworkProfileConfig): Promise<AppliedThrottlingResult> {
    await this.attach();
    const session = this.cdpSession!;

    const downloadThroughput = kbpsToBytesPerSecond(profile.downloadKbps, profile.offline);
    const uploadThroughput = kbpsToBytesPerSecond(profile.uploadKbps, profile.offline);
    const latency = Math.max(0, profile.latencyMs);

    // Attempt modern CDP API first (`Network.overrideNetworkState` + `Network.emulateNetworkConditionsByRule`)
    if (this.supportsRuleApi !== false) {
      try {
        if (this.supportsOverrideState !== false) {
          try {
            await session.send("Network.overrideNetworkState" as never, {
              offline: profile.offline,
              latency,
              downloadThroughput,
              uploadThroughput,
              connectionType: profile.connectionType ?? "other",
            } as never);
            this.supportsOverrideState = true;
          } catch {
            this.supportsOverrideState = false;
          }
        }

        const matchedConditions =
          profile.offline || latency > 0 || downloadThroughput > 0 || uploadThroughput > 0
            ? [
                {
                  urlPattern: profile.urlPattern ?? "*",
                  latency,
                  downloadThroughput,
                  uploadThroughput,
                  connectionType: profile.connectionType ?? "other",
                },
              ]
            : [];

        await session.send("Network.emulateNetworkConditionsByRule" as never, {
          offline: profile.offline,
          matchedNetworkConditions: matchedConditions,
        } as never);
        this.supportsRuleApi = true;

        return {
          mechanism: "cdp-rules",
          bandwidthEmulated: downloadThroughput >= 0 || uploadThroughput >= 0,
          latencyEmulated: latency > 0 || profile.offline,
        };
      } catch {
        this.supportsRuleApi = false;
      }
    }

    // Graceful fallback to widely supported CDP Network.emulateNetworkConditions
    await session.send("Network.emulateNetworkConditions", {
      offline: profile.offline,
      latency,
      downloadThroughput,
      uploadThroughput,
      connectionType: profile.connectionType ?? "other",
    });

    return {
      mechanism: "cdp-legacy",
      bandwidthEmulated: downloadThroughput >= 0 || uploadThroughput >= 0,
      latencyEmulated: latency > 0 || profile.offline,
    };
  }

  async reset(): Promise<void> {
    if (!this.cdpSession || !this.enabled) return;
    try {
      if (this.supportsRuleApi === true) {
        await this.cdpSession.send("Network.emulateNetworkConditionsByRule" as never, {
          offline: false,
          matchedNetworkConditions: [],
        } as never);
      } else {
        await this.cdpSession.send("Network.emulateNetworkConditions", {
          offline: false,
          latency: 0,
          downloadThroughput: -1,
          uploadThroughput: -1,
        });
      }
    } catch {
      // Session or page may already be closed during teardown
    }
  }

  async detach(): Promise<void> {
    if (!this.cdpSession) return;
    try {
      await this.reset();
      await this.cdpSession.detach();
    } catch {
      // Ignore detach errors when page is already closed
    } finally {
      this.cdpSession = null;
      this.enabled = false;
    }
  }
}

export class BrowserAdapter {
  public readonly browser: BrowserName;
  public readonly capabilities: BrowserCapabilities;

  constructor(browser: BrowserName) {
    this.browser = browser;
    this.capabilities = getBrowserCapabilities(browser);
  }

  createCdpAdapter(context: BrowserContext, page: Page): ChromiumCdpNetworkAdapter | null {
    if (!this.capabilities.cdpNetworkThrottling) {
      return null;
    }
    return new ChromiumCdpNetworkAdapter(context, page);
  }

  assertCapability(
    capability: keyof Pick<
      BrowserCapabilities,
      | "contextOffline"
      | "cdpNetworkThrottling"
      | "requestInterception"
      | "serviceWorkerInspection"
    >,
    featureDescription: string,
  ): void {
    if (!this.capabilities[capability]) {
      throw new UnsupportedCapabilityError(
        `Browser "${this.browser}" does not support ${featureDescription} (${capability}).`,
        {
          browser: this.browser,
          capability,
          featureDescription,
        },
        `Use Chromium for ${featureDescription}, or adjust the scenario/config unsupportedPolicy.`,
      );
    }
  }
}
