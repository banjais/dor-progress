const VERSION = "v1.0.333"; // Updated automatically by deploy.js
console.log(`[Service Worker] Script loaded. Version: ${VERSION}`);

const STATIC_CACHE_NAME = `dor-static-v2-${VERSION}`;
// const DATA_CACHE_NAME = "dor-data-v2";
const OFFLINE_URL = "/";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE_NAME).then((cache) => {
      return cache.addAll(["/icons/logo.png", "/manifest.json", OFFLINE_URL]);
    }),
  );
});

self.addEventListener("activate", () => {
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  // Handle fetch events for offline support
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});
