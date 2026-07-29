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
  limit,
  onSnapshot,
  arrayUnion,
  arrayRemove,
  deleteField,
  type QuerySnapshot,
} from "firebase/firestore";
import { db } from "./firebase";
import {
  Group, Expense, Settlement, SettlementStatus, SettlementKind,
  SplitType, ExpenseSplit, UserProfile,
} from "./types";
import { notifyGroupMembers, notifyUsers } from "./send-notification";

function genInviteCode(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

/**
 * Firestore rejects `undefined` field values outright, so every write path
 * scrubs them first. Passing `receiptUrls: undefined` used to make editing an
 * expense throw before it ever reached the server.
 */
function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined)
  ) as Partial<T>;
}

/**
 * Snapshot listeners fail silently by default: without an error callback a
 * permission error or a dropped connection just leaves the UI showing an empty
 * list forever, which is exactly how "Android isn't populating data" presents.
 * Every subscription now reports errors so callers can surface them.
 */
function onSnapshotError(context: string, onError?: (err: Error) => void) {
  return (err: Error) => {
    console.error(`[firestore] ${context} listener failed:`, err);
    onError?.(err);
  };
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
    members: { [creatorUid]: stripUndefined(creatorProfile) },
    createdBy: creatorUid,
    createdAt: Date.now(),
    inviteCode,
  });
  return groupRef.id;
}

export async function updateGroupProfile(
  groupId: string,
  data: { name?: string; description?: string; photoURL?: string; useSimplifiedDebts?: boolean }
): Promise<void> {
  const payload: Record<string, string | boolean | undefined> = {};
  if (data.name !== undefined) payload.name = data.name;
  if (data.description !== undefined) payload.description = data.description;
  if (data.photoURL !== undefined) payload.photoURL = data.photoURL;
  if (data.useSimplifiedDebts !== undefined) payload.useSimplifiedDebts = data.useSimplifiedDebts;
  await updateDoc(doc(db, "groups", groupId), payload);
}

// Removes a member from the group (admin action). Their expenses/settlements
// stay in history, but they lose access and drop off the member list.
export async function removeMember(groupId: string, uid: string): Promise<void> {
  await updateDoc(doc(db, "groups", groupId), {
    memberIds: arrayRemove(uid),
    [`members.${uid}`]: deleteField(),
  });
}

// Adds an existing app user to the group (admin action).
export async function addMemberToGroup(
  groupId: string,
  uid: string,
  profile: { displayName: string; email: string; photoURL?: string }
): Promise<void> {
  await updateDoc(doc(db, "groups", groupId), {
    memberIds: arrayUnion(uid),
    [`members.${uid}`]: stripUndefined(profile),
  });
}

export interface UserSearchResult {
  uid: string;
  displayName: string;
  email: string;
  photoURL?: string;
}

// Prefix search over the users collection by email and display name. Firestore
// has no substring search, so this matches from the start of the field.
export async function searchUsers(
  term: string,
  excludeUids: string[] = []
): Promise<UserSearchResult[]> {
  const t = term.trim();
  if (t.length < 2) return [];
  const exclude = new Set(excludeUids);
  const results = new Map<string, UserSearchResult>();

  const collect = (snap: QuerySnapshot) => {
    snap.docs.forEach((d) => {
      if (exclude.has(d.id) || results.has(d.id)) return;
      const data = d.data();
      results.set(d.id, {
        uid: d.id,
        displayName: (data.displayName as string) || "User",
        email: (data.email as string) || "",
        photoURL: (data.photoURL as string) || undefined,
      });
    });
  };

  const emailQ = query(
    collection(db, "users"),
    where("email", ">=", t.toLowerCase()),
    where("email", "<=", t.toLowerCase() + "\uf8ff"),
    limit(10)
  );
  const nameQ = query(
    collection(db, "users"),
    where("displayName", ">=", t),
    where("displayName", "<=", t + "\uf8ff"),
    limit(10)
  );

  const [emailSnap, nameSnap] = await Promise.all([getDocs(emailQ), getDocs(nameQ)]);
  collect(emailSnap);
  collect(nameSnap);
  return Array.from(results.values()).slice(0, 10);
}

// Deletes the group document. Note: Firestore does not cascade, so the
// expenses/settlements subcollections are orphaned (they become unreadable
// once the group is gone, since rules check group membership on the parent).
export async function deleteGroup(groupId: string): Promise<void> {
  await deleteDoc(doc(db, "groups", groupId));
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
    [`members.${uid}`]: stripUndefined(profile),
  });
  return groupDoc.id;
}

export async function getGroupByInviteCode(code: string): Promise<Group | null> {
  const q = query(collection(db, "groups"), where("inviteCode", "==", code.toUpperCase()));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return toGroup(d.id, d.data());
}

