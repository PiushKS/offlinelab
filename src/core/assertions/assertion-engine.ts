import crypto from "node:crypto";
import type { Locator, Page } from "playwright";
import type { ServiceWorkerInspector } from "../../browser/service-workers/sw-inspector.js";
import type { StorageInspector } from "../../browser/storage/storage-inspector.js";
import { matchesUrlPattern } from "../../network/faults/fault-engine.js";
import type { PluginManager } from "../../plugins/plugin-manager.js";
import type {
  AssertionResult,
  ExpectMatcher,
  OfflineLabExpect,
  PageExpectMatcher,
  ScenarioRuntimeContext,
  ValueExpectMatcher,
} from "../../types/index.js";
import { AssertionFailedError, ConfigValidationError } from "../errors/index.js";
import type { EventRecorder } from "../events/event-recorder.js";

export interface AssertionEngineDeps {
  page: Page;
  eventRecorder: EventRecorder;
  swInspector: ServiceWorkerInspector;
  storageInspector: StorageInspector;
  pluginManager?: PluginManager;
  defaultTimeoutMs: number;
  getRuntimeContext?: () => ScenarioRuntimeContext;
}

function matchesExpected(actual: string, expected: string | RegExp, exact = false): boolean {
  if (expected instanceof RegExp) {
    return expected.test(actual);
  }
  return exact ? actual === expected : actual.includes(expected);
}

function recordMatchesFilter(record: unknown, match: Record<string, unknown>): boolean {
  if (!record || typeof record !== "object") return false;
  const obj = record as Record<string, unknown>;
  for (const [key, expectedVal] of Object.entries(match)) {
    const actualVal = obj[key];
    if (expectedVal !== actualVal) {
      if (
        typeof expectedVal === "object" &&
        expectedVal !== null &&
        typeof actualVal === "object" &&
        actualVal !== null
      ) {
        if (JSON.stringify(actualVal) !== JSON.stringify(expectedVal)) {
          return false;
        }
      } else {
        return false;
      }
    }
  }
  return true;
}

export class AssertionEngine {
  private readonly results: AssertionResult[] = [];
  private readonly deps: AssertionEngineDeps;

  constructor(deps: AssertionEngineDeps) {
    this.deps = deps;
  }

  getResults(): AssertionResult[] {
    return [...this.results];
  }

  private async runAssertion(
    name: string,
    fn: () => Promise<{ expected?: unknown; actual?: unknown } | void>,
  ): Promise<void> {
    const id = `asr_${crypto.randomUUID().slice(0, 10)}`;
    const elapsedStart = this.deps.eventRecorder.getElapsedMs();
    this.deps.eventRecorder.record("assertion.started", { assertionId: id, name });

    try {
      const meta = await fn();
      const result: AssertionResult = {
        id,
        name,
        status: "passed",
        elapsedMs: this.deps.eventRecorder.getElapsedMs(),
        expected: meta?.expected,
        actual: meta?.actual,
      };
      this.results.push(result);
      this.deps.eventRecorder.record("assertion.passed", {
        assertionId: id,
        name,
        durationMs: Math.max(0, result.elapsedMs - elapsedStart),
      });
    } catch (err) {
      const error =
        err instanceof AssertionFailedError
          ? err
          : new AssertionFailedError(err instanceof Error ? err.message : String(err), {
              cause: err,
            });

      const result: AssertionResult = {
        id,
        name,
        status: "failed",
        elapsedMs: this.deps.eventRecorder.getElapsedMs(),
        expected: error.expected,
        actual: error.actual,
        message: error.message,
      };
      this.results.push(result);
      this.deps.eventRecorder.record(
        "assertion.failed",
        {
          assertionId: id,
          name,
          message: error.message,
          expected: error.expected,
          actual: error.actual,
        },
        "error",
      );
      throw error;
    }
  }

  private runSyncAssertion(
    name: string,
    fn: () => { expected?: unknown; actual?: unknown } | void,
  ): void {
    const id = `asr_${crypto.randomUUID().slice(0, 10)}`;
    this.deps.eventRecorder.record("assertion.started", { assertionId: id, name });
    try {
      const meta = fn();
      this.results.push({
        id,
        name,
        status: "passed",
        elapsedMs: this.deps.eventRecorder.getElapsedMs(),
        expected: meta?.expected,
        actual: meta?.actual,
      });
      this.deps.eventRecorder.record("assertion.passed", { assertionId: id, name });
    } catch (err) {
      const error =
        err instanceof AssertionFailedError
          ? err
          : new AssertionFailedError(err instanceof Error ? err.message : String(err));
      this.results.push({
        id,
        name,
        status: "failed",
        elapsedMs: this.deps.eventRecorder.getElapsedMs(),
        expected: error.expected,
        actual: error.actual,
        message: error.message,
      });
      this.deps.eventRecorder.record(
        "assertion.failed",
        { assertionId: id, name, message: error.message },
        "error",
      );
      throw error;
    }
  }

