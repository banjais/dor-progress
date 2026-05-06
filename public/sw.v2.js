const VERSION = "__VERSION__";
const CHANGELOG = {
  "2.4.0": [
    "Optimized Translation sync: Background Sync support and fingerprint-based revalidation",
  ],
  "2.2.5": [
    "Added automated UI refresh when background data revalidation completes",
  ],
  "2.2.4": [
    "Implemented Stale-While-Revalidate (SWR) for API data with background refresh",
  ],
  "2.2.3": ["Added cryptographic integrity verification for cached API data"],
  "2.2.2": [
    "Implemented smooth Fade Out for background music when narration ends",
  ],
  "2.2.1": [
    "Added smooth Fade transitions for music ducking",
    'Implemented "Voice Only" accessibility mode',
  ],
  "2.2.0": [
    "Implemented Background Music volume control",
    'Added "Voice Over" ducking effect for narration',
  ],
  "2.1.9": [
    "Added Music Selection dropdown and Voice Over (music ducking) effect",
  ],
  "2.1.8": [
    'Implemented offline audio mixing for "baked" background music in exports',
  ],
  "2.1.7": ["Added Background Music toggle for AI Summaries"],
  "2.1.6": ["Added Voice Preview button to settings"],
  "2.1.5": [
    "Added Direct Audio Sharing",
    "Implemented Premium Neural TTS tier",
  ],
  "2.1.4": ['Added "Download Audio" feature for AI summaries (MP3 export)'],
  "2.1.3": ["Added Pitch Control and Pause/Resume for AI Summary narration"],
  "2.1.2": ["Added Speed Control for AI Summary narration"],
  "2.1.1": ["Added Voice Selection for AI Summary narration"],
  "2.1.0": ["Implemented AI Summary Read Aloud feature (Web Speech API)"],
  "2.0.9": ["Added Dark Mode scheduling based on local sunrise/sunset times"],
  "2.0.8": [
    "New Accessibility Suite: High Contrast, Grayscale, and Blue Light filters",
    "Customizable Font Size and System Font options",
  ],
  "2.0.7": ["Enhanced API resilience and structured offline fallbacks"],
  "2.0.6": ["Implemented local font fallbacks for Noto Sans and Roboto"],
  "2.0.5": ["Added offline support for Nepali Devanagari and Roboto fonts"],
  "2.0.4": [
    'Added "Check for Updates" button',
    "Real-time version sync",
    "What's New log",
  ],
  "2.0.3": ["Global Redis caching implementation", "Distributed mutex locks"],
  "2.0.2": ["PWA offline data downloader", "Infrastructure health checks"],
  "2.0.1": ["AI-powered Executive Briefing", "Content fingerprinting"],
  "2.0.0": ["Initial MIS Dashboard release"],
};

const STATIC_CACHE_NAME = "dor-static-v2";
const DATA_CACHE_NAME = "dor-data-v2";
const OFFLINE_URL = "/offline.html";
const API_PREFIX = "/api";
// eslint-disable-next-line no-unused-vars
const BUILD_ID = "__BUILD_ID__";
// eslint-disable-next-line no-unused-vars
const COMMIT_SHA = "__COMMIT_SHA__";
// eslint-disable-next-line no-unused-vars
const MAX_DATA_ITEMS = 50; // Limit cached API responses

let syncFailures = 0;

const ASSETS_TO_CACHE = [
  "/",
  "/index.html",
  "/logo.png",
  "/ambient-focus.mp3", // New track
  "/ambient-calm.mp3", // New track
  // Add more ambient tracks here
  "/translations.json",
  "/manifest.json",
  OFFLINE_URL,
];

/**
 * Centralized Configuration Validator for Service Worker
 * Ensures critical assets and paths are defined before installation.
 */
function validateConfig() {
  const criticalAssets = [
    "/",
    "/index.html",
    "/logo.png",
    "/manifest.json",
    OFFLINE_URL,
  ];

  if (!OFFLINE_URL) {
    console.error("[SW Config] Critical Error: OFFLINE_URL is not defined.");
    return false;
  }

  const missing = criticalAssets.filter(
    (asset) => !ASSETS_TO_CACHE.includes(asset),
  );
  if (missing.length > 0) {
    console.warn(
      `[SW Config] Warning: Missing recommended assets in ASSETS_TO_CACHE: ${missing.join(", ")}`,
    );
    // We return true here as the SW can still function, but with limited offline reliability.
  }

  return true;
}

/**
 * Trims the cache to a specific length to prevent bloat.
 */
// eslint-disable-next-line no-unused-vars
async function trimCache(cacheName, maxItems) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > maxItems) {
    await cache.delete(keys[0]);
    await trimCache(cacheName, maxItems);
  }
}

/**
 * Verifies the integrity of cached data using SHA-256.
 * Prevents serving tampered or corrupted cached responses.
 * @param {Response} response
 * @returns {Promise<boolean>}
 */
async function verifyIntegrity(response) {
  const contentHash = response.headers.get("X-Content-SHA256");
  if (!contentHash) return true; // Legacy support for items without hashes

  try {
    const clone = response.clone();
    const buffer = await clone.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const actualHash = hashArray
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return actualHash === contentHash;
  } catch (err) {
    console.error("[SW Security] Integrity validation failed:", err);
    return false;
  }
}

