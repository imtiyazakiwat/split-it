"use client";

import { useLinkStatus } from "next/link";

/**
 * Immediate feedback that a tap was received and a screen is on its way.
 *
 * `useLinkStatus` reports the pending state of the enclosing `<Link>`, so this
 * must be rendered inside one (NavLink does that by default). It is the second
 * line of defence after `loading.tsx`: a slow network where even the
 * prefetched shell isn't there yet.
 *
 * The 100 ms delay lives in CSS (`.nav-hint`), not a timer: a prefetched route
 * commits in ~20 ms and unmounts this before it ever becomes visible, so fast
 * navigations stay silent and only slow ones announce themselves.
 */
export default function NavHint({ variant = "bar" }: { variant?: "bar" | "dot" }) {
  const { pending } = useLinkStatus();
  if (!pending) return null;

  if (variant === "dot") {
    return (
      <span
        aria-hidden
        className="nav-hint absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-[var(--tint)]"
      />
    );
  }
  // Decorative: the route change itself is what assistive tech should report.
  return <span aria-hidden className="nav-hint-bar" />;
}
