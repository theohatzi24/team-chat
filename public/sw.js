// Service Worker: hält die App Hülle offline verfügbar, API läuft immer live
const CACHE = 'teamchat-v1';
const SHELL = ['/', '/index.html', '/app.js', '/style.css', '/manifest.webmanifest', '/icon-192.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/api/') || e.request.method !== 'GET') return;
  // Netz zuerst, bei Funkloch aus dem Cache
  e.respondWith(fetch(e.request).then(r => {
    const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r;
  }).catch(() => caches.match(e.request)));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(list => list.length ? list[0].focus() : self.clients.openWindow('/')));
});
