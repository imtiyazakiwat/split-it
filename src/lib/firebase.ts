import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";

/**
 * Firebase app + auth only. Firestore deliberately lives in `./firebase-db`.
 *
 * Measured: `@firebase/firestore` compiles to a 641 kB client chunk — 46% of the
 * 1386 kB this app parses before the home screen can become interactive, and more
 * than react-dom and every line of application code combined. Turbopack already
 * isolates it into its own chunk; it was only loaded eagerly because this module
 * created `db` at import time and sat in the root layout's import graph via
 * AuthProvider.
 *
 * Splitting it out means nothing on the critical path mentions
 * `firebase/firestore` statically, so that chunk is fetched after hydration
 * instead of blocking it. Auth stays here because the login decision genuinely is
 * needed immediately.
 *
 * Anything needing `db` must `await import("./firebase-db")`. That is enforced by
 * construction rather than convention: importing it statically from a module the
 * layout reaches would pull the chunk straight back onto the critical path, and
 * `npm run analyze:critical` will say so.
 */

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

// Avoid re-initializing on hot reload / multiple imports
export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const isFirebaseConfigReady = !!firebaseConfig.apiKey;

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

export { firebaseConfig };

// Analytics only works in the browser (relies on window), and is optional —
// don't let it break server rendering or environments without measurementId.
export async function initAnalytics() {
  if (typeof window === "undefined" || !firebaseConfig.measurementId) return null;
  const { getAnalytics, isSupported } = await import("firebase/analytics");
  if (!(await isSupported())) return null;
  return getAnalytics(app);
}
