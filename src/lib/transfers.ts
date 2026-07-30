import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "./firebase";
import { DirectTransfer } from "./types";
import { notifyUsers } from "./send-notification";

/**
 * Direct person-to-person transfers.
 *
 * The app has no payment rail of its own — money actually moves over UPI, cash
 * or a bank app. A transfer document therefore records a *claim* that money
 * moved, and the receiver is the only person who can turn that claim into
 * anything that affects a group balance. See `DirectTransfer` in types.ts.
 *
 * Everything here is a top-level `transfers` collection rather than a group
 * subcollection, because the whole point is that a direct payment doesn't
 * belong to a group until someone puts it in one.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

function toTransfer(id: string, data: Record<string, unknown>): DirectTransfer {
  return {
    id,
    ...data,
    receiptUrls: (data.receiptUrls as string[]) || [],
    status: (data.status as DirectTransfer["status"]) || "pending",
    createdBy: (data.createdBy as string) || (data.fromUid as string),
    updatedAt: (data.updatedAt as number) || (data.createdAt as number),
  } as DirectTransfer;
}

/**
 * Every transfer the user is either side of, newest first.
 *
 * Sorted in memory on purpose: `array-contains` plus `orderBy` needs a composite
 * index, and a person's direct transfers are a small enough set that ordering
 * them here costs nothing and keeps deployment to `firestore.rules` alone.
 */
export function subscribeToMyTransfers(
  uid: string,
  callback: (transfers: DirectTransfer[]) => void,
  onError?: (err: Error) => void
) {
  const q = query(collection(db, "transfers"), where("participants", "array-contains", uid));
  return onSnapshot(
    q,
    (snap) => {
      const transfers = snap.docs
        .map((d) => toTransfer(d.id, d.data()))
        .sort((a, b) => b.createdAt - a.createdAt);
      callback(transfers);
    },
    (err) => {
      console.error("[transfers] listener failed:", err);
      onError?.(err);
    }
  );
}

export interface NewTransfer {
  fromUid: string;
  toUid: string;
  amount: number;
  note?: string;
  receiptUrls?: string[];
}

async function displayName(uid: string): Promise<string> {
  try {
    const snap = await getDoc(doc(db, "users", uid));
    return (snap.data()?.displayName as string) || "Someone";
  } catch {
    return "Someone";
  }
}

export async function createTransfer(data: NewTransfer): Promise<string> {
  const amount = round2(data.amount);
  if (!(amount > 0)) throw new Error("Enter an amount greater than zero.");
  if (data.fromUid === data.toUid) throw new Error("You can't send money to yourself.");

  const ref = doc(collection(db, "transfers"));
  const batch = writeBatch(db);
  batch.set(ref, {
    fromUid: data.fromUid,
    toUid: data.toUid,
    participants: [data.fromUid, data.toUid],
    amount,
    ...(data.note ? { note: data.note } : {}),
    receiptUrls: data.receiptUrls || [],
    status: "pending",
    createdBy: data.fromUid,
    createdAt: Date.now(),
  });
  await batch.commit();

  try {
    const name = await displayName(data.fromUid);
    notifyUsers([data.toUid], {
      title: "Money received",
      body: `${name} says they sent you ₹${amount}. Confirm it to settle up.`,
      link: `/chat/${data.fromUid}`,
    });
  } catch {
    // notification is best-effort; the transfer is already recorded
  }

  return ref.id;
}

/** The sender withdrawing a claim they raised by mistake. */
export async function cancelTransfer(transfer: DirectTransfer): Promise<void> {
  await updateDoc(doc(db, "transfers", transfer.id), {
    status: "cancelled",
    updatedAt: Date.now(),
  });
}

/** The receiver saying the money never arrived. */
export async function declineTransfer(transfer: DirectTransfer): Promise<void> {
  await updateDoc(doc(db, "transfers", transfer.id), {
    status: "declined",
    updatedAt: Date.now(),
  });
  await notifyCounterparty(
    transfer,
    `Your ₹${transfer.amount} payment was marked as not received`
  );
}

