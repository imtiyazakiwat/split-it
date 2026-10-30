"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLayoutEffect, useRef, useState } from "react";
import NavHint from "@/components/NavHint";
import { useAuth } from "@/lib/auth-context";
import { usePayments } from "@/lib/payments-context";

type Tab = "groups" | "pay" | "activity" | "reports" | "profile";

function GroupsIcon({ active }: { active: boolean }) {
  return active ? (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="9" cy="7.5" r="3.8" />
      <path d="M1.8 19.6C2.4 15.8 5.2 13.6 9 13.6s6.6 2.2 7.2 6c.1.6-.4 1.1-1 1.1H2.8c-.6 0-1.1-.5-1-1.1Z" />
      <path d="M16.2 4.2a3.6 3.6 0 0 1 0 6.7 5.2 5.2 0 0 0 0-6.7ZM18.6 13.9c2 .8 3.3 2.6 3.6 5.6.1.6-.4 1.2-1 1.2h-2.4c.2-.4.3-.8.2-1.3-.2-2.2-.4-3.9-1.8-5.5h1.4Z" />
    </svg>
  ) : (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="9" cy="7.5" r="3.6" />
      <path d="M2.5 20c.6-3.7 3.2-5.7 6.5-5.7s5.9 2 6.5 5.7" />
      <path d="M16 4.3a3.4 3.4 0 0 1 0 6.5M18.4 14.6c1.8.7 2.9 2.5 3.1 5.4" />
    </svg>
  );
}

function PayIcon({ active }: { active: boolean }) {
  return active ? (
    <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden>
      <path fill="currentColor" d="M12 3C6.8 3 2.5 6.7 2.5 11.3c0 2.3 1 4.4 2.8 5.9l-.9 3c-.2.6.5 1.1 1 .8l3.4-1.8c1 .3 2.1.4 3.2.4 5.2 0 9.5-3.7 9.5-8.3S17.2 3 12 3Z" />
      <path fill="none" stroke="var(--surface)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" d="M9.3 7.8h5.4M9.3 10.3h5.4M10.6 7.8c1.9 0 2.8.8 2.8 2.5s-1.1 2.5-2.8 2.5H9.4l3.6 3.1" />
    </svg>
  ) : (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3.5c-5 0-9 3.5-9 7.8 0 2.2 1 4.2 2.8 5.6l-.9 3.1 3.6-1.8c1.1.3 2.3.5 3.5.5 5 0 9-3.5 9-7.8S17 3.5 12 3.5Z" />
      <path d="M9.3 7.8h5.4M9.3 10.3h5.4M10.6 7.8c1.9 0 2.8.8 2.8 2.5s-1.1 2.5-2.8 2.5H9.4l3.6 3.1" />
    </svg>
  );
}

function ActivityIcon({ active }: { active: boolean }) {
  return active ? (
    <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="9.5" fill="currentColor" />
      <path d="M12 6.8V12l3.4 2.1" fill="none" stroke="var(--surface)" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) : (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 6.8V12l3.4 2.1" />
    </svg>
  );
}

function StatementsIcon({ active }: { active: boolean }) {
  return active ? (
    <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden>
      <path fill="currentColor" d="M7 2.8h6.6c.4 0 .8.2 1.1.4l4.4 4.4c.3.3.4.7.4 1.1V19.5A1.7 1.7 0 0 1 17.8 21.2H7a1.7 1.7 0 0 1-1.7-1.7v-15A1.7 1.7 0 0 1 7 2.8Z" />
      <path fill="none" stroke="var(--surface)" strokeWidth="1.6" strokeLinecap="round" d="M9 12.5h6.5M9 16h6.5" />
    </svg>
  ) : (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M7 3.3h6.8l4.9 4.9v11.3a1.4 1.4 0 0 1-1.4 1.4H7a1.4 1.4 0 0 1-1.4-1.4V4.7A1.4 1.4 0 0 1 7 3.3Z" />
      <path d="M13.5 3.5v5h5M9 12.5h6.5M9 16h6.5" />
    </svg>
  );
}

