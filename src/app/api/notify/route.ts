import { NextRequest, NextResponse } from "next/server";
import type { Firestore } from "firebase-admin/firestore";
import { getDb, getMessaging, verifyCaller } from "@/lib/firebase-admin";
import {
  LIMITS,
  cleanText,
  collectTargets,
  consumeRate,
  dedupeTag,
  isDeadTokenError,
  parseNotifyRequest,
  resolveGroupRecipients,
  type DeviceTarget,
  type RateState,
  type RecipientDevices,
} from "@/lib/notify-policy";

/**
 * POST /api/notify — sends a push through FCM (HTTP v1, via the Admin SDK).
 *
 * Auth:  Authorization: Bearer <Firebase ID token>
 * Body:  one of
 *   { groupId, body, link?, title?, uids? }  members of a group the caller is in
 *   { uids, title, body, link? }             people the caller shares a group or
 *                                            a direct transfer with
 *   { test: true }                           a fixed message to the caller's own
 *                                            devices
 *
 * The caller never names a device. Recipients are resolved and authorised here,
 * and their tokens are read here, so nobody can push arbitrary text to a device
 * they merely saw once. All decisions live in src/lib/notify-policy.ts.
 *
 * Messages are DATA-ONLY on purpose: a `notification` block makes FCM render the
 * push itself and ALSO invoke the service worker, which showed every push twice.
 * public/sw.js is the single renderer.
 *
 * Changes from the previous version, each fixing a measured or reported problem:
 * - Tokens come from users/{uid}/devices (one per install) as well as the legacy
 *   single field, so a second device no longer silently loses notifications.
 * - Authorisation no longer reads every transfer the caller was ever part of on
 *   every push; it checks the one pair in question.
 * - Group mode resolves members and the title server-side, which removed two
 *   client reads from every expense notification.
 * - Per-caller rate limit, a TTL so a stale push isn't delivered days later, and
 *   a generic 500 instead of echoing internal error text.
 */

const TTL_SECONDS = 24 * 60 * 60;

export async function POST(req: NextRequest) {
  try {
    const callerUid = await verifyCaller(req.headers.get("authorization"));
    if (!callerUid) {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    }

    let payload: unknown;
    try {
      payload = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    const parsed = parseNotifyRequest(payload);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const request = parsed.request;

    const db = getDb();
    if (!(await consumeRateLimit(db, callerUid))) {
      return NextResponse.json(
        { error: "Too many notifications. Try again in a few minutes." },
        { status: 429 }
      );
    }

    let recipients: string[];
    let title: string;
    let body: string;
    let link: string | null;

    if (request.test) {
      recipients = [callerUid];
      title = "Notifications are on";
      body = "This is a test from SplitIt. If you can see it, you're all set.";
      link = "/settings";
    } else if (request.groupId) {
      const snap = await db.collection("groups").doc(request.groupId).get();
      const memberIds = (snap.get("memberIds") as unknown[] | undefined) ?? [];
      if (!snap.exists || snap.get("deletedAt") || !memberIds.includes(callerUid)) {
        return NextResponse.json({ error: "Not allowed" }, { status: 403 });
      }
      recipients = resolveGroupRecipients(callerUid, memberIds, request.uids);
      title = request.title || cleanText(snap.get("name"), LIMITS.MAX_TITLE) || "SplitIt";
      body = request.body;
      link = request.link;
    } else {
      recipients = await reachableRecipients(db, callerUid, request.uids);
      title = request.title;
      body = request.body;
      link = request.link;
    }

    const requestedCount = request.test ? 1 : request.uids.length || recipients.length;
    if (recipients.length === 0) {
      // Deliberately indistinguishable from "they have no device": a caller
      // shouldn't be able to probe who shares a group with them. The log says
      // which it was, because that's where a missing push gets investigated.
      console.warn(`[notify] ${callerUid}: no reachable recipients`);
      return NextResponse.json({ success: true, sent: 0, skipped: requestedCount });
    }

    const targets = await loadTargets(db, recipients);
    if (targets.length === 0) {
      console.warn(`[notify] ${callerUid}: ${recipients.length} recipient(s), no registered device`);
      return NextResponse.json({
        success: true,
        sent: 0,
        skipped: requestedCount - recipients.length,
        noDevice: recipients.length,
      });
    }

    // FCM data payloads carry strings only.
    const data: Record<string, string> = { title, body, tag: dedupeTag(title, body, link) };
    if (link) data.link = link;

    const response = await getMessaging().sendEachForMulticast({
      tokens: targets.map((t) => t.token),
      data,
      webpush: { headers: { Urgency: "high", TTL: String(TTL_SECONDS) } },
    });

    const dead: DeviceTarget[] = [];
    response.responses.forEach((r, i) => {
      if (r.success) return;
      const code = r.error?.code;
      console.error(`[notify] send failed for ${targets[i].uid}: ${code ?? "unknown"}`);
      if (isDeadTokenError(code)) dead.push(targets[i]);
    });
    if (dead.length > 0) await pruneDeadTargets(db, dead);

    return NextResponse.json({
      success: true,
      sent: response.successCount,
      failed: response.failureCount,
      skipped: requestedCount - recipients.length,
      pruned: dead.length,
    });
  } catch (err) {
    // Logged in full server-side; the client gets nothing internal.
    console.error("[notify] failed:", err);
    return NextResponse.json({ error: "Couldn't send notification" }, { status: 500 });
  }
}

/**
 * Fixed-window limit per caller, stored in rateLimits/{uid}. That collection has
 * no client rules, so only this server can read or write it.
 */
async function consumeRateLimit(db: Firestore, uid: string): Promise<boolean> {
  const ref = db.collection("rateLimits").doc(uid);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const { allowed, next } = consumeRate(
      snap.exists ? (snap.data() as Partial<RateState>) : undefined,
      Date.now()
    );
    if (allowed) tx.set(ref, { ...next, updatedAt: Date.now() });
    return allowed;
  });
}

