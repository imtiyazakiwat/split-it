import { Expense, Settlement, SettlementStatus } from "./types";
import { isActiveExpense } from "./balance";

/**
 * Pairwise statement between two people — the "why do I owe this?" ledger.
 *
 * Every row is one real event (an expense one of them covered, or a payment
 * between them) with the running balance after it, so a number can always be
 * traced back to the things that produced it.
 *
 * Sign convention throughout: POSITIVE means `otherUid` owes `meUid`.
 * Negative means `meUid` owes `otherUid`. Only these two people's shares are
 * ever considered, so the total never routes through a third person.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

export type StatementRowKind = "expense-they-paid" | "expense-i-paid" | "payment-i-sent" | "payment-they-sent";

export interface StatementRow {
  key: string;
  ts: number;
  kind: StatementRowKind;
  /** Plain-words description of the event, e.g. "Lunch" or "You paid Ganesh". */
  label: string;
  /**
   * Supporting numbers for the secondary line, unformatted on purpose: currency
   * formatting belongs to the renderer (formatCurrency), not to this model. Only
   * set on expense rows.
   */
  expenseTotal?: number;
  /** The share this row is about — mine when they paid, theirs when I paid. */
  shareAmount?: number;
  /** Free-text note the payer attached. Only set on payment rows. */
  note?: string;
  /** Change to the pair's balance. Positive: they owe me more. */
  delta: number;
  /** Running balance after this row. Positive: they owe me. */
  balance: number;
  /** Only set on payment rows. Pending/rejected rows never move the balance. */
  status?: SettlementStatus;
  /** True when the row is shown for information but excluded from the balance. */
  informationalOnly: boolean;
  expenseId?: string;
  settlementId?: string;
}

export interface PairStatement {
  otherUid: string;
  rows: StatementRow[];
  /** Positive: they owe me. Negative: I owe them. */
  net: number;
  /** Total of their shares on expenses I covered. */
  iCoveredForThem: number;
  /** Total of my shares on expenses they covered. */
  theyCoveredForMe: number;
  /** Approved payments I sent them. */
  iPaid: number;
  /** Approved payments they sent me. */
  theyPaid: number;
  /** Payments awaiting a response, by direction. */
  pendingFromMe: number;
  pendingFromThem: number;
  /** Number of expenses the two of them actually shared. */
  sharedExpenseCount: number;
}

function settlementStatus(s: Settlement): SettlementStatus {
  // Records written before the approval flow carry no status; the app has
  // always treated those as approved.
  return s.status || "approved";
}

export function buildPairStatement(
  meUid: string,
  otherUid: string,
  expenses: Expense[],
  settlements: Settlement[]
): PairStatement {
  const rows: StatementRow[] = [];
  let iCoveredForThem = 0;
  let theyCoveredForMe = 0;
  let iPaid = 0;
  let theyPaid = 0;
  let pendingFromMe = 0;
  let pendingFromThem = 0;
  let sharedExpenseCount = 0;

  for (const e of expenses) {
    if (!isActiveExpense(e)) continue;
    const myShare = e.splits.find((s) => s.uid === meUid)?.amount ?? 0;
    const theirShare = e.splits.find((s) => s.uid === otherUid)?.amount ?? 0;

    if (e.paidBy === otherUid && myShare > 0) {
      sharedExpenseCount += 1;
      theyCoveredForMe = round2(theyCoveredForMe + myShare);
      rows.push({
        key: `e-${e.id}`,
        ts: e.createdAt,
        kind: "expense-they-paid",
        label: e.description || "Expense",
        expenseTotal: round2(e.amount),
        shareAmount: round2(myShare),
        delta: -round2(myShare),
        balance: 0,
        informationalOnly: false,
        expenseId: e.id,
      });
    } else if (e.paidBy === meUid && theirShare > 0) {
      sharedExpenseCount += 1;
      iCoveredForThem = round2(iCoveredForThem + theirShare);
      rows.push({
        key: `e-${e.id}`,
        ts: e.createdAt,
        kind: "expense-i-paid",
        label: e.description || "Expense",
        expenseTotal: round2(e.amount),
        shareAmount: round2(theirShare),
        delta: round2(theirShare),
        balance: 0,
        informationalOnly: false,
        expenseId: e.id,
      });
    }
  }

  for (const s of settlements) {
    const involvesPair =
      (s.fromUid === meUid && s.toUid === otherUid) ||
      (s.fromUid === otherUid && s.toUid === meUid);
    if (!involvesPair) continue;
    const status = settlementStatus(s);
    const approved = status === "approved";
    const iSent = s.fromUid === meUid;

    if (approved) {
      if (iSent) iPaid = round2(iPaid + s.amount);
      else theyPaid = round2(theyPaid + s.amount);
    } else if (status === "pending") {
      if (iSent) pendingFromMe = round2(pendingFromMe + s.amount);
      else pendingFromThem = round2(pendingFromThem + s.amount);
    }

    rows.push({
      key: `s-${s.id}`,
      ts: s.createdAt,
      kind: iSent ? "payment-i-sent" : "payment-they-sent",
      label: iSent ? "You paid them" : "They paid you",
      note: s.note || undefined,
      // A payment I make reduces what I owe, i.e. moves the balance towards
      // them owing me. Only approved payments move it at all.
      delta: approved ? (iSent ? round2(s.amount) : -round2(s.amount)) : 0,
      balance: 0,
      status,
      informationalOnly: !approved,
      settlementId: s.id,
    });
  }

  rows.sort((a, b) => a.ts - b.ts || a.key.localeCompare(b.key));

  let running = 0;
  for (const row of rows) {
    running = round2(running + row.delta);
    row.balance = running;
  }

  return {
    otherUid,
    rows,
    net: running,
    iCoveredForThem,
    theyCoveredForMe,
    iPaid,
    theyPaid,
    pendingFromMe,
    pendingFromThem,
    sharedExpenseCount,
  };
}

/** "Ganesh owes you ₹98.50" / "You owe Ganesh ₹20" / "You're settled up". */
export function describeNet(net: number, otherName: string, format: (n: number) => string): string {
  if (Math.abs(net) < 0.01) return "You\u2019re settled up";
  return net > 0
    ? `${otherName} owes you ${format(net)}`
    : `You owe ${otherName} ${format(-net)}`;
}

/**
 * Deep link to a single item inside a group.
 *
 * Notifications and activity rows used to point at `/groups/{id}`, which dropped
 * you at the top of the group and left you hunting for the thing the
 * notification was actually about. The group screen reads these params and opens
 * the matching detail sheet.
 */
export function groupItemLink(
  groupId: string,
  item?: { kind: "expense" | "settlement"; id: string }
): string {
  if (!item) return `/groups/${groupId}`;
  const key = item.kind === "expense" ? "expense" : "settlement";
  return `/groups/${groupId}?${key}=${encodeURIComponent(item.id)}`;
}
