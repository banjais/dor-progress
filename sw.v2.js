const VERSION = '2.2.2';
const CHANGELOG = {
  '2.2.2': ['Implemented smooth Fade Out for background music when narration ends'],
  '2.2.1': ['Added smooth Fade transitions for music ducking', 'Implemented "Voice Only" accessibility mode'],
  '2.2.0': ['Implemented Background Music volume control', 'Added "Voice Over" ducking effect for narration'],
  '2.1.9': ['Added Music Selection dropdown and Voice Over (music ducking) effect'],
  '2.1.8': ['Implemented offline audio mixing for "baked" background music in exports'],
  '2.1.7': ['Added Background Music toggle for AI Summaries'],
  '2.1.6': ['Added Voice Preview button to settings'],
  '2.1.5': ['Added Direct Audio Sharing', 'Implemented Premium Neural TTS tier'],
  '2.1.4': ['Added "Download Audio" feature for AI summaries (MP3 export)'],
  '2.1.3': ['Added Pitch Control and Pause/Resume for AI Summary narration'],
  '2.1.2': ['Added Speed Control for AI Summary narration'],
  '2.1.1': ['Added Voice Selection for AI Summary narration'],
  '2.1.0': ['Implemented AI Summary Read Aloud feature (Web Speech API)'],
  '2.0.9': ['Added Dark Mode scheduling based on local sunrise/sunset times'],
  '2.0.8': ['New Accessibility Suite: High Contrast, Grayscale, and Blue Light filters', 'Customizable Font Size and System Font options'],
  '2.0.7': ['Enhanced API resilience and structured offline fallbacks'],
  '2.0.6': ['Implemented local font fallbacks for Noto Sans and Roboto'],
  '2.0.5': ['Added offline support for Nepali Devanagari and Roboto fonts'],
  '2.0.4': ['Added "Check for Updates" button', 'Real-time version sync', 'What\'s New log'],
  '2.0.3': ['Global Redis caching implementation', 'Distributed mutex locks'],
  '2.0.2': ['PWA offline data downloader', 'Infrastructure health checks'],
  '2.0.1': ['AI-powered Executive Briefing', 'Content fingerprinting'],
  '2.0.0': ['Initial MIS Dashboard release']
};

const STATIC_CACHE_NAME = 'dor-static-v2';
const DATA_CACHE_NAME = 'dor-data-v2';
const OFFLINE_URL = '/offline.html';
const API_BASE = '__API_BASE_URL__';
const BUILD_ID = '__BUILD_ID__';
const COMMIT_SHA = '__COMMIT_SHA__';
const MAX_DATA_ITEMS = 50; // Limit cached API responses

let syncFailures = 0;

const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/logo.png',
  '/ambient-focus.mp3', // New track
  '/ambient-calm.mp3',   // New track
  // Add more ambient tracks here
  '/manifest.json',
  OFFLINE_URL,
  '/fonts/noto-sans-devanagari.woff2',
  '/fonts/roboto.woff2',
  'https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@400;700&display=swap',
  'https://fonts.googleapis.com/css2?family=Roboto:wght@400;700&display=swap'
];

/**
 * Centralized Configuration Validator for Service Worker
 * Ensures critical assets and paths are defined before installation.
 */
function validateConfig() {
  const criticalAssets = ['/', '/index.html', '/logo.png', '/manifest.json', OFFLINE_URL];

  if (!OFFLINE_URL) {
    console.error('[SW Config] Critical Error: OFFLINE_URL is not defined.');
    return false;
  }

  const missing = criticalAssets.filter(asset => !ASSETS_TO_CACHE.includes(asset));
  if (missing.length > 0) {
    console.warn(`[SW Config] Warning: Missing recommended assets in ASSETS_TO_CACHE: ${missing.join(', ')}`);
    // We return true here as the SW can still function, but with limited offline reliability.
  }

  return true;
}

/**
 * Trims the cache to a specific length to prevent bloat.
 */
async function trimCache(cacheName, maxItems) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > maxItems) {
    await cache.delete(keys[0]);
    await trimCache(cacheName, maxItems);
  }
}

