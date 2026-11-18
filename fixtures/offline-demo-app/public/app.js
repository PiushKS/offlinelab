(function () {
  const DB_NAME = "offlinelab-demo-db";
  const DB_VERSION = 1;
  const NOTES_STORE = "notes";
  const QUEUE_STORE = "mutationQueue";

  const networkStatusEl = document.getElementById("network-status");
  const syncStatusEl = document.getElementById("sync-status");
  const pendingCountEl = document.getElementById("pending-count");
  const errorBannerEl = document.getElementById("error-banner");
  const notesListEl = document.getElementById("notes-list");
  const notesCountEl = document.getElementById("notes-count");
  const noteFormEl = document.getElementById("note-form");
  const titleInputEl = document.getElementById("note-title");
  const bodyInputEl = document.getElementById("note-body");
  const retrySyncBtn = document.getElementById("retry-sync-btn");
  const refreshServerBtn = document.getElementById("refresh-server-btn");

  // Store a non-secret demo user indicator in localStorage for persistence tests
  if (!window.localStorage.getItem("offlinelab_demo_user")) {
    window.localStorage.setItem("offlinelab_demo_user", "demo-user");
  }

  let dbPromise = null;
  let syncing = false;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(NOTES_STORE)) {
          db.createObjectStore(NOTES_STORE, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(QUEUE_STORE)) {
          db.createObjectStore(QUEUE_STORE, { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function idbGetAll(storeName) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readonly");
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbPut(storeName, value) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).put(value);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function idbDelete(storeName, key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  function showError(msg) {
    if (!msg) {
      errorBannerEl.textContent = "";
      errorBannerEl.classList.remove("visible");
    } else {
      errorBannerEl.textContent = msg;
      errorBannerEl.classList.add("visible");
    }
  }

  function setSyncStatus(text) {
    syncStatusEl.textContent = text;
  }

  function updateNetworkIndicator() {
    const online = navigator.onLine;
    networkStatusEl.textContent = online ? "Online" : "Offline";
    networkStatusEl.className = "pill " + (online ? "online" : "offline");
  }

  async function renderUI() {
    const [notes, queue] = await Promise.all([
      idbGetAll(NOTES_STORE),
      idbGetAll(QUEUE_STORE),
    ]);

    notes.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    notesCountEl.textContent = String(notes.length);
    pendingCountEl.textContent = String(queue.length);

    notesListEl.innerHTML = "";
    for (const note of notes) {
      const li = document.createElement("li");
      li.className = "note-card";
      li.setAttribute("data-note-id", note.id);
      li.setAttribute("data-sync-status", note.syncStatus);

      const left = document.createElement("div");
      const strong = document.createElement("strong");
      strong.textContent = note.title;
      left.appendChild(strong);
      if (note.body) {
        const p = document.createElement("div");
        p.style.fontSize = "12px";
        p.style.color = "#475569";
        p.textContent = note.body;
        left.appendChild(p);
      }

      const right = document.createElement("span");
      right.className = "pill";
      right.textContent = note.syncStatus;

      li.appendChild(left);
      li.appendChild(right);
      notesListEl.appendChild(li);
    }
  }

  function makeId(prefix) {
    return prefix + "_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  async function syncQueue() {
    if (syncing) return;
    if (!navigator.onLine) {
      setSyncStatus("Saved locally (offline)");
      await renderUI();
      return;
    }

    const queue = await idbGetAll(QUEUE_STORE);
    if (queue.length === 0) {
      await renderUI();
      return;
    }

    syncing = true;
    showError("");
    setSyncStatus("Syncing...");

    let hadFailure = false;
    let hadConflict = false;

    try {
      for (const item of queue) {
        try {
          const response = await fetch("/api/notes", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Idempotency-Key": item.idempotencyKey,
            },
            body: JSON.stringify({
              id: item.noteId,
              title: item.title,
              body: item.body,
              baseVersion: item.baseVersion,
            }),
          });

          if (response.status === 409) {
            const conflictData = await response.json().catch(() => ({}));
            hadConflict = true;
            await idbPut(NOTES_STORE, {
              id: item.noteId,
              title: item.title,
              body: item.body,
              version: conflictData.serverRecord?.version ?? item.baseVersion,
              syncStatus: "conflict",
              updatedAt: Date.now(),
              idempotencyKey: item.idempotencyKey,
            });
            await idbDelete(QUEUE_STORE, item.id);
            showError("Conflict detected for note: " + item.title);
            continue;
          }

          if (!response.ok) {
            throw new Error("HTTP " + response.status);
          }

          const saved = await response.json();
          await idbPut(NOTES_STORE, {
            id: saved.record.id,
            title: saved.record.title,
            body: saved.record.body,
            version: saved.record.version,
            syncStatus: "synced",
            updatedAt: saved.record.updatedAt,
            idempotencyKey: item.idempotencyKey,
          });
          await idbDelete(QUEUE_STORE, item.id);
        } catch (err) {
          hadFailure = true;
          item.retries = (item.retries || 0) + 1;
          item.lastError = err instanceof Error ? err.message : String(err);
          await idbPut(QUEUE_STORE, item);
          await idbPut(NOTES_STORE, {
            id: item.noteId,
            title: item.title,
            body: item.body,
            version: item.baseVersion,
            syncStatus: "pending",
            updatedAt: Date.now(),
            idempotencyKey: item.idempotencyKey,
          });
          showError("Sync failed: " + item.lastError);
        }
      }
    } finally {
      syncing = false;
    }

    const remaining = await idbGetAll(QUEUE_STORE);
    if (hadConflict) {
      setSyncStatus("Conflict");
    } else if (hadFailure || remaining.length > 0) {
      setSyncStatus(navigator.onLine ? "Sync failed" : "Saved locally (offline)");
    } else {
      setSyncStatus("Synced");
      showError("");
    }
    await renderUI();
  }

  async function fetchServerNotes() {
    showError("");
    try {
      const response = await fetch("/api/notes");
      if (!response.ok) {
        throw new Error("Server returned HTTP " + response.status);
      }
      const data = await response.json();
      if (!data || !Array.isArray(data.records)) {
        throw new Error("Malformed server response");
      }
      for (const rec of data.records) {
        await idbPut(NOTES_STORE, {
          id: rec.id,
          title: rec.title,
          body: rec.body || "",
          version: rec.version,
          syncStatus: "synced",
          updatedAt: rec.updatedAt,
        });
      }
      await renderUI();
    } catch (err) {
      showError("Failed to fetch notes: " + (err instanceof Error ? err.message : String(err)));
    }
  }

  noteFormEl.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = titleInputEl.value.trim();
    const body = bodyInputEl.value.trim();
    if (!title) return;

    const noteId = makeId("note");
    const idempotencyKey = makeId("idem");
    const now = Date.now();

    const noteRecord = {
      id: noteId,
      title,
      body,
      version: 0,
      syncStatus: "pending",
      updatedAt: now,
      idempotencyKey,
    };

    const queueItem = {
      id: makeId("mut"),
      noteId,
      title,
      body,
      baseVersion: 0,
      idempotencyKey,
      retries: 0,
      createdAt: now,
    };

    await idbPut(NOTES_STORE, noteRecord);
    await idbPut(QUEUE_STORE, queueItem);

    titleInputEl.value = "";
    bodyInputEl.value = "";
    setSyncStatus("Saved locally");
    await renderUI();

    if (navigator.onLine) {
      await syncQueue();
    }
  });

  retrySyncBtn.addEventListener("click", () => {
    void syncQueue();
  });

  refreshServerBtn.addEventListener("click", () => {
    void fetchServerNotes();
  });

  window.addEventListener("online", () => {
    updateNetworkIndicator();
    void syncQueue();
  });

  window.addEventListener("offline", () => {
    updateNetworkIndicator();
  });

  // Expose minimal test hooks on window for advanced conflict tests without faking sync
  window.__offlinelabDemo = {
    syncQueue,
    fetchServerNotes,
    renderUI,
  };

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // SW registration may be blocked in interception mode
    });
  }

  updateNetworkIndicator();
  void renderUI().then(() => {
    if (navigator.onLine) {
      void fetchServerNotes();
    }
  });
})();
