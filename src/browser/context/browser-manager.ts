import {
  chromium,
  devices,
  firefox,
  webkit,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type BrowserType,
  type Page,
} from "playwright";
import { BrowserLaunchError, ConfigValidationError } from "../../core/errors/index.js";
import type {
  BrowserName,
  DeviceConfig,
  ProxyConfig,
  ServiceWorkerPolicy,
} from "../../types/index.js";
import { BrowserAdapter } from "../adapters/browser-adapter.js";

export interface CreateContextOptions {
  browser: BrowserName;
  headless: boolean;
  baseURL?: string;
  serviceWorkers: ServiceWorkerPolicy;
  device?: string | DeviceConfig;
  proxy?: ProxyConfig;
  ignoreHTTPSErrors?: boolean;
  extraHTTPHeaders?: Record<string, string>;
  locale?: string;
  timezoneId?: string;
  storageState?: string;
  persistentProfileDir?: string;
  timeoutMs?: number;
}

export interface ManagedBrowserSession {
  browserName: BrowserName;
  adapter: BrowserAdapter;
  context: BrowserContext;
  page: Page;
  isPersistent: boolean;
  close: () => Promise<void>;
}

export function getPlaywrightBrowserType(name: BrowserName): BrowserType {
  switch (name) {
    case "chromium":
      return chromium;
    case "firefox":
      return firefox;
    case "webkit":
      return webkit;
  }
}

export function resolveDeviceContextOptions(
  device?: string | DeviceConfig,
): BrowserContextOptions {
  if (!device) return {};

  if (typeof device === "string") {
    const descriptor = devices[device];
    if (!descriptor) {
      const sample = Object.keys(devices).slice(0, 12).join(", ");
      throw new ConfigValidationError(
        `Unknown Playwright device descriptor "${device}".`,
        { device },
        `Use a valid Playwright device name (e.g. ${sample}) or specify a custom DeviceConfig object.`,
      );
    }
    return { ...descriptor };
  }

  let base: BrowserContextOptions = {};
  if (device.name) {
    const descriptor = devices[device.name];
    if (!descriptor) {
      throw new ConfigValidationError(`Unknown Playwright device descriptor "${device.name}".`);
    }
    base = { ...descriptor };
  }

  let viewport = device.viewport ?? base.viewport;
  if (viewport && device.orientation) {
    const longSide = Math.max(viewport.width, viewport.height);
    const shortSide = Math.min(viewport.width, viewport.height);
    viewport =
      device.orientation === "landscape"
        ? { width: longSide, height: shortSide }
        : { width: shortSide, height: longSide };
  }

  return {
    ...base,
    ...(viewport ? { viewport } : {}),
    ...(device.deviceScaleFactor !== undefined
      ? { deviceScaleFactor: device.deviceScaleFactor }
      : {}),
    ...(device.isMobile !== undefined ? { isMobile: device.isMobile } : {}),
    ...(device.hasTouch !== undefined ? { hasTouch: device.hasTouch } : {}),
    ...(device.userAgent !== undefined ? { userAgent: device.userAgent } : {}),
  };
}

/**
 * Manages reusable Playwright browser instances with strict context isolation per scenario.
 */
export class BrowserManager {
  private readonly browsers = new Map<string, Browser>();
  private readonly activeContexts = new Set<BrowserContext>();

  async getBrowser(
    browserName: BrowserName,
    headless: boolean,
    timeoutMs = 30_000,
  ): Promise<Browser> {
    const key = `${browserName}:${headless ? "headless" : "headed"}`;
    const existing = this.browsers.get(key);
    if (existing && existing.isConnected()) {
      return existing;
    }

    const browserType = getPlaywrightBrowserType(browserName);
    try {
      const browser = await browserType.launch({
        headless,
        timeout: timeoutMs,
      });
      this.browsers.set(key, browser);
      return browser;
    } catch (err) {
      throw new BrowserLaunchError(
        `Failed to launch ${browserName} browser: ${(err as Error).message}`,
        browserName,
        err,
      );
    }
  }

  async createSession(options: CreateContextOptions): Promise<ManagedBrowserSession> {
    const adapter = new BrowserAdapter(options.browser);
    const deviceOptions = resolveDeviceContextOptions(options.device);

    const contextOptions: BrowserContextOptions = {
      ...deviceOptions,
      baseURL: options.baseURL,
      serviceWorkers: options.serviceWorkers,
      ...(options.proxy ? { proxy: options.proxy } : {}),
      ...(options.ignoreHTTPSErrors !== undefined
        ? { ignoreHTTPSErrors: options.ignoreHTTPSErrors }
        : {}),
      ...(options.extraHTTPHeaders ? { extraHTTPHeaders: options.extraHTTPHeaders } : {}),
      ...(options.locale ? { locale: options.locale } : {}),
      ...(options.timezoneId ? { timezoneId: options.timezoneId } : {}),
      ...(options.storageState ? { storageState: options.storageState } : {}),
    };

    if (options.persistentProfileDir) {
      const browserType = getPlaywrightBrowserType(options.browser);
      try {
        const context = await browserType.launchPersistentContext(
          options.persistentProfileDir,
          {
            ...contextOptions,
            headless: options.headless,
            timeout: options.timeoutMs ?? 30_000,
          },
        );
        this.activeContexts.add(context);
        const page = context.pages()[0] ?? (await context.newPage());
        return {
          browserName: options.browser,
          adapter,
          context,
          page,
          isPersistent: true,
          close: async () => {
            this.activeContexts.delete(context);
            try {
              await context.close();
            } catch {
              // Ignore close errors if already closed
            }
          },
        };
      } catch (err) {
        throw new BrowserLaunchError(
          `Failed to launch persistent ${options.browser} context: ${(err as Error).message}`,
          options.browser,
          err,
        );
      }
    }

    const browser = await this.getBrowser(
      options.browser,
      options.headless,
      options.timeoutMs ?? 30_000,
    );

    const context = await browser.newContext(contextOptions);
    this.activeContexts.add(context);
    const page = await context.newPage();

    return {
      browserName: options.browser,
      adapter,
      context,
      page,
      isPersistent: false,
      close: async () => {
        this.activeContexts.delete(context);
        try {
          await context.close();
        } catch {
          // Ignore close errors if browser crashed or was closed
        }
      },
    };
  }

  async closeAll(): Promise<void> {
    const contextClosures = Array.from(this.activeContexts).map(async (ctx) => {
      try {
        await ctx.close();
      } catch {
        // Ignore
      }
    });
    await Promise.allSettled(contextClosures);
    this.activeContexts.clear();

    const browserClosures = Array.from(this.browsers.values()).map(async (b) => {
      try {
        await b.close();
      } catch {
        // Ignore
      }
    });
    await Promise.allSettled(browserClosures);
    this.browsers.clear();
  }
}