self.addEventListener("install", (event) => {
  if (!validateConfig()) {
    console.error(
      "[SW Install] Installation aborted due to configuration errors.",
    );
    // Force the service worker to stay in the installing phase (effectively failing)
    return;
  }

  event.waitUntil(
    caches.open(STATIC_CACHE_NAME).then(async (cache) => {
      console.log("[SW] Pre-caching assets...");
      // Use a more resilient approach: cache what we can, log errors for the rest
      return Promise.allSettled(
        ASSETS_TO_CACHE.map((url) =>
          cache
            .add(url)
            .catch((err) => console.warn(`[SW] Failed to cache ${url}:`, err)),
        ),
      );
    }),
  );
  // We no longer skipWaiting automatically to allow the user to trigger the update via the UI banner.
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== STATIC_CACHE_NAME && cache !== DATA_CACHE_NAME) {
            return caches.delete(cache);
          }
        }),
      );
    }),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  // We only care about GET requests for navigation or assets
  if (event.request.method !== "GET") return;

  const url = event.request.url;
  const isApiRequest = new URL(url).pathname.startsWith(API_PREFIX);

  // 1. CSS - Cache-First (Prioritize instant UI rendering)
  if (url.endsWith(".css") || url.includes("fonts.googleapis.com/css")) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        return (
          cachedResponse ||
          fetch(event.request).then((networkResponse) => {
            return caches.open(STATIC_CACHE_NAME).then((cache) => {
              if (networkResponse.ok)
                cache.put(event.request, networkResponse.clone());
              return networkResponse;
            });
          })
        );
      }),
    );
    return;
  }

  // 2. JS - Network-First (Prioritize logic freshness, fallback to cache)
  if (url.endsWith(".js")) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          return caches.open(STATIC_CACHE_NAME).then((cache) => {
            if (networkResponse.ok)
              cache.put(event.request, networkResponse.clone());
            return networkResponse;
          });
        })
        .catch(() => caches.match(event.request)),
    );
    return;
  }

  // 2.5 Translations - Stale-While-Revalidate with Content Fingerprint Check
  if (url.endsWith("/translations.json")) {
    event.respondWith(
      caches.open(STATIC_CACHE_NAME).then(async (cache) => {
        const cachedResponse = await cache.match(event.request);

        const fetchPromise = fetch(event.request).then(
          async (networkResponse) => {
            if (networkResponse.ok) {
              const freshData = await networkResponse.clone().json();
              const cachedData = cachedResponse
                ? await cachedResponse.clone().json()
                : null;

              // Only update cache and notify clients if the content fingerprint has actually changed
              if (
                !cachedData ||
                freshData._metadata?.fingerprint !==
                cachedData._metadata?.fingerprint
              ) {
                await cache.put(event.request, networkResponse.clone());
                notifyClients({
                  action: "translations-updated",
                  fingerprint: freshData._metadata?.fingerprint,
                });
              }
            }
            return networkResponse;
          },
        );

        return cachedResponse || fetchPromise;
      }),
    );
    return;
  }

  // 3. Other Static Assets - Stale-While-Revalidate (Images, Fonts, etc.)
  const isOtherStatic =
    url.startsWith("http") && /\.(?:png|jpg|jpeg|svg|webp|woff2?)$/i.test(url);
  if (isOtherStatic) {
    event.respondWith(
      caches.open(STATIC_CACHE_NAME).then((cache) => {
        return cache.match(event.request).then((cachedResponse) => {
          const fetchPromise = fetch(event.request).then((networkResponse) => {
            if (networkResponse.ok) {
              cache.put(event.request, networkResponse.clone());
            }
            return networkResponse;
          });
          return cachedResponse || fetchPromise;
        });
      }),
    );
    return;
  }

  // 4. API & Data - Stale-While-Revalidate (SWR)
  if (isApiRequest) {
    event.respondWith(
      caches.open(DATA_CACHE_NAME).then(async (cache) => {
        const cachedResponse = await cache.match(event.request);

        // The revalidation logic: Fetch from network and update cache
        const fetchPromise = fetch(event.request)
          .then(async (networkResponse) => {
            if (networkResponse.ok) {
              // Verify integrity before caching
              if (await verifyIntegrity(networkResponse.clone())) {
                await cache.put(event.request, networkResponse.clone());

                // Notify frontend that fresh data is now available in the cache
                notifyClients({
                  action: "api-data-updated",
                  url: event.request.url,
                });
              }
            }
            return networkResponse;
          })
          .catch((err) => {
            console.warn("[SW SWR] Background refresh failed:", err);
            return null; // Don't crash if refresh fails
          });

        // Security & Speed Balance: Use cache if it exists and is fresh enough
        if (cachedResponse && (await verifyIntegrity(cachedResponse))) {
          const dateHeader = cachedResponse.headers.get("date");
          const age = dateHeader
            ? Date.now() - new Date(dateHeader).getTime()
            : 0;
          const isTooStale = age > 24 * 60 * 60 * 1000; // 24 Hours

          if (!isTooStale) {
            // Serve stale data immediately, update in background
            event.waitUntil(fetchPromise);
            const headers = new Headers(cachedResponse.headers);
            headers.set("X-From-Cache", "true");
            headers.set("X-Is-Stale", "true");
            return new Response(cachedResponse.body, {
              status: cachedResponse.status,
              statusText: cachedResponse.statusText,
              headers,
            });
          }
        }

        // If no cache or too stale, wait for the network
        return (
          fetchPromise ||
          new Response(
            JSON.stringify({
              error: "Offline",
              message: "Data is too old or unavailable.",
            }),
            { status: 503, headers: { "Content-Type": "application/json" } },
          )
        );
      }),
    );
    return;
  }

  // 5. Default Navigation/Asset Fallback
  event.respondWith(
    fetch(event.request).catch(() => {
      if (event.request.mode === "navigate") {
        return caches.match(OFFLINE_URL);
      }
      return caches.match(event.request);
    }),
  );
});

