import GroupDetailSkeleton from "@/components/group/GroupDetailSkeleton";

/**
 * Route-level loading UI for a group.
 *
 * This file does two jobs, and the first is why a tap used to feel dead. Per the
 * Next 16 prefetching contract:
 *
 *              | Static route     | Dynamic route
 *   Prefetched | Yes, full route  | NO — unless loading.tsx exists
 *
 * `/groups/[id]` has no `generateStaticParams`, so `next build` marks it dynamic
 * (ƒ). Without this file it was never prefetched: a prefetch request returned
 * 239 bytes — an empty payload, measured — so the tap started a cold server
 * round trip. And because there was no Suspense boundary either, React had
 * nothing to swap to and kept the previous screen on screen, fully painted and
 * apparently interactive. With this file the same prefetch returns 13.6 kB
 * containing a renderable skeleton.
 *
 * Deliberately NOT added to the static routes (/, /pay, /activity, /reports,
 * /settings): those already prefetch the entire page with a 5 minute client
 * cache, and introducing a loading boundary would downgrade them to shell-only
 * with caching off by default.
 */
export default function Loading() {
  return <GroupDetailSkeleton />;
}
