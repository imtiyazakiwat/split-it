import Skeleton from "@/components/ui/Skeleton";

/**
 * Layout-matching skeleton for a group: header, balance card, balances list
 * and activity, shown while the group document loads.
 */
export default function GroupDetailSkeleton() {
  return (
    <div className="flex-1 flex flex-col bg-[var(--background)] min-h-full">
      <header className="pt-[env(safe-area-inset-top)]">
        <div className="max-w-md mx-auto h-[52px] px-4 flex items-center justify-between">
          <Skeleton className="w-11 h-11 rounded-full" />
          <div className="flex gap-2">
            <Skeleton className="w-11 h-11 rounded-full" />
            <Skeleton className="w-11 h-11 rounded-full" />
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-md w-full mx-auto px-4 pb-[var(--content-bottom)]">
        <div className="flex flex-col items-center pt-1 pb-5">
          <Skeleton className="w-[88px] h-[88px] rounded-full" />
          <Skeleton className="h-7 w-40 mt-3 rounded-lg" />
          <Skeleton className="h-4 w-48 mt-2 rounded-md" />
        </div>
        <div className="list-section px-4 pt-4 pb-4">
          <Skeleton className="h-4 w-24 rounded-md" />
          <Skeleton className="h-9 w-36 mt-2 rounded-lg" />
          <Skeleton className="h-[50px] w-full mt-4 rounded-full" />
        </div>
        <Skeleton className="h-3 w-20 mt-7 mb-2 ml-4 rounded-md" />
        <div className="list-section">
          {[0, 1, 2].map((i) => (
            <div key={i} className="list-row">
              <Skeleton className="w-9 h-9 rounded-full" />
              <Skeleton className="h-4 flex-1 max-w-[50%] rounded-md" />
              <Skeleton className="h-4 w-14 ml-auto rounded-md" />
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
