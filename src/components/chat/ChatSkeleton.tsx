import Skeleton from "@/components/ui/Skeleton";

/**
 * Layout-matching placeholder for a conversation: header, then alternating
 * bubbles. Kept free of "use client" so the route's loading.tsx can use it.
 */
export default function ChatSkeleton() {
  return (
    <div className="fixed inset-0 flex flex-col bg-[var(--background)]">
      <div className="pt-[env(safe-area-inset-top)] pb-1.5">
        <div className="max-w-md mx-auto px-4 h-[64px] grid grid-cols-[44px_1fr_44px] items-center gap-2">
          <Skeleton className="w-11 h-11 rounded-full" />
          <div className="flex flex-col items-center gap-1">
            <Skeleton className="w-9 h-9 rounded-full" />
            <Skeleton className="h-3 w-20 rounded-md" />
          </div>
        </div>
      </div>
      <div className="flex-1 max-w-md w-full mx-auto px-3 pt-6 space-y-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className={`h-10 rounded-[19px] ${i % 2 ? "w-3/5 ml-auto" : "w-1/2"}`} />
        ))}
      </div>
    </div>
  );
}
