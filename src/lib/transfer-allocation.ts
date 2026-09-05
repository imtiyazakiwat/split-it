import { DirectTransfer } from "./types";
import { fromPaise, toPaise } from "./money";

/**
 * Splitting one direct payment across the group balances it settles.
 *
 * A payment rarely lines up with exactly one group's balance. Someone sends
 * ₹500 that covers ₹300 owed on a trip and ₹150 owed on rent, leaving ₹50 that
 * belongs to neither. The receiver has to be able to say so, and the two things
 * that must never happen are:
 *
 *   - booking more into a group than was owed there, because the excess doesn't
 *     vanish — it flips the balance and the group reads as unsettled forever
 *     (this is exactly how a stubborn ₹5.31 appeared in the live data); and
 *   - silently swallowing the remainder, which makes the arithmetic
 *     unexplainable to both people.
 *
 * So every leg is capped at what the sender actually owed in that group, and
 * anything left over is reported rather than absorbed. All arithmetic is in
 * integer paise.
 */

export interface AllocatableGroup {
  groupId: string;
  groupName: string;
  /**
   * What the sender owes the receiver in this group, in rupees. Zero or
   * negative means there is nothing here for this payment to settle.
   */
  theyOweMe: number;
}

export interface PlannedLeg {
  groupId: string;
  groupName: string;
  /** Rupees to book here. Never above `owed`, never above what's left. */
  amount: number;
  /** What the sender owed here before this payment. */
  owed: number;
  /** True when this leg clears the group's balance exactly. */
  clearsGroup: boolean;
}

export interface AllocationPlan {
  legs: PlannedLeg[];
  /** Rupees booked into groups. */
  allocated: number;
  /** Rupees this payment couldn't attribute to any selected group. */
  leftover: number;
  /** Sum of what's owed across the selected groups, capped at nothing. */
  selectedOwed: number;
  /** True when the payment is larger than every selected debt combined. */
  exceedsSelectedDebt: boolean;
}

/** Rupees of a transfer not yet booked into any group. */
export function unallocatedAmount(transfer: DirectTransfer): number {
  const total = toPaise(transfer.amount);
  const used = allocatedPaise(transfer);
  return fromPaise(Math.max(0, total - used));
}

function allocatedPaise(transfer: DirectTransfer): number {
  const legs = transferAllocations(transfer);
  return legs.reduce((sum, leg) => sum + toPaise(leg.amount), 0);
}

/**
 * Every leg of a transfer in one shape, folding in the pre-multi-group records
 * that only ever carried `appliedGroupId` / `appliedSettlementId`.
 */
export function transferAllocations(
  transfer: DirectTransfer
): { settlementId: string; groupId: string; amount: number }[] {
  const entries = Object.entries(transfer.allocations || {});
  if (entries.length > 0) {
    return entries.map(([settlementId, a]) => ({
      settlementId,
      groupId: a.groupId,
      amount: a.amount,
    }));
  }
  if (transfer.appliedGroupId && transfer.appliedSettlementId) {
    // Legacy single-group booking always consumed the whole transfer.
    return [
      {
        settlementId: transfer.appliedSettlementId,
        groupId: transfer.appliedGroupId,
        amount: transfer.amount,
      },
    ];
  }
  return [];
}

/** True when none of the payment has been booked into a group yet. */
export function isFullyUnallocated(transfer: DirectTransfer): boolean {
  return transferAllocations(transfer).length === 0;
}

/**
 * Allocation legs the transfer claims exist but which are absent from the group
 * ledger.
 *
 * Booking is necessarily two writes — the security rules can only authorise a
 * settlement against a plan that was already committed — so a failure in between
 * leaves the transfer saying the money is counted while the group has no record
 * of it, understating the balance. A fully allocated transfer no longer appears
 * as unassigned, so nothing would otherwise prompt a repair.
 *
 * Groups absent from `settlementIdsByGroup` are skipped rather than reported:
 * their data simply isn't loaded, which is not the same as a missing leg.
 */
export function missingAllocationLegs(
  transfer: DirectTransfer,
  settlementIdsByGroup: Map<string, Set<string>>
): { settlementId: string; groupId: string; amount: number }[] {
  return transferAllocations(transfer).filter((leg) => {
    const known = settlementIdsByGroup.get(leg.groupId);
    return !!known && !known.has(leg.settlementId);
  });
}

/**
 * Builds the plan for booking `available` rupees across `groups`.
 *
 * `desired` gives the receiver's chosen amount per group; a group absent from it
 * is not being booked. A group present with `undefined` takes as much as it can,
 * which is what selecting a group without typing a number should do. Groups are
 * filled in the order given, so callers control precedence by sorting.
 */
export function buildAllocationPlan(
  available: number,
  groups: AllocatableGroup[],
  desired: Map<string, number | undefined>
): AllocationPlan {
  let remaining = toPaise(available);
  let selectedOwedPaise = 0;
  const legs: PlannedLeg[] = [];

  for (const group of groups) {
    if (!desired.has(group.groupId)) continue;

    const owedPaise = Math.max(0, toPaise(group.theyOweMe));
    selectedOwedPaise += owedPaise;

    const wanted = desired.get(group.groupId);
    const wantedPaise = wanted === undefined ? owedPaise : Math.max(0, toPaise(wanted));

    // The cap is the whole point: never book more into a group than was owed
    // there, and never book more than the payment still has left.
    const amountPaise = Math.min(wantedPaise, owedPaise, remaining);
    remaining -= amountPaise;

    legs.push({
      groupId: group.groupId,
      groupName: group.groupName,
      amount: fromPaise(amountPaise),
      owed: fromPaise(owedPaise),
      clearsGroup: owedPaise > 0 && amountPaise === owedPaise,
    });
  }

  const allocatedPaiseTotal = legs.reduce((sum, l) => sum + toPaise(l.amount), 0);
  return {
    legs,
    allocated: fromPaise(allocatedPaiseTotal),
    leftover: fromPaise(remaining),
    selectedOwed: fromPaise(selectedOwedPaise),
    exceedsSelectedDebt: toPaise(available) > selectedOwedPaise,
  };
}

/**
 * Books as much of `available` as possible, largest debt first. Used to seed the
 * sheet so the common case — "this payment covers what I'm owed, spread it" —
 * needs no typing at all.
 */
export function suggestAllocation(
  available: number,
  groups: AllocatableGroup[]
): Map<string, number | undefined> {
  const desired = new Map<string, number | undefined>();
  let remaining = toPaise(available);
  const byLargestDebt = [...groups].sort((a, b) => toPaise(b.theyOweMe) - toPaise(a.theyOweMe));

  for (const group of byLargestDebt) {
    if (remaining <= 0) break;
    const owedPaise = Math.max(0, toPaise(group.theyOweMe));
    if (owedPaise === 0) continue;
    const take = Math.min(owedPaise, remaining);
    desired.set(group.groupId, fromPaise(take));
    remaining -= take;
  }
  return desired;
}

/** Legs worth writing: a zero-rupee settlement records nothing. */
export function payableLegs(plan: AllocationPlan): { groupId: string; amount: number }[] {
  return plan.legs
    .filter((l) => toPaise(l.amount) > 0)
    .map((l) => ({ groupId: l.groupId, amount: l.amount }));
}
