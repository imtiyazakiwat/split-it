import { app } from "./firebase";
import { getAppServiceWorker } from "./sw-registration";

/**
 * Push notifications on the client: support detection, permission, the FCM
 * token, and registering this device for the signed-in user.
 *
 * Three rules shape everything here.
 *
 * 1. One service worker. The token is minted against the registration from
 *    `getAppServiceWorker()` — the same /sw.js the rest of the app uses. The
 *    old code registered a second worker at the same scope, and the two kept
 *    replacing each other; see public/sw.js.
 *
 * 2. Tokens are per device, not per user. Each install has a stable device id
 *    and its own `users/{uid}/devices/{deviceId}` document. A single
 *    `users/{uid}.fcmToken` field meant the last phone to open the app silently
 *    took every notification from the others.
 *
 * 3. Failures say why. `getFcmToken` used to return `null` for four different
 *    causes, and Settings reported all of them as "check the VAPID key config" —
 *    something no user can act on. Every path now returns a reason, and
 *    `describePushFailure` turns it into copy a person can do something with.
 *
 * `firebase/messaging` is imported lazily: this module is reached from the root
 * layout (via NotificationSetup), and the SDK is only needed once a token is.
 */

const VAPID_KEY = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY || "";

/** Set when the user turned notifications off on this device. Survives relaunch. */
const OPT_OUT_KEY = "splitit:push-opt-out";
/** Stable per-install id; the key of this device's document. */
const DEVICE_KEY = "splitit:device-id";
/** { uid, token, at } of the last successful registration from this device. */
const REGISTERED_KEY = "splitit:push-registered";
/** Fired whenever any of the above changes, so screens can re-read status. */
const PUSH_EVENT = "splitit:push-change";

/**
 * Re-write the device document at most this often when nothing has changed.
 * Keeps `updatedAt` meaningful for spotting dead devices without writing on
 * every single launch.
 */
const REFRESH_EVERY_MS = 7 * 24 * 60 * 60 * 1000;

export type PushSupport = "supported" | "needs-install" | "unsupported";

export type PushFailure =
  | "unsupported" // this browser has no Web Push at all
  | "needs-install" // iPhone/iPad in a Safari tab: push exists only for Home Screen apps
  | "unavailable" // the app itself isn't configured for push (no VAPID key)
  | "denied" // the user or OS blocked notifications for this site
  | "dismissed" // the permission prompt was closed without a choice
  | "failed"; // everything was allowed but getting or saving the token failed

export type PushResult = { ok: true } | { ok: false; reason: PushFailure };

export type PushStatus = "on" | "off" | Exclude<PushFailure, "dismissed" | "failed">;

// ── Environment ───────────────────────────────────────────────────────────

function isValidVapidKey(key: string): boolean {
  return /^B[A-Za-z0-9_-]{86,}$/.test(key);
}

/** False when this build was made without a usable public VAPID key. */
export function isPushConfigured(): boolean {
  return isValidVapidKey(VAPID_KEY);
}

function isAppleMobile(): boolean {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    // iPadOS 13+ reports a desktop Safari UA.
    (navigator.userAgent.includes("Macintosh") && navigator.maxTouchPoints > 1)
  );
}

function isStandalone(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function getPushSupport(): PushSupport {
  if (typeof window === "undefined") return "unsupported";
  const hasApis =
    "Notification" in window && "serviceWorker" in navigator && "PushManager" in window;
  if (hasApis) return "supported";
  // iOS/iPadOS 16.4+ exposes Web Push only to web apps opened from the Home
  // Screen. In a Safari tab the APIs are simply absent — which the old code
  // reported to the user as "permission denied".
  if (isAppleMobile() && !isStandalone()) return "needs-install";
  return "unsupported";
}

export function detectPlatform(): "ios" | "android" | "desktop" {
  if (typeof window === "undefined") return "desktop";
  if (isAppleMobile()) return "ios";
  if (/Android/i.test(navigator.userAgent)) return "android";
  return "desktop";
}

// ── Local state ───────────────────────────────────────────────────────────

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Private mode or storage disabled: we just lose the memory next launch.
  }
}

function emitPushChange(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(PUSH_EVENT));
}

export function isPushOptedOut(): boolean {
  return readStorage(OPT_OUT_KEY) === "1";
}

/** A random id per install, created on first use and kept thereafter. */
export function getDeviceId(): string {
  const existing = readStorage(DEVICE_KEY);
  if (existing && /^[A-Za-z0-9-]{8,64}$/.test(existing)) return existing;
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  writeStorage(DEVICE_KEY, id);
  return id;
}

interface RegistrationRecord {
  uid: string;
  token: string;
  at: number;
}

function readRegistration(): RegistrationRecord | null {
  const raw = readStorage(REGISTERED_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<RegistrationRecord>;
    if (typeof parsed.uid === "string" && typeof parsed.token === "string") {
      return { uid: parsed.uid, token: parsed.token, at: Number(parsed.at) || 0 };
    }
  } catch {
    /* corrupt entry: treat as unregistered */
  }
  return null;
}

/**
 * What the Notifications switch should show for this device, right now.
 * Only ever reports "on" when a token was actually registered for this user —
 * permission alone isn't enough, because acquiring or saving the token can fail.
 */
