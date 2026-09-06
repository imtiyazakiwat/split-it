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
      isIOS: /iPad|iPhone|iPod/.test(navigator.userAgent) && !("MSStream" in window),
      isStandalone: window.matchMedia("(display-mode: standalone)").matches,
      dismissed: sessionStorage.getItem("pwa-install-dismissed") === "1",
    });

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
      <p className="text-[var(--label-primary)]">
        Install SplitIt: tap Share <span aria-hidden>⎋</span> then &ldquo;Add to Home Screen&rdquo;.
      </p>
      <button
        onClick={() => {
          sessionStorage.setItem("pwa-install-dismissed", "1");
          setState((s) => ({ ...s, dismissed: true }));
        }}
        className="text-[var(--label-tertiary)] text-lg leading-none tap-shrink shrink-0"
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}
