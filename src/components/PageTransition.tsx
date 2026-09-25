import { ReactNode } from "react";

/**
 * Wrapper for the routed content.
 *
 * This used to be `<div key={pathname} className="page-enter">`, which was
 * actively harmful on two counts:
 *
 * 1. `key={pathname}` made React unmount the entire previous screen and mount a
 *    brand-new tree on every navigation. All page-level state was discarded and
 *    every derived value recomputed from scratch on arrival — the most expensive
 *    possible way to change screens.
 *
 * 2. The `page-enter` animation could only start *after* the router committed
 *    the new route. So during the wait nothing moved at all, and the fade played
 *    once the delay was already over — decorating the end of the stall rather
 *    than covering it. Perceived responsiveness now comes from the route-level
 *    `loading.tsx` boundaries and the `<NavHint />` pending indicator, both of
 *    which appear *during* the navigation, which is when feedback is worth
 *    anything.
 *
 * With no pathname dependency left this no longer needs to be a Client
 * Component, so it drops out of the client bundle entirely.
 */
export default function PageTransition({ children }: { children: ReactNode }) {
  return <div className="flex-1 flex flex-col min-h-full">{children}</div>;
}