export function readPushStatus(uid: string | null | undefined): PushStatus {
  const support = getPushSupport();
  if (support !== "supported") return support;
  if (!isPushConfigured()) return "unavailable";
  if (Notification.permission === "denied") return "denied";
  if (
    uid &&
    Notification.permission === "granted" &&
    !isPushOptedOut() &&
    readRegistration()?.uid === uid
  ) {
    return "on";
  }
  return "off";
}

/** Subscribe to status changes: our own writes, and returning to the app. */
export function subscribePushStatus(onChange: () => void): () => void {
  window.addEventListener(PUSH_EVENT, onChange);
  // Permission can be changed in OS settings while the app is backgrounded.
  document.addEventListener("visibilitychange", onChange);
  return () => {
    window.removeEventListener(PUSH_EVENT, onChange);
    document.removeEventListener("visibilitychange", onChange);
  };
}

// ── Token + device registration ───────────────────────────────────────────

async function acquireToken(): Promise<{ ok: true; token: string } | { ok: false; reason: PushFailure }> {
  try {
    const [{ getMessaging, getToken, isSupported }, registration] = await Promise.all([
      import("firebase/messaging"),
      getAppServiceWorker(),
    ]);
    if (!(await isSupported())) return { ok: false, reason: "unsupported" };
    if (!registration) return { ok: false, reason: "failed" };
    const token = await getToken(getMessaging(app), {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration,
    });
    return token ? { ok: true, token } : { ok: false, reason: "failed" };
  } catch (err) {
    // Kept for diagnosis; the user sees a reason, not this.
    console.error("[push] getToken failed:", err);
    return { ok: false, reason: "failed" };
  }
}

async function saveDevice(uid: string, token: string, force: boolean): Promise<PushResult> {
  const previous = readRegistration();
  const unchanged =
    previous?.uid === uid && previous.token === token && Date.now() - previous.at < REFRESH_EVERY_MS;
  if (unchanged && !force) return { ok: true };

  try {
    const { registerPushDevice } = await import("./firestore");
    await registerPushDevice(uid, getDeviceId(), token, detectPlatform());
  } catch (err) {
    console.error("[push] saving this device failed:", err);
    return { ok: false, reason: "failed" };
  }
  writeStorage(REGISTERED_KEY, JSON.stringify({ uid, token, at: Date.now() }));
  emitPushChange();
  return { ok: true };
}

/**
 * Turns notifications on for this device. Call it from a tap: iOS only allows
 * the permission prompt in direct response to a user gesture.
 */
export async function enablePushForUser(uid: string): Promise<PushResult> {
  const support = getPushSupport();
  if (support !== "supported") return { ok: false, reason: support };
  if (!isPushConfigured()) return { ok: false, reason: "unavailable" };

  let permission = Notification.permission;
  if (permission === "default") {
    try {
      permission = await Notification.requestPermission();
    } catch {
      return { ok: false, reason: "failed" };
    }
  }
  if (permission === "denied") {
    emitPushChange();
    return { ok: false, reason: "denied" };
  }
  if (permission !== "granted") return { ok: false, reason: "dismissed" };

  writeStorage(OPT_OUT_KEY, null);
  const token = await acquireToken();
  if (!token.ok) {
    emitPushChange();
    return token;
  }
  return saveDevice(uid, token.token, true);
}

/**
 * Keeps this device's registration fresh on launch. Never prompts, and does
 * nothing if the user turned notifications off here — the old version re-saved
 * the token on every launch, which silently undid the Settings switch.
 */
export async function refreshPushForUser(uid: string): Promise<PushResult | null> {
  if (getPushSupport() !== "supported" || !isPushConfigured()) return null;
  if (isPushOptedOut() || Notification.permission !== "granted") return null;
  const token = await acquireToken();
  if (!token.ok) return token;
  return saveDevice(uid, token.token, false);
}

/** Turns notifications off for this device only, and remembers the choice. */
export async function disablePushForUser(uid: string): Promise<void> {
  writeStorage(OPT_OUT_KEY, "1");
  writeStorage(REGISTERED_KEY, null);
  emitPushChange();

  try {
    const { disablePushDevice } = await import("./firestore");
    await disablePushDevice(uid, getDeviceId());
  } catch (err) {
    console.error("[push] disabling this device failed:", err);
  }

  // Best-effort: also retire the token itself, so even a server holding a stale
  // copy can no longer reach this device. A fresh token is minted on re-enable.
  try {
    const { getMessaging, deleteToken } = await import("firebase/messaging");
    await deleteToken(getMessaging(app));
  } catch {
    /* offline or never had one: the device document is already disabled */
  }
}

/** One sentence the user can act on, for each way turning push on can fail. */
export function describePushFailure(reason: PushFailure): string {
  switch (reason) {
    case "needs-install":
      return "To get notifications on iPhone or iPad, add SplitIt to your Home Screen and open it from there.";
    case "unsupported":
      return "This browser can't show notifications.";
    case "unavailable":
      return "Notifications aren't available yet.";
    case "denied":
      return "Notifications are blocked for SplitIt. Turn them on in your device's notification settings, then come back.";
    case "dismissed":
      return "Notifications weren't turned on. Tap the switch to try again.";
    case "failed":
      return "Couldn't turn on notifications. Check your connection and try again.";
  }
}
