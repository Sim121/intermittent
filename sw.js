// Version incrémentée à chaque déploiement — le navigateur détecte le changement automatiquement
const CACHE_VERSION = 'intermittent-v4';
const ASSETS = ['./', './index.html', './manifest.json', './utils.js', './bilan.js', './contrats.js', './scan.js', './app.js', './style.css'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_VERSION).then(c => c.addAll(ASSETS))
  );
  // Force l'activation immédiate sans attendre la fermeture des onglets
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)))
    )
  );
  // Prend le contrôle de tous les onglets immédiatement
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // Ne jamais mettre en cache les appels API
  if (e.request.url.includes('anthropic.com') ||
      e.request.url.includes('script.google.com') ||
      e.request.url.includes('workers.dev') ||
      e.request.url.includes('googleapis.com') ||
      e.request.url.includes('accounts.google.com')) {
    return;
  }

  // Pour les fichiers de l'app : network first, cache fallback
  // → toujours essayer de charger la dernière version depuis GitHub
  if (e.request.url.includes('sim121.github.io')) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          // Met à jour le cache avec la nouvelle version
          const clone = res.clone();
          caches.open(CACHE_VERSION).then(c => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request)) // Fallback cache si hors-ligne
    );
    return;
  }

  // Fonts Google : cache first
  if (e.request.url.includes('fonts.googleapis.com') ||
      e.request.url.includes('fonts.gstatic.com')) {
    e.respondWith(
      caches.match(e.request).then(r => r || fetch(e.request).then(res => {
        const clone = res.clone();
        caches.open(CACHE_VERSION).then(c => c.put(e.request, clone));
        return res;
      }))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});
