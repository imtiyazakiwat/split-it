import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
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