self.addEventListener("sync", (event) => {
  if (event.tag === "send-analytics") {
    event.waitUntil(processAnalyticsQueue());
  } else if (event.tag === "sync-translations") {
    event.waitUntil(refreshTranslations());
  }
});

async function refreshTranslations() {
  const cache = await caches.open(STATIC_CACHE_NAME);
  const request = new Request("/translations.json");
  try {
    const response = await fetch(request);
    if (response.ok) {
      const freshData = await response.clone().json();
      const cachedResponse = await cache.match(request);
      const cachedData = cachedResponse ? await cachedResponse.json() : null;

      if (
        !cachedData ||
        freshData._metadata?.fingerprint !== cachedData._metadata?.fingerprint
      ) {
        await cache.put(request, response);
        await notifyClients({
          action: "translations-updated",
          sync: true,
          fingerprint: freshData._metadata?.fingerprint,
        });
      }
    }
  } catch (err) {
    console.warn("[SW Sync] Translation background refresh failed:", err);
  }
}

async function processAnalyticsQueue() {
  await notifyClients({ action: "bg-sync-start" });

  let success = false;
  const db = await openDatabase();
  if (!db) {
    // Database was wiped due to corruption; nothing to sync this cycle.
    await notifyClients({
      action: "bg-sync-end",
      success: "repaired",
      failureCount: ++syncFailures,
    });
    return;
  }

  const tx = db.transaction("analytics", "readonly");
  const store = tx.objectStore("analytics");
  const events = await new Promise((resolve) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
  });

  if (events.length === 0) {
    await notifyClients({ action: "bg-sync-end", success: "no-op" });
    return;
  }

  try {
    // Send all queued events to your Cloudflare Worker endpoint
    await fetch("/api/analytics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events, timestamp: Date.now() }),
    });

    // If successful, clear the queue
    const deleteTx = db.transaction("analytics", "readwrite");
    deleteTx.objectStore("analytics").clear();
    success = true;
    syncFailures = 0;
  } catch (err) {
    console.error("Failed to sync analytics", err);
    syncFailures++;
    throw err; // Browser will retry the sync later
  } finally {
    await notifyClients({
      action: "bg-sync-end",
      success,
      failureCount: syncFailures,
    });
  }
}

/**
 * Helper to communicate with all open dashboard tabs.
 */
async function notifyClients(data) {
  const clients = await self.clients.matchAll({ type: "window" });
  clients.forEach((client) => client.postMessage(data));
}

function openDatabase() {
  return new Promise((resolve) => {
    const request = indexedDB.open("dor_mis_db", 2);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("analytics")) {
        db.createObjectStore("analytics", { autoIncrement: true });
      }
      if (!db.objectStoreNames.contains("metadata")) {
        db.createObjectStore("metadata");
      }
    };
    request.onsuccess = (e) => {
      const db = e.target.result;
      // Final integrity check: if stores are missing despite version match, it is corrupt.
      if (
        !db.objectStoreNames.contains("analytics") ||
        !db.objectStoreNames.contains("metadata")
      ) {
        console.warn("[SW DB] Integrity failure. Wiping for repair.");
        db.close();
        indexedDB.deleteDatabase("dor_mis_db");
        resolve(null);
      } else {
        resolve(db);
      }
    };
    request.onerror = () => {
      console.error("[SW DB] Fatal connection error. Wiping database.");
      indexedDB.deleteDatabase("dor_mis_db");
      resolve(null);
    };
  });
}

/**
 * Listen for messages from the frontend to perform cache maintenance.
 */
self.addEventListener("message", (event) => {
  if (!event.data) return;

  if (event.data.action === "clear-data-cache") {
    event.waitUntil(
      caches.delete(DATA_CACHE_NAME).then(() => {
        console.log("[SW] Data cache cleared per user request.");
      }),
    );
  } else if (event.data.action === "get-changelog") {
    event.ports[0].postMessage({ changelog: CHANGELOG });
  } else if (event.data.action === "get-version") {
    event.ports[0].postMessage({ version: VERSION });
  } else if (event.data.action === "skip-waiting") {
    self.skipWaiting();
  }
});
