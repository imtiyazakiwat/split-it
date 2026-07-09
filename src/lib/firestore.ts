import {
  collection,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  getDocs,
  query,
  where,
  onSnapshot,
  arrayUnion,
} from "firebase/firestore";
import { db } from "./firebase";
import {
  Group, Expense, Settlement, SettlementStatus,
  SplitType, ExpenseSplit, EditAction,
} from "./types";
import { notifyGroupMembers, notifyUsers } from "./send-notification";

function genInviteCode(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// ── Groups ──────────────────────────────────────────────────

export async function createGroup(
  name: string,
  creatorUid: string,
  creatorProfile: { displayName: string; email: string; photoURL?: string }
): Promise<string> {
  const inviteCode = genInviteCode();
  const groupRef = await addDoc(collection(db, "groups"), {
    name,
    memberIds: [creatorUid],
    members: { [creatorUid]: creatorProfile },
    createdBy: creatorUid,
    createdAt: Date.now(),
    inviteCode,
  });
  return groupRef.id;
}

export async function updateGroupProfile(
  groupId: string,
  data: { name?: string; description?: string; photoURL?: string }
): Promise<void> {
  const payload: Record<string, string | undefined> = {};
  if (data.name !== undefined) payload.name = data.name;
  if (data.description !== undefined) payload.description = data.description;
  if (data.photoURL !== undefined) payload.photoURL = data.photoURL;
  await updateDoc(doc(db, "groups", groupId), payload);
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

export async function getGroupByInviteCode(code: string): Promise<Group | null> {
  const q = query(collection(db, "groups"), where("inviteCode", "==", code.toUpperCase()));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() } as Group;
}

export function subscribeToUserGroups(
  uid: string,
  callback: (groups: Group[]) => void
) {
  const q = query(collection(db, "groups"), where("memberIds", "array-contains", uid));
  return onSnapshot(q, (snap) => {
    const groups = snap.docs.map((d) => {
      const data = d.data();
      return { id: d.id, ...data, description: data.description || "" } as Group;
    });
    callback(groups);
  });
}

export function subscribeToGroup(
  groupId: string,
  callback: (group: Group | null) => void
) {
  return onSnapshot(doc(db, "groups", groupId), (snap) => {
    if (!snap.exists()) { callback(null); return; }
    const data = snap.data();
    callback({ id: snap.id, ...data, description: data.description || "" } as Group);
  });
}

// ── Expenses ────────────────────────────────────────────────

export function subscribeToExpenses(
  groupId: string,
  callback: (expenses: Expense[]) => void
) {
  const q = query(collection(db, "groups", groupId, "expenses"));
  return onSnapshot(q, (snap) => {
    const expenses = snap.docs
      .map((d) => {
        const data = d.data();
        return { id: d.id, ...data, receiptUrls: data.receiptUrls || [] } as Expense;
      })
      .sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
    callback(expenses);
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
    receiptUrls?: string[];
    category?: string;
  }
): Promise<string> {
  const ref = await addDoc(collection(db, "groups", groupId, "expenses"), {
    ...stripUndefined(data),
    receiptUrls: data.receiptUrls || [],
    groupId,
    createdAt: Date.now(),
  });

  try {
    const groupSnap = await getDoc(doc(db, "groups", groupId));
    const groupName = groupSnap.data()?.name || "Group";
    notifyGroupMembers(groupId, data.createdBy, {
      title: groupName,
      body: `New expense: ${data.description} — ₹${data.amount}`,
      link: `/groups/${groupId}`,
    });
  } catch {
    // notification is best-effort
  }

  return ref.id;
}

export async function updateExpense(
  groupId: string,
  expenseId: string,
  data: {
    description?: string;
    amount?: number;
    paidBy?: string;
    splits?: ExpenseSplit[];
    receiptUrls?: string[];
    category?: string;
  },
  editedBy?: string
): Promise<void> {
  await updateDoc(doc(db, "groups", groupId, "expenses", expenseId), {
    ...stripUndefined(data),
    receiptUrls: data.receiptUrls,
    updatedAt: Date.now(),
    editAction: "edited",
  });

  if (editedBy) {
    try {
      const groupSnap = await getDoc(doc(db, "groups", groupId));
      const groupName = groupSnap.data()?.name || "Group";
      const desc = data.description || "Expense";
      notifyGroupMembers(groupId, editedBy, {
        title: groupName,
        body: `${desc} was updated`,
        link: `/groups/${groupId}`,
      });
    } catch {
      // best-effort
    }
  }
}

export async function deleteExpense(
  groupId: string,
  expenseId: string,
  deletedBy?: string
): Promise<void> {
  const snap = await getDoc(doc(db, "groups", groupId, "expenses", expenseId));
  const desc = (snap.data()?.description as string) || "Expense";

  await updateDoc(doc(db, "groups", groupId, "expenses", expenseId), {
    editAction: "deleted",
    updatedAt: Date.now(),
  });

  if (deletedBy) {
    try {
      const groupSnap = await getDoc(doc(db, "groups", groupId));
      const groupName = groupSnap.data()?.name || "Group";
      notifyGroupMembers(groupId, deletedBy, {
        title: groupName,
        body: `${desc} was removed`,
        link: `/groups/${groupId}`,
      });
    } catch {
      // best-effort
    }
  }
}

// ── Settlements ─────────────────────────────────────────────

export function subscribeToSettlements(
  groupId: string,
  callback: (settlements: Settlement[]) => void
) {
  const q = query(collection(db, "groups", groupId, "settlements"));
  return onSnapshot(q, (snap) => {
    const settlements = snap.docs
      .map((d) => {
        const data = d.data();
        return {
          id: d.id, ...data,
          receiptUrls: data.receiptUrls || [],
          status: data.status || "approved",
          updatedAt: data.updatedAt || data.createdAt,
        } as Settlement;
      })
      .sort((a, b) => b.createdAt - a.createdAt);
    callback(settlements);
  });
}

export async function addSettlementRequest(
  groupId: string,
  data: {
    fromUid: string;
    toUid: string;
    amount: number;
    note?: string;
    receiptUrls?: string[];
    expenseIds?: string[];
  }
): Promise<string> {
  const ref = await addDoc(collection(db, "groups", groupId, "settlements"), {
    ...stripUndefined(data),
    receiptUrls: data.receiptUrls || [],
    expenseIds: data.expenseIds || [],
    groupId,
    status: "pending",
    createdAt: Date.now(),
  });

  try {
    const groupSnap = await getDoc(doc(db, "groups", groupId));
    const group = groupSnap.data();
    const fromName = (group?.members as Record<string, { displayName: string }>)?.[data.fromUid]?.displayName || "Someone";
    notifyUsers([data.toUid], {
      title: group?.name || "Settlement request",
      body: `${fromName} requested ₹${data.amount} from you`,
      link: `/groups/${groupId}`,
    });
  } catch {
    // best-effort
  }

  return ref.id;
}

export async function updateSettlementStatus(
  groupId: string,
  settlementId: string,
  status: SettlementStatus
): Promise<void> {
  let fromUid = "";
  let amount = 0;
  try {
    const snap = await getDoc(doc(db, "groups", groupId, "settlements", settlementId));
    if (snap.exists()) {
      fromUid = (snap.data().fromUid as string) || "";
      amount = (snap.data().amount as number) || 0;
    }
  } catch {
    // best-effort
  }

  await updateDoc(doc(db, "groups", groupId, "settlements", settlementId), {
    status,
    updatedAt: Date.now(),
  });

  if (fromUid) {
    try {
      const groupSnap = await getDoc(doc(db, "groups", groupId));
      const groupName = groupSnap.data()?.name || "Settlement";
      notifyUsers([fromUid], {
        title: groupName,
        body: `Your settlement request of ₹${amount} was ${status}`,
        link: `/groups/${groupId}`,
      });
    } catch {
      // best-effort
    }
  }
}

// ── User Profile ────────────────────────────────────────────

export async function updateUserProfile(
  uid: string,
  data: { displayName?: string; photoURL?: string }
): Promise<void> {
  const payload: Record<string, string | undefined> = {};
  if (data.displayName !== undefined) payload.displayName = data.displayName;
  if (data.photoURL !== undefined) payload.photoURL = data.photoURL;
  await setDoc(doc(db, "users", uid), payload, { merge: true });
  await syncProfileToGroups(uid, {
    displayName: data.displayName || "",
    email: "",
    photoURL: data.photoURL,
  });
}

export async function updateUpiId(uid: string, upiId: string): Promise<void> {
  await setDoc(doc(db, "users", uid), { upiId }, { merge: true });
}

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

export async function getUserProfile(uid: string) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snap.data() : null;
}

// ── FCM / Notifications ─────────────────────────────────────

export async function saveFcmToken(uid: string, token: string): Promise<void> {
  await setDoc(doc(db, "users", uid), { fcmToken: token }, { merge: true });
}

export async function removeFcmToken(uid: string): Promise<void> {
  await setDoc(doc(db, "users", uid), { fcmToken: "" }, { merge: true });
}
