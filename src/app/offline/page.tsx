import Link from "next/link";
import { EmptyState } from "@/components/kit/Controls";

/**
 * Served by the service worker when a navigation has no network and nothing
 * cached. Static only — it never touches data. Screens you've already opened
 * still load from history; only never-visited routes land here.
 */
export default function OfflinePage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-[var(--bg)] px-6">
      <EmptyState
        icon="wifi.slash"
        title="You're Offline"
        message="SplitIt needs a connection to load this. Anything you've already opened is still available."
        action={
          <Link href="/" className="btn btn-prominent is-md">
            Try Again
          </Link>
        }
      />
    </main>
  );
}
