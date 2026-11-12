const CACHE_PREFIX = 'kairopont-shell-';
const CACHE_NAME = `${CACHE_PREFIX}v5-${'offline-build-version'}`;
const APP_ROOT = new URL('./', self.registration.scope).toString();
const OFFLINE_FILES = /* offline-build-files */ [];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll([APP_ROOT, ...OFFLINE_FILES.map((file) => new URL(file, APP_ROOT).href)]))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== 'GET' || url.origin !== self.location.origin || !url.href.startsWith(APP_ROOT)) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const controller = new AbortController();
      const deadline = setTimeout(() => controller.abort(), 4000);
      try {
        return await fetch(request, { signal: controller.signal });
      } catch {
        return (await (await caches.open(CACHE_NAME)).match(APP_ROOT)) || Response.error();
      } finally {
        clearTimeout(deadline);
      }
    })());
    return;
  }

  if (!url.pathname.startsWith(new URL('assets/', APP_ROOT).pathname) && url.href !== new URL('manifest.webmanifest', APP_ROOT).href) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Static files are identical for every request to this origin.
    const precached = await cache.match(request, { ignoreVary: true });
    if (precached) return precached;
    try {
      const response = await fetch(request);
      if (response.ok && response.type === 'basic') {
        await cache.put(request, response.clone());
      }
      return response;
    } catch { return Response.error(); }
  })());
});
