import type { Page } from "playwright";
import { REDACTED, Redactor } from "../../security/redactor.js";
import type {
  IndexedDBDatabaseSnapshot,
  StorageInspectionOptions,
  StorageSnapshot,
} from "../../types/index.js";
import { ServiceWorkerInspector } from "../service-workers/sw-inspector.js";

export class StorageInspector {
  private readonly redactor: Redactor;
  private readonly swInspector: ServiceWorkerInspector;

  constructor(redactor?: Redactor, swInspector?: ServiceWorkerInspector) {
    this.redactor = redactor ?? new Redactor();
    this.swInspector = swInspector ?? new ServiceWorkerInspector(this.redactor);
  }

  /**
   * Inspects browser storage with privacy-by-default: raw values are redacted unless
   * explicitly requested via `includeValues: true` or listed in `allowedKeys`.
   */
  async inspect(page: Page, options?: StorageInspectionOptions): Promise<StorageSnapshot> {
    const includeLocal = options?.includeLocalStorage ?? true;
    const includeSession = options?.includeSessionStorage ?? false;
    const includeIdb = options?.includeIndexedDB ?? true;
    const includeCache = options?.includeCacheStorage ?? true;
    const includeValues = options?.includeValues ?? false;
    const allowedKeys = new Set(options?.allowedKeys ?? []);
    const redactKeys = new Set((options?.redactKeys ?? []).map((k) => k.toLowerCase()));

    const snapshot: StorageSnapshot = {
      capturedAt: new Date().toISOString(),
    };

    if (includeLocal) {
      const rawLocal = await this.readWebStorage(page, "localStorage");
      snapshot.localStorage = this.sanitizeKeyValues(rawLocal, includeValues, allowedKeys, redactKeys);
    }

    if (includeSession) {
      const rawSession = await this.readWebStorage(page, "sessionStorage");
      snapshot.sessionStorage = this.sanitizeKeyValues(
        rawSession,
        includeValues,
        allowedKeys,
        redactKeys,
      );
    }

    if (includeIdb) {
      snapshot.indexedDB = await this.inspectIndexedDB(page, {
        databases: options?.databases,
        stores: options?.stores,
        includeValues,
        maxRecords: options?.maxRecords ?? 50,
      });
    }

    if (includeCache) {
      snapshot.cacheStorage = await this.swInspector.inspectCacheStorage(page);
    }

    return snapshot;
  }

  async readRawStorageValue(
    page: Page,
    storage: "localStorage" | "sessionStorage",
    key: string,
  ): Promise<string | null> {
    return page.evaluate(
      ({ storageName, k }) => {
        try {
          const store = storageName === "localStorage" ? window.localStorage : window.sessionStorage;
          return store.getItem(k);
        } catch {
          return null;
        }
      },
      { storageName: storage, k: key },
    );
  }

