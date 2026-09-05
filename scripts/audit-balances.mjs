/**
 * Read-only forensic audit of every group ledger.
 *
 * Usage:  node scripts/audit-balances.mjs [--uid=<uid>] [--find=<amount>]
 *
 * Why this exists: the app reports a balance that cannot be settled away. The
 * app computes a member's net as
 *
 *     net = SUM(expense.amount where they paid) - SUM(their split amounts)
 *
 * but the "who pays whom" list the settle-up sheet is built from only ever
 * looks at `split.amount`. Those two agree only while every expense satisfies
 * SUM(splits) == amount. When it doesn't, the payer keeps a residual that no
 * settlement can clear, because no counterparty is carrying the other side of
 * it.
 *
 * This script recomputes both, in integer paise, and reports every place the
 * stored data breaks an invariant the app silently depends on.
 */
import { db, projectId, usingServiceAccount } from "./lib/admin.mjs";

const args = process.argv.slice(2);
const argOf = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const onlyUid = argOf("uid");
const findAmount = argOf("find") ? Number(argOf("find")) : null;

// ── money ────────────────────────────────────────────────────
// Rupee floats in, integer paise out. toPrecision(15) collapses binary
// artefacts (1.15 * 100 === 114.99999999999999) before rounding.
const P = (rupees) => {
  const n = Number(rupees);
  if (!Number.isFinite(n)) return 0;
  const scaled = Number((n * 100).toPrecision(15));
  return scaled < 0 ? -Math.round(-scaled) : Math.round(scaled);
};
const R = (paise) => paise / 100;
const inr = (paise) =>
  `${paise < 0 ? "-" : ""}\u20b9${Math.abs(R(paise)).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const isActive = (e) => e.editAction !== "deleted";
const isApproved = (s) => (s.status || "approved") === "approved";

// ── load ─────────────────────────────────────────────────────
console.log(`Project: ${projectId}`);
console.log(`Auth:    ${usingServiceAccount ? "service account (.env.local)" : "application default credentials"}`);
console.log("Reading Firestore (read-only)...\n");

const users = new Map();
for await (const d of db.collection("users").stream()) users.set(d.id, d.data());

const groups = new Map();
for await (const d of db.collection("groups").stream()) groups.set(d.id, { id: d.id, ...d.data() });

const gidOf = (doc) => doc.ref.parent.parent?.id || doc.get("groupId") || "";

const expensesByGroup = new Map();
for await (const d of db.collectionGroup("expenses").stream()) {
  const gid = gidOf(d);
  const x = d.data();
  if (!expensesByGroup.has(gid)) expensesByGroup.set(gid, []);
  expensesByGroup.get(gid).push({
    id: d.id,
    description: x.description ?? "",
    amount: Number(x.amount) || 0,
    paidBy: x.paidBy || "",
    splitType: x.splitType || "",
    splits: Array.isArray(x.splits) ? x.splits : [],
    splitsMissing: !Array.isArray(x.splits),
    createdAt: x.createdAt,
    editAction: x.editAction || "",
  });
}

const settlementsByGroup = new Map();
for await (const d of db.collectionGroup("settlements").stream()) {
  const gid = gidOf(d);
  const x = d.data();
  if (!settlementsByGroup.has(gid)) settlementsByGroup.set(gid, []);
  settlementsByGroup.get(gid).push({
    id: d.id,
    fromUid: x.fromUid || "",
    toUid: x.toUid || "",
    amount: Number(x.amount) || 0,
    status: x.status || "approved",
    statusMissing: !x.status,
    kind: x.kind || "payment",
    createdAt: x.createdAt,
    note: x.note || "",
  });
}

const transfers = [];
for await (const d of db.collection("transfers").stream()) transfers.push({ id: d.id, ...d.data() });

// ── report ───────────────────────────────────────────────────
const findings = [];
const flag = (severity, groupName, message) => findings.push({ severity, groupName, message });

const allGids = new Set([
  ...groups.keys(),
  ...expensesByGroup.keys(),
  ...settlementsByGroup.keys(),
]);

const nameOf = (group, uid) =>
  (uid && (group?.members?.[uid]?.displayName || users.get(uid)?.displayName)) ||
  (uid ? `(unknown ${uid.slice(0, 6)})` : "(none)");

let grandPhantom = 0;

for (const gid of [...allGids].sort()) {
  const group = groups.get(gid);
  const gname = group?.name || `(deleted group ${gid.slice(0, 8)})`;
  const expenses = (expensesByGroup.get(gid) || []).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const settlements = (settlementsByGroup.get(gid) || []).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const memberIds = group?.memberIds || [];

  if (!group) flag("WARN", gname, `subcollections exist but the group document is gone (${expenses.length} expenses, ${settlements.length} settlements orphaned)`);

  // Everyone who appears anywhere in this ledger.
  const participants = new Set(memberIds);
  for (const e of expenses) {
    if (e.paidBy) participants.add(e.paidBy);
    for (const s of e.splits) if (s.uid) participants.add(s.uid);
  }
  for (const s of settlements) {
    if (s.fromUid) participants.add(s.fromUid);
    if (s.toUid) participants.add(s.toUid);
  }

  // netApp   — exactly what src/lib/balance.ts computeBalances does today.
  // netSplit — payer credited only what was actually allocated to people.
  const netApp = new Map();
  const netSplit = new Map();
  const owes = new Map(); // "a|b" -> paise a owes b
  const bump = (m, k, v) => m.set(k, (m.get(k) || 0) + v);

  for (const e of expenses) {
    if (!isActive(e)) continue;
    const amountP = P(e.amount);
    const splitSumP = e.splits.reduce((t, s) => t + P(s.amount), 0);

    if (e.splitsMissing) {
      flag("CRITICAL", gname, `expense "${e.description}" (${e.id}) has NO splits array — ${nameOf(group, e.paidBy)} is credited ${inr(amountP)} that nobody is charged for`);
    } else if (e.splits.length === 0) {
      flag("CRITICAL", gname, `expense "${e.description}" (${e.id}) has an empty splits array — ${nameOf(group, e.paidBy)} is credited ${inr(amountP)} that nobody is charged for`);
    } else if (splitSumP !== amountP) {
      flag("CRITICAL", gname, `expense "${e.description}" (${e.id}): amount ${inr(amountP)} but splits total ${inr(splitSumP)} — unclearable gap of ${inr(amountP - splitSumP)} sits on ${nameOf(group, e.paidBy)}`);
    }

    for (const s of e.splits) {
      if (!memberIds.includes(s.uid)) {
        flag("WARN", gname, `expense "${e.description}" (${e.id}) charges ${nameOf(group, s.uid)}, who is not a current member`);
      }
    }
    if (e.paidBy && !memberIds.includes(e.paidBy)) {
      flag("WARN", gname, `expense "${e.description}" (${e.id}) was paid by ${nameOf(group, e.paidBy)}, who is not a current member`);
    }

    bump(netApp, e.paidBy, amountP);
    bump(netSplit, e.paidBy, splitSumP);
    for (const s of e.splits) {
      bump(netApp, s.uid, -P(s.amount));
      bump(netSplit, s.uid, -P(s.amount));
      if (s.uid !== e.paidBy) bump(owes, `${s.uid}|${e.paidBy}`, P(s.amount));
    }
  }

  for (const s of settlements) {
    if (s.statusMissing) flag("INFO", gname, `settlement ${s.id} has no status field (treated as approved)`);
    if (s.status === "pending") {
      flag("ATTENTION", gname, `settlement of ${inr(P(s.amount))} from ${nameOf(group, s.fromUid)} to ${nameOf(group, s.toUid)} is still PENDING — it does not reduce any balance until approved`);
    }
    if (!isApproved(s)) continue;
    bump(netApp, s.fromUid, P(s.amount));
    bump(netApp, s.toUid, -P(s.amount));
    bump(netSplit, s.fromUid, P(s.amount));
    bump(netSplit, s.toUid, -P(s.amount));
    bump(owes, `${s.fromUid}|${s.toUid}`, -P(s.amount));
  }

  // Invariant 1: a closed ledger nets to zero.
  const sumApp = [...netApp.values()].reduce((a, b) => a + b, 0);
  const sumSplit = [...netSplit.values()].reduce((a, b) => a + b, 0);
  if (sumApp !== 0) {
    grandPhantom += Math.abs(sumApp);
    flag("CRITICAL", gname, `group balances do not net to zero: they sum to ${inr(sumApp)}. This is money the app believes exists but assigns to nobody.`);
  }
  if (sumSplit !== 0) {
    flag("CRITICAL", gname, `even split-based balances do not net to zero (${inr(sumSplit)}) — settlements reference people outside the ledger`);
  }

  // Invariant 2: a member's net equals the sum of their pairwise positions.
  const pairNet = new Map();
  for (const a of participants) {
    let total = 0;
    for (const b of participants) {
      if (a === b) continue;
      total += (owes.get(`${b}|${a}`) || 0) - (owes.get(`${a}|${b}`) || 0);
    }
    pairNet.set(a, total);
  }

  // Invariant 3: every non-zero pair debt must be reachable by the settle-up UI,
  // which only iterates over CURRENT memberIds.
  const seen = new Set();
  for (const a of participants) {
    for (const b of participants) {
      if (a === b) continue;
      const key = [a, b].sort().join("\u0000");
      if (seen.has(key)) continue;
      seen.add(key);
      const net = (owes.get(`${a}|${b}`) || 0) - (owes.get(`${b}|${a}`) || 0);
      if (net === 0) continue;
      const reachable = memberIds.includes(a) && memberIds.includes(b);
      if (!reachable) {
        // `computeDirectDebts` now derives its participant set from the ledger
        // rather than from `memberIds`, so these debts do get a settle-up row.
        // They are still worth reporting: an orphaned group can't be opened at
        // all, so its balances are unreachable for a different reason.
        const severity = group ? "WARN" : "ATTENTION";
        const why = group
          ? `${nameOf(group, a)} or ${nameOf(group, b)} has left the group, so this only appears while they still carry a balance`
          : `the group document is deleted, so nobody can open this group and clear it — the subcollections are orphaned`;
        flag(severity, gname, `${inr(Math.abs(net))} still outstanding between ${nameOf(group, a)} and ${nameOf(group, b)}: ${why}`);
      }
    }
  }

  for (const uid of participants) {
    if (onlyUid && uid !== onlyUid) continue;
    const app = netApp.get(uid) || 0;
    const split = netSplit.get(uid) || 0;
    const pair = pairNet.get(uid) || 0;
    if (app !== pair) {
      flag("CRITICAL", gname, `${nameOf(group, uid)}: balance screen shows ${inr(app)} but the sum of their settle-up rows is ${inr(pair)} — a phantom ${inr(app - pair)} that cannot be paid off`);
    }
    if (split !== pair) {
      flag("CRITICAL", gname, `${nameOf(group, uid)}: split-based net ${inr(split)} still disagrees with pairwise ${inr(pair)}`);
    }
  }

  if (findAmount !== null) {
    const target = P(findAmount);
    for (const [uid, v] of netApp) {
      if (Math.abs(Math.abs(v) - target) <= 1) {
        flag("MATCH", gname, `${nameOf(group, uid)} nets ${inr(v)} here (matches the reported ${inr(target)})`);
      }
    }
  }
}

// ── transfers ────────────────────────────────────────────────
for (const t of transfers) {
  if (t.status === "pending") {
    flag("ATTENTION", "(direct transfers)", `${inr(P(t.amount))} from ${nameOf(null, t.fromUid)} to ${nameOf(null, t.toUid)} is still pending confirmation`);
  }
  if (t.status === "accepted" && !t.appliedGroupId) {
    flag("ATTENTION", "(direct transfers)", `${inr(P(t.amount))} from ${nameOf(null, t.fromUid)} to ${nameOf(null, t.toUid)} was confirmed but never booked into a group, so it still hasn't reduced any group balance`);
  }
}

