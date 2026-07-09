import { Expense, Settlement, Balance, SimplifiedTransaction } from "./types";

export function computeBalances(
  memberIds: string[],
  expenses: Expense[],
  settlements: Settlement[]
): Balance[] {
  const net: Record<string, number> = {};
  memberIds.forEach((uid) => (net[uid] = 0));

  for (const expense of expenses) {
    net[expense.paidBy] = (net[expense.paidBy] || 0) + expense.amount;
    for (const split of expense.splits) {
      net[split.uid] = (net[split.uid] || 0) - split.amount;
    }
  }

  for (const settlement of settlements) {
    if (settlement.status !== "approved") continue;
    net[settlement.fromUid] = (net[settlement.fromUid] || 0) + settlement.amount;
    net[settlement.toUid] = (net[settlement.toUid] || 0) - settlement.amount;
  }

  return Object.entries(net).map(([uid, netAmount]) => ({
    uid,
    netAmount: Math.round(netAmount * 100) / 100,
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

/**
 * Direct (non-simplified) debts: each person owes another based only on the
 * expenses they actually shared, netted pairwise. Approved settlements between
 * the two people reduce what the payer owes the payee. Unlike simplifyDebts,
 * this never routes a debt through a third party.
 */
export function computeDirectDebts(
  memberIds: string[],
  expenses: Expense[],
  settlements: Settlement[]
): SimplifiedTransaction[] {
  // owes[a][b] = how much a owes b
  const owes: Record<string, Record<string, number>> = {};
  const add = (a: string, b: string, amount: number) => {
    if (!owes[a]) owes[a] = {};
    owes[a][b] = (owes[a][b] || 0) + amount;
  };

  for (const expense of expenses) {
    if (expense.editAction) continue;
    for (const split of expense.splits) {
      if (split.uid === expense.paidBy) continue;
      add(split.uid, expense.paidBy, split.amount);
    }
  }

  for (const s of settlements) {
    if (s.status !== "approved") continue;
    // s.fromUid paid s.toUid, reducing what fromUid owes toUid.
    add(s.fromUid, s.toUid, -s.amount);
  }

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
        transactions.push({ fromUid: a, toUid: b, amount: Math.round(net * 100) / 100 });
      } else if (net < -0.01) {
        transactions.push({ fromUid: b, toUid: a, amount: Math.round(-net * 100) / 100 });
      }
    }
  }
  return transactions;
}

export function splitEqually(amount: number, memberIds: string[]): { uid: string; amount: number }[] {
  const share = Math.floor((amount / memberIds.length) * 100) / 100;
  const splits = memberIds.map((uid) => ({ uid, amount: share }));
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
