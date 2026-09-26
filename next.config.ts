import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  experimental: {
    /**
     * Client-side router cache lifetimes, in seconds.
     *
     * `dynamic` defaults to **0** — dynamic routes are not cached on the client at
     * all, so navigating back to a group you just left refetches its RSC payload
     * every time. (It was 30s in Next 14 and was deliberately changed to 0 in 15.)
     * `/groups/[id]` and `/chat/[uid]` are both dynamic and are exactly the screens
     * users bounce in and out of, so the default meant a server round trip per tap.
     *
     * 30s rather than something larger: the ledger is live data and a stale balance
     * is worse than a fast one. Firestore's listeners still push updates into the
     * mounted screen, so this only governs how long the route *shell* is reused.
     */
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
  },
  // Deployed on Vercel (see README), so cache policy lives here — there is
  // deliberately no `hosting` block in firebase.json. The service worker must
  // always revalidate (a stale SW pins a stale shell); install icons and the
  // manifest change rarely and can cache with background revalidation.
  // /_next/static/* is already immutable-cached by the platform.
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [{ key: "Cache-Control", value: "no-cache" }],
      },
      {
        source: "/manifest.webmanifest",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400, stale-while-revalidate=604800",
          },
        ],
      },
      {
        source: "/:icon(icon-*.png|apple-icon.png|favicon-*.png|splash-*.png)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400, stale-while-revalidate=604800",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
