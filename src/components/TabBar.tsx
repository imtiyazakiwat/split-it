"use client";

import { usePathname } from "next/navigation";
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { useAuth } from "@/lib/auth-context";
import { usePayments } from "@/lib/payments-context";
import {
  activeKind,
  getTabSnapshot,
  screenKeyFromUrl,
  subscribeTab,
  tabOfPath,
  type TabId,
} from "@/lib/nav-transitions";
import { Icon } from "@/components/kit/Icon";
import { NavLink, useNav } from "@/components/kit/nav";

const TABS: { id: TabId; label: string; href: string; icon: string }[] = [
  { id: "groups", label: "Groups", href: "/", icon: "person.2" },
  { id: "pay", label: "Pay", href: "/pay", icon: "rupee.bubble" },
  { id: "activity", label: "Activity", href: "/activity", icon: "clock" },
  { id: "reports", label: "Reports", href: "/reports", icon: "doc.text" },
  { id: "settings", label: "Settings", href: "/settings", icon: "gear" },
];

/** Full-screen flows own the bottom edge themselves. */
function hidesTabBar(p: string) {
  return p.startsWith("/chat") || p.startsWith("/join") || p === "/share-receipt" || p === "/offline";
}

/**
 * The floating Liquid Glass tab bar. Navigation only — no actions live here.
 *
 * Rendered once by the root layout rather than by every page, so it persists
 * across pushes the way UITabBarController's does: the selection lens slides
 * between tabs instead of the whole bar being rebuilt per route, and the Pay
 * badge is visible from every screen, not only from Pay.
 *
 * Re-tapping the current tab pops to its root, and at the root scrolls to top.
 */
export default function TabBar() {
  const pathname = usePathname();
  const { user } = useAuth();
  const { unreadCount, pendingIncoming, unattributed } = usePayments();
  const nav = useNav();
  const ref = useRef<HTMLElement | null>(null);
  const visible = !!user && !hidesTabBar(pathname);
  // The initial `hidden` is the only one React ever renders; after mount the
  // layout effect owns it, so a leaving animation can finish before hiding.
  const [initiallyHidden] = useState(!visible);
  const wasVisible = useRef(visible);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const was = wasVisible.current;
    wasVisible.current = visible;
    if (visible === was && el.hidden === !visible) return;
    const kind = activeKind();
    if (visible) {
      el.hidden = false;
      el.classList.remove("is-leaving");
      if (!was && kind === "pop") {
        el.classList.add("is-entering");
        window.setTimeout(() => el.classList.remove("is-entering"), 600);
      }
    } else if (was && kind === "push") {
      el.classList.add("is-leaving");
      window.setTimeout(() => {
        el.classList.remove("is-leaving");
        if (!wasVisible.current) el.hidden = true;
      }, 580);
    } else {
      el.hidden = true;
    }
  }, [visible]);

  // Each tab owns its stack: a screen pushed from Groups stays under Groups
  // even if its URL lives elsewhere. The controller knows which stack the
  // screen is in; the URL alone decides on a cold load.
  const owned = useSyncExternalStore(subscribeTab, getTabSnapshot, () => null);
  const tab = owned && owned.path === pathname ? owned.tab : tabOfPath(pathname);
  const activeIndex = TABS.findIndex((t) => t.id === tab);
  const payBadge = unreadCount > 0 || pendingIncoming.length + unattributed.length > 0;

  return (
    <nav ref={ref} aria-label="Tabs" className="tab-bar glass-thick" hidden={initiallyHidden}>
      <div className="tab-bar-items">
        {activeIndex >= 0 && (
          <span
            aria-hidden
            className="tab-lens"
            style={{ width: `${100 / TABS.length}%`, transform: `translateX(${activeIndex * 100}%)` }}
          />
        )}
        {TABS.map((t, i) => {
          const current = i === activeIndex;
          return (
            <NavLink
              key={t.id}
              href={t.href}
              kind="tab"
              hint={false}
              aria-current={current ? "page" : undefined}
              className="tab-item"
              onClick={(e) => {
                if (!current) return;
                e.preventDefault();
                // Compare screens, not paths: a statement (/reports?person=)
                // shares its path with the Reports root.
                if (screenKeyFromUrl(window.location.href) === t.href) {
                  window.scrollTo({ top: 0, behavior: "smooth" });
                } else {
                  nav.toRoot(t.href);
                }
              }}
            >
              <span className="relative inline-flex">
                <Icon name={t.icon} size={25} strokeWidth={current ? 2.1 : 1.8} />
                {t.id === "pay" && payBadge && <span className="tab-badge" aria-label="Needs attention" />}
              </span>
              <span className="tab-item-label">{t.label}</span>
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
