'use strict';
// Service worker : l'appli (HTML/CSS/JS) marche hors ligne ; les questions
// viennent d'internet et sont mises en cache par l'appli elle-même (IndexedDB).
const VERSION = 'qp-v3';
const SHELL = ['./', 'index.html', 'style.css', 'pop.js', 'data.js', 'app.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  // réseau d'abord (pour recevoir les mises à jour), cache en secours
  e.respondWith(
    fetch(req, { cache: 'no-cache' }).then(res => { // no-cache : on revalide toujours, pour recevoir les mises à jour
      const copy = res.clone();
      caches.open(VERSION).then(c => c.put(req, copy));
      return res;
    }).catch(() => caches.match(req).then(r => r || caches.match('index.html')))
  );
});
