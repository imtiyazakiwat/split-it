import { Expense } from "./types";
import { isActiveExpense } from "./balance";
import { categoryMeta } from "./categories";

/**
 * "How much have we spent?" for a chosen group and, optionally, a chosen person.
 *
 * With no person selected the scope is every expense in range. With a person
 * selected the scope narrows to the expenses the two of you actually shared —
 * both of you appear in the split — because that is what "spent with them"
 * means. An expense one of you had no part in isn't shared spending, however
 * much it changes the group total.
 *
 * Deleted expenses are excluded throughout. Edited ones are kept: an edit
 * changes the numbers, it doesn't undo the spend.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface CategorySpend {
  id: string;
  label: string;
  emoji: string;
  total: number;
  count: number;
  /** The viewer's own share within this category. */
  myShare: number;
}

export interface PayerSpend {
  uid: string;
  /** Total this person put on the table across the scoped expenses. */
  paid: number;
  count: number;
}

export interface SpendingSummary {
  /** Total value of the scoped expenses. */
  total: number;
  /** The viewer's share of them. */
  myShare: number;
  /** The other person's share, when one is selected. */
  theirShare: number;
  /** How much the viewer fronted. */
  iPaid: number;
  /** How much the other person fronted, when one is selected. */
  theyPaid: number;
  expenseCount: number;
  /** Largest single expense in scope, for context on the average. */
  largest: number;
  average: number;
  firstTs: number | null;
  lastTs: number | null;
  byCategory: CategorySpend[];
  byPayer: PayerSpend[];
}

export function summariseSpending(
  meUid: string,
  expenses: Expense[],
  otherUid?: string | null
): SpendingSummary {
  const shareOf = (e: Expense, uid: string) =>
    e.splits.find((s) => s.uid === uid)?.amount ?? 0;

  const scoped = expenses.filter((e) => {
    if (!isActiveExpense(e)) return false;
    if (!otherUid) return true;
    // Shared means both of us carry part of it.
    return e.splits.some((s) => s.uid === meUid) && e.splits.some((s) => s.uid === otherUid);
  });

  let total = 0;
  let myShare = 0;
  let theirShare = 0;
  let iPaid = 0;
  let theyPaid = 0;
  let largest = 0;
  let firstTs: number | null = null;
  let lastTs: number | null = null;
  const categories = new Map<string, CategorySpend>();
  const payers = new Map<string, PayerSpend>();

  for (const e of scoped) {
    total = round2(total + e.amount);
    myShare = round2(myShare + shareOf(e, meUid));
    if (otherUid) theirShare = round2(theirShare + shareOf(e, otherUid));
    if (e.paidBy === meUid) iPaid = round2(iPaid + e.amount);
    if (otherUid && e.paidBy === otherUid) theyPaid = round2(theyPaid + e.amount);
    if (e.amount > largest) largest = round2(e.amount);
    if (firstTs === null || e.createdAt < firstTs) firstTs = e.createdAt;
    if (lastTs === null || e.createdAt > lastTs) lastTs = e.createdAt;

    const meta = categoryMeta(e.category);
    const cat = categories.get(meta.id) || {
      id: meta.id,
      label: meta.label,
      emoji: meta.emoji,
      total: 0,
      count: 0,
      myShare: 0,
    };
    cat.total = round2(cat.total + e.amount);
    cat.count += 1;
    cat.myShare = round2(cat.myShare + shareOf(e, meUid));
    categories.set(meta.id, cat);

    const payer = payers.get(e.paidBy) || { uid: e.paidBy, paid: 0, count: 0 };
    payer.paid = round2(payer.paid + e.amount);
    payer.count += 1;
    payers.set(e.paidBy, payer);
  }

  return {
    total,
    myShare,
    theirShare,
    iPaid,
    theyPaid,
    expenseCount: scoped.length,
    largest,
    average: scoped.length ? round2(total / scoped.length) : 0,
    firstTs,
    lastTs,
    byCategory: Array.from(categories.values()).sort((a, b) => b.total - a.total),
    byPayer: Array.from(payers.values()).sort((a, b) => b.paid - a.paid),
  };
}
