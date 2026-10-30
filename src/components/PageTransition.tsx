"use client";

import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useLayoutEffect, useEffect, useRef, useState } from "react";

/** Top-level destinations: switching between them cross-fades (no push). */
export const TAB_ROOTS = new Set(["/", "/pay", "/activity", "/reports", "/settings"]);

/** How long the outgoing layer stays mounted. Must exceed --dur-route. */
const EXIT_MS = 500;

type Direction = "push" | "pop" | "fade" | "none";

/**
 * In-app navigation stack, shared with the back buttons so "Back" returns to
 * the screen the user actually came from (a group opened from Activity goes
 * back to Activity, not Groups).
 */
const navStack: string[] = [];

export function previousPath(): string | null {
  return navStack.length >= 2 ? navStack[navStack.length - 2] : null;
}

/**
 * iOS-style routed transitions with both views mounted through the move:
 * incoming travels full width while outgoing parallaxes to −30 % and dims.
 * Tab switches cross-fade (same depth, no hierarchy).
 *
 * Interactive edge-swipe back: touches starting within 22 px of the left
 * edge follow the finger 1:1; release past 40 % of the width or with a fast
 * flick commits, otherwise the screen springs back.
 *
 * `key={pathname}` remounts the routed tree per navigation and the outgoing
 * tree stays mounted for EXIT_MS. That cost is measured and accepted (see
 * scripts/bench-render.mjs); the previous screen is not kept alive between
 * navigations, so the swipe reveals the page background, and the previous
 * screen appears when the gesture commits.
 */
export default function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const prevChildrenRef = useRef<ReactNode>(children);
  const [direction, setDirection] = useState<Direction>("none");
  const [outgoing, setOutgoing] = useState<{ key: string; node: ReactNode } | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const swipeCommitted = useRef(false);
  const gestureRef = useRef({ startX: 0, startY: 0, lastX: 0, lastT: 0, v: 0, active: false, locked: false });

  const prevRef = useRef(pathname);
  useLayoutEffect(() => {
    if (navStack.length === 0) navStack.push(pathname);
    const prev = prevRef.current;
    if (prev === pathname) {
      prevChildrenRef.current = children;
      return;
    }
    let dir: Direction;
    if (navStack.length >= 2 && navStack[navStack.length - 2] === pathname) {
      navStack.pop();
      dir = "pop";
    } else if (TAB_ROOTS.has(pathname) && TAB_ROOTS.has(prev)) {
      // Switching tabs resets the stack to that tab's root.
      navStack.length = 0;
      navStack.push(pathname);
      dir = "fade";
    } else {
      if (navStack[navStack.length - 1] !== prev) navStack.push(prev);
      navStack.push(pathname);
      if (navStack.length > 20) navStack.splice(0, navStack.length - 20);
      dir = "push";
    }
    if (swipeCommitted.current) {
      // The gesture already moved the old screen off; don't replay it.
      swipeCommitted.current = false;
      dir = "none";
      setOutgoing(null);
    } else {
      setOutgoing({ key: prev, node: prevChildrenRef.current });
    }
    prevChildrenRef.current = children;
    prevRef.current = pathname;
    setDirection(dir);
    if (exitTimer.current) clearTimeout(exitTimer.current);
    exitTimer.current = setTimeout(() => setOutgoing(null), EXIT_MS);
  }, [pathname, children]);

  useEffect(
    () => () => {
      if (exitTimer.current) clearTimeout(exitTimer.current);
    },
    []
  );

  // Interactive edge-swipe back.
  useEffect(() => {
    let raf = 0;
    const el = () => wrapRef.current?.querySelector<HTMLElement>(".route-incoming") ?? null;

    const reset = (node: HTMLElement | null) => {
      if (!node) return;
      node.style.transition = "";
      node.style.transform = "";
      node.style.boxShadow = "";
    };

    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t || t.clientX > 22) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      if (document.body.hasAttribute("data-sheet-open")) return;
      if (TAB_ROOTS.has(window.location.pathname)) return;
      gestureRef.current = { startX: t.clientX, startY: t.clientY, lastX: t.clientX, lastT: e.timeStamp, v: 0, active: true, locked: false };
    };
    const onTouchMove = (e: TouchEvent) => {
      const g = gestureRef.current;
      if (!g.active) return;
      const t = e.touches[0];
      if (!t) return;
      const dx = t.clientX - g.startX;
      const dy = Math.abs(t.clientY - g.startY);
      if (!g.locked) {
        if (dy > 10 && dy > Math.abs(dx)) {
          g.active = false;
          return;
        }
        if (dx > 8) g.locked = true;
        else return;
      }
      const dt = Math.max(1, e.timeStamp - g.lastT);
      g.v = ((t.clientX - g.lastX) / dt) * 1000;
      g.lastX = t.clientX;
      g.lastT = e.timeStamp;
      const node = el();
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (!node) return;
        node.style.transition = "none";
        node.style.transform = `translateX(${Math.max(0, dx)}px)`;
        node.style.boxShadow = "-10px 0 30px rgba(0,0,0,0.12)";
      });
    };
    const onTouchEnd = () => {
      const g = gestureRef.current;
      if (!g.active) return;
      g.active = false;
      cancelAnimationFrame(raf);
      const node = el();
      if (!node || !g.locked) return reset(node);
      const width = window.innerWidth;
      const dx = g.lastX - g.startX;
      const commit = dx > width * 0.4 || (g.v > 520 && dx > 20);
      node.style.transition = "transform 0.32s cubic-bezier(0.32,0.72,0,1)";
      if (commit) {
        node.style.transform = `translateX(${width}px)`;
        swipeCommitted.current = true;
        setTimeout(() => {
          const prev = previousPath();
          if (prev) router.push(prev);
          else router.back();
        }, 200);
        setTimeout(() => reset(el()), 700);
      } else {
        node.style.transform = "translateX(0)";
        setTimeout(() => reset(node), 340);
      }
    };

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: true });
    document.addEventListener("touchend", onTouchEnd, { passive: true });
    document.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("touchcancel", onTouchEnd);
      cancelAnimationFrame(raf);
    };
  }, [router]);

  const incomingCls =
    direction === "push" ? "page-push-in" : direction === "pop" ? "page-pop-in" : direction === "fade" ? "page-enter" : "";
  const outgoingCls =
    direction === "push" ? "page-push-out" : direction === "pop" ? "page-pop-out" : "page-fade-out";
  return (
    <div
      ref={wrapRef}
      className={`route-stage flex-1 flex flex-col min-h-full ${direction === "pop" ? "is-pop" : ""}`}
    >
      <div key={pathname} className={`route-incoming flex-1 flex flex-col min-h-full ${incomingCls}`}>
        {children}
      </div>
      {outgoing && (
        <div key={outgoing.key} aria-hidden inert className={`route-outgoing ${outgoingCls}`}>
          {outgoing.node}
        </div>
      )}
    </div>
  );
}
