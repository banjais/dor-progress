const VERSION = "v0.0.0"; // Updated automatically by deploy.sh
console.log(`[Service Worker] Script loaded. Version: ${VERSION}`);

const STATIC_CACHE_NAME = `dor-static-${VERSION}`;
const DATA_CACHE_NAME = "dor-data-v2";
const OFFLINE_URL = "/";

self.addEventListener("install", (event) => {
  event
    .waitUntil(
      caches.open(STATIC_CACHE_NAME).then((cache) => {
        return cache.addAll(["/icons/logo.png", "/manifest.json", OFFLINE_URL]);
      }),
    )
    .then(() => self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (
              cacheName !== STATIC_CACHE_NAME &&
              cacheName !== DATA_CACHE_NAME
            ) {
              console.log(`[Service Worker] Pruning old cache: ${cacheName}`);
              return caches.delete(cacheName);
            }
          }),
        );
      })
      .then(() => self.clients.claim()),
  );
});
