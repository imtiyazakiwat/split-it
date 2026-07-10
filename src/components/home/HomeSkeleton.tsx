import Skeleton from "@/components/ui/Skeleton";

/**
 * Layout-matching skeleton for the home dashboard. Mirrors header, summary
 * card, search, and a few group rows so content resolves in place.
 */
export default function HomeSkeleton() {
  return (
    <div className="flex-1 flex flex-col bg-[var(--background)] min-h-full">
      <main className="flex-1 max-w-md w-full mx-auto px-4 pt-[max(0.5rem,env(safe-area-inset-top))] pb-40">
        {/* Header */}
        <div className="flex items-center justify-between pt-3">
          <Skeleton className="h-8 w-28 rounded-lg" />
          <div className="flex items-center gap-2.5">
            <Skeleton className="w-11 h-11 rounded-2xl" />
            <Skeleton className="w-11 h-11 rounded-2xl" />
          </div>
        </div>

        {/* Greeting */}
        <Skeleton className="h-4 w-28 mt-5 rounded-md" />
        <Skeleton className="h-8 w-40 mt-2 rounded-lg" />

        {/* Summary card */}
        <div className="mt-4 bg-[var(--surface)] rounded-[var(--radius-xl)] p-5">
          <Skeleton className="h-4 w-24 rounded-md" />
          <Skeleton className="h-10 w-44 mt-2 rounded-lg" />
          <div className="h-px bg-[var(--border-subtle)] my-4" />
          <div className="flex items-center gap-2.5">
            <Skeleton className="w-10 h-10 rounded-full" />
            <div className="flex-1">
              <Skeleton className="h-4 w-10 rounded-md" />
              <Skeleton className="h-3 w-16 mt-1.5 rounded-md" />
            </div>
          </div>
        </div>

        {/* Search */}
        <div className="mt-5 flex items-center gap-2.5">
          <Skeleton className="flex-1 h-12 rounded-full" />
          <Skeleton className="w-12 h-12 rounded-2xl" />
        </div>

        {/* Groups header */}
        <div className="mt-6 flex items-center justify-between">
          <Skeleton className="h-6 w-32 rounded-md" />
          <Skeleton className="h-8 w-24 rounded-full" />
        </div>

        {/* Group rows */}
        <div className="mt-3 space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="bg-[var(--surface)] rounded-[var(--radius-card)] p-4 flex items-center gap-3.5">
              <Skeleton className="w-14 h-14 rounded-full" />
              <div className="flex-1 min-w-0">
                <Skeleton className="h-4 w-32 rounded-md" />
                <Skeleton className="h-3 w-20 mt-2 rounded-md" />
                <Skeleton className="h-6 w-16 mt-2 rounded-full" />
              </div>
              <div className="flex flex-col items-end gap-2">
                <Skeleton className="h-3 w-16 rounded-md" />
                <Skeleton className="h-4 w-14 rounded-md" />
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
