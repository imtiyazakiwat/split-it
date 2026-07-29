import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "./firebase";

interface NotifyParams {
  title: string;
  body: string;
  link: string;
}

export async function notifyGroupMembers(
  groupId: string,
  excludeUid: string,
  params: NotifyParams
): Promise<void> {
  let memberIds: string[];
  try {
    const snap = await getDoc(doc(db, "groups", groupId));
    if (!snap.exists()) return;
    memberIds = (snap.data().memberIds as string[]) || [];
  } catch {
    return;
  }

  const targets = memberIds.filter((id) => id !== excludeUid);
  if (targets.length === 0) return;
  await notifyUsers(targets, params);
}

/**
 * Asks the server to push to these users.
 *
 * We send uids, not FCM registration tokens: /api/notify verifies the caller's
 * Firebase ID token, checks that each recipient shares a group with them, and
 * looks the device tokens up itself. Handing the tokens over from here would let
 * any caller push arbitrary text to a device it had merely seen once.
 */
export async function notifyUsers(
  uids: string[],
  params: NotifyParams
): Promise<void> {
  if (uids.length === 0) return;

  const user = auth.currentUser;
  if (!user) return;

  let idToken: string;
  try {
    idToken = await user.getIdToken();
  } catch {
    return;
  }

  // Fire-and-forget: a failed push must never fail the write that triggered it.
  void fetch("/api/notify", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ uids, ...params }),
  }).catch(() => {});
}
