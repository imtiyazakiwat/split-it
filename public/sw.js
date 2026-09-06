// SplitIt service worker
// Handles: (1) Web Share Target interception so shared images can be
// picked up by the /share-receipt page, (2) install lifecycle, (3) an offline
// shell: versioned precache of install-critical assets plus a network-first
// navigation strategy that falls back to /offline. Online behaviour is
// unchanged — the network is always tried first; the cache only speaks when
// the network can't.
//
// Deliberately NOT cached: Firestore traffic (the SDK's own persistent cache
// already serves last-known data offline) and /api/* (never cache writes).

const SHELL_CACHE = "splitit-shell-v1";
const SHARE_CACHE = "share-target-cache";

// Install-critical only: manifest + icons. Lean on purpose — iOS evicts fat
// caches first, and content pages are network-first with fallback anyway.
const PRECACHE = [
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-icon.png",
  "/offline",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .catch(() => {
        // Best-effort: a failed precache must never block activation.
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== SHELL_CACHE && k !== SHARE_CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (event.request.method === "POST" && url.pathname === "/api/share-target") {
    event.respondWith(handleShareTarget(event.request));
    return;
  }

  // Only same-origin GETs past this point: no Firestore, no /api reads.
  if (event.request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }
  if (url.pathname.startsWith("/api/")) return;

  // Navigations: network first (never serve a stale shell after a deploy),
  // cached page next, /offline last.
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(event.request, copy));
          return res;
        })
        .catch(() =>
          caches.match(event.request).then((hit) => hit || caches.match("/offline"))
        )
    );
    return;
  }

  // Versioned build assets are content-hashed: cache-first is safe.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(event.request).then(
        (hit) =>
          hit ||
          fetch(event.request).then((res) => {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(event.request, copy));
            return res;
          })
      )
    );
  }
});

async function handleShareTarget(request) {
  try {
    const formData = await request.formData();
    const file = formData.get("receipt");

    if (file && typeof file !== "string") {
      const cache = await caches.open(SHARE_CACHE);
      await cache.put(
        "shared-receipt",
        new Response(file, { headers: { "Content-Type": file.type || "image/jpeg" } })
      );
    }
  } catch {
    // If parsing fails, fall through to a normal redirect below.
  }

  return Response.redirect("/share-receipt", 303);
}
