import { NextRequest, NextResponse } from "next/server";
import { getMessaging } from "@/lib/firebase-admin";

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
 * Body: { token: string, title: string, body: string, link?: string }
 *
 * The message is sent DATA-ONLY, deliberately. Including a `notification` block
 * makes FCM render the push itself while *also* invoking the service worker's
 * onBackgroundMessage handler, which renders it a second time — every push
 * arrived twice whenever the app was backgrounded. With data only, the service
 * worker is the single renderer, and it can control the icon, the click target
 * and the dedupe tag. See public/firebase-messaging-sw.js.
 */
export async function POST(req: NextRequest) {
  try {
    const { token, title, body, link } = await req.json();
    if (!token || !title || !body) {
      return NextResponse.json(
        { error: "Missing required fields: token, title, body" },
        { status: 400 }
      );
    }
    const messaging = getMessaging();
    // FCM data payloads carry strings only.
    const data: Record<string, string> = {
      title: String(title),
      body: String(body),
      // Identical messages collapse into one instead of stacking; different
      // ones keep their own slot.
      tag: `${String(title)}|${String(body)}`.slice(0, 96),
    };
    if (link) data.link = String(link);
    const response = await messaging.send({
      token,
      data,
      webpush: { headers: { Urgency: "high" } },
    });
    return NextResponse.json({ success: true, messageId: response });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
