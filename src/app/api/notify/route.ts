import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/notify
 *
 * Sends a push notification via Firebase Cloud Messaging.
 * Requires the FCM server key configured in environment:
 *   FCM_SERVER_KEY —可从 Firebase 控制台 > Cloud Messaging > 服务器密钥获取
 *
 * Body: { token: string, title: string, body: string, link?: string, icon?: string }
 */
export async function POST(req: NextRequest) {
  try {
    const { token, title, body, link, icon } = await req.json();
    if (!token || !title || !body) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const serverKey = process.env.FCM_SERVER_KEY;
    if (!serverKey) {
      return NextResponse.json(
        { error: "FCM_SERVER_KEY not configured. Set it in .env.local" },
        { status: 501 }
      );
    }

    const fcmRes = await fetch("https://fcm.googleapis.com/fcm/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `key=${serverKey}`,
      },
      body: JSON.stringify({
        to: token,
        notification: { title, body, icon: icon || "/icon-192.png" },
        data: { link: link || "" },
      }),
    });

    if (!fcmRes.ok) {
      const text = await fcmRes.text();
      return NextResponse.json({ error: `FCM error: ${text}` }, { status: 502 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
