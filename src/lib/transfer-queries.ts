import { DirectTransfer, Expense, Group, Settlement } from "./types";
import { unallocatedAmount } from "./transfer-allocation";
import { pairwiseNet } from "./balance";
import { isSettled } from "./money";

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

/** The slice of group data needed to ask "could this payment settle anything?". */
export interface SettleableDataset {
  group: Pick<Group, "id" | "memberIds">;
  expenses: Expense[];
  settlements: Settlement[];
}

/**
 * Confirmed money that could still settle a group balance, so it's worth
 * asking the receiver to attach it.
 *
 * "Received, not for a group" leaves a transfer `accepted` with nothing
 * allocated, which is a deliberate final answer. The old test (accepted and
 * anything unallocated) therefore listed every such payment forever: the
 * receiver answered, and the row came straight back as "Waiting on you".
 *
 * A payment now stays in the list only while the sender still owes the
 * receiver in a group they both belong to, i.e. while attaching it would
 * actually move a balance. Once nothing is owed there, the decision has
 * nothing left to change and the reminder goes away. The money itself is
 * unaffected: it still counts as a personal balance everywhere it did.
 *
 * Without datasets (no group data loaded yet) nothing is listed, so a cold
 * start never flashes a reminder that the loaded data would then retract.
 */
export function unappliedForMe(
  transfers: DirectTransfer[],
  meUid: string,
  datasets: SettleableDataset[] = []
): DirectTransfer[] {
  return transfers.filter((t) => {
    if (t.toUid !== meUid || t.status !== "accepted") return false;
    if (isSettled(unallocatedAmount(t))) return false;
    return datasets.some(
      (d) =>
        d.group.memberIds?.includes(meUid) &&
        d.group.memberIds?.includes(t.fromUid) &&
        pairwiseNet(t.fromUid, meUid, d.expenses, d.settlements) > 0.009
    );
  });
}
