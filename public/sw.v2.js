const VERSION = "v1.0.424"; // Updated automatically by deploy.js

// Parse environment variables passed from the registration script in PWAManager.ts
const swUrl = new URL(self.location);
const MODE = swUrl.searchParams.get("mode") || "production";
const WORKER_BASE = swUrl.searchParams.get("worker_base") || "";

console.log(`[Service Worker] Script loaded. Version: ${VERSION} Mode: ${MODE} WorkerBase: ${WORKER_BASE}`);

const STATIC_CACHE_NAME = `dor-static-v2-${VERSION}`;
const API_CACHE_NAME = `dor-api-v1-${VERSION}`; // Separate cache for API responses
const OFFLINE_URL = "/";
const API_CACHE_EXPIRATION_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Iterates through the API cache and removes entries older than API_CACHE_EXPIRATION_MS.
 */
async function cleanupExpiredApiCache() {
  console.info("[Service Worker] Starting periodic API cache cleanup...");
  const cache = await caches.open(API_CACHE_NAME);
  const keys = await cache.keys();
  const now = Date.now();

  return Promise.all(keys.map(async (request) => {
    const response = await cache.match(request);
    const fetchedOn = response?.headers.get("x-sw-fetched-on");
    if (fetchedOn && (now - parseInt(fetchedOn) > API_CACHE_EXPIRATION_MS)) {
      console.log(`[Service Worker] Pruning expired entry: ${request.url}`);
      return cache.delete(request);
    }
  }));
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE_NAME).then((cache) => {
      return cache.addAll(["/icons/logo.png", "/manifest.json", OFFLINE_URL]);
    })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      // 1. Delete old cache versions (standard cleanup)
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames.map((name) => {
            if (name !== STATIC_CACHE_NAME && name !== API_CACHE_NAME) return caches.delete(name);
          })
        );
      }),
      // 2. Cleanup expired individual entries within the current API cache
      cleanupExpiredApiCache()
    ]).then(() => self.clients.claim())
  );
});

/**
 * Listen for messages from the client to trigger manual cleanup.
 */
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "CLEANUP_EXPIRED_CACHE") {
    event.waitUntil(cleanupExpiredApiCache());
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;

  // Check if the request is for our UI origin or the API Worker origin
  const isUiRequest = request.url.startsWith(self.location.origin);
  const isApiRequest = WORKER_BASE && request.url.startsWith(WORKER_BASE);

  if (!isUiRequest && !isApiRequest) return;

  // Optional: Skip Vite's dev requests even if SW somehow runs
  if (request.url.includes('@vite') || request.url.includes('/src/')) {
    return;
  }

  if (MODE === "development") {
    // In development mode, prioritize network to ensure fresh content.
    // For API requests, we generally want network-only to avoid stale data.
    if (isApiRequest) {
      event.respondWith(
        fetch(request).catch(async () => {
          // If API network fails, and it's a navigation request, fallback to offline UI
          if (request.mode === "navigate") {
            return caches.match(OFFLINE_URL);
          }
          return new Response("API Network error", { status: 503, statusText: "Service Unavailable" });
        })
      );
    } else if (isUiRequest) {
      // For UI assets, network-first with cache fallback
      event.respondWith(
        fetch(request)
          .then(async (response) => {
            // Cache successful responses for offline fallback
            const cache = await caches.open(STATIC_CACHE_NAME);
            await cache.put(request, response.clone());
            return response;
          })
          .catch(async () => {
            // If network fails, try cache
            const cachedResponse = await caches.match(request);
            if (cachedResponse) return cachedResponse;
            // Fallback to offline page for navigation requests if nothing else works
            if (request.mode === "navigate") {
              return caches.match(OFFLINE_URL);
            }
            return new Response("Network error or no cached content", { status: 503, statusText: "Service Unavailable" });
          })
      );
    }
  } else {
    // In production mode, optimize for performance and offline access.
    // Cache-first for UI assets, network-first with cache fallback for API.
    if (isApiRequest) {
      // Stale-while-revalidate strategy for API requests
      event.respondWith(
        caches.open(API_CACHE_NAME).then(async (cache) => {
          const cachedResponse = await cache.match(request);

          // Fetch from network in the background
          const networkFetch = fetch(request)
            .then(async (response) => {
              if (response.ok) {
                // Add a timestamp header to track cache age
                const headers = new Headers(response.headers);
                headers.set("x-sw-fetched-on", Date.now().toString());
                const responseToCache = new Response(response.clone().body, {
                  status: response.status,
                  statusText: response.statusText,
                  headers,
                });
                await cache.put(request, responseToCache);
              }
              return response;
            })
            .catch((error) => {
              console.error(`[Service Worker] API network fetch failed for ${request.url}:`, error);

              const fetchedOn = cachedResponse?.headers.get("x-sw-fetched-on");
              const isExpired = fetchedOn && (Date.now() - parseInt(fetchedOn) > API_CACHE_EXPIRATION_MS);

              // If network fails and no cached response was available,
              // or the cache is expired, provide a fallback.
              if (!cachedResponse || isExpired) {
                if (request.mode === "navigate") {
                  return caches.match(OFFLINE_URL);
                }
                return new Response(`API Network error${isExpired ? ' (Expired Cache)' : ''}`, { status: 503, statusText: "Service Unavailable" });
              }
              // If cachedResponse was returned, this error is for background update.
              // We don't need to respond with it, but we should log it.
              throw error; // Re-throw to ensure waitUntil catches it if needed
            });

          // If a cached response is available, return it immediately.
          const fetchedOn = cachedResponse?.headers.get("x-sw-fetched-on");
          const isExpired = fetchedOn && (Date.now() - parseInt(fetchedOn) > API_CACHE_EXPIRATION_MS);

          if (cachedResponse && !isExpired) {
            event.waitUntil(networkFetch); // Update the cache in the background
            return cachedResponse;
          }

          // If no cached response or cache is expired, wait for the network.
          return networkFetch;
        })
      );
    } else if (isUiRequest) {
      // Cache-first, then network for UI assets
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
    }
  }
});