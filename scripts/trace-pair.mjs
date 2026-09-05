/**
 * Read-only trace of one pair's ledger inside one group, computed three ways:
 *
 *   paise   — exact integer arithmetic (ground truth)
 *   app     — computePairwiseLedger: raw float accumulation, rounded once
 *   stmt    — buildPairStatement: round2 applied at every single step
 *
 * If these disagree, the balance chip, the settle-up row and the "why do I owe
 * this" statement sheet show different numbers for the same pair.
 *
 * Usage: node scripts/trace-pair.mjs "<group>" "<name A>" "<name B>"
 */
import { db } from "./lib/admin.mjs";

const [needle, nameA, nameB] = process.argv.slice(2);
if (!needle || !nameA || !nameB) {
  console.error('Usage: node scripts/trace-pair.mjs "<group>" "<name A>" "<name B>"');
  process.exit(1);
}

const P = (r) => {
  const n = Number(r);
  if (!Number.isFinite(n)) return 0;
  const s = Number((n * 100).toPrecision(15));
  return s < 0 ? -Math.round(-s) : Math.round(s);
};
const R = (p) => (p / 100).toFixed(2);
const round2 = (n) => Math.round(n * 100) / 100;

const users = new Map();
for await (const d of db.collection("users").stream()) users.set(d.id, d.data());
const groups = [];
for await (const d of db.collection("groups").stream()) groups.push({ id: d.id, ...d.data() });

const group = groups.find(
  (g) => g.id.toLowerCase() === needle.toLowerCase() || (g.name || "").toLowerCase().includes(needle.toLowerCase())
);
if (!group) { console.error("group not found"); process.exit(1); }

const nm = (uid) => group.members?.[uid]?.displayName || users.get(uid)?.displayName || uid.slice(0, 6);
const find = (want) => {
  const hit = [...new Set([...group.memberIds])].find((u) => nm(u).toLowerCase().includes(want.toLowerCase()));
  if (!hit) { console.error(`no member matching "${want}" in ${group.name}`); process.exit(1); }
  return hit;
};
const A = find(nameA);
const B = find(nameB);

const expenses = [];
for await (const d of db.collection("groups").doc(group.id).collection("expenses").stream()) expenses.push({ id: d.id, ...d.data() });
const settlements = [];
for await (const d of db.collection("groups").doc(group.id).collection("settlements").stream()) settlements.push({ id: d.id, ...d.data() });

const rows = [];
for (const e of expenses) {
  if (e.editAction === "deleted") continue;
  const splits = Array.isArray(e.splits) ? e.splits : [];
  const shareA = splits.find((s) => s.uid === A)?.amount ?? 0;
  const shareB = splits.find((s) => s.uid === B)?.amount ?? 0;
  // Positive delta = B owes A more.
  if (e.paidBy === A && shareB) rows.push({ ts: e.createdAt, label: `${e.description} (A paid)`, delta: shareB, kind: "e" });
  else if (e.paidBy === B && shareA) rows.push({ ts: e.createdAt, label: `${e.description} (B paid)`, delta: -shareA, kind: "e" });
}
for (const s of settlements) {
  const involves = (s.fromUid === A && s.toUid === B) || (s.fromUid === B && s.toUid === A);
  if (!involves) continue;
  const status = s.status || "approved";
  if (status !== "approved") { rows.push({ ts: s.createdAt, label: `settlement ${R(P(s.amount))} ${nm(s.fromUid)}->${nm(s.toUid)} [${status}]`, delta: 0, kind: "s" }); continue; }
  // A paying B moves the balance towards B owing A.
  rows.push({ ts: s.createdAt, label: `settlement ${R(P(s.amount))} ${nm(s.fromUid)}->${nm(s.toUid)} [approved]`, delta: s.fromUid === A ? s.amount : -s.amount, kind: "s" });
}
rows.sort((a, b) => (a.ts || 0) - (b.ts || 0));

console.log(`Group: ${group.name}`);
console.log(`A = ${nm(A)}   B = ${nm(B)}   (positive balance = B owes A)\n`);
console.log(`${"date".padEnd(12)}${"event".padEnd(52)}${"delta".padStart(10)}${"paise".padStart(12)}${"stmt".padStart(12)}`);
console.log("-".repeat(98));

let paise = 0;
let appRaw = 0;
let stmt = 0;
for (const r of rows) {
  paise += P(r.delta);
  appRaw += r.delta;
  stmt = round2(stmt + round2(r.delta));
  console.log(
    `${new Date(r.ts).toISOString().slice(0, 10).padEnd(12)}${r.label.padEnd(52).slice(0, 52)}` +
      `${r.delta.toFixed(2).padStart(10)}${R(paise).padStart(12)}${stmt.toFixed(2).padStart(12)}`
  );
}

console.log("-".repeat(98));
console.log(`\nexact (integer paise)          : ${R(paise)}`);
console.log(`app  computePairwiseLedger     : ${round2(appRaw).toFixed(2)}   (raw float ${appRaw})`);
console.log(`app  buildPairStatement        : ${stmt.toFixed(2)}`);
console.log(
  paise === P(round2(appRaw)) && paise === P(stmt)
    ? "\nAll three agree."
    : "\nMISMATCH between the screens above."
);
console.log(
  `\nDirection: ${paise > 0 ? `${nm(B)} owes ${nm(A)} ${R(paise)}` : paise < 0 ? `${nm(A)} owes ${nm(B)} ${R(-paise)}` : "settled"}`
);
