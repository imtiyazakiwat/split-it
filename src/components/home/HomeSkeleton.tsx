import Skeleton from "@/components/ui/Skeleton";

/**
 * Layout-matching skeleton for Groups: large title, summary, and a grouped
 * list, so content resolves in place.
 */
export default function HomeSkeleton() {
  return (
    <div className="flex-1 flex flex-col bg-[var(--background)] min-h-full">
      <main className="flex-1 max-w-md w-full mx-auto px-4 pt-[calc(env(safe-area-inset-top)+52px)] pb-[var(--content-bottom)]">
        <div className="px-1 pt-0.5 pb-3.5">
          <Skeleton className="h-[34px] w-36 rounded-lg" />
          <Skeleton className="h-4 w-44 mt-2 rounded-md" />
        </div>
        <div className="list-section px-4 pt-4 pb-4">
          <Skeleton className="h-4 w-16 rounded-md" />
          <Skeleton className="h-9 w-40 mt-2 rounded-lg" />
        </div>
        <Skeleton className="h-7 w-36 mt-7 mb-3 rounded-md" />
        <Skeleton className="h-9 w-full rounded-full" />
        <div className="list-section mt-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="list-row is-tall">
              <Skeleton className="w-11 h-11 rounded-full" />
              <div className="flex-1 min-w-0 space-y-1.5">
                <Skeleton className="h-4 w-32 rounded-md" />
                <Skeleton className="h-3 w-24 rounded-md" />
              </div>
              <Skeleton className="h-4 w-14 rounded-md" />
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
