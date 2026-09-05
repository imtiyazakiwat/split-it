import { Expense, Group, Settlement } from "./types";
import { computePairwiseLedger, ledgerParticipants } from "./balance";
import { fromPaise, isSettled, roundMoney } from "./money";

/**
 * Cross-group balances (read-only).
 *
 * This module only *reports* a pair's position across groups. Settling always
 * happens inside a single group: the cross-group settle flow was removed
 * because a payment written into several groups at once was impossible to
 * explain, and the legs went stale the moment anyone added an expense.
 *
 * Balances used to be strictly per-group, so two people who were +500 in one
 * group and -500 in another had no way to see (let alone clear) the fact that
 * they were actually square. Everything here works on *pairwise* nets — the
 * amount two specific people owe each other, never routed through a third
 * person — because that is the only figure that is meaningful to carry from
 * one group to another.
 */

// Paise-exact. Rounding at every accumulation step is only safe when each step
// is itself exact: `roundMoney` collapses the binary representation error each
// time instead of letting it compound, which is what the old `Math.round(n*100)`
// version did while also double-rounding each group's net into the totals.
const round2 = roundMoney;

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

    // Derived from the ledger, not from `memberIds`, so a balance with someone
    // who has left a shared group still shows up here. The Pay and Reports
    // screens read this directly, so filtering to current members hid exactly
    // the debts that are hardest to notice and easiest to forget.
    for (const uid of ledgerParticipants(group.memberIds, expenses, settlements)) {
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
            };
        byUid.set(uid, entry);
      }
      // Keep the richest profile we've seen across groups.
      if (member?.displayName) entry.displayName = member.displayName;
      if (member?.photoURL) entry.photoURL = member.photoURL;
      if (member?.upiId) entry.upiId = member.upiId;
      entry.sharedGroupCount += 1;

      // computePairwiseLedger works in paise, so convert once here.
      const net = fromPaise((owes[meUid]?.[uid] || 0) - (owes[uid]?.[meUid] || 0));
      if (isSettled(net)) continue;
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
    };
  });

  return result.sort((a, b) => Math.abs(b.net) - Math.abs(a.net) || a.displayName.localeCompare(b.displayName));
}
