import Skeleton from "@/components/ui/Skeleton";

/**
 * Layout-matching skeleton for the group detail screen (hero, stats, balance
 * hero, and activity), shown while the group document loads.
 */
export default function GroupDetailSkeleton() {
  return (
    <div className="flex-1 flex flex-col bg-[var(--background)] min-h-full">
      <header className="max-w-md w-full mx-auto px-4 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="flex items-center justify-between pt-2">
          <Skeleton className="w-11 h-11 rounded-2xl" />
          <Skeleton className="w-11 h-11 rounded-2xl" />
        </div>
      </header>
      <main className="flex-1 max-w-md w-full mx-auto px-4 pt-4 pb-40 space-y-5">
        {/* Hero */}
        <div className="flex items-start gap-4">
          <Skeleton className="w-[88px] h-[88px] rounded-[var(--radius-card)]" />
          <div className="flex-1 pt-1">
            <Skeleton className="h-7 w-40 rounded-lg" />
            <Skeleton className="h-3.5 w-32 mt-2 rounded-md" />
            <Skeleton className="h-8 w-24 mt-3 rounded-full" />
          </div>
        </div>

        {/* Stats card */}
        <div className="bg-[var(--surface)] rounded-[var(--radius-card)] p-5 grid grid-cols-2 gap-x-4 gap-y-5">
          {[0, 1, 2, 3].map((i) => (
            <div key={i}>
              <Skeleton className="h-3.5 w-20 rounded-md" />
              <Skeleton className="h-6 w-24 mt-1.5 rounded-md" />
            </div>
          ))}
        </div>

        {/* Balance hero */}
        <Skeleton className="h-36 w-full rounded-[var(--radius-card)]" />

        {/* Balances */}
        <div>
          <Skeleton className="h-6 w-28 rounded-md mb-3" />
          <div className="flex gap-3">
            <Skeleton className="h-20 w-[190px] rounded-[var(--radius-inner)] shrink-0" />
            <Skeleton className="h-20 w-[190px] rounded-[var(--radius-inner)] shrink-0" />
          </div>
        </div>

        {/* Activity */}
        <div>
          <Skeleton className="h-6 w-24 rounded-md mb-3" />
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-start gap-3">
                <Skeleton className="w-9 h-9 rounded-full shrink-0" />
                <div className="flex-1">
                  <Skeleton className="h-4 w-2/3 rounded-md" />
                  <Skeleton className="h-3 w-1/3 mt-2 rounded-md" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
