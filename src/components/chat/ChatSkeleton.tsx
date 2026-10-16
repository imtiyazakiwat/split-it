import Screen from "@/components/kit/Screen";
import Skeleton from "@/components/ui/Skeleton";

/**
 * Layout-matching placeholder for a conversation: bar, then alternating
 * bubbles. Shared by the route's loading.tsx and the screen's own in-flight
 * state so both render the identical shape.
 */
export default function ChatSkeleton() {
  return (
    <Screen title="" back="/pay" fixed fixedClassName="is-viewport">
      <div className="flex-1 space-y-3 px-4 pt-[calc(var(--nav-total)+16px)]" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <Skeleton
            key={i}
            className={`h-12 rounded-[20px] ${i % 2 ? "ml-auto w-2/3" : "w-3/5"}`}
          />
        ))}
      </div>
    </Screen>
  );
}
