"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { beginSwipe, cancelSwipe, canSwipeBack, commitSwipe, updateSwipe } from "@/lib/nav-transitions";

const EDGE = 24;
const COMMIT_PROGRESS = 0.4;
const COMMIT_VELOCITY = 520; // px/s

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/**
 * Interactive swipe-back from the left edge, the way a UINavigationController
 * pops: the screen follows the finger 1:1 with the previous screen parallaxing
 * in beneath it; release past 40% (or with a flick) to go back, otherwise it
 * springs home.
 *
 * Installed-app only. In a browser tab Safari and Chrome own this gesture and
 * already animate it, and two back navigations from one swipe would be worse
 * than none. Disabled while a sheet is open, while typing, and inside rows
 * that have their own horizontal swipe.
 */
export default function EdgeSwipe() {
  const router = useRouter();

  useEffect(() => {
    if (!isStandalone()) return;
    let s: {
      x0: number;
      y0: number;
      active: boolean;
      lastX: number;
      lastT: number;
      v: number;
    } | null = null;

    const onMove = (e: TouchEvent) => {
      if (!s) return;
      const t = e.touches[0];
      if (!t) return;
      const dx = t.clientX - s.x0;
      const dy = t.clientY - s.y0;
      if (!s.active) {
        if (Math.abs(dy) > 12 && Math.abs(dy) > dx) {
          stop();
          return;
        }
        if (dx < 10 || dx < Math.abs(dy) * 1.4) return;
        s.active = true;
        beginSwipe();
      }
      e.preventDefault();
      const now = e.timeStamp;
      const dt = Math.max(1, now - s.lastT);
      s.v = ((t.clientX - s.lastX) / dt) * 1000;
      s.lastX = t.clientX;
      s.lastT = now;
      updateSwipe(dx, window.innerWidth);
    };

    const stop = () => {
      document.removeEventListener("touchmove", onMove);
      s = null;
    };

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      if (t.clientX > EDGE || !canSwipeBack()) return;
      if (document.body.dataset.sheetOpen) return;
      const target = e.target as HTMLElement | null;
      // Rows with swipe actions only take leftward drags, so the edge gesture
      // still works over them — unless one is open, when a rightward drag
      // belongs to the row (it closes it).
      if (target?.closest("input, textarea, select, [contenteditable], .swipe-row[data-open]")) return;
      s = { x0: t.clientX, y0: t.clientY, active: false, lastX: t.clientX, lastT: e.timeStamp, v: 0 };
      // Non-passive only for the life of an edge touch, so ordinary scrolling
      // never waits on this listener.
      document.addEventListener("touchmove", onMove, { passive: false });
    };

    const onEnd = (e: TouchEvent) => {
      const g = s;
      stop();
      if (!g || !g.active) return;
      const t = e.changedTouches[0];
      const dx = (t?.clientX ?? g.lastX) - g.x0;
      const progress = dx / window.innerWidth;
      const commit =
        e.type !== "touchcancel" &&
        (progress > COMMIT_PROGRESS || (g.v > COMMIT_VELOCITY && dx > 30)) &&
        g.v > -200;
      if (commit) commitSwipe(Math.max(g.v, 0), (href) => router.replace(href));
      else cancelSwipe();
    };

    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchend", onEnd, { passive: true });
    document.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onEnd);
      document.removeEventListener("touchmove", onMove);
    };
  }, [router]);

  return null;
}
