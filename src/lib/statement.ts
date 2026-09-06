import { DirectTransfer, Expense, Settlement, SettlementStatus } from "./types";
import { isActiveExpense } from "./balance";
import { fromPaise, isSettled, toPaise } from "./money";
import { unallocatedAmount } from "./transfer-allocation";

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
 *
 * Accumulated in exact paise. This file used to apply `round2` at every single
 * step while `computeBalances` accumulated raw floats and rounded once at the
 * end, so the statement's total and the group screen's balance chip could
 * differ by a paise for the same pair — the "why do I owe this" screen
 * contradicting the number it was opened to explain.
 */

export type StatementRowKind =
  | "expense-they-paid"
  | "expense-i-paid"
  | "payment-i-sent"
  | "payment-they-sent"
  | "direct-i-sent"
  | "direct-they-sent";

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
  transferId?: string;
  /** Full transfer amount, set only on direct rows (for partial-booking copy). */
  transferAmount?: number;
  /** How much of the transfer was already booked into groups. Direct rows only. */
  allocatedAmount?: number;
}

export interface PairStatement {
  otherUid: string;
  rows: StatementRow[];
  /** Positive: they owe me. Negative: I owe them. Groups + direct combined. */
  net: number;
  /** Total of their shares on expenses I covered. */
  iCoveredForThem: number;
  /** Total of my shares on expenses they covered. */
  theyCoveredForMe: number;
  /** Approved payments I sent them (groups + direct remainder). */
  iPaid: number;
  /** Approved payments they sent me (groups + direct remainder). */
  theyPaid: number;
  /** Payments awaiting a response, by direction (groups + direct). */
  pendingFromMe: number;
  pendingFromThem: number;
  /** Number of expenses the two of them actually shared. */
  sharedExpenseCount: number;
  /** Direct-only net (statement sign: positive = they owe me). */
  directNet: number;
  /** Accepted direct remainder I sent (personal, not in any group). */
  iPaidDirect: number;
  /** Accepted direct remainder they sent. */
  theyPaidDirect: number;
  /** Number of direct transfers touching this pair (any status). */
  directTransferCount: number;
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
  settlements: Settlement[],
  transfers: DirectTransfer[] = []
): PairStatement {
  const rows: StatementRow[] = [];
  // All accumulators are exact paise; converted to rupees only in the result.
  let iCoveredForThem = 0;
  let theyCoveredForMe = 0;
  let iPaid = 0;
  let theyPaid = 0;
  let pendingFromMe = 0;
  let pendingFromThem = 0;
  let sharedExpenseCount = 0;
  let iPaidDirect = 0;
  let theyPaidDirect = 0;
  let directTransferCount = 0;

  for (const e of expenses) {
    if (!isActiveExpense(e)) continue;
    const splits = e.splits || [];
    // Presence in the split, not a positive amount, decides whether the expense
    // is shared: a genuine zero share still means the two of them were both on
    // the bill, and testing `> 0` dropped it from the statement and from
    // `sharedExpenseCount` entirely.
    const mine = splits.find((s) => s.uid === meUid);
    const theirs = splits.find((s) => s.uid === otherUid);
    const mySharePaise = toPaise(mine?.amount ?? 0);
    const theirSharePaise = toPaise(theirs?.amount ?? 0);

    if (e.paidBy === otherUid && mine) {
      sharedExpenseCount += 1;
      theyCoveredForMe += mySharePaise;
      rows.push({
        key: `e-${e.id}`,
        ts: e.createdAt,
        kind: "expense-they-paid",
        label: e.description || "Expense",
        expenseTotal: fromPaise(toPaise(e.amount)),
        shareAmount: fromPaise(mySharePaise),
        delta: fromPaise(-mySharePaise),
        balance: 0,
        informationalOnly: false,
        expenseId: e.id,
      });
    } else if (e.paidBy === meUid && theirs) {
      sharedExpenseCount += 1;
      iCoveredForThem += theirSharePaise;
      rows.push({
        key: `e-${e.id}`,
        ts: e.createdAt,
        kind: "expense-i-paid",
        label: e.description || "Expense",
        expenseTotal: fromPaise(toPaise(e.amount)),
        shareAmount: fromPaise(theirSharePaise),
        delta: fromPaise(theirSharePaise),
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
    const amountPaise = toPaise(s.amount);

    if (approved) {
      if (iSent) iPaid += amountPaise;
      else theyPaid += amountPaise;
    } else if (status === "pending") {
      if (iSent) pendingFromMe += amountPaise;
      else pendingFromThem += amountPaise;
    }

    rows.push({
      key: `s-${s.id}`,
      ts: s.createdAt,
      kind: iSent ? "payment-i-sent" : "payment-they-sent",
      label: iSent ? "You paid them" : "They paid you",
      note: s.note || undefined,
      // A payment I make reduces what I owe, i.e. moves the balance towards
      // them owing me. Only approved payments move it at all.
      delta: approved ? fromPaise(iSent ? amountPaise : -amountPaise) : 0,
      balance: 0,
      status,
      informationalOnly: !approved,
      settlementId: s.id,
    });
  }

  // ── Direct (non-group) transfers ────────────────────────────────
  // Only the unallocated remainder moves the balance here: whatever was booked
  // into a group already appears above as its `transfer` settlement. Pending /
  // declined / cancelled rows are informational (delta 0), same as group
  // settlements awaiting approval.
  for (const t of transfers) {
    const involvesPair =
      (t.fromUid === meUid && t.toUid === otherUid) ||
      (t.fromUid === otherUid && t.toUid === meUid);
    if (!involvesPair) continue;
    directTransferCount += 1;
    const iSent = t.fromUid === meUid;
    const fullPaise = toPaise(t.amount);
    const unallocPaise = toPaise(unallocatedAmount(t));
    const allocatedPaise = fullPaise - unallocPaise;

    if (t.status === "accepted") {
      if (isSettled(unallocatedAmount(t))) continue; // fully booked → legs cover it
      if (iSent) {
        iPaid += unallocPaise;
        iPaidDirect += unallocPaise;
      } else {
        theyPaid += unallocPaise;
        theyPaidDirect += unallocPaise;
      }
      rows.push({
        key: `d-${t.id}`,
        ts: t.createdAt,
        kind: iSent ? "direct-i-sent" : "direct-they-sent",
        label: "Direct payment",
        note: t.note || undefined,
        delta: fromPaise(iSent ? unallocPaise : -unallocPaise),
        balance: 0,
        status: "approved",
        informationalOnly: false,
        transferId: t.id,
        transferAmount: fromPaise(fullPaise),
        allocatedAmount: fromPaise(allocatedPaise),
      });
    } else if (t.status === "pending") {
      if (iSent) pendingFromMe += fullPaise;
      else pendingFromThem += fullPaise;
      rows.push({
        key: `d-${t.id}`,
        ts: t.createdAt,
        kind: iSent ? "direct-i-sent" : "direct-they-sent",
        label: "Direct payment",
        note: t.note || undefined,
        delta: 0,
        balance: 0,
        status: "pending",
        informationalOnly: true,
        transferId: t.id,
        transferAmount: fromPaise(fullPaise),
        allocatedAmount: 0,
      });
    } else {
      // declined / cancelled — history only, never moves the balance.
      rows.push({
        key: `d-${t.id}`,
        ts: t.createdAt,
        kind: iSent ? "direct-i-sent" : "direct-they-sent",
        label: "Direct payment",
        note: t.note || undefined,
        delta: 0,
        balance: 0,
        status: "rejected",
        informationalOnly: true,
        transferId: t.id,
        transferAmount: fromPaise(fullPaise),
        allocatedAmount: 0,
      });
    }
  }

  rows.sort((a, b) => a.ts - b.ts || a.key.localeCompare(b.key));

  let runningPaise = 0;
  for (const row of rows) {
    runningPaise += toPaise(row.delta);
    row.balance = fromPaise(runningPaise);
  }

  return {
    otherUid,
    rows,
    net: fromPaise(runningPaise),
    iCoveredForThem: fromPaise(iCoveredForThem),
    theyCoveredForMe: fromPaise(theyCoveredForMe),
    iPaid: fromPaise(iPaid),
    theyPaid: fromPaise(theyPaid),
    pendingFromMe: fromPaise(pendingFromMe),
    pendingFromThem: fromPaise(pendingFromThem),
    sharedExpenseCount,
    directNet: fromPaise(iPaidDirect - theyPaidDirect),
    iPaidDirect: fromPaise(iPaidDirect),
    theyPaidDirect: fromPaise(theyPaidDirect),
    directTransferCount,
  };
}

/** "Ganesh owes you ₹98.50" / "You owe Ganesh ₹20" / "You're settled up". */
export function describeNet(net: number, otherName: string, format: (n: number) => string): string {
  if (isSettled(net)) return "You\u2019re settled up";
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
