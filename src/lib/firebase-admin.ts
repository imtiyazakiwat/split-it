import { initializeApp, getApps, cert, App } from "firebase-admin/app";
import { getMessaging as getAdminMessaging } from "firebase-admin/messaging";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getFirestore as getAdminFirestore } from "firebase-admin/firestore";

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY;

function getFirebaseApp(): App {
  const apps = getApps();
  if (apps.length) return apps[0]!;

  if (clientEmail && privateKey) {
    return initializeApp({
      credential: cert({
        projectId,
        clientEmail,
        privateKey: privateKey.replace(/\\n/g, "\n"),
      }),
    });
  }

  return initializeApp({ projectId });
}

export function getMessaging() {
  return getAdminMessaging(getFirebaseApp());
}

export function getAuth() {
  return getAdminAuth(getFirebaseApp());
}

export function getDb() {
  return getAdminFirestore(getFirebaseApp());
}

/**
 * Verifies a `Authorization: Bearer <Firebase ID token>` header and returns the
 * caller's uid, or null when the header is missing or the token is invalid,
 * expired or revoked.
 */
export async function verifyCaller(
  authorization: string | null
): Promise<string | null> {
  const match = /^Bearer (.+)$/.exec(authorization?.trim() ?? "");
  if (!match) return null;
  try {
    const decoded = await getAuth().verifyIdToken(match[1], true);
    return decoded.uid;
  } catch {
    return null;
  }
}
