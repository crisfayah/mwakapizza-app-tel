const CACHE_NAME = 'mwaka-courses-v1';
const ASSETS = [
  'liste-courses.html',
  'https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&display=swap',
  'https://offres.mwakapizza.fr/logo-mwaka-pizza-blanc.png',
  'https://offres.mwakapizza.fr/logo-mwaka-pizza.png'
];

// Installation : mise en cache des fichiers
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

// Activation : nettoyage des anciens caches
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(names) {
      return Promise.all(
        names.filter(function(n) { return n !== CACHE_NAME; })
             .map(function(n) { return caches.delete(n); })
      );
    })
  );
  self.clients.claim();
});

// Fetch : réseau d'abord, cache en fallback
self.addEventListener('fetch', function(event) {
  // Ne pas cacher les appels Firebase
  if (event.request.url.includes('firebasedatabase.app') ||
      event.request.url.includes('googleapis.com/identitytoolkit') ||
      event.request.url.includes('securetoken.googleapis.com')) {
    return;
  }

  event.respondWith(
    fetch(event.request).then(function(response) {
      // Mettre à jour le cache avec la nouvelle réponse
      if (response.status === 200) {
        var clone = response.clone();
        caches.open(CACHE_NAME).then(function(cache) {
          cache.put(event.request, clone);
        });
      }
      return response;
    }).catch(function() {
      // Hors ligne : servir depuis le cache
      return caches.match(event.request);
    })
  );
});
