const CACHE = "gasball-shell-v3";
const SHELL = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/stations.json",
  "/forecast-snapshot.json",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/lib/signal.js",
  "/lib/geo.js",
  "/lib/calibration.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => Promise.all(SHELL.map((url) => cache.add(url).catch(() => null)))));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))));
  self.clients.claim();
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return caches.match("/forecast-snapshot.json");
    return caches.match("/index.html");
  }
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET") return;
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname === "/forecast-snapshot.json") {
    event.respondWith(networkFirst(event.request));
    return;
  }
  event.respondWith(caches.match(event.request).then((hit) => hit || networkFirst(event.request)));
});
