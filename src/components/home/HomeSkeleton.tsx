"use client";

import Screen from "@/components/kit/Screen";
import Skeleton from "@/components/ui/Skeleton";

/**
 * Layout-matching placeholder for the Groups screen: same bar, same large
 * title, same card shapes, so content resolves in place.
 */
export default function HomeSkeleton() {
  return (
    <Screen title="Groups" large tabBar>
      <div className="card mt-2 grid grid-cols-2 p-4" aria-hidden>
        {[0, 1].map((i) => (
          <div key={i} className={i ? "pl-4" : "pr-4"}>
            <Skeleton className="h-3 w-16 rounded-md" />
            <Skeleton className="mt-2 h-7 w-28 rounded-lg" />
            <Skeleton className="mt-2 h-3 w-20 rounded-md" />
          </div>
        ))}
      </div>
      <div className="section">
        <Skeleton className="mx-4 mb-2 h-3 w-20 rounded-md" />
        <div className="card list" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div key={i} className="row is-tall" style={{ ["--sep-inset" as string]: "72px" }}>
              <Skeleton className="h-11 w-11 rounded-[12px]" />
              <div className="flex-1">
                <Skeleton className="h-4 w-36 rounded-md" />
                <Skeleton className="mt-2 h-3 w-24 rounded-md" />
              </div>
              <Skeleton className="h-4 w-16 rounded-md" />
            </div>
          ))}
        </div>
      </div>
    </Screen>
  );
}
