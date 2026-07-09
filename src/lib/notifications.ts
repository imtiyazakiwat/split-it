import { getMessaging, getToken, onMessage } from "firebase/messaging";
import { app } from "./firebase";

const firebaseConfig =
  typeof window !== "undefined"
    ? {
        apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
        authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
        projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
        storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
        messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
        appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
      }
    : {};

const VAPID_KEY = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;

let cachedRegistration: ServiceWorkerRegistration | null = null;

function isVapidKeyValid(key: string): boolean {
  return /^B[A-Za-z0-9_-]{86,}$/.test(key);
}

async function registerMessagingSw(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;
  if (cachedRegistration) return cachedRegistration;

  const params = new URLSearchParams(
    Object.entries(firebaseConfig).filter(([, v]) => !!v) as string[][]
  );

  try {
    cachedRegistration = await navigator.serviceWorker.register(
      `/firebase-messaging-sw.js?${params.toString()}`,
      { scope: "/" }
    );
    await navigator.serviceWorker.ready;
    return cachedRegistration;
  } catch {
    return null;
  }
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof window === "undefined" || !("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  const result = await Notification.requestPermission();
  return result === "granted";
}

export async function getFcmToken(): Promise<string | null> {
  if (typeof window === "undefined") return null;

  if (!VAPID_KEY) {
    console.warn(
      "[FCM] NEXT_PUBLIC_FIREBASE_VAPID_KEY missing. Set it in .env.local"
    );
    return null;
  }
  if (!isVapidKeyValid(VAPID_KEY)) {
    console.warn(
      "[FCM] VAPID key looks invalid. Get the PUBLIC key from Firebase Console > Cloud Messaging > Web Push certificates."
    );
    return null;
  }

  try {
    const messaging = getMessaging(app);
    const registration = await registerMessagingSw();
    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration || undefined,
    });
    return token || null;
  } catch (err) {
    console.error("[FCM] getToken failed:", err);
    return null;
  }
}

export function onForegroundMessage(
  callback: (payload: { title?: string; body?: string; link?: string }) => void
): (() => void) | undefined {
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
  if (typeof window === "undefined") return;
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
