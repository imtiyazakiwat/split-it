import { initializeApp, getApps, cert, App } from "firebase-admin/app";
import { getMessaging as getAdminMessaging } from "firebase-admin/messaging";

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