function SettingsIcon({ active }: { active: boolean }) {
  return active ? (
    <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden>
      <path fill="currentColor" fillRule="evenodd" d="M10.3 2.5h3.4l.6 2.7c.6.2 1.2.5 1.7.9l2.6-.9 1.7 2.9-2 1.9c.1.6.1 1.3 0 2l2 1.9-1.7 2.9-2.6-.9c-.5.4-1.1.7-1.7.9l-.6 2.7h-3.4l-.6-2.7c-.6-.2-1.2-.5-1.7-.9l-2.6.9L3.7 15.9l2-1.9a6.4 6.4 0 0 1 0-2l-2-1.9 1.7-2.9 2.6.9c.5-.4 1.1-.7 1.7-.9l.6-2.7Zm1.7 6.3a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 0 0 0-6.4Z" />
    </svg>
  ) : (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden>
      <path d="M10.4 3h3.2l.6 2.6c.6.2 1.2.6 1.7 1l2.5-.9 1.6 2.8-2 1.8c.1.6.1 1.3 0 1.9l2 1.8-1.6 2.8-2.5-.9c-.5.4-1.1.8-1.7 1l-.6 2.6h-3.2l-.6-2.6c-.6-.2-1.2-.6-1.7-1l-2.5.9L4 14l2-1.8a6 6 0 0 1 0-1.9L4 8.5l1.6-2.8 2.5.9c.5-.4 1.1-.8 1.7-1l.6-2.6Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

const ITEMS: { id: Tab; label: string; href: string; Icon: (p: { active: boolean }) => React.ReactElement }[] = [
  { id: "groups", label: "Groups", href: "/", Icon: GroupsIcon },
  { id: "pay", label: "Pay", href: "/pay", Icon: PayIcon },
  { id: "activity", label: "Activity", href: "/activity", Icon: ActivityIcon },
  { id: "reports", label: "Statements", href: "/reports", Icon: StatementsIcon },
  { id: "profile", label: "Settings", href: "/settings", Icon: SettingsIcon },
];

/** Which tab owns a route. Pushed screens keep their parent tab selected. */
function tabFor(pathname: string): Tab | null {
  if (pathname === "/" || pathname.startsWith("/groups") || pathname.startsWith("/notifications")) return "groups";
  if (pathname.startsWith("/pay") || pathname.startsWith("/chat")) return "pay";
  if (pathname.startsWith("/activity")) return "activity";
  if (pathname.startsWith("/reports")) return "reports";
  if (pathname.startsWith("/settings")) return "profile";
  return null;
}

/** Routes that are full-screen flows: no tab bar. */
function hidesTabBar(pathname: string): boolean {
  return (
    pathname.startsWith("/chat") ||
    pathname.startsWith("/join") ||
    pathname.startsWith("/share-receipt") ||
    pathname.startsWith("/offline")
  );
}

/**
 * iOS 26/27 floating tab bar: a Liquid Glass capsule, navigation only.
 * Rendered once in the root layout so it persists across pushes instead of
 * remounting per screen. The selected tab gets a filled glyph, tinted label
 * and a lens that slides between tabs. Re-tapping the active tab scrolls to
 * the top (or pops to the tab root from a pushed screen, via its href).
 */
export default function BottomNav() {
  const pathname = usePathname();
  const { user } = useAuth();
  const { unreadCount, pendingIncoming, unattributed } = usePayments();
  const active = tabFor(pathname);
  const barRef = useRef<HTMLDivElement | null>(null);
  const [lens, setLens] = useState<{ x: number; w: number } | null>(null);
  const index = ITEMS.findIndex((i) => i.id === active);

  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar || index < 0) return;
    const measure = () => {
      const link = bar.querySelectorAll<HTMLElement>("a")[index];
      if (link) setLens({ x: link.offsetLeft, w: link.offsetWidth });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(bar);
    return () => ro.disconnect();
  }, [index, user]);

  if (!user || !active || hidesTabBar(pathname)) return null;
  const payBadge = unreadCount > 0 || pendingIncoming.length + unattributed.length > 0;

  return (
    <>
      <div className="scroll-edge-bottom" aria-hidden />
      <nav
        aria-label="Tabs"
        className="fixed inset-x-0 z-20 pointer-events-none flex justify-center px-5"
        style={{ bottom: "var(--tab-bottom)" }}
      >
        <div
          ref={barRef}
          className="liquid-tab pointer-events-auto relative flex items-stretch w-full max-w-[420px] p-1"
          style={{ height: "var(--tab-h)" }}
        >
          {lens && index >= 0 && (
            <span aria-hidden className="tab-lens" style={{ left: 0, width: lens.w, transform: `translateX(${lens.x}px)` }} />
          )}
          {ITEMS.map(({ id, label, href, Icon }) => {
            const isActive = id === active;
            const isRoot = pathname === href;
            return (
              <Link
                key={id}
                href={href}
                aria-current={isActive ? "page" : undefined}
                onClick={(e) => {
                  if (isActive && isRoot) {
                    e.preventDefault();
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }
                }}
                className={`flex-1 min-w-0 flex flex-col items-center justify-center gap-[3px] rounded-full ${
                  isActive ? "text-[var(--brand)]" : "text-[var(--text-primary)]"
                }`}
              >
                <span className="relative shrink-0 h-[26px] flex items-center">
                  <Icon active={isActive} />
                  {id === "pay" && payBadge && (
                    <span className="absolute -top-0.5 -right-1 h-[10px] w-[10px] rounded-full bg-[var(--red)] ring-2 ring-[var(--surface)]" aria-label="Needs attention" />
                  )}
                  <NavHint variant="dot" />
                </span>
                <span className={`w-full truncate text-center text-[10px] leading-[12px] ${isActive ? "font-semibold" : "font-medium"}`}>
                  {label}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
