import { Expense, Settlement, Balance, SimplifiedTransaction } from "./types";
import {
  allocatePaise,
  dividePaise,
  fromPaise,
  isSettled,
  toPaise,
} from "./money";

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

/**
 * Approved settlements are the only ones that move money.
 *
 * A missing `status` counts as approved: records written before the approval
 * flow existed have no status field, and the app has always treated them as
 * settled. `subscribeToSettlements` already applies this default on read, but
 * relying on that meant this function quietly disagreed with the same
 * calculation run against raw documents (a script, an export, a Cloud
 * Function). Defaulting here too keeps one answer everywhere.
 */
export function approvedSettlements(settlements: Settlement[]): Settlement[] {
  return settlements.filter((s) => (s.status || "approved") === "approved");
}

export { isSettled };

/**
 * Everyone who appears anywhere in a group's ledger, not just its current
 * members.
 *
 * Removing a member strips them from `memberIds` but leaves their expenses and
 * splits in place, so their share of the ledger lives on. Deriving the
 * participant set from the data means a debt involving someone who has left is
 * still listed and can still be settled. Previously `computeDirectDebts` looped
 * over `memberIds` alone, so those debts appeared in the balance chips with no
 * corresponding settle-up row — visible, but impossible to clear.
 */
export function ledgerParticipants(
  memberIds: string[],
  expenses: Expense[],
  settlements: Settlement[]
): string[] {
  const uids = new Set<string>(memberIds);
  for (const expense of activeExpenses(expenses)) {
    if (expense.paidBy) uids.add(expense.paidBy);
    for (const split of expense.splits || []) {
      if (split.uid) uids.add(split.uid);
    }
  }
  for (const s of approvedSettlements(settlements)) {
    if (s.fromUid) uids.add(s.fromUid);
    if (s.toUid) uids.add(s.toUid);
  }
  return [...uids];
}

/**
 * What an expense actually allocated to people, in paise.
 *
 * The payer is credited this rather than `expense.amount`, and that difference
 * matters. Every "who owes whom" view in the app is built purely from
 * `split.amount`, so crediting the payer `amount` made the two disagree
 * whenever the splits didn't sum to the total — the payer kept a residual that
 * no settlement could ever clear, because nobody was carrying the other side of
 * it. `subscribeToExpenses` defaults a missing `splits` array to `[]`, so a
 * single bad write was enough to mint a permanent phantom balance.
 *
 * Crediting the allocated total instead makes the ledger close by construction:
 * the sum of every member's net is always exactly zero, and any unallocated
 * remainder is treated as what it is — the payer's own cost.
 */
function allocatedPaise(expense: Expense): number {
  return (expense.splits || []).reduce((total, s) => total + toPaise(s.amount), 0);
}

export function computeBalances(
  memberIds: string[],
  expenses: Expense[],
  settlements: Settlement[]
): Balance[] {
  const net = new Map<string, number>();
  for (const uid of ledgerParticipants(memberIds, expenses, settlements)) {
    net.set(uid, 0);
  }
  const bump = (uid: string, paise: number) => net.set(uid, (net.get(uid) || 0) + paise);

  for (const expense of activeExpenses(expenses)) {
    bump(expense.paidBy, allocatedPaise(expense));
    for (const split of expense.splits || []) {
      bump(split.uid, -toPaise(split.amount));
    }
  }

  for (const settlement of approvedSettlements(settlements)) {
    bump(settlement.fromUid, toPaise(settlement.amount));
    bump(settlement.toUid, -toPaise(settlement.amount));
  }

  return [...net.entries()].map(([uid, paise]) => ({ uid, netAmount: fromPaise(paise) }));
}

export function simplifyDebts(balances: Balance[]): SimplifiedTransaction[] {
  const creditors = balances
    .map((b) => ({ uid: b.uid, paise: toPaise(b.netAmount) }))
    .filter((b) => b.paise > 0)
    .sort((a, b) => b.paise - a.paise || a.uid.localeCompare(b.uid));
  const debtors = balances
    .map((b) => ({ uid: b.uid, paise: -toPaise(b.netAmount) }))
    .filter((b) => b.paise > 0)
    .sort((a, b) => b.paise - a.paise || a.uid.localeCompare(b.uid));

  const transactions: SimplifiedTransaction[] = [];
  let i = 0;
  let j = 0;

  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i];
    const creditor = creditors[j];
    const amount = Math.min(debtor.paise, creditor.paise);

    // Emit every non-zero transfer. The old version skipped anything at or
    // below one paise while still deducting it from both sides, so the
    // transactions it produced didn't always add up to the balances it was
    // given.
    if (amount > 0) {
      transactions.push({
        fromUid: debtor.uid,
        toUid: creditor.uid,
        amount: fromPaise(amount),
      });
    }

    debtor.paise -= amount;
    creditor.paise -= amount;
    if (debtor.paise === 0) i++;
    if (creditor.paise === 0) j++;
  }

  return transactions;
}

/**
 * Pairwise "who owes whom" ledger built only from the expenses two people
 * actually shared, netted per pair. Approved settlements between the pair
 * reduce what the payer owes the payee. Unlike simplifyDebts this never routes
 * a debt through a third party, which is what makes it safe to compare and
 * offset the same pair's balances across different groups.
 *
 * Values are exact paise.
 */
