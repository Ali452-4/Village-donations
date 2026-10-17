// Service Worker: تخزين مؤقت للواجهة + طلبات GET مع بديل للشبكة
const CACHE = 'village-donations-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/about.html',
  '/style.css',
  '/app.js',
  '/admin.js',
  '/admin.html',
  '/about.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  // ملفات ثابتة: من الكاش أولا ثم تحديثه
  if (ASSETS.includes(url.pathname)) {
    e.respondWith(
      caches.match(e.request).then(hit => {
        const net = fetch(e.request).then(res => {
          caches.open(CACHE).then(c => c.put(e.request, res.clone()));
          return res;
        }).catch(() => hit);
        return hit || net;
      })
    );
    return;
  }

  // API: الشبكة فقط (البيانات يجب أن تكون حديثة)
  if (url.pathname.startsWith('/api/')) return;

  // الصفحات: الشبكة، ثم الكاش عند انقطاع الإنترنت
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then(hit => hit || caches.match('/index.html')))
  );
});