  async expectVisible(selector: string, timeoutMs?: number): Promise<void> {
    const timeout = timeoutMs ?? this.deps.defaultTimeoutMs;
    await this.runAssertion(`expectVisible(${selector})`, async () => {
      try {
        await this.deps.page.locator(selector).first().waitFor({ state: "visible", timeout });
      } catch (err) {
        throw new AssertionFailedError(
          `Expected element "${selector}" to be visible within ${timeout}ms.`,
          {
            expected: "visible",
            actual: "hidden or detached",
            suggestion: `Check that selector "${selector}" exists on the current page (${this.deps.page.url()}).`,
            cause: err,
          },
        );
      }
    });
  }

  async expectHidden(selector: string, timeoutMs?: number): Promise<void> {
    const timeout = timeoutMs ?? this.deps.defaultTimeoutMs;
    await this.runAssertion(`expectHidden(${selector})`, async () => {
      try {
        await this.deps.page.locator(selector).first().waitFor({ state: "hidden", timeout });
      } catch (err) {
        throw new AssertionFailedError(
          `Expected element "${selector}" to be hidden within ${timeout}ms.`,
          { expected: "hidden", actual: "visible", cause: err },
        );
      }
    });
  }

  async expectText(
    selector: string,
    text: string,
    options?: { exact?: boolean; timeoutMs?: number },
  ): Promise<void> {
    const timeout = options?.timeoutMs ?? this.deps.defaultTimeoutMs;
    const exact = options?.exact ?? false;
    await this.runAssertion(`expectText(${selector}, ${JSON.stringify(text)})`, async () => {
      const locator = this.deps.page.locator(selector).first();
      const deadline = Date.now() + timeout;
      let lastText = "";

      while (Date.now() < deadline) {
        try {
          const content = (await locator.textContent({ timeout: Math.min(1000, timeout) })) ?? "";
          lastText = content.trim();
          if (matchesExpected(lastText, text, exact)) {
            return { expected: text, actual: lastText };
          }
        } catch {
          // Element may not yet be attached; retry until timeout
        }
        await new Promise((r) => setTimeout(r, 100));
      }

      throw new AssertionFailedError(
        `Expected "${selector}" to ${exact ? "have exact text" : "contain text"} ${JSON.stringify(text)}, but got ${JSON.stringify(lastText)} after ${timeout}ms.`,
        { expected: text, actual: lastText },
      );
    });
  }

  async expectURL(
    urlPattern: string | RegExp,
    options?: { exact?: boolean; timeoutMs?: number },
  ): Promise<void> {
    const timeout = options?.timeoutMs ?? this.deps.defaultTimeoutMs;
    const exact = options?.exact ?? false;
    await this.runAssertion(`expectURL(${String(urlPattern)})`, async () => {
      const deadline = Date.now() + timeout;
      let lastUrl = this.deps.page.url();

      while (Date.now() < deadline) {
        lastUrl = this.deps.page.url();
        const ok =
          urlPattern instanceof RegExp
            ? urlPattern.test(lastUrl)
            : exact
              ? lastUrl === urlPattern
              : lastUrl.includes(urlPattern) || matchesUrlPattern(lastUrl, urlPattern);
        if (ok) {
          return { expected: String(urlPattern), actual: lastUrl };
        }
        await new Promise((r) => setTimeout(r, 100));
      }

      throw new AssertionFailedError(
        `Expected URL to match ${String(urlPattern)}, but current URL is "${lastUrl}".`,
        { expected: String(urlPattern), actual: lastUrl },
      );
    });
  }

