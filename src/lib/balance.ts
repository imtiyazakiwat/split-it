import { Expense, Settlement, Balance, SimplifiedTransaction } from "./types";

/**
 * An expense counts towards balances unless it was deleted.
 *
 * `editAction` is set to "edited" whenever an expense is updated, so treating
 * any truthy `editAction` as "ignore this" silently dropped every edited
 * expense out of the balances, the group totals and the activity feed. Only
 * "deleted" should remove an expense from the ledger.
 */
export function isActiveExpense(expense: Expense): boolean {
  return expense.editAction !== "deleted";
}

export function activeExpenses(expenses: Expense[]): Expense[] {
  return expenses.filter(isActiveExpense);
}

/** Approved settlements are the only ones that move money. */
export function approvedSettlements(settlements: Settlement[]): Settlement[] {
  return settlements.filter((s) => s.status === "approved");
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function computeBalances(
  memberIds: string[],
  expenses: Expense[],
  settlements: Settlement[]
): Balance[] {
  const net: Record<string, number> = {};
  memberIds.forEach((uid) => (net[uid] = 0));

  for (const expense of activeExpenses(expenses)) {
    net[expense.paidBy] = (net[expense.paidBy] || 0) + expense.amount;
    for (const split of expense.splits) {
      net[split.uid] = (net[split.uid] || 0) - split.amount;
    }
  }

  for (const settlement of approvedSettlements(settlements)) {
    net[settlement.fromUid] = (net[settlement.fromUid] || 0) + settlement.amount;
    net[settlement.toUid] = (net[settlement.toUid] || 0) - settlement.amount;
  }

  return Object.entries(net).map(([uid, netAmount]) => ({
    uid,
    netAmount: round2(netAmount),
  }));
}

export function simplifyDebts(balances: Balance[]): SimplifiedTransaction[] {
  const creditors = balances
    .filter((b) => b.netAmount > 0.01)
    .map((b) => ({ ...b }))
    .sort((a, b) => b.netAmount - a.netAmount);
  const debtors = balances
    .filter((b) => b.netAmount < -0.01)
    .map((b) => ({ ...b, netAmount: -b.netAmount }))
    .sort((a, b) => b.netAmount - a.netAmount);

  const transactions: SimplifiedTransaction[] = [];
  let i = 0;
  let j = 0;

  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i];
    const creditor = creditors[j];
    const amount = Math.min(debtor.netAmount, creditor.netAmount);

    if (amount > 0.01) {
      transactions.push({
        fromUid: debtor.uid,
        toUid: creditor.uid,
        amount: round2(amount),
      });
    }

    debtor.netAmount -= amount;
    creditor.netAmount -= amount;

    if (debtor.netAmount < 0.01) i++;
    if (creditor.netAmount < 0.01) j++;
  }

  return transactions;
}

/**
 * Pairwise "who owes whom" ledger built only from the expenses two people
 * actually shared, netted per pair. Approved settlements between the pair
 * reduce what the payer owes the payee. Unlike simplifyDebts this never routes
 * a debt through a third party, which is what makes it safe to compare and
 * offset the same pair's balances across different groups.
 */
export function computePairwiseLedger(
  expenses: Expense[],
  settlements: Settlement[]
): Record<string, Record<string, number>> {
  // owes[a][b] = how much a owes b
  const owes: Record<string, Record<string, number>> = {};
  const add = (a: string, b: string, amount: number) => {
    if (!owes[a]) owes[a] = {};
    owes[a][b] = (owes[a][b] || 0) + amount;
  };

  for (const expense of activeExpenses(expenses)) {
    for (const split of expense.splits) {
      if (split.uid === expense.paidBy) continue;
      add(split.uid, expense.paidBy, split.amount);
    }
  }

  for (const s of approvedSettlements(settlements)) {
    // s.fromUid paid s.toUid, reducing what fromUid owes toUid.
    add(s.fromUid, s.toUid, -s.amount);
  }

  return owes;
}

/**
 * Net amount `a` owes `b` for a single group. Negative means `b` owes `a`.
 * This is the building block for cross-group settlement.
 */
export function pairwiseNet(
  uidA: string,
  uidB: string,
  expenses: Expense[],
  settlements: Settlement[]
): number {
  const owes = computePairwiseLedger(expenses, settlements);
  return round2((owes[uidA]?.[uidB] || 0) - (owes[uidB]?.[uidA] || 0));
}

export function computeDirectDebts(
  memberIds: string[],
  expenses: Expense[],
  settlements: Settlement[]
): SimplifiedTransaction[] {
  const owes = computePairwiseLedger(expenses, settlements);

  const transactions: SimplifiedTransaction[] = [];
  const seen = new Set<string>();
  for (const a of memberIds) {
    for (const b of memberIds) {
      if (a === b) continue;
      const key = [a, b].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      const net = (owes[a]?.[b] || 0) - (owes[b]?.[a] || 0);
      if (net > 0.01) {
        transactions.push({ fromUid: a, toUid: b, amount: round2(net) });
      } else if (net < -0.01) {
        transactions.push({ fromUid: b, toUid: a, amount: round2(-net) });
      }
    }
  }
  return transactions;
}

