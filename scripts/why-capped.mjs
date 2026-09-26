/**
 * Read-only: reproduce the number the allocation sheet actually used.
 *
 * `IncludeTransferSheet` computes each group's offer as
 *
 *     theyOweMe = pairwiseNet(sender, receiver, d.expenses, d.settlements)
 *
 * where `d` comes from `GroupDataProvider.datasets`. That provider exposes
 * `expenses` and `settlements` from two *independent* listeners and the Pay
 * screen renders as soon as the groups list has loaded, so `d` can legitimately
 * hold one collection and not the other.
 *
 * This script evaluates the same expression under every partial-load state the
 * provider can be in, and reports which one produces the leg that was written.
 * Usage: node scripts/why-capped.mjs --transfer=<id> --group=<id> --leg=<rupees>
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

const isActive = (e) => e.editAction !== "deleted";
const isApproved = (s) => (s.status || "approved") === "approved";

const transferId = argOf("transfer");
const groupId = argOf("group");
const legPaise = P(argOf("leg"));

const users = new Map();
for await (const d of db.collection("users").stream()) users.set(d.id, d.data());
const nameOf = (uid) => users.get(uid)?.displayName || `(${String(uid).slice(0, 6)})`;

const tSnap = await db.collection("transfers").doc(transferId).get();
const t = { id: tSnap.id, ...tSnap.data() };
const from = t.fromUid;
const to = t.toUid;
const bookedAt = t.updatedAt || t.createdAt;
const legIds = new Set(Object.keys(t.allocations || {}));

const expenses = [];
for await (const d of db.collection("groups").doc(groupId).collection("expenses").stream()) {
  expenses.push({ id: d.id, ...d.data() });
}
const settlements = [];
for await (const d of db.collection("groups").doc(groupId).collection("settlements").stream()) {
  settlements.push({ id: d.id, ...d.data() });
}

const gSnap = await db.collection("groups").doc(groupId).get();
console.log(`Project: ${projectId}`);
console.log(`Group:   ${gSnap.get("name")}`);
console.log(`Pair:    ${nameOf(from)} (sender) -> ${nameOf(to)} (receiver)`);
console.log(`Leg written: ${inr(legPaise)}\n`);
console.log("Sign convention below: POSITIVE = sender owes receiver (what the");
console.log("sheet calls `theyOweMe`, and the only case it offers a group at all).\n");

/** Exactly src/lib/balance.ts pairwiseNet, in paise, over the rows given. */
function pairwiseNet(exps, setts, a, b) {
  let net = 0;
  for (const e of exps) {
    if (!isActive(e)) continue;
    for (const s of e.splits || []) {
      if (s.uid === e.paidBy) continue;
      if (s.uid === a && e.paidBy === b) net += P(s.amount);
      if (s.uid === b && e.paidBy === a) net -= P(s.amount);
    }
  }
  for (const s of setts) {
    if (!isApproved(s)) continue;
    if (s.fromUid === a && s.toUid === b) net -= P(s.amount);
    if (s.fromUid === b && s.toUid === a) net += P(s.amount);
  }
  return net;
}

// Rows that existed when the booking happened, excluding the legs it created.
const exAt = expenses.filter((e) => (e.createdAt || 0) <= bookedAt);
const stAt = settlements.filter((s) => (s.createdAt || 0) <= bookedAt && !legIds.has(s.id));

const scenarios = [
  ["both collections loaded (correct)", exAt, stAt],
  ["expenses loaded, settlements MISSING", exAt, []],
  ["settlements loaded, expenses MISSING", [], stAt],
  ["neither loaded", [], []],
  ["expenses loaded, only approved-settlements missing", exAt, stAt.filter((s) => !isApproved(s))],
];

let hit = null;
for (const [label, e, s] of scenarios) {
  const net = pairwiseNet(e, s, from, to);
  const offered = net > 0;
  const capped = Math.max(0, Math.min(net, P(t.amount)));
  const match = offered && capped === legPaise;
  if (match && !hit) hit = label;
  console.log(
    `  ${match ? ">>" : "  "} ${label.padEnd(52)} theyOweMe = ${inr(net).padStart(12)}  ` +
      `${offered ? `offered, would cap at ${inr(capped)}` : "NOT offered (<= 0)"}${match ? "   <== MATCHES THE LEG WRITTEN" : ""}`
  );
}

console.log("");
if (hit) {
  console.log(`CONCLUSION: the sheet was reading a partially-loaded ledger — "${hit}".`);
} else {
  console.log("CONCLUSION: no whole-collection partial-load state reproduces the leg;");
  console.log("the ledger must have been partially *streamed* (some documents of a");
  console.log("collection present, others not). Narrowing to a document prefix:");

  // Firestore delivers a snapshot atomically, but the provider replaces state on
  // every snapshot, and expenses arrive sorted by recency. Try growing prefixes.
  const byNewest = [...exAt].sort(
    (a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0)
  );
  for (let k = 0; k <= byNewest.length; k++) {
    for (const [slabel, sset] of [
      ["no settlements", []],
      ["all settlements", stAt],
    ]) {
      const net = pairwiseNet(byNewest.slice(0, k), sset, from, to);
      if (net > 0 && Math.min(net, P(t.amount)) === legPaise) {
        console.log(`  newest ${k} of ${byNewest.length} expenses + ${slabel} -> theyOweMe = ${inr(net)}  <== MATCHES`);
      }
    }
  }
}

console.log(`\nFinal state now, with everything loaded:`);
const finalNet = pairwiseNet(expenses, settlements, from, to);
console.log(`  ${nameOf(from)} owes ${nameOf(to)}: ${inr(finalNet)}`);
console.log(
  `  The ${inr(legPaise)} leg ${finalNet < 0 ? "pushed this the WRONG WAY" : "reduced this"} — a settlement ` +
    `${nameOf(from)} -> ${nameOf(to)} credits ${nameOf(from)}, so booking it into a group where ` +
    `${nameOf(from)} was already owed money increases the debt instead of clearing it.`
);
