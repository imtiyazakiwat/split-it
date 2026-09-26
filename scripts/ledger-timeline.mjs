/**
 * Read-only: the full event timeline of one group's ledger for one pair, with
 * every mutation timestamp exposed.
 *
 * The other scripts reconstruct "what was owed at time T" from the *current*
 * state of each document. That is only valid if documents have not changed since
 * T. An expense edited or deleted afterwards, or a settlement whose status
 * flipped, makes the reconstruction silently wrong — so this prints the raw
 * mutation timestamps and marks everything that moved after a given instant.
 *
 * Usage: node scripts/ledger-timeline.mjs --group=<id> --a=<uid> --b=<uid> --after=<epochMs>
 */
import { db, projectId } from "./lib/admin.mjs";

const args = process.argv.slice(2);
const argOf = (n) => {
  const hit = args.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : null;
};

const P = (r) => {
  const n = Number(r);
  if (!Number.isFinite(n)) return 0;
  const s = Number((n * 100).toPrecision(15));
  return s < 0 ? -Math.round(-s) : Math.round(s);
};
const inr = (p) =>
  `${p < 0 ? "-" : ""}\u20b9${Math.abs(p / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
const when = (ts) => (ts ? new Date(ts).toISOString().replace("T", " ").slice(0, 19) : "—");

const groupId = argOf("group");
const uidA = argOf("a");
const uidB = argOf("b");
const after = argOf("after") ? Number(argOf("after")) : null;

const users = new Map();
for await (const d of db.collection("users").stream()) users.set(d.id, d.data());
const short = (uid) => (users.get(uid)?.displayName || String(uid).slice(0, 6)).split(" ")[0];

const gSnap = await db.collection("groups").doc(groupId).get();
console.log(`Project: ${projectId}`);
console.log(`Group:   ${gSnap.get("name")} (${groupId})`);
console.log(`Pair:    ${short(uidA)} / ${short(uidB)}`);
if (after !== null) console.log(`Marking anything mutated after ${when(after)}\n`);

const expenses = [];
for await (const d of db.collection("groups").doc(groupId).collection("expenses").stream()) {
  expenses.push({ id: d.id, ...d.data() });
}
const settlements = [];
for await (const d of db.collection("groups").doc(groupId).collection("settlements").stream()) {
  settlements.push({ id: d.id, ...d.data() });
}

let mutatedAfter = 0;

console.log("EXPENSES");
console.log("-".repeat(112));
for (const e of expenses.sort((x, y) => (x.createdAt || 0) - (y.createdAt || 0))) {
  const splitSum = (e.splits || []).reduce((t, s) => t + P(s.amount), 0);
  const aS = (e.splits || []).find((s) => s.uid === uidA);
  const bS = (e.splits || []).find((s) => s.uid === uidB);
  const touchesPair =
    (e.paidBy === uidA && bS) || (e.paidBy === uidB && aS);
  const moved = after !== null && (e.updatedAt || 0) > after;
  if (moved && touchesPair) mutatedAfter++;
  const flags = [
    e.editAction ? e.editAction.toUpperCase() : "",
    splitSum !== P(e.amount) ? `SPLIT-GAP ${inr(P(e.amount) - splitSum)}` : "",
    moved ? "*** MUTATED AFTER ***" : "",
  ]
    .filter(Boolean)
    .join("  ");
  console.log(
    `${when(e.createdAt)}  upd ${when(e.updatedAt)}  ${inr(P(e.amount)).padStart(11)}  ` +
      `paid by ${short(e.paidBy).padEnd(8)}  ${touchesPair ? "PAIR" : "    "}  ` +
      `${String(e.description || "").slice(0, 28).padEnd(28)} ${flags}`
  );
}

console.log("\nSETTLEMENTS");
console.log("-".repeat(112));
for (const s of settlements.sort((x, y) => (x.createdAt || 0) - (y.createdAt || 0))) {
  const touchesPair =
    (s.fromUid === uidA && s.toUid === uidB) || (s.fromUid === uidB && s.toUid === uidA);
  const moved = after !== null && (s.updatedAt || 0) > after;
  if (moved && touchesPair) mutatedAfter++;
  console.log(
    `${when(s.createdAt)}  upd ${when(s.updatedAt)}  ${inr(P(s.amount)).padStart(11)}  ` +
      `${short(s.fromUid)} -> ${short(s.toUid)}`.padEnd(22) +
      `  ${(s.status || "approved").padEnd(9)} ${(s.kind || "payment").padEnd(9)} ${
        touchesPair ? "PAIR" : "    "
      }  ${moved ? "*** MUTATED AFTER ***" : ""}  ${String(s.note || "").slice(0, 26)}`
  );
}

console.log("\n" + "=".repeat(112));
if (after !== null) {
  console.log(
    mutatedAfter === 0
      ? `No pair-relevant document was mutated after ${when(after)} — a reconstruction as of that instant is trustworthy.`
      : `${mutatedAfter} pair-relevant document(s) were mutated after ${when(after)} — reconstructions as of that instant are NOT trustworthy.`
  );
}