/**
 * The receiver confirming the money without touching any group ledger — a gift,
 * a repayment of something the app never tracked, splitting a bill in cash.
 */
export async function acknowledgeTransfer(transfer: DirectTransfer): Promise<void> {
  await updateDoc(doc(db, "transfers", transfer.id), {
    status: "accepted",
    updatedAt: Date.now(),
  });
  await notifyCounterparty(transfer, `Your ₹${transfer.amount} payment was confirmed`);
}

/**
 * The receiver booking the money into one group's ledger, where it settles what
 * the sender owed them.
 *
 * Both writes go in one batch so a transfer can never be marked as applied
 * without the settlement existing, or vice versa. Firestore evaluates each
 * write in a batch against the state *before* the batch, which is what lets the
 * settlement rule check `appliedGroupId` is still unset while the same batch
 * sets it — and what makes a second attempt at the same transfer fail.
 */
export async function includeTransferInGroup(
  transfer: DirectTransfer,
  groupId: string
): Promise<string> {
  if (transfer.appliedGroupId) {
    throw new Error("This payment is already counted in a group.");
  }

  const now = Date.now();
  const settlementRef = doc(collection(db, "groups", groupId, "settlements"));
  const batch = writeBatch(db);

  batch.set(settlementRef, {
    groupId,
    fromUid: transfer.fromUid,
    toUid: transfer.toUid,
    amount: transfer.amount,
    // Born approved: the payee is the one writing it, and confirming money you
    // have received is exactly the approval the normal flow waits for.
    status: "approved",
    kind: "transfer",
    transferId: transfer.id,
    createdBy: transfer.toUid,
    receiptUrls: transfer.receiptUrls || [],
    expenseIds: [],
    note: transfer.note ? `Direct payment · ${transfer.note}` : "Direct payment",
    createdAt: now,
    updatedAt: now,
  });

  batch.update(doc(db, "transfers", transfer.id), {
    status: "accepted",
    appliedGroupId: groupId,
    appliedSettlementId: settlementRef.id,
    updatedAt: now,
  });

  await batch.commit();

  try {
    const groupSnap = await getDoc(doc(db, "groups", groupId));
    const groupName = (groupSnap.data()?.name as string) || "a group";
    const name = await displayName(transfer.toUid);
    notifyUsers([transfer.fromUid], {
      title: groupName,
      body: `${name} counted your ₹${transfer.amount} towards what you owe in ${groupName}`,
      link: `/groups/${groupId}?settlement=${settlementRef.id}`,
    });
  } catch {
    // best-effort
  }

  return settlementRef.id;
}

async function notifyCounterparty(transfer: DirectTransfer, body: string): Promise<void> {
  try {
    notifyUsers([transfer.fromUid], {
      title: "SplitIt",
      body,
      link: `/chat/${transfer.toUid}`,
    });
  } catch {
    // best-effort
  }
}

// ── Read helpers ────────────────────────────────────────────

/** Transfers between the current user and one other person, oldest first. */
export function transfersWith(
  transfers: DirectTransfer[],
  meUid: string,
  otherUid: string
): DirectTransfer[] {
  return transfers
    .filter(
      (t) =>
        (t.fromUid === meUid && t.toUid === otherUid) ||
        (t.fromUid === otherUid && t.toUid === meUid)
    )
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** Incoming transfers still waiting on the current user to say what they were. */
export function pendingForMe(transfers: DirectTransfer[], meUid: string): DirectTransfer[] {
  return transfers.filter((t) => t.toUid === meUid && t.status === "pending");
}

/**
 * Money the receiver confirmed but never attributed to a group. Worth surfacing:
 * it's the case where a balance still looks unsettled even though the payment
 * went through.
 */
export function unappliedForMe(transfers: DirectTransfer[], meUid: string): DirectTransfer[] {
  return transfers.filter(
    (t) => t.toUid === meUid && t.status === "accepted" && !t.appliedGroupId
  );
}