self.addEventListener('install', (event) => {
  if (!validateConfig()) {
    console.error('[SW Install] Installation aborted due to configuration errors.');
    // Force the service worker to stay in the installing phase (effectively failing)
    return;
  }

  event.waitUntil(
    caches.open(STATIC_CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  // We no longer skipWaiting automatically to allow the user to trigger the update via the UI banner.
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== STATIC_CACHE_NAME && cache !== DATA_CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // We only care about GET requests for navigation or assets
  if (event.request.method !== 'GET') return;

  const url = event.request.url;

  // 1. CSS - Cache-First (Prioritize instant UI rendering)
  if (url.endsWith('.css') || url.includes('fonts.googleapis.com/css')) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        return cachedResponse || fetch(event.request).then((networkResponse) => {
          return caches.open(STATIC_CACHE_NAME).then((cache) => {
            if (networkResponse.ok) cache.put(event.request, networkResponse.clone());
            return networkResponse;
          });
        });
      })
    );
    return;
  }

  // 2. JS - Network-First (Prioritize logic freshness, fallback to cache)
  if (url.endsWith('.js')) {
    event.respondWith(
      fetch(event.request).then((networkResponse) => {
        return caches.open(STATIC_CACHE_NAME).then((cache) => {
          if (networkResponse.ok) cache.put(event.request, networkResponse.clone());
          return networkResponse;
        });
      }).catch(() => caches.match(event.request))
    );
    return;
  }

  // 3. Other Static Assets - Stale-While-Revalidate (Images, Fonts, etc.)
  const isOtherStatic = url.startsWith('http') && /\.(?:png|jpg|jpeg|svg|webp|woff2?)$/i.test(url);
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
      })
    );
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const isApiRequest = url.startsWith(API_BASE);

        // Handle Server Failures (5xx): Try cache fallback instead of raw error
        if (isApiRequest && !response.ok && response.status >= 500) {
          return caches.match(event.request).then(cached => {
            if (cached) {
              const headers = new Headers(cached.headers);
              headers.set('X-From-Cache', 'true');
              headers.set('X-Cache-Fallback-Reason', 'server-error');
              return new Response(cached.body, { ...cached, headers });
            }
            return response;
          });
        }

        const isSameOrigin = url.startsWith(self.location.origin);
        if (response.ok && (isSameOrigin || isApiRequest)) {
          const copy = response.clone();
          caches.open(DATA_CACHE_NAME).then(cache => {
            cache.put(event.request, copy);
            trimCache(DATA_CACHE_NAME, MAX_DATA_ITEMS);
          });
        }
        return response;
      })
      .catch(() => {
        // If fetch fails (offline), try the cache
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            const headers = new Headers(cachedResponse.headers);
            headers.set('X-From-Cache', 'true');
            headers.set('X-Cache-Fallback-Reason', 'network-offline');
            return new Response(cachedResponse.body, {
              status: cachedResponse.status,
              statusText: cachedResponse.statusText,
              headers
            });
          }

          // If API data is missing and we're offline, return a structured JSON error
          const isApiRequest = event.request.url.startsWith(API_BASE);
          if (isApiRequest) {
            // If the user navigates directly to an API URL in the browser, show the HTML offline page
            if (event.request.mode === 'navigate') {
              return caches.match(OFFLINE_URL);
            }

            // For standard JSON API fetches, return a structured error
            return new Response(JSON.stringify({
              error: 'Connection Unstable',
              message: 'Department of Roads servers are unreachable and no local cache was found.',
              timestamp: new Date().toISOString()
            }), {
              status: 503,
              headers: { 'Content-Type': 'application/json' }
            });
          }

          // If it's a navigation request and not in cache, show offline page
          if (event.request.mode === 'navigate') return caches.match(OFFLINE_URL);
        });
      })
  );
});

self.addEventListener('sync', (event) => {
  if (event.tag === 'send-analytics') {
    event.waitUntil(processAnalyticsQueue());
  }
});

async function processAnalyticsQueue() {
  await notifyClients({ action: 'bg-sync-start' });

  let success = false;
  const db = await openDatabase();
  const tx = db.transaction('analytics', 'readonly');
  const store = tx.objectStore('analytics');
  const events = await new Promise(resolve => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
  });

  if (events.length === 0) {
    await notifyClients({ action: 'bg-sync-end', success: 'no-op' });
    return;
  }

  try {
    // Send all queued events to your Cloudflare Worker endpoint
    await fetch('/api/analytics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events, timestamp: Date.now() })
    });

    // If successful, clear the queue
    const deleteTx = db.transaction('analytics', 'readwrite');
    deleteTx.objectStore('analytics').clear();
    success = true;
    syncFailures = 0;
  } catch (err) {
    console.error('Failed to sync analytics', err);
    syncFailures++;
    throw err; // Browser will retry the sync later
  } finally {
    await notifyClients({ action: 'bg-sync-end', success, failureCount: syncFailures });
  }
}

/**
 * Helper to communicate with all open dashboard tabs.
 */
async function notifyClients(data) {
  const clients = await self.clients.matchAll({ type: 'window' });
  clients.forEach(client => client.postMessage(data));
}

function openDatabase() {
  return new Promise((resolve) => {
    const request = indexedDB.open('dor_mis_db', 2);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('analytics')) {
        db.createObjectStore('analytics', { autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('metadata')) {
        db.createObjectStore('metadata');
      }
    };
    request.onsuccess = (e) => resolve(e.target.result);
  });
}

/**
 * Listen for messages from the frontend to perform cache maintenance.
 */
self.addEventListener('message', (event) => {
  if (!event.data) return;

  if (event.data.action === 'clear-data-cache') {
    event.waitUntil(
      caches.delete(DATA_CACHE_NAME).then(() => {
        console.log('[SW] Data cache cleared per user request.');
      })
    );
  } else if (event.data.action === 'get-changelog') {
    event.ports[0].postMessage({ changelog: CHANGELOG });
  } else if (event.data.action === 'get-version') {
    event.ports[0].postMessage({ version: VERSION });
  } else if (event.data.action === 'skip-waiting') {
    self.skipWaiting();
  }
});