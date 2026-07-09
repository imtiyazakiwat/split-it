import { Expense, Settlement, Balance, SimplifiedTransaction } from "./types";

/**
 * Computes net balance per user from a list of expenses and settlements.
 * Positive netAmount = this user is owed money overall.
 * Negative netAmount = this user owes money overall.
 */
export function computeBalances(
  memberIds: string[],
  expenses: Expense[],
  settlements: Settlement[]
): Balance[] {
  const net: Record<string, number> = {};
  memberIds.forEach((uid) => (net[uid] = 0));

  for (const expense of expenses) {
    // Payer is owed the full amount
    net[expense.paidBy] = (net[expense.paidBy] || 0) + expense.amount;
    // Each participant owes their split
    for (const split of expense.splits) {
      net[split.uid] = (net[split.uid] || 0) - split.amount;
    }
  }

  for (const settlement of settlements) {
    // fromUid paid toUid, so fromUid's debt decreases (net increases),
    // toUid's credit decreases (net decreases)
    net[settlement.fromUid] = (net[settlement.fromUid] || 0) + settlement.amount;
    net[settlement.toUid] = (net[settlement.toUid] || 0) - settlement.amount;
  }

  return Object.entries(net).map(([uid, netAmount]) => ({
    uid,
    netAmount: Math.round(netAmount * 100) / 100,
  }));
}

/**
 * Simplifies debts so the minimum number of transactions settle all balances.
 * Classic greedy algorithm: match the largest debtor with the largest creditor repeatedly.
 */
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
        amount: Math.round(amount * 100) / 100,
      });
    }

    debtor.netAmount -= amount;
    creditor.netAmount -= amount;

    if (debtor.netAmount < 0.01) i++;
    if (creditor.netAmount < 0.01) j++;
  }

  return transactions;
}

export function splitEqually(amount: number, memberIds: string[]): { uid: string; amount: number }[] {
  const share = Math.floor((amount / memberIds.length) * 100) / 100;
  const splits = memberIds.map((uid) => ({ uid, amount: share }));
  // Distribute rounding remainder to the first member(s)
  const total = share * memberIds.length;
  const remainder = Math.round((amount - total) * 100) / 100;
  if (remainder !== 0) {
    splits[0].amount = Math.round((splits[0].amount + remainder) * 100) / 100;
  }
  return splits;
}

export function formatCurrency(amount: number, currency = "INR"): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}
