import { DirectTransfer } from "./types";
import { unallocatedAmount } from "./transfer-allocation";

/**
 * Pure selectors over a list of transfers, with no Firestore dependency.
 *
 * Split out of `transfers.ts` so `PaymentsProvider` — which lives in the root
 * layout and calls these on every render — can use them without statically
 * importing a module that reaches the 641 kB Firestore SDK. `transfers.ts`
 * re-exports all three, so existing call sites are unaffected.
 */

/** Transfers between the current user and one other person, oldest first. */
export function transfersWith(
  transfers: DirectTransfer[],
  meUid: string,
  otherUid: string
): DirectTransfer[] {
  return transfers
    .filter(
      (t) =>
        (t.fromUid === meUid && t.toUid === otherUid) ||
        (t.fromUid === otherUid && t.toUid === meUid)
    )
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** Incoming transfers still waiting on the current user to say what they were. */
export function pendingForMe(transfers: DirectTransfer[], meUid: string): DirectTransfer[] {
  return transfers.filter((t) => t.toUid === meUid && t.status === "pending");
}

/**
 * Money the receiver confirmed but hasn't fully attributed to a group. Worth
 * surfacing: it's the case where a balance still looks unsettled even though the
 * payment went through.
 *
 * Tests the unallocated remainder rather than "has it been booked at all", so a
 * payment larger than the first group's debt keeps offering the rest up instead of
 * disappearing the moment one leg is written.
 */
export function unappliedForMe(transfers: DirectTransfer[], meUid: string): DirectTransfer[] {
  return transfers.filter(
    (t) => t.toUid === meUid && t.status === "accepted" && unallocatedAmount(t) > 0
  );
}
