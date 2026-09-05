/**
 * Read-only line-by-line dump of one group's ledger, in integer paise.
 *
 * Usage: node scripts/inspect-group.mjs "<group name or id>"
 */
import { db } from "./lib/admin.mjs";

const needle = (process.argv[2] || "").toLowerCase();
if (!needle) {
  console.error('Usage: node scripts/inspect-group.mjs "<group name or id>"');
  process.exit(1);
}

const P = (r) => {
  const n = Number(r);
  if (!Number.isFinite(n)) return 0;
  const s = Number((n * 100).toPrecision(15));
  return s < 0 ? -Math.round(-s) : Math.round(s);
};
const R = (p) => (p / 100).toFixed(2);

const users = new Map();
for await (const d of db.collection("users").stream()) users.set(d.id, d.data());

const groups = [];
for await (const d of db.collection("groups").stream()) groups.push({ id: d.id, ...d.data() });

const group = groups.find(
  (g) => g.id.toLowerCase() === needle || (g.name || "").toLowerCase().includes(needle)
);
if (!group) {
  console.error(`No group matched "${needle}". Available:`);
  for (const g of groups) console.error(`  ${g.id}  ${g.name}`);
  process.exit(1);
}

const name = (uid) =>
  group.members?.[uid]?.displayName || users.get(uid)?.displayName || `(${uid.slice(0, 6)})`;

console.log(`Group: ${group.name}  (${group.id})`);
console.log(`useSimplifiedDebts: ${group.useSimplifiedDebts}   legacy settlementMode: ${group.settlementMode}`);
console.log(`memberIds order: ${group.memberIds.map((u) => name(u)).join(", ")}\n`);

const expenses = [];
for await (const d of db.collection("groups").doc(group.id).collection("expenses").stream()) {
  expenses.push({ id: d.id, ...d.data() });
}
expenses.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

const settlements = [];
for await (const d of db.collection("groups").doc(group.id).collection("settlements").stream()) {
  settlements.push({ id: d.id, ...d.data() });
}
settlements.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

const net = new Map();
const owes = new Map();
const bump = (m, k, v) => m.set(k, (m.get(k) || 0) + v);

console.log("EXPENSES");
console.log("-".repeat(100));
let remainderLoad = new Map();
for (const e of expenses) {
  const active = e.editAction !== "deleted";
  const amountP = P(e.amount);
  const splits = Array.isArray(e.splits) ? e.splits : [];
  const sumP = splits.reduce((t, s) => t + P(s.amount), 0);
  const tag = active ? "" : "  [DELETED]";
  const mismatch = sumP !== amountP ? `  <<< SPLITS SUM ${R(sumP)} != AMOUNT ${R(amountP)}` : "";
  console.log(
    `${new Date(e.createdAt).toISOString().slice(0, 10)}  ${(e.description || "").padEnd(26).slice(0, 26)} ` +
      `${R(amountP).padStart(9)}  paid by ${name(e.paidBy).padEnd(20)} ${e.splitType || "?"}${tag}${mismatch}`
  );
  const even = splits.length ? Math.floor(amountP / splits.length) : 0;
  for (const s of splits) {
    const p = P(s.amount);
    const extra = p - even;
    if (active && extra !== 0) bump(remainderLoad, s.uid, extra);
    console.log(
      `        ${name(s.uid).padEnd(24)} ${R(p).padStart(9)}` +
        (extra !== 0 ? `   (${extra > 0 ? "+" : ""}${extra}p vs even share ${R(even)})` : "")
    );
  }
  if (!active) continue;
  bump(net, e.paidBy, amountP);
  for (const s of splits) {
    bump(net, s.uid, -P(s.amount));
    if (s.uid !== e.paidBy) bump(owes, `${s.uid}|${e.paidBy}`, P(s.amount));
  }
}

console.log("\nSETTLEMENTS");
console.log("-".repeat(100));
for (const s of settlements) {
  const status = s.status || "approved(default)";
  const p = P(s.amount);
  console.log(
    `${new Date(s.createdAt).toISOString().slice(0, 10)}  ${R(p).padStart(9)}  ` +
      `${name(s.fromUid)} -> ${name(s.toUid)}   status=${status} kind=${s.kind || "payment"}  ${s.note || ""}`
  );
  if ((s.status || "approved") !== "approved") continue;
  bump(net, s.fromUid, p);
  bump(net, s.toUid, -p);
  bump(owes, `${s.fromUid}|${s.toUid}`, -p);
}

console.log("\nNET PER MEMBER (positive = is owed)");
console.log("-".repeat(100));
for (const [uid, v] of [...net.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${name(uid).padEnd(24)} ${R(v).padStart(10)}`);
}
console.log(`  ${"SUM".padEnd(24)} ${R([...net.values()].reduce((a, b) => a + b, 0)).padStart(10)}`);

console.log("\nPAIRWISE OUTSTANDING");
console.log("-".repeat(100));
const uids = [...new Set([...group.memberIds, ...net.keys()])];
const seen = new Set();
for (const a of uids) {
  for (const b of uids) {
    if (a === b) continue;
    const k = [a, b].sort().join("\u0000");
    if (seen.has(k)) continue;
    seen.add(k);
    const v = (owes.get(`${a}|${b}`) || 0) - (owes.get(`${b}|${a}`) || 0);
    if (v === 0) continue;
    const [from, to, amt] = v > 0 ? [a, b, v] : [b, a, -v];
    console.log(`  ${name(from)} owes ${name(to)}: ${R(amt)}`);
  }
}

console.log("\nROUNDING REMAINDER ABSORBED (paise above/below an even share)");
console.log("-".repeat(100));
for (const [uid, v] of [...remainderLoad.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${name(uid).padEnd(24)} ${v > 0 ? "+" : ""}${v}p  (= ${R(v)})`);
}
