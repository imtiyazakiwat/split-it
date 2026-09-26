"use client";

import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useLayoutEffect, useEffect, useRef, useState } from "react";

/** Top-level destinations: switching between them cross-fades (no push). */
const TAB_ROOTS = new Set(["/", "/pay", "/activity", "/reports", "/settings"]);

/** How long the outgoing layer stays mounted. Must exceed --dur-route. */
const EXIT_MS = 450;

type Direction = "push" | "pop" | "fade";

/**
 * iOS-style routed transitions with both views mounted through the move:
 * incoming travels full width while outgoing parallaxes to -32% and dims —
 * that continuity is what reads as a push rather than a pan. Tab switches
 * cross-fade (same depth, no hierarchy). A left-edge drag also pops, like the
 * system swipe-back — gated to touches starting within 20px of the edge,
 * moving mostly horizontally, never while typing or while a sheet is open.
 */
export default function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const stackRef = useRef<string[]>([]);
  const prevChildrenRef = useRef<ReactNode>(children);
  const [direction, setDirection] = useState<Direction>("fade");
  const [outgoing, setOutgoing] = useState<{ key: string; node: ReactNode } | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gestureRef = useRef<{ startX: number; startY: number; active: boolean }>({
    startX: 0,
    startY: 0,
    active: false,
  });

  const prevRef = useRef(pathname);
  // Layout effect so the correct animation class is set before paint — one
  // animation per navigation, never a flash of the wrong direction.
  useLayoutEffect(() => {
    const prev = prevRef.current;
    if (prev === pathname) {
      prevChildrenRef.current = children;
      return;
    }
    const stack = stackRef.current;
    let dir: Direction;
    if (stack.length >= 2 && stack[stack.length - 2] === pathname) {
      stack.pop();
      dir = "pop";
    } else {
      if (stack[stack.length - 1] !== prev) stack.push(prev);
      stack.push(pathname);
      if (stack.length > 20) stack.splice(0, stack.length - 20);
      // Tab-to-tab switches never slide: same depth, no hierarchy.
      dir = TAB_ROOTS.has(prev) && TAB_ROOTS.has(pathname) ? "fade" : "push";
    }
    // Hold the departing view for the outgoing half of the move. Effects in
    // the old tree stay alive for EXIT_MS — reads, not writes, so nothing
    // fires twice that matters.
    setOutgoing({ key: prev, node: prevChildrenRef.current });
    prevChildrenRef.current = children;
    prevRef.current = pathname;
    setDirection(dir);
    if (exitTimer.current) clearTimeout(exitTimer.current);
    exitTimer.current = setTimeout(() => setOutgoing(null), EXIT_MS);
  }, [pathname, children]);

  useEffect(() => () => {
    if (exitTimer.current) clearTimeout(exitTimer.current);
  }, []);

  // Interactive edge-swipe back.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    let raf = 0;

    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t || t.clientX > 20) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      if (document.body.hasAttribute("data-sheet-open")) return;
      if (TAB_ROOTS.has(window.location.pathname)) return;
      gestureRef.current = { startX: t.clientX, startY: t.clientY, active: true };
    };
    const onTouchMove = (e: TouchEvent) => {
      const g = gestureRef.current;
      if (!g.active || !el) return;
      const t = e.touches[0];
      if (!t) return;
      const dx = t.clientX - g.startX;
      const dy = Math.abs(t.clientY - g.startY);
      if (dx < 0 || dy > dx * 0.6) {
        g.active = false;
        el.style.transform = "";
        return;
      }
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (el) el.style.transform = `translateX(${Math.min(dx, 120)}px)`;
      });
    };
    const onTouchEnd = (e: TouchEvent) => {
      const g = gestureRef.current;
      if (!g.active || !el) return;
      g.active = false;
      cancelAnimationFrame(raf);
      const t = e.changedTouches[0];
      const dx = t ? t.clientX - g.startX : 0;
      el.style.transition = "transform 0.25s cubic-bezier(0.32,0.72,0,1)";
      if (dx > 96) {
        el.style.transform = "translateX(40px)";
        el.style.opacity = "0.4";
        setTimeout(() => router.back(), 60);
      } else {
        el.style.transform = "";
      }
      setTimeout(() => {
        if (el) {
          el.style.transition = "";
          el.style.transform = "";
          el.style.opacity = "";
        }
      }, 300);
    };

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: true });
    document.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      cancelAnimationFrame(raf);
    };
  }, [router]);

  const incomingCls =
    direction === "push" ? "page-push-in" : direction === "pop" ? "page-pop-in" : "page-enter";
  const outgoingCls =
    direction === "push" ? "page-push-out" : direction === "pop" ? "page-pop-out" : "page-fade-out";
  return (
    <div key={pathname} ref={wrapRef} className="route-stage flex-1 flex flex-col min-h-full">
      <div className={`route-incoming flex-1 flex flex-col min-h-full ${incomingCls}`}>
        {children}
      </div>
      {outgoing && (
        <div key={outgoing.key} aria-hidden className={`route-outgoing ${outgoingCls}`}>
          {outgoing.node}
        </div>
      )}
    </div>
  );
}
