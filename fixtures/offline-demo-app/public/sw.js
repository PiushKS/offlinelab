const CACHE_VERSION = "offlinelab-demo-v1";
const SHELL_ASSETS = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/manifest.webmanifest",
  "/offline.html",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== CACHE_VERSION)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Never cache API calls in the SW; let app handle offline queuing explicitly
  if (url.pathname.startsWith("/api/")) {
    return;
  }

  // Navigation requests: network-first, fall back to cached shell for `/` or `/offline.html` for uncached routes
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok && (url.pathname === "/" || url.pathname === "/index.html")) {
            const clone = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(async () => {
          const cache = await caches.open(CACHE_VERSION);
          if (url.pathname === "/" || url.pathname === "/index.html") {
            const cachedShell = await cache.match("/") || await cache.match("/index.html");
            if (cachedShell) return cachedShell;
          }
          const exact = await cache.match(request);
          if (exact) return exact;
          const fallback = await cache.match("/offline.html");
          return fallback || new Response("Offline", { status: 503, statusText: "Offline" });
        }),
    );
    return;
  }

  // Static shell assets: cache-first with network fallback
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request);
    }),
  );
});