export function computePairwiseLedger(
  expenses: Expense[],
  settlements: Settlement[]
): Record<string, Record<string, number>> {
  // owes[a][b] = how much a owes b, in paise
  const owes: Record<string, Record<string, number>> = {};
  const add = (a: string, b: string, paise: number) => {
    if (!owes[a]) owes[a] = {};
    owes[a][b] = (owes[a][b] || 0) + paise;
  };

  for (const expense of activeExpenses(expenses)) {
    for (const split of expense.splits || []) {
      if (split.uid === expense.paidBy) continue;
      add(split.uid, expense.paidBy, toPaise(split.amount));
    }
  }

  for (const s of approvedSettlements(settlements)) {
    // s.fromUid paid s.toUid, reducing what fromUid owes toUid.
    add(s.fromUid, s.toUid, -toPaise(s.amount));
  }

  return owes;
}

/** Net paise `a` owes `b`. Negative means `b` owes `a`. */
function pairNetPaise(
  owes: Record<string, Record<string, number>>,
  a: string,
  b: string
): number {
  return (owes[a]?.[b] || 0) - (owes[b]?.[a] || 0);
}

/**
 * Net amount `a` owes `b` for a single group, in rupees. Negative means `b`
 * owes `a`. This is the building block for cross-group comparison.
 */
export function pairwiseNet(
  uidA: string,
  uidB: string,
  expenses: Expense[],
  settlements: Settlement[]
): number {
  return fromPaise(pairNetPaise(computePairwiseLedger(expenses, settlements), uidA, uidB));
}

export function computeDirectDebts(
  memberIds: string[],
  expenses: Expense[],
  settlements: Settlement[]
): SimplifiedTransaction[] {
  const owes = computePairwiseLedger(expenses, settlements);
  // Derived from the ledger, not from memberIds, so a balance with someone who
  // has left the group still gets a row that can be settled.
  const participants = ledgerParticipants(memberIds, expenses, settlements);

  const transactions: SimplifiedTransaction[] = [];
  const seen = new Set<string>();
  for (const a of participants) {
    for (const b of participants) {
      if (a === b) continue;
      const key = [a, b].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      const net = pairNetPaise(owes, a, b);
      if (net > 0) {
        transactions.push({ fromUid: a, toUid: b, amount: fromPaise(net) });
      } else if (net < 0) {
        transactions.push({ fromUid: b, toUid: a, amount: fromPaise(-net) });
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
  let totalDebtPaise = 0;
  for (const expense of activeExpenses(expenses)) {
    for (const split of expense.splits || []) {
      if (split.uid === expense.paidBy) continue;
      totalDebtPaise += toPaise(split.amount);
    }
  }

  const clearedPaise = approvedSettlements(settlements).reduce(
    (sum, s) => sum + toPaise(s.amount),
    0
  );

  const outstandingPaise = computeBalances(memberIds, expenses, settlements).reduce(
    (sum, b) => sum + Math.max(0, toPaise(b.netAmount)),
    0
  );

  // Nothing was ever owed, and nothing was ever paid.
  if (totalDebtPaise === 0 && clearedPaise === 0) {
    return { totalDebt: 0, clearedDebt: 0, outstanding: 0, pct: 100, isEmpty: true };
  }

  const movement = clearedPaise + outstandingPaise;
  // Debts that cancelled each other out need no payment at all: fully settled.
  const pct =
    movement === 0
      ? 100
      : Math.max(0, Math.min(100, Math.round((clearedPaise / movement) * 100)));

  return {
    totalDebt: fromPaise(totalDebtPaise),
    clearedDebt: fromPaise(clearedPaise),
    outstanding: fromPaise(outstandingPaise),
    pct,
    isEmpty: false,
  };
}

/**
 * Splits `amount` equally, to the paise, summing back to `amount` exactly.
 *
 * The remainder is spread one paise per person instead of being piled onto the
 * first member — see `dividePaise`.
 */
export function splitEqually(
  amount: number,
  memberIds: string[]
): { uid: string; amount: number }[] {
  if (memberIds.length === 0) return [];
  const shares = dividePaise(toPaise(amount), memberIds.length);
  return memberIds.map((uid, i) => ({ uid, amount: fromPaise(shares[i]) }));
}

/**
 * Rescales an existing split to a new total, preserving each person's relative
 * share and summing back to `newAmount` exactly.
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
  const weights = splits.map((s) => toPaise(s.amount));
  const shares = allocatePaise(toPaise(newAmount), weights);
  return splits.map((s, i) => ({ uid: s.uid, amount: fromPaise(shares[i]) }));
}

/**
 * Forces a stored split to sum to its expense total, in whole paise.
 *
 * Applied on every write so the invariant the whole ledger depends on —
 * `sum(splits) === amount` — can never be broken by a rounding slip, a
 * hand-edited document, or an amount typed with three decimal places.
 */
export function normaliseSplits(
  amount: number,
  splits: { uid: string; amount: number }[]
): { uid: string; amount: number }[] {
  if (splits.length === 0) return [];
  const target = toPaise(amount);
  const current = splits.map((s) => toPaise(s.amount));
  const total = current.reduce((t, v) => t + v, 0);
  if (total === target) {
    return splits.map((s, i) => ({ uid: s.uid, amount: fromPaise(current[i]) }));
  }
  const shares = total > 0 ? allocatePaise(target, current) : dividePaise(target, splits.length);
  return splits.map((s, i) => ({ uid: s.uid, amount: fromPaise(shares[i]) }));
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
