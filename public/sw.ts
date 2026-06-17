// Service Worker for MYLO Music - Offline Support & Caching

const CACHE_NAME = 'mylo-music-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/src/main.tsx',
  '/src/styles/index.css'
];

// Install event - cache static assets
self.addEventListener('install', (event: any) => {
  console.log('Service Worker installing...');
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(STATIC_ASSETS);
      self.skipWaiting();
    })()
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event: any) => {
  console.log('Service Worker activating...');
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames.map(name => {
          if (name !== CACHE_NAME) {
            return caches.delete(name);
          }
        })
      );
      self.clients.claim();
    })()
  );
});

// Fetch event - network-first for API, cache-first for assets
self.addEventListener('fetch', (event: any) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip cross-origin requests
  if (url.origin !== location.origin) {
    return;
  }

  // Cache first strategy for static assets
  if (request.method === 'GET' && isStaticAsset(url.pathname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(request);
        if (cached) {
          return cached;
        }

        try {
          const response = await fetch(request);
          if (response.ok) {
            const responseCopy = response.clone();
            cache.put(request, responseCopy);
          }
          return response;
        } catch {
          return new Response('Offline - Asset not cached', { status: 503 });
        }
      })()
    );
  }
});

function isStaticAsset(pathname: string): boolean {
  const staticExtensions = [
    '.js',
    '.css',
    '.png',
    '.jpg',
    '.svg',
    '.woff',
    '.woff2'
  ];
  return staticExtensions.some(ext => pathname.endsWith(ext));
}
