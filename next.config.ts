import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  experimental: {
    /**
     * Client-side router cache lifetimes, in seconds.
     *
     * `dynamic` defaults to **0** — meaning dynamic routes are not cached on the
     * client at all, so navigating back to a group you just left refetches its
     * RSC payload from the server every time. (It was 30s in Next 14 and was
     * deliberately changed to 0 in 15.) `/groups/[id]` and `/chat/[uid]` are
     * both dynamic, and they are exactly the screens users bounce in and out of,
     * so leaving this at the default meant paying a server round trip per tap.
     *
     * 30s is chosen to match the pre-15 default rather than something larger:
     * the ledger is live data, and a stale balance is worse than a fast one.
     * Firestore's own listeners still push updates into the mounted screen, so
     * this only affects how long the route *shell* is reused.
     */
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
  },
};

export default nextConfig;
