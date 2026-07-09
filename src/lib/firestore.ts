import {
  collection,
  doc,
  addDoc,
  setDoc,
  getDocs,
  query,
  where,
  onSnapshot,
  updateDoc,
  arrayUnion,
} from "firebase/firestore";
import { db } from "./firebase";
import { Group, Expense, Settlement, SplitType, ExpenseSplit } from "./types";

function genInviteCode(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

export async function createGroup(
  name: string,
  creatorUid: string,
  creatorProfile: { displayName: string; email: string; photoURL?: string }
): Promise<string> {
  const inviteCode = genInviteCode();
  const groupRef = await addDoc(collection(db, "groups"), {
    name,
    memberIds: [creatorUid],
    members: {
      [creatorUid]: creatorProfile,
    },
    createdBy: creatorUid,
    createdAt: Date.now(),
    inviteCode,
  });
  return groupRef.id;
}

export async function joinGroupByCode(
  inviteCode: string,
  uid: string,
  profile: { displayName: string; email: string; photoURL?: string }
): Promise<string | null> {
  const q = query(collection(db, "groups"), where("inviteCode", "==", inviteCode.toUpperCase()));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const groupDoc = snap.docs[0];
  await updateDoc(doc(db, "groups", groupDoc.id), {
    memberIds: arrayUnion(uid),
    [`members.${uid}`]: profile,
  });
  return groupDoc.id;
}

export function subscribeToUserGroups(
  uid: string,
  callback: (groups: Group[]) => void
) {
  const q = query(collection(db, "groups"), where("memberIds", "array-contains", uid));
  return onSnapshot(q, (snap) => {
    const groups = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Group));
    callback(groups);
  });
}

export function subscribeToGroup(
  groupId: string,
  callback: (group: Group | null) => void
) {
  return onSnapshot(doc(db, "groups", groupId), (snap) => {
    if (!snap.exists()) {
      callback(null);
      return;
    }
    callback({ id: snap.id, ...snap.data() } as Group);
  });
}

export function subscribeToExpenses(
  groupId: string,
  callback: (expenses: Expense[]) => void
) {
  const q = query(collection(db, "groups", groupId, "expenses"));
  return onSnapshot(q, (snap) => {
    const expenses = snap.docs
      .map((d) => ({ id: d.id, ...d.data() } as Expense))
      .sort((a, b) => b.createdAt - a.createdAt);
    callback(expenses);
  });
}

export function subscribeToSettlements(
  groupId: string,
  callback: (settlements: Settlement[]) => void
) {
  const q = query(collection(db, "groups", groupId, "settlements"));
  return onSnapshot(q, (snap) => {
    const settlements = snap.docs
      .map((d) => ({ id: d.id, ...d.data() } as Settlement))
      .sort((a, b) => b.createdAt - a.createdAt);
    callback(settlements);
  });
}

function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined)
  ) as Partial<T>;
}

export async function addExpense(
  groupId: string,
  data: {
    description: string;
    amount: number;
    paidBy: string;
    splitType: SplitType;
    splits: ExpenseSplit[];
    createdBy: string;
    receiptUrl?: string;
    category?: string;
  }
): Promise<string> {
  const ref = await addDoc(collection(db, "groups", groupId, "expenses"), {
    ...stripUndefined(data),
    groupId,
    createdAt: Date.now(),
  });
  return ref.id;
}

export async function addSettlement(
  groupId: string,
  data: { fromUid: string; toUid: string; amount: number; note?: string; receiptUrl?: string }
): Promise<string> {
  const ref = await addDoc(collection(db, "groups", groupId, "settlements"), {
    ...stripUndefined(data),
    groupId,
    createdAt: Date.now(),
  });
  return ref.id;
}

export async function updateUpiId(uid: string, upiId: string): Promise<void> {
  await setDoc(doc(db, "users", uid), { upiId }, { merge: true });
}

/**
 * Propagates a user's current profile (including UPI ID) into every group
 * they're a member of, so group.members[uid] stays in sync without needing
 * a separate users/{uid} lookup when rendering settle-up UI.
 */
export async function syncProfileToGroups(
  uid: string,
  profile: { displayName: string; email: string; photoURL?: string; upiId?: string }
): Promise<void> {
  const q = query(collection(db, "groups"), where("memberIds", "array-contains", uid));
  const snap = await getDocs(q);
  await Promise.all(
    snap.docs.map((groupDoc) =>
      updateDoc(doc(db, "groups", groupDoc.id), {
        [`members.${uid}`]: stripUndefined(profile),
      })
    )
  );
}
