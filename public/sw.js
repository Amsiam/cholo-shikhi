// Service worker (US9.1, US9.2; BR17.5, BR17.6). Caches ONLY the public app shell and static assets:
// never API responses, authenticated pages, personal data or signed video URLs. A new version waits
// until the page asks it to take over (the "Update" button); it never reloads the app by itself.
const CACHE = 'cs-static-v1';
const PRECACHE = ['/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      ),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const isStatic =
    event.request.method === 'GET' &&
    url.origin === self.location.origin &&
    (url.pathname.startsWith('/assets/') || PRECACHE.includes(url.pathname));
  if (!isStatic) return; // Pages and APIs always go to the network.
  event.respondWith(
    caches.match(event.request).then(
      (hit) =>
        hit ||
        fetch(event.request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE).then((cache) => cache.put(event.request, copy));
          }
          return response;
        }),
    ),
  );
});
