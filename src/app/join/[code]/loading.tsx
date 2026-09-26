import Skeleton from "@/components/ui/Skeleton";

/**
 * Joining by invite code is a redirect in disguise: the screen resolves the
 * code, joins, then replaces the URL with the group. A centred placeholder
 * rather than a full page skeleton keeps it honest about being transient.
 *
 * See `app/groups/[id]/loading.tsx` for why dynamic routes need this file.
 */
export default function Loading() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6">
      <Skeleton className="h-14 w-14 rounded-2xl" />
      <Skeleton className="h-5 w-40 rounded-md" />
      <Skeleton className="h-3.5 w-56 rounded-md" />
    </div>
  );
}
