// تسجيل Service Worker (PWA) — آمن للتشغيل من file:// أو عند تعذّر التسجيل
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}