var CACHE_NAME = "nap-game-20260929b";
var LOCAL_ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-512-maskable.png",
  "./css/reset.css",
  "./css/variables.css",
  "./css/style.css",
  "./js/normalization.js",
  "./js/letters.js?v=20260929b",
  "./js/dictionary.js",
  "./js/validation.js",
  "./js/scoring.js?v=20260929b",
  "./js/game.js?v=20260929b",
  "./js/online.js?v=20260929b",
  "./js/app.js?v=20260929b",
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(LOCAL_ASSETS);
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

self.addEventListener("fetch", function (event) {
  if (event.request.method !== "GET") return;

  var requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then(function (cached) {
      if (cached) return cached;
      return fetch(event.request).then(function (response) {
        if (!response || response.status !== 200 || response.type !== "basic") return response;
        var copy = response.clone();
        caches.open(CACHE_NAME).then(function (cache) { cache.put(event.request, copy); });
        return response;
      });
    }).catch(function () {
      if (event.request.mode === "navigate") return caches.match("./index.html");
      return Response.error();
    })
  );
});
