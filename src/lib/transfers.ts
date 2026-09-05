import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  updateDoc,
  where,
  writeBatch,
  type DocumentReference,
} from "firebase/firestore";
import { db } from "./firebase";
import { DirectTransfer } from "./types";
import { notifyUsers } from "./send-notification";
import { fromPaise, roundMoney, toPaise } from "./money";
import { transferAllocations, unallocatedAmount } from "./transfer-allocation";

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
  const amount = roundMoney(data.amount);
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
 * The receiver booking the money into one or more group ledgers, settling what
 * the sender owed them in each.
 *
 * Written in two phases, and the ordering is forced by how Firestore rules work
 * rather than by preference. A settlement created from a transfer is born
 * *approved*, so the rules have to prove it against the transfer: same payer,
 * same payee, and an amount the receiver actually attributed to that group.
 * Rules evaluate every write in a batch against the state that existed *before*
 * the batch, so a plan written in the same batch is invisible to them.
 *
 *   Phase 1 — commit the allocation onto the transfer, with the settlement ids
 *             generated up front (Firestore mints ids client-side).
 *   Phase 2 — create each settlement, which the rules now validate against the
 *             committed `allocations[settlementId]`.
 *
 * Phase 2 is idempotent: it skips legs whose settlement already exists, so a
 * failure between the phases is fixed by simply running it again rather than
 * leaving the transfer marked as applied with no settlement behind it.
 */
export async function includeTransferInGroups(
  transfer: DirectTransfer,
  legs: { groupId: string; amount: number }[]
): Promise<{ groupId: string; settlementId: string; amount: number }[]> {
  const requested = legs
    .map((l) => ({ groupId: l.groupId, amount: roundMoney(l.amount) }))
    .filter((l) => l.amount > 0);

  if (requested.length === 0) throw new Error("Pick at least one group and an amount.");

  const uniqueGroups = new Set(requested.map((l) => l.groupId));
  if (uniqueGroups.size !== requested.length) {
    throw new Error("Each group can only take one share of a payment.");
  }

  // Heal any leg whose plan was committed but whose settlement never landed,
  // before planning more. Without this, a phase-2 failure is terminal: the group
  // it belongs to is rejected below as "already counted", and a fully allocated
  // transfer disappears from `unappliedForMe` entirely, so nothing ever retries.
  await reconcileTransferAllocations(transfer);

  const already = transferAllocations(transfer);
  const alreadyGroups = new Set(already.map((a) => a.groupId));
  for (const leg of requested) {
    if (alreadyGroups.has(leg.groupId)) {
      throw new Error("This payment has already been counted in one of those groups.");
    }
  }

  // The receiver can come back and book the remainder later, so the bound is
  // what's still unspoken for, not the whole transfer.
  const remaining = toPaise(unallocatedAmount(transfer));
  const wanted = requested.reduce((sum, l) => sum + toPaise(l.amount), 0);
  if (wanted > remaining) {
    throw new Error(
      `That's more than this payment has left to give (${fromPaise(remaining)} remaining).`
    );
  }

  const now = Date.now();
  const planned = requested.map((leg) => ({
    ...leg,
    ref: doc(collection(db, "groups", leg.groupId, "settlements")),
  }));

  const allocations: Record<string, { groupId: string; amount: number }> = {};
  for (const a of already) {
    allocations[a.settlementId] = { groupId: a.groupId, amount: a.amount };
  }
  for (const leg of planned) {
    allocations[leg.ref.id] = { groupId: leg.groupId, amount: leg.amount };
  }
  const allocatedAmount = fromPaise(
    Object.values(allocations).reduce((sum, a) => sum + toPaise(a.amount), 0)
  );

  // Phase 1 — the plan.
  await updateDoc(doc(db, "transfers", transfer.id), {
    status: "accepted",
    allocations,
    allocatedAmount,
    // Kept in step for older clients, which only understand a single booking.
    appliedGroupId: transfer.appliedGroupId || planned[0].groupId,
    appliedSettlementId: transfer.appliedSettlementId || planned[0].ref.id,
    updatedAt: now,
  });

  // Phase 2 — the legs.
  await writeAllocationLegs(transfer, planned, now);

  notifyAllocation(transfer, planned).catch(() => {
    // notification is best-effort; the ledger is already correct
  });

  return planned.map((l) => ({
    groupId: l.groupId,
    settlementId: l.ref.id,
    amount: l.amount,
  }));
}

