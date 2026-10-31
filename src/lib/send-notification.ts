import { auth } from "./firebase";

/**
 * Client side of /api/notify.
 *
 * Callers pass uids or a group id, never device tokens: the server authorises
 * recipients and looks their devices up itself.
 *
 * Every notification is best-effort and must never fail the write that
 * triggered it, so these functions don't throw and callers don't await them.
 * They are no longer silent, though: outcomes are logged, because a
 * misconfigured server, a recipient with no device and a refused recipient all
 * looked identical from here before.
 *
 * This module no longer imports Firestore. It used to read the group document
 * before every expense notification (twice, counting the caller's own read for
 * the title); the server now resolves members and the group name itself.
 */

export interface NotifyContent {
  /** Omit in group mode to title the push with the group's name. */
  title?: string;
  body: string;
  link: string;
}

/** "₹1,200" / "₹80.66" — the amount formatting notifications use. */
export function rupees(amount: number): string {
  return `₹${amount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

/** First name of whoever is signed in, for "Asha added Lunch" copy. */
export function actorName(): string {
  const name = auth.currentUser?.displayName?.trim();
  return name ? name.split(/\s+/)[0] : "Someone";
}

/** Everyone else in the group. The server checks membership and titles it. */
export function notifyGroupMembers(groupId: string, content: NotifyContent): void {
  void postNotify({ groupId, ...content });
}

/**
 * Specific people. Pass `groupId` when the push is about a group: the server
 * then requires them to be members and uses the group name as the title.
 */
export function notifyUsers(
  uids: string[],
  content: NotifyContent & { groupId?: string }
): void {
  if (uids.length === 0) return;
  void postNotify({ uids, ...content });
}

export type TestPushResult =
  | { ok: true; sent: number }
  | { ok: false; reason: "signed-out" | "no-device" | "rate-limited" | "failed" };

/** Sends the fixed test message to this user's own devices. Awaited by Settings. */
export async function sendTestNotification(): Promise<TestPushResult> {
  const res = await postNotify({ test: true });
  if (!res) return { ok: false, reason: "signed-out" };
  if (res.status === 429) return { ok: false, reason: "rate-limited" };
  if (!res.ok) return { ok: false, reason: "failed" };
  const result = (await res.json().catch(() => null)) as { sent?: number } | null;
  const sent = Number(result?.sent) || 0;
  return sent > 0 ? { ok: true, sent } : { ok: false, reason: "no-device" };
}

async function postNotify(payload: Record<string, unknown>): Promise<Response | null> {
  const user = auth.currentUser;
  if (!user) return null;

  let idToken: string;
  try {
    idToken = await user.getIdToken();
  } catch {
    return null;
  }

  try {
    const res = await fetch("/api/notify", {
      method: "POST",
      // keepalive lets the request outlive the page. A notification is sent
      // right after a write, which is exactly when a user backgrounds the app
      // to go and pay someone — and iOS suspends the page mid-request.
      keepalive: true,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error("[notify] push rejected:", res.status);
    }
    return res;
  } catch (err) {
    console.error("[notify] push request failed:", err);
    return null;
  }
}
