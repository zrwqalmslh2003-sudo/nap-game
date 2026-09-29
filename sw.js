var CACHE_NAME = "nap-game-20260930h";
var LOCAL_ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-512-maskable.png",
  "./css/reset.css?v=20260930h",
  "./css/variables.css?v=20260930h",
  "./css/style.css?v=20260930h",
  "./js/normalization.js?v=20260930h",
  "./js/letters.js?v=20260930h",
  "./js/dictionary.js?v=20260930h",
  "./js/validation.js?v=20260930h",
  "./js/scoring.js?v=20260930h",
  "./js/beep.js?v=20260930h",
  "./js/game.js?v=20260930h",
  "./js/online.js?v=20260930h",
  "./js/app.js?v=20260930h",
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return Promise.all(LOCAL_ASSETS.map(function (url) {
        return cache.add(url).catch(function (e) {
          console.warn("precache skipped:", url, e);
        });
      }));
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (key) { return key !== CACHE_NAME; }).map(function (key) { return caches.delete(key); }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener("message", function (event) {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

// Network-first: always try the server for the freshest files, and fall back to
// the cache only when offline. (Cache-first made the refresh button reload stale files.)
self.addEventListener("fetch", function (event) {
  if (event.request.method !== "GET") return;

  var requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;

  var isNav = event.request.mode === "navigate";
  var networkRequest = isNav
    ? new Request(event.request.url, { cache: "no-cache", credentials: "same-origin" })
    : new Request(event.request, { cache: "no-cache" });

  event.respondWith(
    fetch(networkRequest).then(function (response) {
      if (response && response.status === 200 && response.type === "basic") {
        var copy = response.clone();
        caches.open(CACHE_NAME).then(function (cache) { cache.put(isNav ? "./index.html" : event.request, copy); });
      }
      return response;
    }).catch(function () {
      return caches.match(isNav ? "./index.html" : event.request).then(function (cached) {
        return cached || (isNav ? caches.match("./") : null) || Response.error();
      });
    })
  );
});
