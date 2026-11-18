import type { Page } from "playwright";
import { TimeoutError } from "../../core/errors/index.js";
import { Redactor } from "../../security/redactor.js";
import type {
  CacheStorageSnapshot,
  ServiceWorkerSnapshot,
} from "../../types/index.js";

export class ServiceWorkerInspector {
  private readonly redactor: Redactor;

  constructor(redactor?: Redactor) {
    this.redactor = redactor ?? new Redactor();
  }

  async inspect(page: Page): Promise<ServiceWorkerSnapshot> {
    try {
      const raw = await page.evaluate(async () => {
        const supported = typeof navigator !== "undefined" && "serviceWorker" in navigator;
        if (!supported) {
          return {
            supported: false,
            controlled: false,
            registrations: [],
            errors: [] as string[],
          };
        }

        const errors: string[] = [];
        const controller = navigator.serviceWorker.controller;
        const registrations: Array<{
          scope: string;
          activeState?: string;
          activeScriptURL?: string;
          waitingState?: string;
          waitingScriptURL?: string;
          installingState?: string;
          installingScriptURL?: string;
          updateViaCache?: string;
        }> = [];

        try {
          const regs = await navigator.serviceWorker.getRegistrations();
          for (const reg of regs) {
            registrations.push({
              scope: reg.scope,
              activeState: reg.active?.state,
              activeScriptURL: reg.active?.scriptURL,
              waitingState: reg.waiting?.state,
              waitingScriptURL: reg.waiting?.scriptURL,
              installingState: reg.installing?.state,
              installingScriptURL: reg.installing?.scriptURL,
              updateViaCache: reg.updateViaCache,
            });
          }
        } catch (err) {
          errors.push(err instanceof Error ? err.message : String(err));
        }

        return {
          supported: true,
          controlled: Boolean(controller),
          controllerScriptURL: controller?.scriptURL,
          controllerState: controller?.state,
          registrations,
          errors,
        };
      });

      return {
        ...raw,
        controllerScriptURL: raw.controllerScriptURL
          ? this.redactor.redactUrl(raw.controllerScriptURL)
          : undefined,
        registrations: raw.registrations.map((reg) => ({
          ...reg,
          scope: this.redactor.redactUrl(reg.scope),
          activeScriptURL: reg.activeScriptURL
            ? this.redactor.redactUrl(reg.activeScriptURL)
            : undefined,
          waitingScriptURL: reg.waitingScriptURL
            ? this.redactor.redactUrl(reg.waitingScriptURL)
            : undefined,
          installingScriptURL: reg.installingScriptURL
            ? this.redactor.redactUrl(reg.installingScriptURL)
            : undefined,
        })),
        capturedAt: new Date().toISOString(),
      };
    } catch (err) {
      return {
        supported: false,
        controlled: false,
        registrations: [],
        errors: [err instanceof Error ? err.message : String(err)],
        capturedAt: new Date().toISOString(),
      };
    }
  }

  async waitForServiceWorker(
    page: Page,
    options?: {
      controlled?: boolean;
      state?: "installing" | "installed" | "activating" | "activated";
      timeoutMs?: number;
    },
  ): Promise<ServiceWorkerSnapshot> {
    const timeoutMs = options?.timeoutMs ?? 15_000;
    const requireControlled = options?.controlled ?? false;
    const desiredState = options?.state ?? "activated";
    const deadline = Date.now() + timeoutMs;

    let lastSnapshot = await this.inspect(page);

    while (Date.now() < deadline) {
      const hasMatchingRegistration = lastSnapshot.registrations.some((reg) => {
        if (desiredState === "activated") return reg.activeState === "activated";
        if (desiredState === "activating")
          return reg.activeState === "activating" || reg.activeState === "activated";
        if (desiredState === "installed")
          return reg.waitingState === "installed" || reg.activeState === "activated";
        if (desiredState === "installing")
          return (
            reg.installingState === "installing" ||
            reg.waitingState === "installed" ||
            reg.activeState === "activated"
          );
        return false;
      });

      const controllerSatisfied = !requireControlled || lastSnapshot.controlled;

      if (hasMatchingRegistration && controllerSatisfied) {
        return lastSnapshot;
      }

      await new Promise((resolve) => setTimeout(resolve, 150));
      lastSnapshot = await this.inspect(page);
    }

    throw new TimeoutError(
      `Timed out after ${timeoutMs}ms waiting for Service Worker (state=${desiredState}, controlled=${requireControlled}). ` +
        `Observed registrations: ${lastSnapshot.registrations.length}, controlled: ${lastSnapshot.controlled}.`,
      timeoutMs,
      "Verify that the page registers a Service Worker on a secure origin (HTTPS or localhost), that `serviceWorkers: 'allow'` is set, and that the worker calls `clients.claim()` or the page reloads after activation.",
    );
  }

  async inspectCacheStorage(page: Page): Promise<CacheStorageSnapshot> {
    try {
      const raw = await page.evaluate(async () => {
        if (typeof caches === "undefined") {
          return { supported: false, caches: [] as Array<{ name: string; entryCount: number; entries: Array<{ url: string; status?: number; contentType?: string }> }> };
        }
        const names = await caches.keys();
        const result: Array<{
          name: string;
          entryCount: number;
          entries: Array<{ url: string; status?: number; contentType?: string }>;
        }> = [];

        for (const name of names) {
          const cache = await caches.open(name);
          const requests = await cache.keys();
          const entries: Array<{ url: string; status?: number; contentType?: string }> = [];
          for (const req of requests.slice(0, 200)) {
            let status: number | undefined;
            let contentType: string | undefined;
            try {
              const res = await cache.match(req);
              status = res?.status;
              contentType = res?.headers.get("content-type") ?? undefined;
            } catch {
              // ignore match errors
            }
            entries.push({
              url: req.url,
              status,
              contentType,
            });
          }
          result.push({
            name,
            entryCount: requests.length,
            entries,
          });
        }
        return { supported: true, caches: result };
      });

      let totalEntries = 0;
      const redactedCaches = raw.caches.map((c) => {
        totalEntries += c.entryCount;
        return {
          name: c.name,
          entryCount: c.entryCount,
          entries: c.entries.map((entry) => ({
            ...entry,
            url: this.redactor.redactUrl(entry.url),
          })),
        };
      });

      return {
        supported: raw.supported,
        caches: redactedCaches,
        totalEntries,
        capturedAt: new Date().toISOString(),
      };
    } catch {
      return {
        supported: false,
        caches: [],
        totalEntries: 0,
        capturedAt: new Date().toISOString(),
      };
    }
  }
}