export interface SettlementProgress {
  /** Gross money one member ever covered on another member's behalf. */
  totalDebt: number;
  /** Value already settled: approved payments and cross-group offsets. */
  clearedDebt: number;
  /** How much still needs to move for everyone to be square. */
  outstanding: number;
  /** 0–100. 100 when nobody owes anybody. */
  pct: number;
  /** True when there has never been anything to settle. */
  isEmpty: boolean;
}

/**
 * Money-based settlement progress.
 *
 * The old implementation counted expenses whose id happened to be tagged on an
 * approved settlement (`expenseIds`). That tag is only ever written when the
 * payer manually ticks items in the settle-up sheet, so a fully settled group
 * routinely reported 0% while an empty group reported 100%. Progress is now
 * derived from the ledger itself:
 *
 *   totalDebt   = every rupee one member covered on another member's behalf
 *   outstanding = every rupee that still has to move (sum of positive nets)
 *
 * so a group where debts cancel out, or where everyone has paid up, reads 100%.
 *
 * Progress is `settled / (settled + outstanding)`. Anchoring it to the gross
 * expense debt instead would report 0% for a group where someone *overpaid* —
 * the original debt is gone, yet a refund is now outstanding — whereas this
 * form correctly reports most of the work as done with a little left to move.
 */
export function computeSettlementProgress(
  memberIds: string[],
  expenses: Expense[],
  settlements: Settlement[]
): SettlementProgress {
  let totalDebt = 0;
  for (const expense of activeExpenses(expenses)) {
    for (const split of expense.splits) {
      if (split.uid === expense.paidBy) continue;
      totalDebt += split.amount;
    }
  }
  totalDebt = round2(totalDebt);

  const clearedDebt = round2(
    approvedSettlements(settlements).reduce((sum, s) => sum + s.amount, 0)
  );

  const balances = computeBalances(memberIds, expenses, settlements);
  const outstanding = Math.max(
    0,
    round2(balances.reduce((sum, b) => sum + (b.netAmount > 0 ? b.netAmount : 0), 0))
  );

  // Nothing was ever owed, and nothing was ever paid.
  if (totalDebt <= 0.01 && clearedDebt <= 0.01) {
    return { totalDebt: 0, clearedDebt: 0, outstanding: 0, pct: 100, isEmpty: true };
  }

  const movement = round2(clearedDebt + outstanding);
  // Debts that cancelled each other out need no payment at all: fully settled.
  const pct =
    movement <= 0.01
      ? 100
      : Math.max(0, Math.min(100, Math.round((clearedDebt / movement) * 100)));
  return { totalDebt, clearedDebt, outstanding, pct, isEmpty: false };
}

export function splitEqually(amount: number, memberIds: string[]): { uid: string; amount: number }[] {
  if (memberIds.length === 0) return [];
  const share = Math.floor((amount / memberIds.length) * 100) / 100;
  const splits = memberIds.map((uid) => ({ uid, amount: share }));
  const total = share * memberIds.length;
  const remainder = round2(amount - total);
  if (remainder !== 0) {
    splits[0].amount = round2(splits[0].amount + remainder);
  }
  return splits;
}

/**
 * Rescales an existing split to a new total, preserving each person's relative
 * share and putting any rounding remainder on the first entry.
 *
 * Editing an expense used to change only the amount and leave the splits
 * untouched, so a ₹300 expense edited to ₹600 still had ₹100+₹100+₹100 of
 * splits — the payer appeared to be owed ₹500 out of ₹600 and every balance in
 * the group was wrong from then on.
 */
export function rescaleSplits(
  splits: { uid: string; amount: number }[],
  newAmount: number
): { uid: string; amount: number }[] {
  if (splits.length === 0) return [];
  const oldTotal = splits.reduce((sum, s) => sum + s.amount, 0);
  if (oldTotal <= 0) return splitEqually(newAmount, splits.map((s) => s.uid));

  const scaled = splits.map((s) => ({
    uid: s.uid,
    amount: Math.floor((s.amount / oldTotal) * newAmount * 100) / 100,
  }));
  const remainder = round2(newAmount - scaled.reduce((sum, s) => sum + s.amount, 0));
  if (remainder !== 0) scaled[0].amount = round2(scaled[0].amount + remainder);
  return scaled;
}

export function formatCurrency(amount: number, currency = "INR"): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Who is allowed to accept or decline a pending settlement: always the party
 * that did *not* create it. Legacy records have no `createdBy`, in which case
 * the creator is assumed to be the payer (`fromUid`), preserving the original
 * "the payee approves" behaviour.
 */
export function settlementCreator(s: Settlement): string {
  return s.createdBy || s.fromUid;
}

export function canRespondToSettlement(s: Settlement, uid: string): boolean {
  if (s.status !== "pending") return false;
  if (settlementCreator(s) === uid) return false;
  return s.fromUid === uid || s.toUid === uid;
}
