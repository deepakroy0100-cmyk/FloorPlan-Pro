// FloorPlan Pro — Service Worker
// Caches all files for offline use

const CACHE = 'floordraft-v1';
const FILES = [
  '/FloorPlan-Pro/',
  '/FloorPlan-Pro/index.html',
  '/FloorPlan-Pro/style.css',
  '/FloorPlan-Pro/script.js',
  '/FloorPlan-Pro/manifest.json',
  '/FloorPlan-Pro/icon-192.png',
  '/FloorPlan-Pro/icon-512.png',
  'https://fonts.googleapis.com/icon?family=Material+Icons',
  'https://fonts.googleapis.com/css2?family=Rajdhani:wght@500;700&family=Inter:wght@400;500&display=swap'
];

// Install — cache everything
self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE).then(function(cache) {
      return cache.addAll(FILES.filter(function(f){ return !f.startsWith('https://fonts'); }));
    })
  );
  self.skipWaiting();
});

// Activate — delete old caches
self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.filter(function(k){ return k !== CACHE; }).map(function(k){ return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

// Fetch — serve from cache, fallback to network
self.addEventListener('fetch', function(e) {
  e.respondWith(
    caches.match(e.request).then(function(cached) {
      if (cached) return cached;
      return fetch(e.request).then(function(response) {
        // Cache new responses for same-origin requests
        if (e.request.url.startsWith(self.location.origin)) {
          var clone = response.clone();
          caches.open(CACHE).then(function(cache){ cache.put(e.request, clone); });
        }
        return response;
      }).catch(function() {
        // Offline fallback
        if (e.request.destination === 'document') {
          return caches.match('/FloorPlan-Pro/index.html');
        }
      });
    })
  );

});
