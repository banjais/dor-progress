const VERSION = "v0.0.0"; // Updated automatically by deploy.sh
console.log(`[Service Worker] Script loaded. Version: ${VERSION}`);

const STATIC_CACHE_NAME = "dor-static-v2";
const DATA_CACHE_NAME = "dor-data-v2";
const OFFLINE_URL = "/";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE_NAME).then((cache) => {
      return cache.addAll(["/icons/logo.png", "/manifest.json", OFFLINE_URL]);
    }),
  );
});

self.addEventListener("activate", (event) => {
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