  async readIndexedDBRecords(
    page: Page,
    database: string,
    storeName: string,
    maxRecords = 200,
  ): Promise<{ exists: boolean; records: unknown[]; count: number }> {
    return page.evaluate(
      async ({ dbName, store, limit }) => {
        if (typeof indexedDB === "undefined") {
          return { exists: false, records: [], count: 0 };
        }
        return new Promise<{ exists: boolean; records: unknown[]; count: number }>((resolve) => {
          const req = indexedDB.open(dbName);
          req.onerror = () => resolve({ exists: false, records: [], count: 0 });
          req.onupgradeneeded = () => {
            // Do not accidentally create an empty database if it didn't exist
            req.transaction?.abort();
            resolve({ exists: false, records: [], count: 0 });
          };
          req.onsuccess = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(store)) {
              db.close();
              resolve({ exists: false, records: [], count: 0 });
              return;
            }
            const tx = db.transaction(store, "readonly");
            const objStore = tx.objectStore(store);
            const getAllReq = objStore.getAll(undefined, limit);
            const countReq = objStore.count();
            let records: unknown[] = [];
            let count = 0;

            getAllReq.onsuccess = () => {
              records = getAllReq.result ?? [];
            };
            countReq.onsuccess = () => {
              count = countReq.result ?? 0;
            };
            tx.oncomplete = () => {
              db.close();
              resolve({ exists: true, records, count });
            };
            tx.onerror = () => {
              db.close();
              resolve({ exists: false, records: [], count: 0 });
            };
          };
        });
      },
      { dbName: database, store: storeName, limit: maxRecords },
    );
  }

  async inspectIndexedDB(
    page: Page,
    options?: {
      databases?: string[];
      stores?: string[];
      includeValues?: boolean;
      maxRecords?: number;
    },
  ): Promise<IndexedDBDatabaseSnapshot[]> {
    const rawDbs = await page.evaluate(
      async ({ filterDbs, filterStores, includeVals, limit }) => {
        if (typeof indexedDB === "undefined") return [];

        let dbNames: string[] = [];
        if (filterDbs && filterDbs.length > 0) {
          dbNames = filterDbs;
        } else if (typeof indexedDB.databases === "function") {
          try {
            const list = await indexedDB.databases();
            dbNames = list.map((d) => d.name).filter((n): n is string => Boolean(n));
          } catch {
            dbNames = [];
          }
        }

        const results: Array<{
          name: string;
          version?: number;
          objectStores: Array<{ name: string; recordCount: number; records?: unknown[] }>;
        }> = [];

        for (const dbName of dbNames) {
          const snapshot = await new Promise<{
            name: string;
            version?: number;
            objectStores: Array<{ name: string; recordCount: number; records?: unknown[] }>;
          } | null>((resolve) => {
            const req = indexedDB.open(dbName);
            req.onerror = () => resolve(null);
            req.onupgradeneeded = () => {
              req.transaction?.abort();
              resolve(null);
            };
            req.onsuccess = async () => {
              const db = req.result;
              const storeNames = Array.from(db.objectStoreNames).filter(
                (s) => !filterStores || filterStores.length === 0 || filterStores.includes(s),
              );

              const objectStores: Array<{
                name: string;
                recordCount: number;
                records?: unknown[];
              }> = [];

              for (const storeName of storeNames) {
                const storeData = await new Promise<{
                  name: string;
                  recordCount: number;
                  records?: unknown[];
                }>((resStore) => {
                  try {
                    const tx = db.transaction(storeName, "readonly");
                    const store = tx.objectStore(storeName);
                    const countReq = store.count();
                    const allReq = includeVals ? store.getAll(undefined, limit) : null;
                    let recordCount = 0;
                    let records: unknown[] | undefined;

                    countReq.onsuccess = () => {
                      recordCount = countReq.result ?? 0;
                    };
                    if (allReq) {
                      allReq.onsuccess = () => {
                        records = allReq.result ?? [];
                      };
                    }
                    tx.oncomplete = () =>
                      resStore({
                        name: storeName,
                        recordCount,
                        ...(includeVals ? { records: records ?? [] } : {}),
                      });
                    tx.onerror = () => resStore({ name: storeName, recordCount: 0 });
                  } catch {
                    resStore({ name: storeName, recordCount: 0 });
                  }
                });
                objectStores.push(storeData);
              }

              const version = db.version;
              db.close();
              resolve({ name: dbName, version, objectStores });
            };
          });

          if (snapshot) {
            results.push(snapshot);
          }
        }

        return results;
      },
      {
        filterDbs: options?.databases,
        filterStores: options?.stores,
        includeVals: options?.includeValues ?? false,
        limit: options?.maxRecords ?? 50,
      },
    );

    return rawDbs.map((db) => ({
      ...db,
      objectStores: db.objectStores.map((store) => ({
        ...store,
        records: store.records ? this.redactor.redactObject(store.records) : undefined,
      })),
    }));
  }

  private async readWebStorage(
    page: Page,
    storage: "localStorage" | "sessionStorage",
  ): Promise<Record<string, string>> {
    try {
      return await page.evaluate((storageName) => {
        const store = storageName === "localStorage" ? window.localStorage : window.sessionStorage;
        const out: Record<string, string> = {};
        for (let i = 0; i < store.length; i++) {
          const key = store.key(i);
          if (key !== null) {
            out[key] = store.getItem(key) ?? "";
          }
        }
        return out;
      }, storage);
    } catch {
      return {};
    }
  }

  private sanitizeKeyValues(
    raw: Record<string, string>,
    includeValues: boolean,
    allowedKeys: Set<string>,
    redactKeys: Set<string>,
  ): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw)) {
      const lower = key.toLowerCase();
      const looksSensitive =
        redactKeys.has(lower) ||
        lower.includes("token") ||
        lower.includes("secret") ||
        lower.includes("password") ||
        lower.includes("auth") ||
        lower.includes("session") ||
        lower.includes("cookie");

      if (looksSensitive) {
        out[key] = REDACTED;
      } else if (includeValues || allowedKeys.has(key)) {
        out[key] = this.redactor.redactText(value);
      } else {
        out[key] = `<present:${value.length}chars>`;
      }
    }
    return out;
  }
}
