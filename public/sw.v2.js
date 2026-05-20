const VERSION = "v1.0.333"; // Updated automatically by deploy.js
console.log(`[Service Worker] Script loaded. Version: ${VERSION}`);

const STATIC_CACHE_NAME = `dor-static-v2-${VERSION}`;
const OFFLINE_URL = "/";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE_NAME).then((cache) => {
      return cache.addAll(["/icons/logo.png", "/manifest.json", OFFLINE_URL]);
    })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (name !== STATIC_CACHE_NAME) return caches.delete(name);
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;
  if (!request.url.startsWith(self.location.origin)) return;

  // Optional: Skip Vite's dev requests even if SW somehow runs
  if (request.url.includes('@vite') || request.url.includes('/src/')) {
    return;
  }

  event.respondWith(
    caches.match(request).then((response) => {
      if (response) return response;
      return fetch(request).catch(() => {
        if (request.mode === "navigate") {
          return caches.match(OFFLINE_URL);
        }
      });
    })
  );
});