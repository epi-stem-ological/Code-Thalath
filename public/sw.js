/* Thalath Space service worker — offline shell + push. */
const CACHE = 'tspace-v3';
const SHELL = [
  '/css/site.css?v=3',
  '/js/app.js?v=3',
  '/img/nopic.svg',
  '/img/icon.svg',
  '/offline.html',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // never cache live things
  if (url.pathname.startsWith('/im/') && url.pathname.endsWith('/stream')) return;
  if (url.pathname.startsWith('/push/')) return;

  const isStatic = /^\/(css|js|img|uploads)\//.test(url.pathname);

  if (isStatic) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((resp) => {
        if (resp.ok && resp.type === 'basic') {
          const copy = resp.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return resp;
      }).catch(() => hit))
    );
    return;
  }

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match(req).then((hit) => hit || caches.match('/offline.html')))
    );
  }
});

self.addEventListener('push', (event) => {
  let data = { title: 'Thalath Space', body: 'Something happened.', url: '/home' };
  try { if (event.data) data = Object.assign(data, event.data.json()); } catch (e) {
    if (event.data) data.body = event.data.text();
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/img/icon-192.png',
      badge: '/img/badge.png',
      tag: data.tag || undefined,
      renotify: !!data.tag,
      data: { url: data.url || '/home' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/home';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
