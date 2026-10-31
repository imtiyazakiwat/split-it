"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { getAppServiceWorker } from "@/lib/sw-registration";

export default function PwaBootstrap() {
  const pathname = usePathname();
  const { user } = useAuth();
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

    // Through the shared helper so this and push-token acquisition always
    // register the same worker at the same scope. Non-fatal on failure: the app
    // still works, it just loses share-target capture, offline caching and push.
    void getAppServiceWorker();
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
  // Never over sign-in, a composer or a full-screen flow.
  if (!user) return null;
  if (/^\/(chat|join|share-receipt|offline)/.test(pathname)) return null;

  // Sits above the floating tab bar, never on top of it; the page grows its
  // bottom inset (see globals.css) so the last row can still scroll clear.
  return (
    <div
      data-install-banner
      className="glass glass-strong fixed left-4 right-4 max-w-md mx-auto rounded-[22px] pl-4 pr-1.5 py-1.5 flex items-center gap-3 z-30 animate-sheet-up"
      style={{ bottom: "calc(var(--tab-bottom) + var(--tab-h) + 10px)" }}
    >
      <p className="flex-1 t-footnote text-[var(--text-primary)] py-1.5">
        <span className="font-semibold">Install SplitIt.</span> Tap{" "}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="inline -mt-0.5" aria-label="Share">
          <path d="M12 3.5v11M8 7l4-3.5L16 7" />
          <path d="M7.5 10.5H6a1.5 1.5 0 0 0-1.5 1.5v7A1.5 1.5 0 0 0 6 20.5h12a1.5 1.5 0 0 0 1.5-1.5v-7a1.5 1.5 0 0 0-1.5-1.5h-1.5" />
        </svg>{" "}
        then Add to Home Screen to get notifications.
      </p>
      <button
        onClick={() => {
          sessionStorage.setItem("pwa-install-dismissed", "1");
          setState((s) => ({ ...s, dismissed: true }));
        }}
        className="shrink-0 w-[30px] h-[30px] m-[7px] rounded-full bg-[var(--fill)] text-[var(--text-secondary)] grid place-items-center"
        aria-label="Dismiss"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
      </button>
    </div>
  );
}
