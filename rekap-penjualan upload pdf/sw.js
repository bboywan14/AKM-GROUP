/* Service worker: membuat aplikasi bisa di-install dan cepat dibuka.
   Hanya file aplikasi (milik sendiri) yang disimpan. Data penjualan TIDAK
   pernah disimpan di sini; selalu diambil langsung dari Google dengan login. */
const VERSION = 'akm-v4';
const SHELL = [
  './', 'index.html', 'styles.css', 'app.js', 'form.js', 'pdfparse.js', 'drive.js', 'writer.js', 'logic.js', 'config.js',
  'manifest.webmanifest', 'icons/logo.png', 'icons/icon-192.png', 'icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* Network-first untuk file sendiri: perubahan (mis. config.js) langsung terpakai,
   dan cache dipakai saat offline. Permintaan ke domain lain tidak disentuh. */
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('index.html')))
  );
});
