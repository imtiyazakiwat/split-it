import { NextRequest, NextResponse } from "next/server";
import { getDb, getMessaging, verifyCaller } from "@/lib/firebase-admin";

/**
 * POST /api/notify
 *
 * Sends a push notification via Firebase Cloud Messaging HTTP v1 API
 * using the Firebase Admin SDK (OAuth 2.0 / service account auth).
 *
 * Server-side env vars required:
 *   FIREBASE_CLIENT_EMAIL  — from Firebase Console > Service Accounts
 *   FIREBASE_PRIVATE_KEY   — the private key from the same service account JSON
 *
 * Auth:  Authorization: Bearer <Firebase ID token>
 * Body:  { uids: string[], title: string, body: string, link?: string }
 *
 * The route used to accept an arbitrary FCM registration token plus arbitrary
 * text, so anyone who got hold of a token could push a convincing fake ("Asha
 * paid you INR 5,000") to that device. Now the caller proves who they are, the
 * recipients are filtered down to people who actually share a group with the
 * caller, and the device tokens are read server-side — a client never gets to
 * name the device it is pushing to.
 *
 * The message is sent DATA-ONLY, deliberately. Including a `notification` block
 * makes FCM render the push itself while *also* invoking the service worker's
 * onBackgroundMessage handler, which renders it a second time — every push
 * arrived twice whenever the app was backgrounded. With data only, the service
 * worker is the single renderer, and it can control the icon, the click target
 * and the dedupe tag. See public/firebase-messaging-sw.js.
 */

const MAX_RECIPIENTS = 50;
const MAX_TITLE = 120;
const MAX_BODY = 400;
const MAX_TAG = 96;

/**
 * Links are used as in-app navigation targets by the service worker, so only
 * same-origin absolute paths are accepted. This keeps a push from being turned
 * into a redirect to an attacker's page.
 */
function safeLink(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const link = value.trim();
  if (!link.startsWith("/") || link.startsWith("//")) return null;
  return link.slice(0, 512);
}

/** Small stable hash, so a long link still contributes to the dedupe identity. */
function shortHash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * Two pushes collapse into one only when they say the same thing *and* go to the
 * same place. Keying on title/body alone meant "Asha added an expense" for two
 * different groups replaced each other, and the survivor could carry the wrong
 * link.
 */
function dedupeTag(title: string, body: string, link: string | null): string {
  const source = `${title}|${body}|${link ?? ""}`;
  if (source.length <= MAX_TAG) return source;
  const suffix = `#${shortHash(source)}`;
  return `${source.slice(0, MAX_TAG - suffix.length)}${suffix}`;
}

export async function POST(req: NextRequest) {
  try {
    const callerUid = await verifyCaller(req.headers.get("authorization"));
    if (!callerUid) {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    }

    const payload = await req.json();
    const requested: unknown = payload?.uids;
    const title = typeof payload?.title === "string" ? payload.title.trim() : "";
    const body = typeof payload?.body === "string" ? payload.body.trim() : "";
    const link = safeLink(payload?.link);

    if (!Array.isArray(requested) || requested.length === 0 || !title || !body) {
      return NextResponse.json(
        { error: "Missing required fields: uids, title, body" },
        { status: 400 }
      );
    }

    const uids = [
      ...new Set(requested.filter((u): u is string => typeof u === "string" && !!u)),
    ].slice(0, MAX_RECIPIENTS);

    const db = getDb();

    // Authorization: you may only notify people you share a group with. The
    // permitted set is derived here rather than taken from the request.
    const groupSnap = await db
      .collection("groups")
      .where("memberIds", "array-contains", callerUid)
      .get();
    const reachable = new Set<string>();
    for (const doc of groupSnap.docs) {
      for (const uid of (doc.get("memberIds") as string[]) || []) reachable.add(uid);
    }
    reachable.delete(callerUid);

    const allowed = uids.filter((uid) => reachable.has(uid));
    if (allowed.length === 0) {
      // Nothing to do, and deliberately not distinguishable from "they have no
      // device registered" — a caller shouldn't be able to probe group membership.
      return NextResponse.json({ success: true, sent: 0, skipped: uids.length });
    }

    // Device tokens are resolved server-side, so the client never supplies one.
    const userDocs = await db.getAll(
      ...allowed.map((uid) => db.collection("users").doc(uid))
    );
    const tokens = userDocs
      .map((doc) => doc.get("fcmToken"))
      .filter((token): token is string => typeof token === "string" && !!token);

    if (tokens.length === 0) {
      return NextResponse.json({ success: true, sent: 0, skipped: uids.length });
    }

    const truncatedTitle = title.slice(0, MAX_TITLE);
    const truncatedBody = body.slice(0, MAX_BODY);

    // FCM data payloads carry strings only.
    const data: Record<string, string> = {
      title: truncatedTitle,
      body: truncatedBody,
      tag: dedupeTag(truncatedTitle, truncatedBody, link),
    };
    if (link) data.link = link;

    const messaging = getMessaging();
    const response = await messaging.sendEachForMulticast({
      tokens,
      data,
      webpush: { headers: { Urgency: "high" } },
    });

    return NextResponse.json({
      success: true,
      sent: response.successCount,
      failed: response.failureCount,
      skipped: uids.length - allowed.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