  async expectRequestCount(options: {
    url: string;
    count?: number;
    min?: number;
    max?: number;
    method?: string;
  }): Promise<void> {
    await this.runAssertion(`expectRequestCount(${options.url})`, async () => {
      const requests = this.deps.eventRecorder.getRequests().filter((req) => {
        if (options.method && req.method.toUpperCase() !== options.method.toUpperCase()) {
          return false;
        }
        return matchesUrlPattern(req.url, options.url) || req.url.includes(options.url);
      });

      const actual = requests.length;

      if (options.count !== undefined && actual !== options.count) {
        throw new AssertionFailedError(
          `Expected exactly ${options.count} request(s) matching "${options.url}", observed ${actual}.`,
          { expected: options.count, actual },
        );
      }
      if (options.min !== undefined && actual < options.min) {
        throw new AssertionFailedError(
          `Expected at least ${options.min} request(s) matching "${options.url}", observed ${actual}.`,
          { expected: `>= ${options.min}`, actual },
        );
      }
      if (options.max !== undefined && actual > options.max) {
        throw new AssertionFailedError(
          `Expected at most ${options.max} request(s) matching "${options.url}", observed ${actual}.`,
          { expected: `<= ${options.max}`, actual },
        );
      }

      return {
        expected: options.count ?? { min: options.min, max: options.max },
        actual,
      };
    });
  }

  async expectResponseStatus(options: {
    url: string;
    status: number;
    method?: string;
  }): Promise<void> {
    await this.runAssertion(`expectResponseStatus(${options.url}, ${options.status})`, async () => {
      const matching = this.deps.eventRecorder.getRequests().filter((req) => {
        if (options.method && req.method.toUpperCase() !== options.method.toUpperCase()) {
          return false;
        }
        return matchesUrlPattern(req.url, options.url) || req.url.includes(options.url);
      });

      const statuses = matching.map((r) => r.status).filter((s): s is number => s !== undefined);
      if (!statuses.includes(options.status)) {
        throw new AssertionFailedError(
          `Expected a response with HTTP status ${options.status} matching "${options.url}", observed statuses: [${statuses.join(", ") || "none"}].`,
          { expected: options.status, actual: statuses },
        );
      }
      return { expected: options.status, actual: statuses };
    });
  }

  async expectNoConsoleErrors(ignorePatterns?: string[]): Promise<void> {
    await this.runAssertion("expectNoConsoleErrors()", async () => {
      const compiled = (ignorePatterns ?? []).map((p) => new RegExp(p));
      const errors = this.deps.eventRecorder
        .getConsoleErrors()
        .filter((e) => !compiled.some((re) => re.test(e.text)));

      if (errors.length > 0) {
        const preview = errors
          .slice(0, 5)
          .map((e) => `[${e.type}] ${e.text}`)
          .join("; ");
        throw new AssertionFailedError(
          `Expected no console errors, but observed ${errors.length}: ${preview}`,
          { expected: 0, actual: errors.length },
        );
      }
      return { expected: 0, actual: 0 };
    });
  }

  async expectStorageValue(options: {
    storage: "localStorage" | "sessionStorage";
    key: string;
    value?: string;
    exists?: boolean;
  }): Promise<void> {
    await this.runAssertion(
      `expectStorageValue(${options.storage}.${options.key})`,
      async () => {
        const actual = await this.deps.storageInspector.readRawStorageValue(
          this.deps.page,
          options.storage,
          options.key,
        );
        const doesExist = actual !== null;

        if (options.exists === false && doesExist) {
          throw new AssertionFailedError(
            `Expected ${options.storage} key "${options.key}" not to exist, but it was present.`,
            { expected: null, actual: "<present>" },
          );
        }

        if ((options.exists === true || options.value !== undefined) && !doesExist) {
          throw new AssertionFailedError(
            `Expected ${options.storage} key "${options.key}" to exist, but it was missing.`,
            { expected: options.value ?? "<present>", actual: null },
          );
        }

        if (options.value !== undefined && actual !== options.value) {
          throw new AssertionFailedError(
            `Expected ${options.storage} key "${options.key}" to equal ${JSON.stringify(options.value)}, but got ${JSON.stringify(actual)}.`,
            { expected: options.value, actual },
          );
        }

        return { expected: options.value ?? (options.exists ?? true), actual: doesExist ? "present" : null };
      },
    );
  }

  async expectCacheContains(urlPattern: string, cacheName?: string): Promise<void> {
    await this.runAssertion(`expectCacheContains(${urlPattern})`, async () => {
      const snapshot = await this.deps.swInspector.inspectCacheStorage(this.deps.page);
      if (!snapshot.supported) {
        throw new AssertionFailedError(
          "Cache Storage API is not supported or unavailable in this browser context.",
        );
      }

      const targetCaches = cacheName
        ? snapshot.caches.filter((c) => c.name === cacheName)
        : snapshot.caches;

      const allUrls = targetCaches.flatMap((c) => c.entries.map((e) => e.url));
      const matched = allUrls.some(
        (u) => matchesUrlPattern(u, urlPattern) || u.includes(urlPattern),
      );

      if (!matched) {
        throw new AssertionFailedError(
          `Expected Cache Storage${cacheName ? ` ("${cacheName}")` : ""} to contain entry matching "${urlPattern}", found ${allUrls.length} cached URL(s).`,
          { expected: urlPattern, actual: allUrls.slice(0, 10) },
        );
      }

      return { expected: urlPattern, actual: allUrls.length };
    });
  }

