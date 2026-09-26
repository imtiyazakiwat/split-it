import { ChatThread } from "./types";

/**
 * Pure helpers for reasoning about a thread, with no Firestore dependency.
 *
 * Split out of `chat.ts` so `PaymentsProvider` — which lives in the root layout
 * and needs these on every render — can use them without statically importing a
 * module that reaches the 641 kB Firestore SDK. `chat.ts` re-exports both, so
 * existing call sites are unaffected.
 */

/** Deterministic thread id: the two uids sorted, so both sides derive the same one. */
export function threadIdFor(uidA: string, uidB: string): string {
  return [uidA, uidB].sort().join("_");
}

/** True when the other person has said something this user hasn't seen. */
export function hasUnread(thread: ChatThread | undefined, meUid: string): boolean {
  if (!thread?.lastMessageAt) return false;
  if (thread.lastMessageFrom === meUid) return false;
  return thread.lastMessageAt > (thread.lastRead?.[meUid] ?? 0);
}
