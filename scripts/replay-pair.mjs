/**
 * Read-only: replay one pair's balance in one group, event by event, in the
 * order the documents were actually written.
 *
 * This is the only reconstruction that can be trusted for "what did the app
 * offer me at the moment I tapped the button", because it shows the running
 * pairwise net immediately before and after every single row — including the
 * transfer legs, which are what the allocation sheet both reads and writes.
 *
 * Usage: node scripts/replay-pair.mjs --group=<id> --a=<senderUid> --b=<receiverUid>
 * Sign convention: POSITIVE = `a` owes `b` (what the sheet calls `theyOweMe`).
 */
import { db, projectId } from "./lib/admin.mjs";

const args = process.argv.slice(2);
const argOf = (n) => {
  const hit = args.find((x) => x.startsWith(`--${n}=`));
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

const users = new Map();
for await (const d of db.collection("users").stream()) users.set(d.id, d.data());
const short = (uid) => (users.get(uid)?.displayName || String(uid).slice(0, 6)).split(" ")[0];

const gSnap = await db.collection("groups").doc(groupId).get();
const expenses = [];
for await (const d of db.collection("groups").doc(groupId).collection("expenses").stream()) {
  expenses.push({ id: d.id, ...d.data() });
}
const settlements = [];
for await (const d of db.collection("groups").doc(groupId).collection("settlements").stream()) {
  settlements.push({ id: d.id, ...d.data() });
}

const events = [];
for (const e of expenses) {
  if (e.editAction === "deleted") continue;
  const aS = (e.splits || []).find((s) => s.uid === uidA);
  const bS = (e.splits || []).find((s) => s.uid === uidB);
  let delta = 0;
  if (e.paidBy === uidB && aS) delta += P(aS.amount); // a owes b more
  if (e.paidBy === uidA && bS) delta -= P(bS.amount); // b owes a more
  if (delta === 0) continue;
  events.push({
    ts: e.createdAt || 0,
    delta,
    label: `expense  ${inr(P(e.amount)).padStart(11)} paid by ${short(e.paidBy).padEnd(8)} ${String(
      e.description || ""
    ).slice(0, 26)}`,
    kind: "expense",
  });
}
for (const s of settlements) {
  if ((s.status || "approved") !== "approved") continue;
  let delta = 0;
  if (s.fromUid === uidA && s.toUid === uidB) delta -= P(s.amount);
  else if (s.fromUid === uidB && s.toUid === uidA) delta += P(s.amount);
  else continue;
  events.push({
    ts: s.createdAt || 0,
    delta,
    label: `${(s.kind || "payment") === "transfer" ? "LEG     " : "payment "} ${inr(
      P(s.amount)
    ).padStart(11)} ${short(s.fromUid)} -> ${short(s.toUid)}  ${String(s.note || "").slice(0, 26)}`,
    kind: s.kind || "payment",
    id: s.id,
  });
}

events.sort((x, y) => x.ts - y.ts);

console.log(`Project: ${projectId}`);
console.log(`Group:   ${gSnap.get("name")}`);
console.log(`Replaying what ${short(uidA)} owes ${short(uidB)} (positive = ${short(uidA)} owes ${short(uidB)})\n`);
console.log(`${"when".padEnd(20)} ${"event".padEnd(62)} ${"delta".padStart(11)} ${"running".padStart(12)}`);
console.log("-".repeat(110));

let running = 0;
for (const ev of events) {
  const before = running;
  running += ev.delta;
  const isLeg = ev.kind === "transfer";
  console.log(
    `${when(ev.ts).padEnd(20)} ${ev.label.padEnd(62)} ${inr(ev.delta).padStart(11)} ${inr(running).padStart(12)}` +
      (isLeg
        ? `   <- sheet offered ${inr(Math.max(0, before))} here${
            before <= 0 ? "  ** OFFERED NOTHING, YET A LEG WAS WRITTEN **" : ""
          }`
        : "")
  );
}

console.log("-".repeat(110));
console.log(`Final: ${short(uidA)} owes ${short(uidB)} ${inr(running)}`);