// ── print ────────────────────────────────────────────────────
const order = ["CRITICAL", "MATCH", "ATTENTION", "WARN", "INFO"];
console.log(`Scanned ${allGids.size} group(s), ${[...expensesByGroup.values()].flat().length} expense(s), ${[...settlementsByGroup.values()].flat().length} settlement(s), ${transfers.length} transfer(s).\n`);

if (findings.length === 0) {
  console.log("No invariant violations found. Every group nets to zero and every balance is reachable from a settle-up row.");
} else {
  for (const sev of order) {
    const rows = findings.filter((f) => f.severity === sev);
    if (rows.length === 0) continue;
    console.log(`\n${"=".repeat(70)}\n${sev}  (${rows.length})\n${"=".repeat(70)}`);
    const byGroup = new Map();
    for (const r of rows) {
      if (!byGroup.has(r.groupName)) byGroup.set(r.groupName, []);
      byGroup.get(r.groupName).push(r.message);
    }
    for (const [g, msgs] of byGroup) {
      console.log(`\n  [${g}]`);
      for (const m of msgs) console.log(`    - ${m}`);
    }
  }
}

if (grandPhantom > 0) {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`TOTAL PHANTOM MONEY ACROSS ALL GROUPS: ${inr(grandPhantom)}`);
  console.log(`${"=".repeat(70)}`);
}
