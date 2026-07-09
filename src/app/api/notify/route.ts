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

    const message: {
      token: string;
      notification: { title: string; body: string };
      webpush?: { fcmOptions: { link: string } };
    } = {
      token,
      notification: { title, body },
    };

    if (link) {
      message.webpush = { fcmOptions: { link } };
    }

    const response = await messaging.send(message);

    return NextResponse.json({ success: true, messageId: response });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
