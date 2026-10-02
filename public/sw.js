const CACHE = 'fitcrew-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

// App files: serve the cached copy instantly and refresh it in the background.
// The API is never cached, so data is always live.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(e.request);
    const net = fetch(e.request).then((r) => { if (r.ok) cache.put(e.request, r.clone()); return r; }).catch(() => null);
    if (hit) return hit;
    const res = await net;
    if (res) return res;
    if (e.request.mode === 'navigate') return (await cache.match('/index.html')) ?? Response.error();
    return Response.error();
  })());
});
