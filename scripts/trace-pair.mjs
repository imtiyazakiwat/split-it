/**
 * Read-only trace of one pair's ledger inside one group, computed three ways:
 *
 *   paise    — exact integer arithmetic. This is what the app now does
 *              everywhere (computePairwiseLedger and buildPairStatement both
 *              accumulate in paise), so it is both ground truth and the current
 *              application result.
 *   float    — the pre-fix behaviour: raw rupee floats accumulated and rounded
 *              once at the end. Kept because it makes the drift that used to
 *              exist visible on real data.
 *   step     — the pre-fix statement behaviour: round-to-paise applied at every
 *              single step, which is how the statement sheet could disagree with
 *              the balance chip for the same pair.
 *
 * A gap between `paise` and either legacy column is the drift the fix removed.
 *
 * Usage: node scripts/trace-pair.mjs "<group>" "<name A>" "<name B>"
 */
import { db } from "./lib/admin.mjs";
import { selectGroup, selectPerson } from "./lib/select.mjs";

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

const group = selectGroup(groups, needle);

const nm = (uid) => group.members?.[uid]?.displayName || users.get(uid)?.displayName || uid.slice(0, 6);

// Load the ledger before resolving names. An outstanding balance can involve
// someone who has left the group, so they are absent from `memberIds` while
// still appearing on expenses and settlements — and that is exactly the pair
// worth tracing.
const expenses = [];
for await (const d of db.collection("groups").doc(group.id).collection("expenses").stream()) expenses.push({ id: d.id, ...d.data() });
const settlements = [];
for await (const d of db.collection("groups").doc(group.id).collection("settlements").stream()) settlements.push({ id: d.id, ...d.data() });

const participants = new Set(group.memberIds || []);
for (const e of expenses) {
  if (e.editAction === "deleted") continue;
  if (e.paidBy) participants.add(e.paidBy);
  for (const s of Array.isArray(e.splits) ? e.splits : []) if (s?.uid) participants.add(s.uid);
}
for (const s of settlements) {
  if ((s.status || "approved") !== "approved") continue;
  if (s.fromUid) participants.add(s.fromUid);
  if (s.toUid) participants.add(s.toUid);
}

const candidates = [...participants];
const A = selectPerson(candidates, nm, nameA, "person A");
const B = selectPerson(candidates, nm, nameB, "person B");
if (A === B) {
  console.error("Person A and person B resolved to the same person.");
  process.exit(1);
}

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
console.log(`${"date".padEnd(12)}${"event".padEnd(52)}${"delta".padStart(10)}${"paise".padStart(12)}${"step".padStart(12)}`);
console.log("-".repeat(98));

let paise = 0;
let floatRaw = 0;
let step = 0;
for (const r of rows) {
  paise += P(r.delta);
  floatRaw += r.delta;
  step = round2(step + round2(r.delta));
  console.log(
    `${new Date(r.ts).toISOString().slice(0, 10).padEnd(12)}${r.label.padEnd(52).slice(0, 52)}` +
      `${r.delta.toFixed(2).padStart(10)}${R(paise).padStart(12)}${step.toFixed(2).padStart(12)}`
  );
}

console.log("-".repeat(98));
console.log(`\npaise  — exact, and what the app computes now : ${R(paise)}`);
console.log(`float  — legacy float accumulation            : ${round2(floatRaw).toFixed(2)}   (raw ${floatRaw})`);
console.log(`step   — legacy round-at-every-step statement : ${step.toFixed(2)}`);

const floatDrift = P(round2(floatRaw)) - paise;
const stepDrift = P(step) - paise;
if (floatDrift === 0 && stepDrift === 0) {
  console.log("\nNo drift: the legacy models happen to agree with exact arithmetic for this pair.");
} else {
  console.log("\nDrift the paise rewrite removed for this pair:");
  if (floatDrift !== 0) console.log(`  float accumulation was off by ${R(floatDrift)}`);
  if (stepDrift !== 0) console.log(`  round-every-step was off by ${R(stepDrift)}`);
}
console.log(
  `\nDirection: ${paise > 0 ? `${nm(B)} owes ${nm(A)} ${R(paise)}` : paise < 0 ? `${nm(A)} owes ${nm(B)} ${R(-paise)}` : "settled"}`
);
