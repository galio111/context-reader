const CACHE_VERSION = "context-reader-v2";
const APP_SHELL = ["/", "/offline.html", "/manifest.webmanifest", "/icon.svg"];
const PUBLIC_ARTICLE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_PUBLIC_ARTICLE_ENTRIES = 50;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const response = await fetch(request);
    if (response.ok) {
      const headers = new Headers(response.headers);
      headers.set("X-SW-Cached-At", String(Date.now()));
      const cachedResponse = new Response(response.clone().body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
      await cache.put(request, cachedResponse);
      const articleRequests = (await cache.keys()).filter((item) => new URL(item.url).pathname.startsWith("/api/public-articles"));
      await Promise.all(articleRequests.slice(0, Math.max(0, articleRequests.length - MAX_PUBLIC_ARTICLE_ENTRIES)).map((item) => cache.delete(item)));
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    const cachedAt = Number(cached?.headers.get("X-SW-Cached-At") ?? 0);
    if (cached && cachedAt > 0 && Date.now() - cachedAt <= PUBLIC_ARTICLE_TTL_MS) {
      return cached;
    }
    if (cached) {
      await cache.delete(request);
    }
    throw new Error("network unavailable");
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) {
    return cached;
  }
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE_VERSION);
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }

  if (url.pathname.startsWith("/api/public-articles")) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (url.pathname.startsWith("/_next/static/") || url.pathname === "/manifest.webmanifest" || url.pathname === "/icon.svg") {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      networkFirst(request).catch(async () => {
        return (await caches.match("/")) || caches.match("/offline.html");
      }),
    );
  }
});
