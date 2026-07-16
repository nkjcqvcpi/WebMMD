// SPDX-License-Identifier: AGPL-3.0-or-later
const CACHE_NAME = "webmmd-cache-v1";
const ASSETS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png",
  "/NOTICE.md",
  "/THIRD_PARTY_NOTICES.md",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    }),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        }),
      );
    }),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  // Only handle GET requests and exclude Chrome extensions or external API calls
  if (
    event.request.method !== "GET" ||
    !event.request.url.startsWith(self.location.origin)
  ) {
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Fetch fresh in background to update cache
        fetch(event.request)
          .then((networkResponse) => {
            if (networkResponse.status === 200) {
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(event.request, networkResponse);
              });
            }
          })
          .catch(() => {
            /* Ignore network failures */
          });
        return cachedResponse;
      }

      return fetch(event.request)
        .then((networkResponse) => {
          if (
            !networkResponse ||
            networkResponse.status !== 200 ||
            networkResponse.type !== "basic"
          ) {
            return networkResponse;
          }
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
          return networkResponse;
        })
        .catch(() => {
          // Offline fallback if index.html request fails
          if (event.request.mode === "navigate") {
            return caches.match("/index.html");
          }
        });
    }),
  );
});
