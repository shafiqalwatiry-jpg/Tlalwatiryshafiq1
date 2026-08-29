/**
 * Service Worker for Tilawatak Lil-Alem (تلاوتك للعالم)
 * Strategies:
 * - Static Assets (HTML, JS, CSS, fonts, logos): Stale-While-Revalidate (GET only)
 * - Audio & Media Assets: Cache-First (GET only)
 * - Supabase REST / Auth / Dynamic API: Network-Only (NEVER cache dynamic data in SW to prevent stale state in WebView)
 */

const CACHE_NAME = 'tilawatak-v3-cache';
const AUDIO_CACHE_NAME = 'tilawatak-audio-cache';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll([
        '/',
        '/index.html',
        '/favicon.ico',
        '/logo.png'
      ]).catch(() => {});
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME && key !== AUDIO_CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Only handle GET requests in Cache Storage; bypass everything else
  if (event.request.method !== 'GET') {
    return;
  }

  const url = new URL(event.request.url);

  // 1. Supabase REST API, RPC, Auth, and Realtime: ALWAYS Network-Only (Bypass SW Cache)
  // SyncEngine & DatabaseService in JavaScript handle enterprise offline and persistence
  if (
    url.hostname.includes('supabase.co') &&
    (url.pathname.includes('/rest/') || url.pathname.includes('/auth/') || url.pathname.includes('/realtime/'))
  ) {
    return; // Let browser / WebView execute standard fresh network fetch
  }

  if (url.pathname.startsWith('/api/')) {
    return; // Pass dynamic backend API directly to network
  }

  // 2. Audio & Media files: Cache-First strategy
  if (
    url.pathname.match(/\.(mp3|wav|m4a|aac|ogg|flac|mp4|webm|jpg|jpeg|png|webp|svg|ico)$/i) ||
    url.hostname.includes('supabase.co/storage')
  ) {
    event.respondWith(
      caches.open(AUDIO_CACHE_NAME).then(async (cache) => {
        const cachedResponse = await cache.match(event.request);
        if (cachedResponse) {
          // Fetch update in background
          fetch(event.request)
            .then((networkResponse) => {
              if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
                cache.put(event.request, networkResponse.clone());
              }
            })
            .catch(() => {});
          return cachedResponse;
        }

        try {
          const networkResponse = await fetch(event.request);
          if (networkResponse && networkResponse.status === 200) {
            cache.put(event.request, networkResponse.clone());
          }
          return networkResponse;
        } catch (error) {
          return new Response('Network error or offline', { status: 503, statusText: 'Offline' });
        }
      })
    );
    return;
  }

  // 3. Static App Shell (HTML, CSS, JS, fonts): Stale-While-Revalidate
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, networkResponse.clone());
            });
          }
          return networkResponse;
        })
        .catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});

