import { doc, getDoc } from "firebase/firestore";
import { db } from "./firebase";

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

export async function notifyUsers(
  uids: string[],
  params: NotifyParams
): Promise<void> {
  const tokens: string[] = [];

  for (const uid of uids) {
    try {
      const snap = await getDoc(doc(db, "users", uid));
      const data = snap.data();
      const token = data?.fcmToken as string | undefined;
      if (token) tokens.push(token);
    } catch {
      // skip users whose docs we can't read
    }
  }

  if (tokens.length === 0) return;

  Promise.allSettled(
    tokens.map((token) =>
      fetch("/api/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, ...params }),
      }).catch(() => {})
    )
  );
}
