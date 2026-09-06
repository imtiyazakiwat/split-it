"use client";

import Link from "next/link";

/**
 * Served by the service worker when a navigation has no network and nothing
 * cached. Static content only — never touches data, so it renders with or
 * without a connection. Cached groups/threads still open from history; only
 * never-visited routes land here.
 */
export default function OfflinePage() {
  return (
    <main className="flex-1 max-w-md w-full mx-auto px-4 pt-[max(2rem,env(safe-area-inset-top))] pb-16 text-center">
      <div className="mt-16 rounded-[var(--radius-card)] bg-[var(--surface)] p-8 shadow-[var(--shadow-card)]">
        <p className="text-[44px]" aria-hidden>
          📶
        </p>
        <h1 className="text-[22px] font-extrabold text-[var(--text-primary)] mt-3">
          You&rsquo;re offline
        </h1>
        <p className="text-[15px] text-[var(--text-secondary)] mt-2">
          SplitIt needs a connection to load this. Anything you already opened
          is still available — check the tabs below.
        </p>
        <Link
          href="/"
          className="inline-block mt-5 rounded-full bg-[var(--brand-solid)] text-white px-6 py-3 text-[16px] font-semibold tap-shrink"
        >
          Try again
        </Link>
      </div>
    </main>
  );
}