/**
 * Recreates settlements for allocations that were committed to the transfer but
 * never written, and reports how many it repaired.
 *
 * The two-phase write is forced by the security rules (they only see pre-batch
 * state, so the plan must be committed before the legs it authorises). That
 * leaves a window: if the second phase fails, the transfer claims the money is
 * booked while the group ledger has no record of it, understating the balance.
 * Because the plan is committed with its settlement ids already chosen, the
 * repair is deterministic — write exactly the documents that are missing.
 *
 * Safe to call at any time: `writeAllocationLegs` skips legs that already exist.
 */
export async function reconcileTransferAllocations(
  transfer: DirectTransfer
): Promise<number> {
  const committed = transferAllocations(transfer);
  if (committed.length === 0) return 0;

  const planned: PlannedLegRef[] = committed.map((a) => ({
    groupId: a.groupId,
    amount: a.amount,
    ref: doc(db, "groups", a.groupId, "settlements", a.settlementId),
  }));

  const existing = await Promise.all(planned.map((l) => getDoc(l.ref)));
  const missing = planned.filter((_, i) => !existing[i].exists());
  if (missing.length === 0) return 0;

  await writeAllocationLegs(transfer, missing, transfer.updatedAt || Date.now());
  return missing.length;
}

type PlannedLegRef = { groupId: string; amount: number; ref: DocumentReference };

async function writeAllocationLegs(
  transfer: DirectTransfer,
  planned: PlannedLegRef[],
  now: number
): Promise<void> {
  const existing = await Promise.all(planned.map((l) => getDoc(l.ref)));
  const missing = planned.filter((_, i) => !existing[i].exists());
  if (missing.length === 0) return;

  const batch = writeBatch(db);
  for (const leg of missing) {
    batch.set(leg.ref, {
      groupId: leg.groupId,
      fromUid: transfer.fromUid,
      toUid: transfer.toUid,
      amount: leg.amount,
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
  }
  await batch.commit();
}

async function notifyAllocation(
  transfer: DirectTransfer,
  planned: PlannedLegRef[]
): Promise<void> {
  const name = await displayName(transfer.toUid);
  const names = await Promise.all(
    planned.map(async (leg) => {
      const snap = await getDoc(doc(db, "groups", leg.groupId));
      return { ...leg, groupName: (snap.data()?.name as string) || "a group" };
    })
  );

  if (names.length === 1) {
    const only = names[0];
    notifyUsers([transfer.fromUid], {
      title: only.groupName,
      body: `${name} counted ₹${only.amount} of your payment towards what you owe in ${only.groupName}`,
      link: `/groups/${only.groupId}?settlement=${only.ref.id}`,
    });
    return;
  }

  const summary = names.map((n) => `₹${n.amount} in ${n.groupName}`).join(", ");
  notifyUsers([transfer.fromUid], {
    title: "Payment counted",
    body: `${name} split your ₹${transfer.amount} payment across ${names.length} groups: ${summary}`,
    link: `/groups/${names[0].groupId}?settlement=${names[0].ref.id}`,
  });
}

/**
 * Single-group convenience wrapper, kept because "this payment was for that
 * group" is still the common case.
 */
export async function includeTransferInGroup(
  transfer: DirectTransfer,
  groupId: string,
  amount?: number
): Promise<string> {
  const [leg] = await includeTransferInGroups(transfer, [
    { groupId, amount: amount ?? unallocatedAmount(transfer) },
  ]);
  return leg.settlementId;
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
 * Money the receiver confirmed but hasn't fully attributed to a group. Worth
 * surfacing: it's the case where a balance still looks unsettled even though the
 * payment went through.
 *
 * Tests the unallocated remainder rather than "has it been booked at all", so a
 * payment that was larger than the first group's debt keeps offering the rest up
 * instead of disappearing the moment one leg is written.
 */
export function unappliedForMe(transfers: DirectTransfer[], meUid: string): DirectTransfer[] {
  return transfers.filter(
    (t) => t.toUid === meUid && t.status === "accepted" && unallocatedAmount(t) > 0
  );
}
