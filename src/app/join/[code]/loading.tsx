import { Spinner } from "@/components/kit/Controls";

/**
 * Joining by invite code is a redirect in disguise, so a centred activity
 * indicator rather than a page skeleton keeps it honest about being transient.
 * See `app/groups/[id]/loading.tsx` for why dynamic routes need this file.
 */
export default function Loading() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-[var(--bg)] text-label-2">
      <Spinner size={24} />
    </main>
  );
}
