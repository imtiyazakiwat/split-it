// SplitIt service worker — the ONLY one this app registers.
//
// Handles: (1) Web Share Target interception so shared images can be picked up
// by the /share-receipt page, (2) install lifecycle, (3) an offline shell:
// versioned precache of install-critical assets plus a network-first navigation
// strategy that falls back to /offline, and (4) push notifications.
//
// Why push lives here and not in a separate worker: a scope can hold exactly one
// service worker registration. The app used to register this file AND
// /firebase-messaging-sw.js, both at scope "/", so each registration replaced
// the other. This file calls skipWaiting(), so it won every launch — and it had
// no push handler. The server sends data-only messages (to avoid duplicate
// notifications), and a data-only push only appears if a handler calls
// showNotification. With no handler, notifications silently never showed.
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

// ── Push notifications ─────────────────────────────────────────────────────

/**
 * Only same-origin absolute paths may be opened from a notification. The server
 * already restricts links this way; checking again here means a malformed or
 * hostile payload can never turn a tap into a redirect off-site.
 */
function safeLink(value) {
  if (typeof value !== "string") return "/";
  const link = value.trim();
  if (!link.startsWith("/") || link.startsWith("//")) return "/";
  return link;
}

/**
 * Reads a push payload into { title, options }.
 *
 * FCM delivers a data-only message as JSON shaped { data: {...}, from, ... }.
 * A `notification` block (older senders) and a bare top-level object are also
 * accepted, so a payload shape change degrades to a generic notification rather
 * than to silence.
 */
function readPush(event) {
  let raw = {};
  if (event.data) {
    try {
      raw = event.data.json() || {};
    } catch {
      try {
        raw = { body: event.data.text() };
      } catch {
        raw = {};
      }
    }
  }
  const data = raw && typeof raw.data === "object" && raw.data ? raw.data : {};
  const note =
    raw && typeof raw.notification === "object" && raw.notification ? raw.notification : {};

  const title = data.title || note.title || raw.title || "SplitIt";
  const options = {
    body: data.body || note.body || raw.body || "",
    icon: "/icon-192.png",
    badge: "/favicon-32.png",
    data: { link: safeLink(data.link || raw.link) },
  };
  // Repeats of the same message replace each other instead of stacking up.
  const tag = data.tag || raw.tag;
  if (typeof tag === "string" && tag) options.tag = tag;
  return { title, options };
}

self.addEventListener("push", (event) => {
  const { title, options } = readPush(event);
  // Always show something. WebKit revokes the push subscription of a site
  // whose pushes aren't user-visible, and Chrome substitutes a generic "this
  // site has been updated in the background" notice. Showing it even when the
  // app is open is what native apps do on iOS too.
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const target = new URL(safeLink(data.link), self.location.origin).href;

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        try {
          // Focus first: the click's user activation is what permits it, and it
          // must be spent before any other await.
          const focused = await client.focus();
          if (focused && "navigate" in focused) await focused.navigate(target);
          return;
        } catch {
          // An uncontrolled client can't be navigated; open a fresh window.
        }
      }
      if (self.clients.openWindow) await self.clients.openWindow(target);
    })()
  );
});
