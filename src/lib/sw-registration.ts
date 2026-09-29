/**
 * The one place the app registers its service worker.
 *
 * Both the PWA bootstrap and push-token acquisition go through here, so they
 * always ask for the same script at the same scope. That is the whole fix for
 * notifications never arriving: a scope holds a single registration, and the
 * app used to register two different scripts at "/" from two different places,
 * each replacing the other. Registering the same URL twice is harmless — the
 * browser returns the existing registration and just checks for an update.
 */

const SCRIPT_URL = "/sw.js";
const SCOPE = "/";

/**
 * How long to wait for the worker to become active before handing back the
 * registration anyway. `navigator.serviceWorker.ready` never settles if the
 * worker fails to install, and push-token acquisition must not hang forever on
 * it — pushManager.subscribe will then fail with a real, reportable error.
 */
const READY_TIMEOUT_MS = 10_000;

let pending: Promise<ServiceWorkerRegistration | null> | null = null;

export function getAppServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return Promise.resolve(null);
  }
  if (pending) return pending;

  pending = navigator.serviceWorker
    .register(SCRIPT_URL, { scope: SCOPE })
    .then((registration) =>
      Promise.race([
        navigator.serviceWorker.ready,
        new Promise<ServiceWorkerRegistration>((resolve) =>
          setTimeout(() => resolve(registration), READY_TIMEOUT_MS)
        ),
      ])
    )
    .catch((err) => {
      console.error("[sw] registration failed:", err);
      // Allow a later call to retry rather than caching the failure forever.
      pending = null;
      return null;
    });

  return pending;
}
