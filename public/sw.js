const CACHE = 'fitcrew-v15';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

// App files: network first, so an update (deploy.cmd) shows up on the very next open and the
// app never runs a mix of old and new files. The cached copy is the offline / slow-network
// fallback (after 3 s). The API is never cached, so data is always live.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Local development: always straight from the server, so code changes show up immediately.
  if (['localhost', '127.0.0.1'].includes(self.location.hostname)) return;
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const net = fetch(e.request, { cache: 'no-cache' }).then((r) => { if (r.ok) cache.put(e.request, r.clone()); return r; }).catch(() => null);
    const slow = new Promise((r) => setTimeout(() => r(null), 3000));
    const res = await Promise.race([net, slow]);
    if (res) return res;
    const hit = await cache.match(e.request);
    if (hit) return hit;
    const late = await net;
    if (late) return late;
    if (e.request.mode === 'navigate') return (await cache.match('/index.html')) ?? Response.error();
    return Response.error();
  })());
});

// Coach check-ins and crew updates arrive as push notifications.
self.addEventListener('push', (e) => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch { m = { title: 'FitCrew', body: e.data?.text() ?? '' }; }
  e.waitUntil(self.registration.showNotification(m.title || 'FitCrew', {
    body: m.body || '', tag: m.tag || 'fitcrew', renotify: false,
    icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', data: { url: m.url || '/#/coach' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = e.notification.data?.url || '/#/coach';
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = wins.find((w) => new URL(w.url).origin === self.location.origin);
    if (open) { await open.focus(); open.navigate(url); } else await self.clients.openWindow(url);
  })());
});
