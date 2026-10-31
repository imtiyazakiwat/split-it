import { describe, expect, it } from "vitest";
import { pendingForMe, unappliedForMe, SettleableDataset } from "./transfer-queries";
import { DirectTransfer, Expense } from "./types";

const ME = "me";
const ASHA = "asha";
const ROHAN = "rohan";

function transfer(over: Partial<DirectTransfer>): DirectTransfer {
  return {
    id: "t1",
    fromUid: ASHA,
    toUid: ME,
    participants: [ASHA, ME],
    amount: 500,
    receiptUrls: [],
    status: "accepted",
    createdBy: ASHA,
    createdAt: 1,
    ...over,
  };
}

/** A group where `debtor` owes `creditor` half of `amount`. */
function groupWhere(id: string, creditor: string, debtor: string, amount: number): SettleableDataset {
  const expense: Expense = {
    id: `e-${id}`,
    groupId: id,
    description: "Dinner",
    amount,
    paidBy: creditor,
    splitType: "equal",
    splits: [
      { uid: creditor, amount: amount / 2 },
      { uid: debtor, amount: amount / 2 },
    ],
    receiptUrls: [],
    createdBy: creditor,
    createdAt: 1,
  };
  return { group: { id, memberIds: [creditor, debtor] }, expenses: [expense], settlements: [] };
}

describe("unappliedForMe", () => {
  it("drops a payment confirmed as personal when there is no group balance to settle", () => {
    // The reported bug: "Received, not for a group" left the row in Waiting on You forever.
    const t = transfer({ status: "accepted", allocatedAmount: 0 });
    expect(unappliedForMe([t], ME, [])).toEqual([]);
  });

  it("drops it when the sender owes nothing in the shared groups", () => {
    const t = transfer({});
    const iOweAsha = groupWhere("g1", ASHA, ME, 400);
    expect(unappliedForMe([t], ME, [iOweAsha])).toEqual([]);
  });

  it("keeps it while the sender still owes the receiver in a shared group", () => {
    const t = transfer({});
    const ashaOwesMe = groupWhere("g1", ME, ASHA, 400);
    expect(unappliedForMe([t], ME, [ashaOwesMe])).toEqual([t]);
  });

  it("ignores debts from groups the sender isn't in", () => {
    const t = transfer({});
    const rohanOwesMe = groupWhere("g1", ME, ROHAN, 400);
    expect(unappliedForMe([t], ME, [rohanOwesMe])).toEqual([]);
  });

  it("drops fully allocated, pending, declined and outgoing transfers", () => {
    const ashaOwesMe = groupWhere("g1", ME, ASHA, 400);
    const cases = [
      transfer({ allocations: { s1: { groupId: "g1", amount: 500 } }, allocatedAmount: 500 }),
      transfer({ status: "pending" }),
      transfer({ status: "declined" }),
      transfer({ fromUid: ME, toUid: ASHA, participants: [ME, ASHA] }),
    ];
    expect(unappliedForMe(cases, ME, [ashaOwesMe])).toEqual([]);
  });

  it("keeps a partly booked payment while a balance remains elsewhere", () => {
    const t = transfer({ amount: 500, allocations: { s1: { groupId: "g1", amount: 200 } }, allocatedAmount: 200 });
    const ashaOwesMe = groupWhere("g2", ME, ASHA, 400);
    expect(unappliedForMe([t], ME, [ashaOwesMe])).toEqual([t]);
  });
});

describe("pendingForMe", () => {
  it("lists only incoming pending transfers", () => {
    const incoming = transfer({ id: "a", status: "pending" });
    const outgoing = transfer({ id: "b", status: "pending", fromUid: ME, toUid: ASHA });
    const done = transfer({ id: "c", status: "accepted" });
    expect(pendingForMe([incoming, outgoing, done], ME)).toEqual([incoming]);
  });
});
