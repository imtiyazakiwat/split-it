import { Expense, Group, Settlement } from "./types";
import { canRespondToSettlement, computePairwiseLedger } from "./balance";

/**
 * Cross-group balances.
 *
 * Balances used to be strictly per-group, so two people who were +500 in one
 * group and -500 in another had no way to see (let alone clear) the fact that
 * they were actually square. Everything here works on *pairwise* nets — the
 * amount two specific people owe each other, never routed through a third
 * person — because that is the only figure that is meaningful to carry from
 * one group to another.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface GroupPairBalance {
  groupId: string;
  groupName: string;
  /** Positive: I owe them in this group. Negative: they owe me. */
  net: number;
}

export interface CounterpartyBalance {
  uid: string;
  displayName: string;
  photoURL?: string;
  upiId?: string;
  /** Only groups where this pair has a non-zero balance. */
  groups: GroupPairBalance[];
  /** Number of groups shared with this person (including settled ones). */
  sharedGroupCount: number;
  /** Net across every shared group. Positive: I owe them. */
  net: number;
  /** Total I owe them, ignoring the groups where they owe me. */
  iOwe: number;
  /** Total they owe me, ignoring the groups where I owe them. */
  owedToMe: number;
  /**
   * Amount that cancels out across groups: money neither side needs to send,
   * it just needs writing off on both sides.
   */
  offsetable: number;
}

export interface GroupDataset {
  group: Group;
  expenses: Expense[];
  settlements: Settlement[];
}

/**
 * Builds the global, per-person balance sheet for `meUid` across every group
 * they belong to.
 */
export function computeCounterpartyBalances(
  meUid: string,
  datasets: GroupDataset[]
): CounterpartyBalance[] {
  const byUid = new Map<string, CounterpartyBalance>();

  for (const { group, expenses, settlements } of datasets) {
    if (!group.memberIds?.includes(meUid)) continue;
    const owes = computePairwiseLedger(expenses, settlements);

    for (const uid of group.memberIds) {
      if (uid === meUid) continue;
      const member = group.members?.[uid];
      let entry = byUid.get(uid);
      if (!entry) {
        entry = {
          uid,
          displayName: member?.displayName || "Member",
          photoURL: member?.photoURL,
          upiId: member?.upiId,
          groups: [],
          sharedGroupCount: 0,
          net: 0,
          iOwe: 0,
          owedToMe: 0,
          offsetable: 0,
        };
        byUid.set(uid, entry);
      }
      // Keep the richest profile we've seen across groups.
      if (member?.displayName) entry.displayName = member.displayName;
      if (member?.photoURL) entry.photoURL = member.photoURL;
      if (member?.upiId) entry.upiId = member.upiId;
      entry.sharedGroupCount += 1;

      const net = round2((owes[meUid]?.[uid] || 0) - (owes[uid]?.[meUid] || 0));
      if (Math.abs(net) < 0.01) continue;
      entry.groups.push({ groupId: group.id, groupName: group.name, net });
    }
  }

  const result = Array.from(byUid.values()).map((entry) => {
    const iOwe = round2(
      entry.groups.reduce((sum, g) => sum + (g.net > 0 ? g.net : 0), 0)
    );
    const owedToMe = round2(
      entry.groups.reduce((sum, g) => sum + (g.net < 0 ? -g.net : 0), 0)
    );
    return {
      ...entry,
      groups: entry.groups.sort((a, b) => Math.abs(b.net) - Math.abs(a.net)),
      iOwe,
      owedToMe,
      net: round2(iOwe - owedToMe),
      offsetable: round2(Math.min(iOwe, owedToMe)),
    };
  });

  return result.sort((a, b) => Math.abs(b.net) - Math.abs(a.net) || a.displayName.localeCompare(b.displayName));
}

export interface CrossGroupLeg {
  groupId: string;
  settlementId: string;
  settlement: Settlement;
}

export interface CrossGroupLegSet {
  legs: CrossGroupLeg[];
  /** How many legs the creator said this set contains. */
  expected: number;
  /** False when we can't see every leg — approving would half-apply the set. */
  complete: boolean;
  /** Value being written off (no money moves), from the creator's side. */
  offsetAmount: number;
  /** Value the creator claims to have actually paid. */
  cashAmount: number;
}

/**
 * Collects the pending legs of one cross-group action so a single approval
 * applies to all of them.
 *
 * `crossGroupId` alone must never be trusted: every member of a group can read
 * its settlements, so anyone could mint their own record carrying a borrowed
 * id and have it swept into someone else's "approve all". Legs therefore only
 * count when they also share the same creator and the same two parties — both
 * of which the security rules pin to the authenticated user at write time —
 * and when the responding user is actually entitled to act on them.
 */
