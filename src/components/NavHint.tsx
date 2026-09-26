"use client";

import { useLinkStatus } from "next/link";

/**
 * Immediate feedback that a tap was received and a screen is on its way.
 *
 * `useLinkStatus` reports the pending state of the enclosing `<Link>`, so this
 * must be rendered *inside* one. Next's own guidance is to reach for it
 * precisely when "the destination route is dynamic and doesn't include a
 * loading.js file" — we now have `loading.tsx` on every dynamic route, so this
 * is the second line of defence for the case the docs call out separately: a
 * slow or flaky network where prefetching hasn't finished by the time the user
 * taps, and even the prefetched fallback isn't available yet.
 *
 * Why this exists at all: `tap-shrink` is `:active`-only, so every scrap of
 * feedback in this app disappeared the moment the finger lifted. On a slow
 * navigation the user was left looking at a fully painted previous screen with
 * no indication anything was happening — which is what "tap and nothing, tap
 * again" was.
 *
 * The delay before it appears lives in CSS (`.nav-hint`, 100ms), not in a timer
 * here. A prefetched route commits in ~20ms and unmounts this before the
 * animation-delay elapses, so fast navigations stay visually silent and only
 * slow ones announce themselves. Doing it with `setTimeout` would mean a state
 * update and a re-render per navigation for the same result.
 */
export default function NavHint({ variant = "bar" }: { variant?: "bar" | "dot" }) {
  const { pending } = useLinkStatus();
  if (!pending) return null;

  if (variant === "dot") {
    return (
      <span
        aria-hidden
        className="nav-hint absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-[var(--brand)]"
      />
    );
  }

  // `aria-hidden` plus `role="status"` on a wrapper would double-announce; the
  // route change itself is what assistive tech should report, so this is purely
  // decorative and stays out of the accessibility tree.
  return <span aria-hidden className="nav-hint-bar" />;
}