/**
 * Normalizes a stored group document.
 *
 * `useSimplifiedDebts` replaced the older `settlementMode` string. Legacy
 * documents were never migrated, so the boolean falls back to the old field:
 * without this, every group that had opted into simplified debts would quietly
 * revert to direct settlement and show different amounts owed.
 */
function toGroup(id: string, data: Record<string, unknown>): Group {
  const useSimplifiedDebts =
    typeof data.useSimplifiedDebts === "boolean"
      ? data.useSimplifiedDebts
      : data.settlementMode === "simplified";
  return {
    id,
    ...data,
    description: (data.description as string) || "",
    memberIds: (data.memberIds as string[]) || [],
    members: (data.members as Group["members"]) || {},
    useSimplifiedDebts,
  } as Group;
}

export function subscribeToUserGroups(
  uid: string,
  callback: (groups: Group[]) => void,
  onError?: (err: Error) => void
) {
  const q = query(collection(db, "groups"), where("memberIds", "array-contains", uid));
  return onSnapshot(
    q,
    (snap) => callback(snap.docs.map((d) => toGroup(d.id, d.data()))),
    onSnapshotError("user groups", onError)
  );
}

export function subscribeToGroup(
  groupId: string,
  callback: (group: Group | null) => void,
  onError?: (err: Error) => void
) {
  return onSnapshot(
    doc(db, "groups", groupId),
    (snap) => callback(snap.exists() ? toGroup(snap.id, snap.data()) : null),
    onSnapshotError(`group ${groupId}`, onError)
  );
}

// ── Expenses ────────────────────────────────────────────────

