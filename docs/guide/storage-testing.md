# Storage & Synchronization Testing

Offline-first applications persist mutations locally in `IndexedDB` or `localStorage` and synchronize them after connectivity returns.

## Privacy-by-Default Storage Inspection

When capturing storage snapshots (`captureStorageSnapshot`, `inspectLocalStorage`, `inspectIndexedDB`), OfflineLab:
- Automatically redacts keys matching sensitive names (`token`, `secret`, `password`, `auth`, `session`, `cookie`).
- Omits raw values by default unless `includeValues: true` or `allowedKeys` is explicitly configured.

## IndexedDB Persistence Assertions

Verify that offline-created records survive reloads inside IndexedDB:

```yaml
- action: expectIndexedDBRecord
  database: offlinelab-demo-db
  store: notes
  count: 1
  match:
    title: "Persisted Offline Note"
    syncStatus: "pending"
```

## Verifying Reconnection Sync & Idempotency

Never assume synchronization succeeded simply because a loading spinner disappeared. Verify both:
1. Local client state (`pending-count` drains to `0`, UI reflects `"Synced"`).
2. Actual backend persistence (e.g., querying your test backend's record list or stats endpoint).

See `fixtures/offline-demo-app/server.ts` and `tests/e2e/pwa-offline-sync.test.ts` for a complete real-world example verifying:
- Offline persistence across reload
- Reconnection queue drain
- Mid-response drop after server persistence + `Idempotency-Key` duplicate prevention
- HTTP 500 failure retention and manual retry recovery
