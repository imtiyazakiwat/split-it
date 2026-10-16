"use client";

import Screen from "@/components/kit/Screen";
import Skeleton from "@/components/ui/Skeleton";

/**
 * Layout-matching placeholder for a group (header, balance card, summary,
 * rows). Also the route's loading.tsx, which is what lets /groups/[id] be
 * prefetched at all (see that file).
 */
export default function GroupDetailSkeleton() {
  return (
    <Screen title="" back="/" tabBar>
      <div className="flex flex-col items-center pt-2" aria-hidden>
        <Skeleton className="h-[84px] w-[84px] rounded-[22px]" />
        <Skeleton className="mt-4 h-7 w-44 rounded-lg" />
        <Skeleton className="mt-2 h-4 w-32 rounded-md" />
      </div>
      <div className="card mt-6 p-4" aria-hidden>
        <Skeleton className="h-3 w-20 rounded-md" />
        <Skeleton className="mt-2 h-9 w-36 rounded-lg" />
        <Skeleton className="mt-4 h-[50px] w-full rounded-full" />
      </div>
      <div className="section" aria-hidden>
        <Skeleton className="mx-4 mb-2 h-3 w-20 rounded-md" />
        <div className="card list">
          {[0, 1, 2].map((i) => (
            <div key={i} className="row is-tall" style={{ ["--sep-inset" as string]: "58px" }}>
              <Skeleton className="h-[30px] w-[30px] rounded-[8px]" />
              <div className="flex-1">
                <Skeleton className="h-4 w-2/3 rounded-md" />
                <Skeleton className="mt-2 h-3 w-1/3 rounded-md" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </Screen>
  );
}
