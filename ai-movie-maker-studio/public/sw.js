/* Service worker: lets the app shell open offline. It NEVER stores API answers, media or any
 * signed-in data (/api, /media, /health are always network-only), so no private data lands in a cache. */
const VERSION = 'v1';
const SHELL_CACHE = `mms-shell-${VERSION}`;
const ASSET_CACHE = `mms-assets-${VERSION}`;
const SHELL_URLS = ['/', '/offline.html', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon.svg'];
const NEVER_CACHE = [/^\/api\//, /^\/media\//, /^\/health$/];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Also cache the hashed JS/CSS the shell page uses, so the app really starts offline.
      let assets = [];
      try {
        const res = await fetch('/', { cache: 'reload' });
        const html = await res.clone().text();
        assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
        await cache.put('/', res);
      } catch (err) {
        /* offline during install: the next online visit installs again */
      }
      await cache.addAll([...SHELL_URLS.filter((u) => u !== '/'), ...assets]);
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, ASSET_CACHE]);
      for (const key of await caches.keys()) if (key.startsWith('mms-') && !keep.has(key)) await caches.delete(key);
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // fonts, Google sign-in, signed storage URLs: browser handles them
  if (NEVER_CACHE.some((re) => re.test(url.pathname))) return; // network only

  // Page navigations: network first, then the cached app shell (single-page app), then the offline page.
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          if (fresh.ok && url.pathname === '/') (await caches.open(SHELL_CACHE)).put('/', fresh.clone());
          return fresh;
        } catch (err) {
          const shell = await caches.match('/');
          return shell || (await caches.match('/offline.html')) || Response.error();
        }
      })()
    );
    return;
  }

  // Hashed build files never change: cache first.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      (async () => {
        const hit = await caches.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) (await caches.open(ASSET_CACHE)).put(req, res.clone());
        return res;
      })()
    );
    return;
  }

  // Everything else on this site (icons, manifest): answer from cache, refresh in the background.
  event.respondWith(
    (async () => {
      const hit = await caches.match(req);
      const network = fetch(req)
        .then(async (res) => {
          if (res.ok) (await caches.open(SHELL_CACHE)).put(req, res.clone());
          return res;
        })
        .catch(() => undefined);
      return hit || (await network) || Response.error();
    })()
  );
});
