"use client";

import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useLayoutEffect, useEffect, useRef, useState } from "react";

/** Top-level destinations: switching between them cross-fades (no push). */
const TAB_ROOTS = new Set(["/", "/pay", "/activity", "/reports", "/settings"]);

/**
 * iOS-style routed transitions. Deeper routes slide in from the trailing
 * edge (push), going back slides from the leading edge (pop), tab switches
 * cross-fade. A left-edge drag also pops, like the system swipe-back — gated
 * to touches starting within 20px of the edge, moving mostly horizontally,
 * never while typing or while a sheet is open.
 */
export default function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const stackRef = useRef<string[]>([]);
  const prevRef = useRef(pathname);
  const [direction, setDirection] = useState<"push" | "pop" | "fade">("fade");
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const gestureRef = useRef<{ startX: number; startY: number; active: boolean }>({
    startX: 0,
    startY: 0,
    active: false,
  });

  // Layout effect so the correct animation class is set before paint — one
  // animation per navigation, never a flash of the wrong direction.
  useLayoutEffect(() => {
    const prev = prevRef.current;
    if (prev === pathname) return;
    const stack = stackRef.current;
    if (stack.length >= 2 && stack[stack.length - 2] === pathname) {
      stack.pop();
      setDirection("pop");
    } else {
      if (stack[stack.length - 1] !== prev) stack.push(prev);
      stack.push(pathname);
      if (stack.length > 20) stack.splice(0, stack.length - 20);
      // Tab-to-tab switches never slide: same depth, no hierarchy.
      setDirection(TAB_ROOTS.has(prev) && TAB_ROOTS.has(pathname) ? "fade" : "push");
    }
    prevRef.current = pathname;
  }, [pathname]);

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

  const cls =
    direction === "push" ? "page-push" : direction === "pop" ? "page-pop" : "page-enter";
  return (
    <div key={pathname} ref={wrapRef} className={`${cls} flex-1 flex flex-col min-h-full`}>
      {children}
    </div>
  );
}