  async expectIndexedDBRecord(options: {
    database: string;
    store: string;
    minCount?: number;
    count?: number;
    match?: Record<string, unknown>;
    timeoutMs?: number;
  }): Promise<void> {
    const timeout = options.timeoutMs ?? this.deps.defaultTimeoutMs;
    await this.runAssertion(
      `expectIndexedDBRecord(${options.database}.${options.store})`,
      async () => {
        const deadline = Date.now() + timeout;
        let lastCount = 0;
        let lastMatchedCount = 0;
        let lastExists = false;

        while (Date.now() < deadline) {
          const result = await this.deps.storageInspector.readIndexedDBRecords(
            this.deps.page,
            options.database,
            options.store,
          );
          lastExists = result.exists;
          lastCount = result.count;

          const matchedRecords = options.match
            ? result.records.filter((r) => recordMatchesFilter(r, options.match!))
            : result.records;
          lastMatchedCount = matchedRecords.length;

          const effectiveCount = options.match ? lastMatchedCount : lastCount;
          const countOk = options.count === undefined || effectiveCount === options.count;
          const minOk = options.minCount === undefined || effectiveCount >= options.minCount;
          const defaultAtLeastOne =
            options.count === undefined && options.minCount === undefined
              ? effectiveCount >= 1
              : true;

          if (result.exists && countOk && minOk && defaultAtLeastOne) {
            return {
              expected: options.count ?? options.minCount ?? ">= 1",
              actual: effectiveCount,
            };
          }

          await new Promise((r) => setTimeout(r, 120));
        }

        if (!lastExists) {
          throw new AssertionFailedError(
            `IndexedDB database "${options.database}" / store "${options.store}" does not exist.`,
            { expected: `${options.database}.${options.store}`, actual: "missing" },
          );
        }

        throw new AssertionFailedError(
          `IndexedDB assertion failed for "${options.database}.${options.store}": observed total=${lastCount}, matched=${lastMatchedCount}.`,
          {
            expected: { count: options.count, minCount: options.minCount, match: options.match },
            actual: { total: lastCount, matched: lastMatchedCount },
          },
        );
      },
    );
  }

  async runCustomAssertion(name: string, options?: Record<string, unknown>): Promise<void> {
    const def = this.deps.pluginManager?.getAssertion(name);
    if (!def) {
      throw new ConfigValidationError(
        `Custom assertion "${name}" is not registered by any loaded plugin.`,
        { name },
        "Register the plugin providing this assertion in `offlinelab.config.ts`.",
      );
    }
    const ctx = this.deps.getRuntimeContext?.();
    if (!ctx) {
      throw new AssertionFailedError("Runtime context unavailable for custom assertion.");
    }
    await this.runAssertion(`custom(${name})`, async () => {
      await def.execute(ctx, options);
    });
  }

