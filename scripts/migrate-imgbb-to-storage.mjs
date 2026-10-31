/**
 * Moves every ImgBB image referenced in Firestore into Firebase Storage and
 * rewrites the references to the new download URLs.
 *
 *   node scripts/migrate-imgbb-to-storage.mjs            # dry run: plan only
 *   node scripts/migrate-imgbb-to-storage.mjs --apply    # copy + rewrite
 *
 * Safety:
 * - Every original value is written to scripts/backups/ before any change, so a
 *   rewrite can be undone field by field.
 * - Each Firestore write touches only the one field that held the old URL
 *   (dotted path for member photos, a re-written array for receipts). A field
 *   that changed since the scan is left alone.
 * - An image that won't download after retries keeps its ImgBB URL and is
 *   listed in the report. Nothing is ever deleted.
 * - Re-running is safe: already-migrated URLs are no longer ImgBB URLs.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { db, projectId } from "./lib/admin.mjs";
import { getStorage } from "firebase-admin/storage";
import { FieldPath } from "firebase-admin/firestore";

const APPLY = process.argv.includes("--apply");
const BUCKET = `${projectId}.firebasestorage.app`;
const ATTEMPTS = 8;
const isImgbb = (u) => typeof u === "string" && /^https:\/\/i\.ibb\.co\//.test(u);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 1. Find every reference ────────────────────────────────────────────────
const refs = []; // { url, docPath, kind: "field"|"member"|"array", field, uid?, index?, owner, folder }
const users = await db.collection("users").get();
for (const u of users.docs) {
  if (isImgbb(u.get("photoURL"))) refs.push({ url: u.get("photoURL"), docPath: u.ref.path, kind: "field", field: "photoURL", owner: u.id, folder: "avatars" });
}
const groups = await db.collection("groups").get();
for (const g of groups.docs) {
  if (isImgbb(g.get("photoURL"))) refs.push({ url: g.get("photoURL"), docPath: g.ref.path, kind: "field", field: "photoURL", owner: g.get("createdBy") || "system", folder: "groups" });
  for (const [uid, m] of Object.entries(g.get("members") || {})) {
    if (isImgbb(m?.photoURL)) refs.push({ url: m.photoURL, docPath: g.ref.path, kind: "member", field: `members.${uid}.photoURL`, uid, owner: uid, folder: "avatars" });
  }
  for (const sub of ["expenses", "settlements"]) {
    for (const d of (await g.ref.collection(sub).get()).docs) {
      (d.get("receiptUrls") || []).forEach((url, index) => {
        if (isImgbb(url)) refs.push({ url, docPath: d.ref.path, kind: "array", field: "receiptUrls", index, owner: d.get("createdBy") || d.get("fromUid") || "system", folder: "receipts" });
      });
    }
  }
}
for (const t of (await db.collection("transfers").get()).docs) {
  (t.get("receiptUrls") || []).forEach((url, index) => {
    if (isImgbb(url)) refs.push({ url, docPath: t.ref.path, kind: "array", field: "receiptUrls", index, owner: t.get("fromUid") || "system", folder: "receipts" });
  });
}

const unique = [...new Map(refs.map((r) => [r.url, r])).values()];
console.log(`${refs.length} references to ${unique.length} ImgBB images. Mode: ${APPLY ? "APPLY" : "dry run"}`);

// ── 2. Download each image, retrying ImgBB's intermittent 503s ─────────────
// ImgBB answers a missing or unavailable image with a non-200 status and a
// small "image not found" PNG, so only a 200 with an image body counts.
async function download(url) {
  for (let i = 1; i <= ATTEMPTS; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      const type = res.headers.get("content-type") || "";
      if (res.status === 200 && type.startsWith("image/")) {
        return { body: Buffer.from(await res.arrayBuffer()), type };
      }
      console.log(`  try ${i}/${ATTEMPTS}: HTTP ${res.status} ${url.slice(0, 40)}…`);
    } catch (err) {
      console.log(`  try ${i}/${ATTEMPTS}: ${err.name} ${url.slice(0, 40)}…`);
    }
    await sleep(Math.min(30_000, 2_000 * 2 ** (i - 1)));
  }
  return null;
}

const bucket = getStorage().bucket(BUCKET);
const moved = new Map(); // old url -> new url
const failed = [];
const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/heic": "heic" };

for (const r of unique) {
  const got = await download(r.url);
  if (!got) {
    failed.push(r.url);
    continue;
  }
  if (!APPLY) {
    moved.set(r.url, "(would upload)");
    console.log(`  ok ${(got.body.length / 1e3).toFixed(0)} kB ${r.url.slice(0, 40)}…`);
    continue;
  }
  // Same layout the app uses for new uploads: {folder}/{ownerUid}/{random}.{ext}
  const token = randomUUID();
  const name = `${r.folder}/${r.owner}/${createHash("sha1").update(r.url).digest("hex").slice(0, 16)}.${EXT[got.type] || "img"}`;
  await bucket.file(name).save(got.body, {
    contentType: got.type,
    resumable: false,
    metadata: {
      cacheControl: "public, max-age=31536000, immutable",
      metadata: { firebaseStorageDownloadTokens: token, migratedFrom: r.url },
    },
  });
  const newUrl = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(name)}?alt=media&token=${token}`;
  // Prove the new URL serves the same bytes before pointing anything at it.
  const check = await fetch(newUrl);
  const back = Buffer.from(await check.arrayBuffer());
  if (check.status !== 200 || !back.equals(got.body)) {
    console.log(`  VERIFY FAILED for ${name}; keeping the old URL`);
    failed.push(r.url);
    continue;
  }
  moved.set(r.url, newUrl);
  console.log(`  moved ${(got.body.length / 1e3).toFixed(0)} kB → ${name}`);
}

// ── 3. Back up originals, then rewrite only the fields that held them ──────
const touched = refs.filter((r) => moved.has(r.url));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
mkdirSync("scripts/backups", { recursive: true });
const backupFile = `scripts/backups/imgbb-migration-${stamp}.json`;
writeFileSync(backupFile, JSON.stringify({ apply: APPLY, bucket: BUCKET, refs: touched.map((r) => ({ ...r, newUrl: moved.get(r.url) })), failed }, null, 2));

let writes = 0;
if (APPLY) {
  // Group array edits per document so a doc with several receipts is written once.
  const arrayDocs = new Map();
  for (const r of touched) {
    const ref = db.doc(r.docPath);
    if (r.kind === "array") {
      arrayDocs.set(r.docPath, [...(arrayDocs.get(r.docPath) || []), r]);
      continue;
    }
    // FieldPath, not a dotted string, so a uid can never be misread as a path.
    const path = r.kind === "member" ? new FieldPath("members", r.uid, "photoURL") : new FieldPath(r.field);
    const did = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.get(path) !== r.url) return false; // changed since the scan: leave it
      tx.update(ref, path, moved.get(r.url));
      return true;
    });
    if (did) writes++;
  }
  for (const [docPath, items] of arrayDocs) {
    const ref = db.doc(docPath);
    const did = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const list = [...(snap.get("receiptUrls") || [])];
      let changed = false;
      for (const r of items) {
        if (list[r.index] === r.url) {
          list[r.index] = moved.get(r.url);
          changed = true;
        }
      }
      if (changed) tx.update(ref, { receiptUrls: list });
      return changed;
    });
    if (did) writes++;
  }
}

console.log(`\nDone. Images moved: ${moved.size}/${unique.length}. Firestore documents updated: ${writes}.`);
console.log(`Still on ImgBB (could not download): ${failed.length}`);
for (const u of failed) console.log(`  ${u}`);
console.log(`Backup of every original value: ${backupFile}`);
process.exit(0);