/**
 * The requested uids the caller may reach: anyone sharing a group with them, or
 * anyone they have a direct transfer with.
 *
 * The group check reads only the caller's groups, projected to memberIds. The
 * old version also read EVERY transfer the caller had ever been party to, on
 * every push, so its cost grew with history forever. Transfers are now checked
 * per remaining pair with limit(1) — two equality filters, which Firestore
 * serves without a composite index.
 */
async function reachableRecipients(
  db: Firestore,
  callerUid: string,
  requested: string[]
): Promise<string[]> {
  const candidates = requested.filter((uid) => uid !== callerUid);
  if (candidates.length === 0) return [];

  const groups = await db
    .collection("groups")
    .where("memberIds", "array-contains", callerUid)
    .select("memberIds")
    .get();
  const reachable = new Set<string>();
  for (const g of groups.docs) {
    for (const uid of (g.get("memberIds") as unknown[] | undefined) ?? []) {
      if (typeof uid === "string") reachable.add(uid);
    }
  }

  const unresolved = candidates.filter((uid) => !reachable.has(uid));
  const transfers = db.collection("transfers");
  const pairChecks = await Promise.all(
    unresolved.map(async (uid) => {
      const [sent, received] = await Promise.all([
        transfers.where("fromUid", "==", callerUid).where("toUid", "==", uid).limit(1).get(),
        transfers.where("fromUid", "==", uid).where("toUid", "==", callerUid).limit(1).get(),
      ]);
      return { uid, ok: !sent.empty || !received.empty };
    })
  );
  for (const c of pairChecks) if (c.ok) reachable.add(c.uid);

  return candidates.filter((uid) => reachable.has(uid));
}

/** Enabled device tokens plus the legacy single-token field, per recipient. */
async function loadTargets(db: Firestore, uids: string[]): Promise<DeviceTarget[]> {
  const recipients: RecipientDevices[] = await Promise.all(
    uids.map(async (uid) => {
      const userRef = db.collection("users").doc(uid);
      const [user, devices] = await Promise.all([
        userRef.get(),
        userRef.collection("devices").where("enabled", "==", true).get(),
      ]);
      return {
        uid,
        legacyToken: user.get("fcmToken"),
        devices: devices.docs.map((d) => ({
          id: d.id,
          token: d.get("token"),
          enabled: d.get("enabled"),
        })),
      };
    })
  );
  return collectTargets(recipients);
}

/**
 * Removes tokens FCM says will never work again, so the next send doesn't fail
 * on them too and the device can register a fresh one.
 */
async function pruneDeadTargets(db: Firestore, dead: DeviceTarget[]): Promise<void> {
  const writes: Promise<unknown>[] = [];
  for (const t of dead) {
    const userRef = db.collection("users").doc(t.uid);
    if (t.deviceId) writes.push(userRef.collection("devices").doc(t.deviceId).delete());
    if (t.legacy) writes.push(userRef.update({ fcmToken: "" }));
  }
  await Promise.allSettled(writes);
}
