import { getMessaging, getToken, onMessage } from "firebase/messaging";
import { app } from "./firebase";

const VAPID_KEY = process.env.NEXT_PUBLIC_FCM_VAPID_KEY;

export async function requestNotificationPermission(): Promise<boolean> {
  if (!("Notification" in window)) return false;
  const result = await Notification.requestPermission();
  return result === "granted";
}

export async function getFcmToken(): Promise<string | null> {
  if (!VAPID_KEY) return null;
  try {
    const messaging = getMessaging(app);
    const token = await getToken(messaging, { vapidKey: VAPID_KEY });
    return token;
  } catch {
    return null;
  }
}

export function onForegroundMessage(callback: (payload: { title?: string; body?: string; link?: string }) => void): (() => void) | undefined {
  try {
    const messaging = getMessaging(app);
    const unsub = onMessage(messaging, (payload) => {
      const data = payload.data || {};
      callback({
        title: data.title || payload.notification?.title,
        body: data.body || payload.notification?.body,
        link: data.link,
      });
    });
    return unsub;
  } catch {
    return undefined;
  }
}

export function showLocalNotification(title: string, body: string, link?: string) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try {
    const n = new Notification(title, {
      body,
      icon: "/icon-192.png",
      badge: "/favicon-32.png",
    });
    if (link) {
      n.onclick = () => {
        window.focus();
        window.location.href = link;
      };
    }
  } catch {
    // notification failed
  }
}
