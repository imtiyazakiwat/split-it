// SplitIt service worker
// Handles: (1) Web Share Target interception so shared images can be
// picked up by the /share-receipt page, (2) basic install lifecycle.

const SHARE_CACHE = "share-target-cache";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (event.request.method === "POST" && url.pathname === "/api/share-target") {
    event.respondWith(handleShareTarget(event.request));
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
