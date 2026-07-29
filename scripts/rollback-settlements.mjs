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
import { writeFileSync, mkdirSync } from "node:fs";
import { db, projectId } from "./lib/admin.mjs";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
// Options that take a value, so their value is not mistaken for a settlement id.
const VALUE_FLAGS = new Set(["--mode", "--group"]);
const valueOf = (flag) => {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : undefined;
};
const mode = valueOf("--mode") ?? "reject";
const groupId = valueOf("--group");
const ids = args.filter((a, i) => !a.startsWith("--") && !VALUE_FLAGS.has(args[i - 1]));

if (!ids.length) { console.error("Pass at least one settlement id."); process.exit(1); }
if (!["reject", "delete"].includes(mode)) { console.error(`Unknown --mode ${mode}`); process.exit(1); }
if (groupId !== undefined && !groupId) { console.error("--group needs a group id."); process.exit(1); }

console.log(`Project : ${projectId}`);
console.log(`Mode    : ${mode}`);
console.log(`Scope   : ${groupId ? `group ${groupId}` : "all groups"}`);
console.log(`Writing : ${apply ? "YES (--apply given)" : "no, dry run"}\n`);

// Find each settlement wherever it lives. With --group we read that group's own
// subcollection, which avoids scanning every settlement in the project.
const query = groupId
  ? db.collection("groups").doc(groupId).collection("settlements")
  : db.collectionGroup("settlements");
const snap = await query.get();
const found = new Map();
for (const d of snap.docs) if (ids.includes(d.id)) found.set(d.id, d);

const missing = ids.filter((i) => !found.has(i));
if (missing.length) {
  console.error(`Not found${groupId ? ` in group ${groupId}` : ""}: ${missing.join(", ")}`);
  process.exit(1);
}

// One read per group, reused for both the group name and every member lookup.
const groupSnaps = new Map();
const groupSnapFor = async (gid) => {
  if (!gid) return null;
  if (!groupSnaps.has(gid)) groupSnaps.set(gid, await db.collection("groups").doc(gid).get());
  return groupSnaps.get(gid);
};
const groupNameOf = (gid, snapshot) =>
  snapshot?.exists ? snapshot.get("name") : `(deleted group ${String(gid).slice(0, 6)})`;

// Legacy settlement docs can be missing fromUid/toUid, so bail out before
// dereferencing an undefined uid.
const memberName = async (groupSnapshot, uid) => {
  if (!uid || typeof uid !== "string") return "(unknown)";
  const n = groupSnapshot?.exists ? groupSnapshot.get(`members.${uid}.displayName`) : null;
  if (n) return n;
  const u = await db.collection("users").doc(uid).get();
  return u.exists ? u.get("displayName") || uid.slice(0, 8) : uid.slice(0, 8);
};

/** createdAt is absent on the oldest documents, so guard the Date conversion. */
const isoOrUnknown = (ms) => {
  const n = Number(ms);
  return Number.isFinite(n) && n > 0 ? new Date(n).toISOString() : "(unknown)";
};

const backup = [];
for (const d of found.values()) {
  const gid = d.ref.parent.parent?.id;
  const data = d.data();
  const groupSnapshot = await groupSnapFor(gid);
  const from = await memberName(groupSnapshot, data.fromUid);
  const to = await memberName(groupSnapshot, data.toUid);
  const effective = data.status || "approved";
  backup.push({ path: d.ref.path, groupId: gid, data });

  console.log(`${groupNameOf(gid, groupSnapshot)}  /  ${d.id}`);
  console.log(`   ${from} -> ${to}   INR ${data.amount}`);
  console.log(`   note            ${JSON.stringify(data.note || "")}`);
  console.log(`   created         ${isoOrUnknown(data.createdAt)}`);
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
