"use client";

import { useEffect, useState } from "react";

export default function PwaBootstrap() {
  const [state, setState] = useState({
    mounted: false,
    isIOS: false,
    isStandalone: false,
    dismissed: false,
  });

  useEffect(() => {
    // Runs only on the client, after the initial (SSR-matching) render, so
    // there's no server/client markup mismatch from reading window/navigator.
    // This is intentionally deferred to an effect (rather than computed
    // during render) because `window`/`navigator` don't exist during SSR —
    // computing this eagerly would cause a hydration mismatch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({
      mounted: true,
      // iPadOS 13+ reports a desktop UA ("Macintosh…") with touch — detect it
      // via maxTouchPoints rather than the platform string alone.
      isIOS:
        (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
          (navigator.userAgent.includes("Macintosh") &&
            navigator.maxTouchPoints > 1)) &&
        !("MSStream" in window),
      isStandalone: window.matchMedia("(display-mode: standalone)").matches,
      dismissed: sessionStorage.getItem("pwa-install-dismissed") === "1",
    });

    // Ask the OS to spare our origin under storage pressure (Safari evicts
    // least-recently-used origins when space runs low). Firestore's own
    // persistent cache holds the data; this keeps the evictor off our back.
    if (navigator.storage?.persist) {
      navigator.storage.persist().catch(() => {
        // Best-effort: eviction policy is the OS's call either way.
      });
    }

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        // Non-fatal: app still works without the service worker,
        // just loses share-target file capture and offline caching.
      });
    }
  }, []);

  // Tracks the visible viewport (keyboard, Safari chrome) into --app-height so
  // dvh-backed sheets size to what's actually on screen. Read-only: no layout
  // writes besides the single CSS variable.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const sync = () =>
      document.documentElement.style.setProperty("--app-height", `${vv.height}px`);
    sync();
    vv.addEventListener("resize", sync);
    return () => vv.removeEventListener("resize", sync);
  }, []);

  const { mounted, isIOS, isStandalone, dismissed } = state;

  if (!mounted || isStandalone || dismissed || !isIOS) return null;

  return (
    <div className="glass glass-strong fixed bottom-4 left-4 right-4 max-w-md mx-auto rounded-[var(--radius-lg)] p-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] text-sm flex items-center justify-between gap-3 z-30 animate-modal-in">
      <p className="text-[var(--text-primary)]">
        Install SplitIt: tap Share{" "}
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline -mt-0.5" aria-label="Share">
          <path d="M12 3v13" />
          <path d="m7 8 5-5 5 5" />
          <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
        </svg>{" "}
        then &ldquo;Add to Home Screen&rdquo;.
      </p>
      <button
        onClick={() => {
          sessionStorage.setItem("pwa-install-dismissed", "1");
          setState((s) => ({ ...s, dismissed: true }));
        }}
        className="text-[var(--text-tertiary)] text-lg leading-none tap-shrink shrink-0"
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}