export function findCrossGroupLegs(
  datasets: GroupDataset[],
  settlement: Settlement,
  respondingUid: string
): CrossGroupLegSet {
  const creator = settlement.createdBy || settlement.fromUid;
  const pairKey = [settlement.fromUid, settlement.toUid].sort().join("|");
  const single: CrossGroupLeg[] = [
    { groupId: settlement.groupId, settlementId: settlement.id, settlement },
  ];

  const summarise = (legs: CrossGroupLeg[], expected: number): CrossGroupLegSet => ({
    legs,
    expected,
    complete: legs.length >= expected,
    offsetAmount: round2(
      legs
        .filter((l) => l.settlement.kind === "offset" && l.settlement.fromUid === creator)
        .reduce((sum, l) => sum + l.settlement.amount, 0)
    ),
    cashAmount: round2(
      legs
        .filter((l) => l.settlement.kind !== "offset" && l.settlement.fromUid === creator)
        .reduce((sum, l) => sum + l.settlement.amount, 0)
    ),
  });

  if (!settlement.crossGroupId) return summarise(single, 1);

  const legs: CrossGroupLeg[] = [];
  for (const { group, settlements } of datasets) {
    for (const s of settlements) {
      if (s.crossGroupId !== settlement.crossGroupId) continue;
      if (s.status !== "pending") continue;
      if ((s.createdBy || s.fromUid) !== creator) continue;
      if ([s.fromUid, s.toUid].sort().join("|") !== pairKey) continue;
      if (!canRespondToSettlement(s, respondingUid)) continue;
      legs.push({ groupId: group.id, settlementId: s.id, settlement: s });
    }
  }

  const expected = settlement.crossGroupLegCount || legs.length || 1;
  return summarise(legs.length > 0 ? legs : single, expected);
}

export interface SettlementLeg {
  groupId: string;
  groupName: string;
  amount: number;
  /**
   * "pay"    — I owe this group's balance and am paying it.
   * "offset" — cancelled against an opposing balance in another group; no
   *            money moves for this leg.
   */
  type: "pay" | "offset";
  /** Direction of the underlying record: who is credited by this leg. */
  direction: "i-pay-them" | "they-pay-me";
}

export interface GlobalSettlementPlan {
  /** Legs that cancel out across groups — no money changes hands. */
  offsetLegs: SettlementLeg[];
  /** Legs the current user settles with real money. */
  paymentLegs: SettlementLeg[];
  /** Total that actually has to be transferred by the current user. */
  cashAmount: number;
  /** Total value being written off on both sides. */
  offsetAmount: number;
  /** Net position after the plan is applied (should be ~0 for the offset part). */
  remainingOwedToMe: number;
}

function allocate(
  amount: number,
  buckets: { groupId: string; groupName: string; available: number }[]
): { groupId: string; groupName: string; amount: number }[] {
  const out: { groupId: string; groupName: string; amount: number }[] = [];
  let left = round2(amount);
  for (const bucket of buckets) {
    if (left <= 0.01) break;
    const take = round2(Math.min(left, bucket.available));
    if (take <= 0.01) continue;
    out.push({ groupId: bucket.groupId, groupName: bucket.groupName, amount: take });
    left = round2(left - take);
  }
  return out;
}

/**
 * Turns a person's cross-group position into concrete settlement legs.
 *
 * `includeCash` controls whether the leftover (the part that can't be
 * cancelled) is included as a real payment, letting the UI offer "just cancel
 * out what matches" separately from "cancel out and pay the difference".
 */
export function buildGlobalSettlementPlan(
  counterparty: CounterpartyBalance,
  options: { includeOffsets?: boolean; includeCash?: boolean; cashAmount?: number } = {}
): GlobalSettlementPlan {
  const includeOffsets = options.includeOffsets ?? true;
  const includeCash = options.includeCash ?? true;

  const debtBuckets = counterparty.groups
    .filter((g) => g.net > 0.01)
    .map((g) => ({ groupId: g.groupId, groupName: g.groupName, available: g.net }))
    .sort((a, b) => b.available - a.available);
  const creditBuckets = counterparty.groups
    .filter((g) => g.net < -0.01)
    .map((g) => ({ groupId: g.groupId, groupName: g.groupName, available: -g.net }))
    .sort((a, b) => b.available - a.available);

  const offsetLegs: SettlementLeg[] = [];
  let offsetAmount = 0;

  if (includeOffsets && counterparty.offsetable > 0.01) {
    offsetAmount = counterparty.offsetable;
    // Clear `offsetable` from both sides: my debts shrink in the groups where
    // I owe, their debts shrink in the groups where they owe me.
    allocate(offsetAmount, debtBuckets).forEach((a) =>
      offsetLegs.push({ ...a, type: "offset", direction: "i-pay-them" })
    );
    allocate(offsetAmount, creditBuckets).forEach((a) =>
      offsetLegs.push({ ...a, type: "offset", direction: "they-pay-me" })
    );
  }

  // What's left of my debt after offsetting.
  const remainingDebt = round2(Math.max(0, counterparty.iOwe - offsetAmount));
  const requestedCash = options.cashAmount ?? remainingDebt;
  const cashToPay = round2(Math.max(0, Math.min(remainingDebt, requestedCash)));

  const paymentLegs: SettlementLeg[] = [];
  if (includeCash && cashToPay > 0.01) {
    // Spend the cash against the debt buckets that weren't fully offset.
    const consumed = new Map<string, number>();
    offsetLegs
      .filter((l) => l.direction === "i-pay-them")
      .forEach((l) => consumed.set(l.groupId, (consumed.get(l.groupId) || 0) + l.amount));
    const remainingBuckets = debtBuckets
      .map((b) => ({ ...b, available: round2(b.available - (consumed.get(b.groupId) || 0)) }))
      .filter((b) => b.available > 0.01);
    allocate(cashToPay, remainingBuckets).forEach((a) =>
      paymentLegs.push({ ...a, type: "pay", direction: "i-pay-them" })
    );
  }

  return {
    offsetLegs,
    paymentLegs,
    offsetAmount,
    cashAmount: round2(paymentLegs.reduce((sum, l) => sum + l.amount, 0)),
    remainingOwedToMe: round2(Math.max(0, counterparty.owedToMe - offsetAmount)),
  };
}