export function subscribeToExpenses(
  groupId: string,
  callback: (expenses: Expense[]) => void,
  onError?: (err: Error) => void
) {
  const q = query(collection(db, "groups", groupId, "expenses"));
  return onSnapshot(
    q,
    (snap) => {
      const expenses = snap.docs
        .map((d) => {
          const data = d.data();
          return {
            id: d.id,
            ...data,
            groupId,
            receiptUrls: data.receiptUrls || [],
            splits: data.splits || [],
          } as Expense;
        })
        .sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
      callback(expenses);
    },
    onSnapshotError(`expenses of ${groupId}`, onError)
  );
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
    splitType?: SplitType;
    splits?: ExpenseSplit[];
    receiptUrls?: string[];
    category?: string;
  },
  editedBy?: string
): Promise<void> {
  // Only send the fields that actually changed. Re-adding `receiptUrls` after
  // stripping undefined values used to make every edit throw
  // "Unsupported field value: undefined".
  await updateDoc(doc(db, "groups", groupId, "expenses", expenseId), {
    ...stripUndefined(data),
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
  callback: (settlements: Settlement[]) => void,
  onError?: (err: Error) => void
) {
  const q = query(collection(db, "groups", groupId, "settlements"));
  return onSnapshot(
    q,
    (snap) => {
      const settlements = snap.docs
        .map((d) => {
          const data = d.data();
          return {
            id: d.id, ...data,
            groupId,
            receiptUrls: data.receiptUrls || [],
            status: data.status || "approved",
            kind: (data.kind as SettlementKind) || "payment",
            // Legacy records predate `createdBy`; the payer raised those.
            createdBy: (data.createdBy as string) || (data.fromUid as string),
            updatedAt: data.updatedAt || data.createdAt,
          } as Settlement;
        })
        .sort((a, b) => b.createdAt - a.createdAt);
      callback(settlements);
    },
    onSnapshotError(`settlements of ${groupId}`, onError)
  );
}

export interface NewSettlement {
  fromUid: string;
  toUid: string;
  amount: number;
  /** Who is raising the record. The *other* party approves it. */
  createdBy: string;
  note?: string;
  receiptUrls?: string[];
  expenseIds?: string[];
  forwardedFromSettlementId?: string;
  kind?: SettlementKind;
}

function settlementPayload(groupId: string, data: NewSettlement) {
  return {
    ...stripUndefined(data as unknown as Record<string, unknown>),
    receiptUrls: data.receiptUrls || [],
    expenseIds: data.expenseIds || [],
    kind: data.kind || "payment",
    groupId,
    status: "pending" as SettlementStatus,
    createdAt: Date.now(),
  };
}

export async function addSettlementRequest(
  groupId: string,
  data: NewSettlement
): Promise<string> {
  const ref = await addDoc(
    collection(db, "groups", groupId, "settlements"),
    settlementPayload(groupId, data)
  );

  // The person who did NOT raise the record is the one who has to act on it.
  const approver = data.createdBy === data.fromUid ? data.toUid : data.fromUid;
  try {
    const groupSnap = await getDoc(doc(db, "groups", groupId));
    const group = groupSnap.data();
    const creatorName =
      (group?.members as Record<string, { displayName: string }>)?.[data.createdBy]
        ?.displayName || "Someone";
    notifyUsers([approver], {
      title: group?.name || "Settlement request",
      body:
        data.createdBy === data.fromUid
          ? `${creatorName} says they paid you ₹${data.amount}`
          : `${creatorName} recorded a ₹${data.amount} payment from you`,
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
  let creator = "";
  let amount = 0;
  try {
    const snap = await getDoc(doc(db, "groups", groupId, "settlements", settlementId));
    if (snap.exists()) {
      const data = snap.data();
      creator = (data.createdBy as string) || (data.fromUid as string) || "";
      amount = (data.amount as number) || 0;
    }
  } catch {
    // best-effort
  }

  await updateDoc(doc(db, "groups", groupId, "settlements", settlementId), {
    status,
    updatedAt: Date.now(),
  });

  if (creator) {
    try {
      const groupSnap = await getDoc(doc(db, "groups", groupId));
      const groupName = groupSnap.data()?.name || "Settlement";
      notifyUsers([creator], {
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

export interface ProfileUpdate {
  displayName?: string;
  photoURL?: string;
  /** UPI ID (VPA). Pass "" to clear it. */
  upiId?: string;
  email?: string;
}

/**
 * Saves the user's profile and mirrors it onto every group they belong to.
 *
 * Two bugs lived here:
 *  - the group sync was called with `email: ""`, which overwrote each group's
 *    copy of the member's email with an empty string; and
 *  - `upiId` was written only to `users/{uid}`, never to `members.{uid}`, so
 *    the settle-up sheet (which reads the group copy) always concluded the
 *    payee "hasn't added a UPI ID" and never offered the UPI buttons.
 */
export async function updateUserProfile(uid: string, data: ProfileUpdate): Promise<void> {
  const payload = stripUndefined({
    uid,
    displayName: data.displayName,
    photoURL: data.photoURL,
    upiId: data.upiId,
    email: data.email,
  });
  await setDoc(doc(db, "users", uid), payload, { merge: true });
  await syncProfileToGroups(uid, data);
}

export async function updateUpiId(uid: string, upiId: string): Promise<void> {
  await updateUserProfile(uid, { upiId });
}

/**
 * Merges the given fields into `members.{uid}` of every group the user is in,
 * using dotted field paths so untouched fields (email, photo, name) survive.
 */
export async function syncProfileToGroups(
  uid: string,
  profile: ProfileUpdate
): Promise<void> {
  const updates: Record<string, string> = {};
  if (profile.displayName !== undefined) updates[`members.${uid}.displayName`] = profile.displayName;
  if (profile.photoURL !== undefined) updates[`members.${uid}.photoURL`] = profile.photoURL;
  if (profile.upiId !== undefined) updates[`members.${uid}.upiId`] = profile.upiId;
  if (profile.email !== undefined) updates[`members.${uid}.email`] = profile.email;
  if (Object.keys(updates).length === 0) return;

  const q = query(collection(db, "groups"), where("memberIds", "array-contains", uid));
  const snap = await getDocs(q);
  const results = await Promise.allSettled(
    snap.docs.map((groupDoc) => updateDoc(doc(db, "groups", groupDoc.id), updates))
  );
  results.forEach((r) => {
    if (r.status === "rejected") console.error("[firestore] profile sync failed:", r.reason);
  });
}

export async function getUserProfile(uid: string): Promise<Partial<UserProfile> | null> {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? (snap.data() as Partial<UserProfile>) : null;
}

/**
 * Resolves a payee's UPI ID, preferring the group's copy but falling back to
 * their `users/{uid}` document. The fallback matters for members who set their
 * UPI ID before the group-sync fix landed, or who joined a group afterwards.
 */
export async function resolveUpiId(
  uid: string,
  groupCopy?: string
): Promise<string | undefined> {
  if (groupCopy && groupCopy.trim()) return groupCopy.trim();
  try {
    const profile = await getUserProfile(uid);
    const upiId = profile?.upiId?.trim();
    return upiId || undefined;
  } catch {
    return undefined;
  }
}

// ── FCM / Notifications ─────────────────────────────────────

export async function saveFcmToken(uid: string, token: string): Promise<void> {
  await setDoc(doc(db, "users", uid), { fcmToken: token }, { merge: true });
}

export async function removeFcmToken(uid: string): Promise<void> {
  await setDoc(doc(db, "users", uid), { fcmToken: "" }, { merge: true });
}
