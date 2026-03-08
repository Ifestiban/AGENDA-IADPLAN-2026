
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open('iadplan-agenda-v2').then(cache => cache.addAll([
      './',
      './index.html',
      './styles.css',
      './app.js',
      './manifest.json',
      './icon-192.png',
      './icon-512.png'
    ]))
  );
});
self.addEventListener('fetch', event => {
  event.respondWith(caches.match(event.request).then(resp => resp || fetch(event.request)));
});
