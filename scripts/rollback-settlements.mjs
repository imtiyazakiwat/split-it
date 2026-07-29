/**
 * Rolls back specific settlement documents.
 *
 *   node scripts/rollback-settlements.mjs <id...> [--group <id>] [--mode reject|delete] [--apply]
 *
 * Defaults to a DRY RUN: nothing is written unless --apply is passed.
 * Before any write it saves the untouched documents to reports/rollback-backup-<ts>.json
 * so the change can be undone.
 *
 * Modes:
 *   reject (default) - sets status:"rejected". This is exactly what the app's own
 *                      reject button does, so balance math stops counting it while
 *                      the record stays visible in history. Reversible.
 *   delete           - removes the document entirely. Note firestore.rules denies
 *                      delete to all clients; only the Admin SDK can do this.
 *                      Not reversible except from the backup file.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

function loadEnv(file) {
  let raw;
  try { raw = readFileSync(file, "utf8"); } catch { return; }
  raw = raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const re = /^[ \t]*(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)[ \t]*=[ \t]*("(?:[^"\\]|\\[\s\S])*"|'(?:[^'\\]|\\[\s\S])*'|[^\n]*)/gm;
  let m;
  while ((m = re.exec(raw)) !== null) {
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    else v = v.trim().replace(/\s+#.*$/, "");
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
loadEnv(".env.local");

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const modeIdx = args.indexOf("--mode");
const mode = modeIdx !== -1 ? args[modeIdx + 1] : "reject";
const ids = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--mode");

if (!ids.length) { console.error("Pass at least one settlement id."); process.exit(1); }
if (!["reject", "delete"].includes(mode)) { console.error(`Unknown --mode ${mode}`); process.exit(1); }

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY;
initializeApp(
  clientEmail && privateKey
    ? { credential: cert({ projectId, clientEmail, privateKey: privateKey.replace(/\\n/g, "\n") }) }
    : { projectId }
);
const db = getFirestore();

console.log(`Project : ${projectId}`);
console.log(`Mode    : ${mode}`);
console.log(`Writing : ${apply ? "YES (--apply given)" : "no, dry run"}\n`);

// find each settlement wherever it lives
const snap = await db.collectionGroup("settlements").get();
const found = new Map();
for (const d of snap.docs) if (ids.includes(d.id)) found.set(d.id, d);

const missing = ids.filter((i) => !found.has(i));
if (missing.length) { console.error(`Not found: ${missing.join(", ")}`); process.exit(1); }

const groupNames = new Map();
for (const d of found.values()) {
  const gid = d.ref.parent.parent?.id;
  if (gid && !groupNames.has(gid)) {
    const g = await db.collection("groups").doc(gid).get();
    groupNames.set(gid, g.exists ? g.get("name") : `(deleted group ${gid.slice(0, 6)})`);
  }
}
const memberName = async (gid, uid) => {
  const g = await db.collection("groups").doc(gid).get();
  const n = g.exists ? g.get(`members.${uid}.displayName`) : null;
  if (n) return n;
  const u = await db.collection("users").doc(uid).get();
  return u.exists ? u.get("displayName") : uid.slice(0, 8);
};

const backup = [];
for (const d of found.values()) {
  const gid = d.ref.parent.parent?.id;
  const data = d.data();
  const from = await memberName(gid, data.fromUid);
  const to = await memberName(gid, data.toUid);
  const effective = data.status || "approved";
  backup.push({ path: d.ref.path, groupId: gid, data });

  console.log(`${groupNames.get(gid)}  /  ${d.id}`);
  console.log(`   ${from} -> ${to}   INR ${data.amount}`);
  console.log(`   note            ${JSON.stringify(data.note || "")}`);
  console.log(`   created         ${new Date(data.createdAt).toISOString()}`);
  console.log(`   status now      ${effective}${data.status ? "" : " (field absent, app treats as approved)"}`);
  if (mode === "reject") {
    console.log(`   status after    rejected   -> stops counting toward settled balances`);
    if (effective !== "approved") console.log(`   NOTE: this was not approved, rolling it back changes no balance`);
  } else {
    console.log(`   after           DOCUMENT DELETED`);
  }
  console.log();
}

if (!apply) {
  console.log("Dry run only. Nothing was written.");
  console.log(`Re-run with --apply to ${mode === "reject" ? "set these to rejected" : "delete these"}.`);
  process.exit(0);
}

mkdirSync("reports", { recursive: true });
const backupPath = `reports/rollback-backup-${Date.now()}.json`;
writeFileSync(backupPath, JSON.stringify({ mode, at: new Date().toISOString(), docs: backup }, null, 2));
console.log(`Backup written to ${backupPath}`);

const batch = db.batch();
for (const d of found.values()) {
  if (mode === "reject") batch.update(d.ref, { status: "rejected", updatedAt: Date.now() });
  else batch.delete(d.ref);
}
await batch.commit();
console.log(`Done. ${found.size} settlement(s) ${mode === "reject" ? "set to rejected" : "deleted"}.`);
console.log("Re-run `npm run report` to refresh the CSVs.");
