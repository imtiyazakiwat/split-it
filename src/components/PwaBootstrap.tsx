"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "@/components/kit/Icon";

/** Only on the Groups screen, where it's least in the way, once per session. */
const HINT_ROUTES = new Set(["/"]);

export default function PwaBootstrap() {
  const pathname = usePathname();
  const [state, setState] = useState({
    mounted: false,
    isIOS: false,
    isStandalone: false,
    dismissed: false,
  });

  useEffect(() => {
    // Deferred to an effect (not computed during render) because window and
    // navigator don't exist during SSR; reading them eagerly would cause a
    // hydration mismatch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({
      mounted: true,
      // iPadOS 13+ reports a desktop UA ("Macintosh…") with touch.
      isIOS:
        (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
          (navigator.userAgent.includes("Macintosh") && navigator.maxTouchPoints > 1)) &&
        !("MSStream" in window),
      isStandalone: window.matchMedia("(display-mode: standalone)").matches,
      dismissed: sessionStorage.getItem("pwa-install-dismissed") === "1",
    });

    // Ask the OS to spare our origin under storage pressure. Firestore's own
    // persistent cache holds the data; this keeps the evictor off it.
    if (navigator.storage?.persist) {
      navigator.storage.persist().catch(() => {});
    }

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        // Non-fatal: the app works without it, minus share-target and offline.
      });
    }
  }, []);

  // Tracks the visible viewport into --app-height (keyboard and Safari chrome
  // included) and the keyboard's overlap into --kb-inset, so bottom sheets can
  // sit above an iOS keyboard instead of behind it. Read-only apart from the
  // two CSS variables.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    const sync = () => {
      root.style.setProperty("--app-height", `${vv.height}px`);
      const overlap = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      root.style.setProperty("--kb-inset", `${Math.round(overlap)}px`);
      // Where the visible area starts when iOS pans the page for the keyboard,
      // so a full-height screen (the conversation) can track it exactly.
      root.style.setProperty("--vv-top", `${Math.round(Math.max(0, vv.offsetTop))}px`);
    };
    sync();
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
    return () => {
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
    };
  }, []);

  const { mounted, isIOS, isStandalone, dismissed } = state;
  if (!mounted || isStandalone || dismissed || !isIOS || !HINT_ROUTES.has(pathname)) return null;

  return (
    <div className="install-hint glass-thick rise-in" role="note">
      <Image src="/icon-192.png" alt="" width={40} height={40} className="h-10 w-10 shrink-0 rounded-[10px]" />
      <p className="t-footnote min-w-0 flex-1 text-label">
        <span className="block font-semibold">Install SplitIt</span>
        <span className="text-label-2">
          Tap <Icon name="share" size={14} className="-mt-0.5 inline" /> then “Add to Home Screen”.
        </span>
      </p>
      <button
        type="button"
        onClick={() => {
          sessionStorage.setItem("pwa-install-dismissed", "1");
          setState((s) => ({ ...s, dismissed: true }));
        }}
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-label-2"
        aria-label="Dismiss"
      >
        <Icon name="xmark" size={18} strokeWidth={2.2} />
      </button>
    </div>
  );
}
