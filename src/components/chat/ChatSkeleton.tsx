import Skeleton from "@/components/ui/Skeleton";

/**
 * Layout-matching placeholder for a conversation: header, balance summary, then
 * alternating message bubbles.
 *
 * Extracted from `app/chat/[uid]/page.tsx` so the route's `loading.tsx` and the
 * screen's own in-flight state render the identical shape. Kept free of
 * `"use client"` so it can be used from the server-rendered loading boundary.
 */
export default function ChatSkeleton() {
  return (
    <div className="flex-1 max-w-md w-full mx-auto px-4 pt-[max(1rem,env(safe-area-inset-top))] space-y-3">
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-20 w-full" />
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className={`h-12 ${i % 2 ? "w-2/3 ml-auto" : "w-3/5"}`} />
      ))}
    </div>
  );
}
