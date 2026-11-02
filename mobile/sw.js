/* =====================================================================
 * АРКЕОН · G2.5 · Service Worker
 * Офлайн-кэш телефонного вертикального среза. Только тот же источник,
 * только GET, без аналитики и без сетевых зависимостей извне.
 * ===================================================================== */
'use strict';
const VERSION = 'arkeon-g25-v1';
const CACHE = 'arkeon-g2-' + VERSION;
const SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/game.js',
  './manifest.webmanifest',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './README.md',
  './css/g2.css',
  './css/g1-link.css',
  './g1.html',
  './js/data.js',
  './js/world.js',
  './js/rpg.js',
  './js/render.js',
  './js/net.js',
  './js/audio.js',
  './js/market.js',
  './js/main.js',
  './js/game.js',
  '../data/classes.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => Promise.allSettled(SHELL.map((u) => cache.add(new Request(u, { cache: 'reload' })))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('arkeon-g') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // внешних CDN в проекте нет

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put('./index.html', copy));
        return res;
      }).catch(() => caches.match('./index.html'))
    );
    return;
  }

  // stale-while-revalidate для кода и данных, cache-first для статики
  event.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => hit || Response.error());
      return hit || net;
    })
  );
});
