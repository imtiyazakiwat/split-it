"use client";

import Link from "next/link";
import { EmptyState } from "@/components/ui/Controls";
import { Wifi } from "@/components/ui/Icons";

/**
 * Served by the service worker when a navigation has no network and nothing
 * cached. Static content only — never touches data, so it renders with or
 * without a connection.
 */
export default function OfflinePage() {
  return (
    <main className="flex-1 min-h-[100dvh] flex items-center justify-center max-w-md w-full mx-auto px-4 pt-[env(safe-area-inset-top)]">
      <EmptyState
        icon={<Wifi size={60} weight={1.5} />}
        title="You’re Offline"
        message="SplitIt needs a connection to open this screen. Anything you’ve opened before is still available."
        action={
          <Link href="/" className="btn-prominent">
            Try Again
          </Link>
        }
      />
    </main>
  );
}