  /**
   * Creates the typed `expect` function exposed to programmatic TypeScript scenarios.
   */
  createExpectFunction(): OfflineLabExpect {
    const isLocator = (v: unknown): v is Locator =>
      typeof v === "object" &&
      v !== null &&
      "waitFor" in v &&
      "textContent" in v &&
      "count" in v;

    const isPage = (v: unknown): v is Page =>
      typeof v === "object" &&
      v !== null &&
      "goto" in v &&
      "url" in v &&
      "title" in v &&
      "locator" in v;

    const expectFn = ((target: unknown) => {
      if (isLocator(target)) {
        const matcher: ExpectMatcher = {
          toBeVisible: async (options) => {
            const timeout = options?.timeout ?? this.deps.defaultTimeoutMs;
            await this.runAssertion("expect(locator).toBeVisible()", async () => {
              try {
                await target.first().waitFor({ state: "visible", timeout });
              } catch (err) {
                throw new AssertionFailedError(
                  `Expected locator to be visible within ${timeout}ms.`,
                  { expected: "visible", actual: "hidden/detached", cause: err },
                );
              }
            });
          },
          toBeHidden: async (options) => {
            const timeout = options?.timeout ?? this.deps.defaultTimeoutMs;
            await this.runAssertion("expect(locator).toBeHidden()", async () => {
              try {
                await target.first().waitFor({ state: "hidden", timeout });
              } catch (err) {
                throw new AssertionFailedError(
                  `Expected locator to be hidden within ${timeout}ms.`,
                  { expected: "hidden", actual: "visible", cause: err },
                );
              }
            });
          },
          toHaveText: async (expected, options) => {
            const timeout = options?.timeout ?? this.deps.defaultTimeoutMs;
            const exact = options?.exact ?? !(expected instanceof RegExp);
            await this.runAssertion(`expect(locator).toHaveText(${String(expected)})`, async () => {
              const deadline = Date.now() + timeout;
              let last = "";
              while (Date.now() < deadline) {
                try {
                  last = ((await target.first().textContent({ timeout: Math.min(1000, timeout) })) ?? "").trim();
                  if (matchesExpected(last, expected, exact)) {
                    return { expected: String(expected), actual: last };
                  }
                } catch {
                  // retry
                }
                await new Promise((r) => setTimeout(r, 100));
              }
              throw new AssertionFailedError(
                `Expected locator text to equal ${String(expected)}, got ${JSON.stringify(last)}.`,
                { expected: String(expected), actual: last },
              );
            });
          },
          toContainText: async (expected, options) => {
            const timeout = options?.timeout ?? this.deps.defaultTimeoutMs;
            await this.runAssertion(
              `expect(locator).toContainText(${String(expected)})`,
              async () => {
                const deadline = Date.now() + timeout;
                let last = "";
                while (Date.now() < deadline) {
                  try {
                    last = ((await target.first().textContent({ timeout: Math.min(1000, timeout) })) ?? "").trim();
                    if (matchesExpected(last, expected, false)) {
                      return { expected: String(expected), actual: last };
                    }
                  } catch {
                    // retry
                  }
                  await new Promise((r) => setTimeout(r, 100));
                }
                throw new AssertionFailedError(
                  `Expected locator text to contain ${String(expected)}, got ${JSON.stringify(last)}.`,
                  { expected: String(expected), actual: last },
                );
              },
            );
          },
          toHaveValue: async (expected, options) => {
            const timeout = options?.timeout ?? this.deps.defaultTimeoutMs;
            await this.runAssertion(
              `expect(locator).toHaveValue(${String(expected)})`,
              async () => {
                const deadline = Date.now() + timeout;
                let last = "";
                while (Date.now() < deadline) {
                  try {
                    last = await target.first().inputValue({ timeout: Math.min(1000, timeout) });
                    if (matchesExpected(last, expected, !(expected instanceof RegExp))) {
                      return { expected: String(expected), actual: last };
                    }
                  } catch {
                    // retry
                  }
                  await new Promise((r) => setTimeout(r, 100));
                }
                throw new AssertionFailedError(
                  `Expected locator input value ${String(expected)}, got ${JSON.stringify(last)}.`,
                  { expected: String(expected), actual: last },
                );
              },
            );
          },
          toHaveCount: async (count, options) => {
            const timeout = options?.timeout ?? this.deps.defaultTimeoutMs;
            await this.runAssertion(`expect(locator).toHaveCount(${count})`, async () => {
              const deadline = Date.now() + timeout;
              let last = 0;
              while (Date.now() < deadline) {
                last = await target.count();
                if (last === count) {
                  return { expected: count, actual: last };
                }
                await new Promise((r) => setTimeout(r, 100));
              }
              throw new AssertionFailedError(
                `Expected locator count ${count}, got ${last}.`,
                { expected: count, actual: last },
              );
            });
          },
        };
        return matcher;
      }

      if (isPage(target)) {
        const matcher: PageExpectMatcher = {
          toHaveURL: async (expected, options) => {
            await this.expectURL(expected, {
              timeoutMs: options?.timeout,
              exact: typeof expected === "string" && expected.startsWith("http"),
            });
          },
          toHaveTitle: async (expected, options) => {
            const timeout = options?.timeout ?? this.deps.defaultTimeoutMs;
            await this.runAssertion(`expect(page).toHaveTitle(${String(expected)})`, async () => {
              const deadline = Date.now() + timeout;
              let last = "";
              while (Date.now() < deadline) {
                last = await target.title();
                if (matchesExpected(last, expected, !(expected instanceof RegExp))) {
                  return { expected: String(expected), actual: last };
                }
                await new Promise((r) => setTimeout(r, 100));
              }
              throw new AssertionFailedError(
                `Expected page title ${String(expected)}, got ${JSON.stringify(last)}.`,
                { expected: String(expected), actual: last },
              );
            });
          },
        };
        return matcher;
      }

      const valueMatcher: ValueExpectMatcher<unknown> = {
        toBe: (expected) => {
          this.runSyncAssertion(`expect(value).toBe(${JSON.stringify(expected)})`, () => {
            if (!Object.is(target, expected)) {
              throw new AssertionFailedError(
                `Expected ${JSON.stringify(target)} to be ${JSON.stringify(expected)}.`,
                { expected, actual: target },
              );
            }
            return { expected, actual: target };
          });
        },
        toEqual: (expected) => {
          this.runSyncAssertion("expect(value).toEqual()", () => {
            if (JSON.stringify(target) !== JSON.stringify(expected)) {
              throw new AssertionFailedError(
                `Expected ${JSON.stringify(target)} to equal ${JSON.stringify(expected)}.`,
                { expected, actual: target },
              );
            }
            return { expected, actual: target };
          });
        },
        toBeTruthy: () => {
          this.runSyncAssertion("expect(value).toBeTruthy()", () => {
            if (!target) {
              throw new AssertionFailedError(`Expected ${JSON.stringify(target)} to be truthy.`, {
                expected: "truthy",
                actual: target,
              });
            }
          });
        },
        toBeFalsy: () => {
          this.runSyncAssertion("expect(value).toBeFalsy()", () => {
            if (target) {
              throw new AssertionFailedError(`Expected ${JSON.stringify(target)} to be falsy.`, {
                expected: "falsy",
                actual: target,
              });
            }
          });
        },
        toContain: (expected) => {
          this.runSyncAssertion(`expect(value).toContain(${JSON.stringify(expected)})`, () => {
            const ok =
              typeof target === "string"
                ? target.includes(String(expected))
                : Array.isArray(target)
                  ? target.includes(expected)
                  : false;
            if (!ok) {
              throw new AssertionFailedError(
                `Expected ${JSON.stringify(target)} to contain ${JSON.stringify(expected)}.`,
                { expected, actual: target },
              );
            }
          });
        },
        toBeGreaterThan: (expected) => {
          this.runSyncAssertion(`expect(value).toBeGreaterThan(${expected})`, () => {
            if (typeof target !== "number" || !(target > expected)) {
              throw new AssertionFailedError(
                `Expected ${String(target)} to be greater than ${expected}.`,
                { expected: `> ${expected}`, actual: target },
              );
            }
          });
        },
        toBeGreaterThanOrEqual: (expected) => {
          this.runSyncAssertion(`expect(value).toBeGreaterThanOrEqual(${expected})`, () => {
            if (typeof target !== "number" || !(target >= expected)) {
              throw new AssertionFailedError(
                `Expected ${String(target)} to be >= ${expected}.`,
                { expected: `>= ${expected}`, actual: target },
              );
            }
          });
        },
        toBeLessThan: (expected) => {
          this.runSyncAssertion(`expect(value).toBeLessThan(${expected})`, () => {
            if (typeof target !== "number" || !(target < expected)) {
              throw new AssertionFailedError(
                `Expected ${String(target)} to be less than ${expected}.`,
                { expected: `< ${expected}`, actual: target },
              );
            }
          });
        },
        toHaveLength: (length) => {
          this.runSyncAssertion(`expect(value).toHaveLength(${length})`, () => {
            const actualLen =
              typeof target === "string" || Array.isArray(target) ? target.length : undefined;
            if (actualLen !== length) {
              throw new AssertionFailedError(
                `Expected length ${length}, got ${String(actualLen)}.`,
                { expected: length, actual: actualLen },
              );
            }
          });
        },
      };
      return valueMatcher;
    }) as OfflineLabExpect;

    expectFn.noConsoleErrors = (ignorePatterns) => this.expectNoConsoleErrors(ignorePatterns);
    expectFn.cacheContains = (urlPattern, cacheName) =>
      this.expectCacheContains(urlPattern, cacheName);
    expectFn.indexedDBRecord = (opts) => this.expectIndexedDBRecord(opts);
    expectFn.requestCount = (opts) => this.expectRequestCount(opts);
    expectFn.responseStatus = (opts) => this.expectResponseStatus(opts);
    expectFn.storageValue = (opts) => this.expectStorageValue(opts);
    expectFn.custom = (name, opts) => this.runCustomAssertion(name, opts);

    return expectFn;
  }
}
