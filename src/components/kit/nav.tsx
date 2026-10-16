"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentProps, ReactNode } from "react";
import NavHint from "@/components/NavHint";
import {
  navigateBack,
  navigateToRoot,
  prepareTransition,
  type NavKind,
} from "@/lib/nav-transitions";

/**
 * <Link> that tells the transition controller which way it is going.
 *
 * Still a real <Link>: it prefetches, populates the router cache and renders
 * an anchor (steering §4). `onNavigate` fires only for client navigations, so
 * a cmd-click into a new tab never captures a ghost.
 */
export function NavLink({
  kind = "push",
  href,
  hint = true,
  children,
  onNavigate,
  ...rest
}: Omit<ComponentProps<typeof Link>, "href"> & {
  href: string;
  kind?: NavKind;
  /** Render the slow-navigation hint (only appears after 100 ms). */
  hint?: boolean;
  children?: ReactNode;
}) {
  return (
    <Link
      href={href}
      onNavigate={(e) => {
        prepareTransition(kind, href);
        onNavigate?.(e);
      }}
      {...rest}
    >
      {hint && <NavHint />}
      {children}
    </Link>
  );
}

/**
 * Imperative navigation with the same motion contract. Use only where the
 * target is computed at tap time or follows a write (steering §4); anything a
 * user can see before tapping should be a <NavLink>.
 */
export function useNav() {
  const router = useRouter();
  return {
    push(href: string) {
      prepareTransition("push", href);
      router.push(href);
    },
    /** In-place replacement with no motion (redirects). */
    replace(href: string) {
      prepareTransition("none", href);
      router.replace(href);
    },
    back(fallbackHref: string) {
      navigateBack((h) => router.replace(h), fallbackHref);
    },
    toRoot(rootHref: string) {
      navigateToRoot(rootHref, (h) => router.push(h));
    },
    router,
  };
}
