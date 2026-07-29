/**
 * Shared Firebase Admin bootstrap for the maintenance scripts.
 *
 * Reads credentials from .env.local (FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY)
 * and falls back to Application Default Credentials when they are absent.
 *
 * Both scripts/export-report.mjs and scripts/rollback-settlements.mjs used to
 * carry their own copy of this logic, which drifted (different quote handling,
 * only one of them validated projectId). It lives here once now.
 */
import { readFileSync } from "node:fs";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

/**
 * Loads KEY=value pairs from a dotenv file into process.env without overwriting
 * variables that are already set.
 *
 * Supports KEY=bare, KEY="quoted", KEY='quoted' and quoted values spanning
 * multiple lines (how a PEM private key is usually pasted into .env.local).
 */
export function loadEnv(file = ".env.local") {
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return;
  }
  raw = raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const re =
    /^[ \t]*(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)[ \t]*=[ \t]*("(?:[^"\\]|\\[\s\S])*"|'(?:[^'\\]|\\[\s\S])*'|[^\n]*)/gm;
  let m;
  while ((m = re.exec(raw)) !== null) {
    const key = m[1];
    let val = m[2];
    if (val.startsWith('"') && val.endsWith('"') && val.length > 1) {
      val = val.slice(1, -1);
    } else if (val.startsWith("'") && val.endsWith("'") && val.length > 1) {
      val = val.slice(1, -1);
    } else {
      val = val.trim().replace(/\s+#.*$/, "");
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadEnv(".env.local");

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY;

if (!projectId) {
  console.error(
    "Missing NEXT_PUBLIC_FIREBASE_PROJECT_ID (checked .env.local and the environment)."
  );
  process.exit(1);
}

if (getApps().length === 0) {
  initializeApp(
    clientEmail && privateKey
      ? {
          credential: cert({
            projectId,
            clientEmail,
            privateKey: privateKey.replace(/\\n/g, "\n"),
          }),
        }
      : { projectId }
  );
}

/** True when a service account from .env.local is in use, false for ADC. */
export const usingServiceAccount = Boolean(clientEmail && privateKey);
export { projectId };
export const db = getFirestore();
