// চিত্রপট সার্ভিস ওয়ার্কার: অ্যাপ হিসেবে ইনস্টল করা যায়, নেট না থাকলে অফলাইন পাতা দেখায়।
// API আর ভিডিও/ছবি কখনো জমা রাখে না, সবসময় সার্ভার থেকে আসে।
const CACHE = 'chitropot-v6';
const STATIC = ['/offline.html', '/offline.js', '/logo.png', '/icon-192.png', '/icon-512.png', '/manifest.webmanifest', '/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/media/')) return;

  if (req.mode === 'navigate') {
    // পাতা: আগে নেট থেকে, না পেলে অফলাইন পাতা
    e.respondWith(fetch(req).catch(() => caches.match('/offline.html')));
    return;
  }
  if (STATIC.includes(url.pathname)) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req)));
  }
});
