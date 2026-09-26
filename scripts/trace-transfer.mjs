/**
 * Read-only forensic trace of one direct transfer.
 *
 * Usage:  node scripts/trace-transfer.mjs --amount=130
 *         node scripts/trace-transfer.mjs --id=<transferId>
 *
 * Answers the question the audit script can only flag: *why* was a leg capped
 * where it was? It reconstructs, for every group the pair shares, what the
 * sender owed the receiver immediately before the booking timestamp — which is
 * the number `IncludeTransferSheet` caps each leg at. If that reconstructed
 * figure disagrees with the leg that was actually written, the cap was computed
 * from data that had not finished loading.
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
const R = (p) => p / 100;
const inr = (p) =>
  `${p < 0 ? "-" : ""}\u20b9${Math.abs(R(p)).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
const when = (ts) => (ts ? new Date(ts).toISOString().replace("T", " ").slice(0, 19) : "?");

const isActive = (e) => e.editAction !== "deleted";
const isApproved = (s) => (s.status || "approved") === "approved";

console.log(`Project: ${projectId}\n`);

const users = new Map();
for await (const d of db.collection("users").stream()) users.set(d.id, d.data());
const nameOf = (uid) => users.get(uid)?.displayName || `(${String(uid).slice(0, 6)})`;

const groups = new Map();
for await (const d of db.collection("groups").stream()) groups.set(d.id, { id: d.id, ...d.data() });

const transfers = [];
for await (const d of db.collection("transfers").stream()) transfers.push({ id: d.id, ...d.data() });

const wantId = argOf("id");
const wantAmount = argOf("amount") ? P(argOf("amount")) : null;
const matches = transfers.filter(
  (t) => (wantId ? t.id === wantId : true) && (wantAmount !== null ? P(t.amount) === wantAmount : true)
);

if (matches.length === 0) {
  console.error("No transfer matched. Known transfers:");
  for (const t of transfers) {
    console.error(`  ${t.id}  ${inr(P(t.amount))}  ${nameOf(t.fromUid)} -> ${nameOf(t.toUid)}  ${t.status}`);
  }
  process.exit(1);
}

// Per-group ledgers, loaded once.
const expensesByGroup = new Map();
for await (const d of db.collectionGroup("expenses").stream()) {
  const gid = d.ref.parent.parent?.id || d.get("groupId") || "";
  if (!expensesByGroup.has(gid)) expensesByGroup.set(gid, []);
  expensesByGroup.get(gid).push({ id: d.id, ...d.data() });
}
const settlementsByGroup = new Map();
for await (const d of db.collectionGroup("settlements").stream()) {
  const gid = d.ref.parent.parent?.id || d.get("groupId") || "";
  if (!settlementsByGroup.has(gid)) settlementsByGroup.set(gid, []);
  settlementsByGroup.get(gid).push({ id: d.id, ...d.data() });
}

/**
 * Net paise `a` owes `b` in one group, counting only rows that existed at
 * `asOf`. Pairwise: never routed through a third person, which is the figure
 * the allocation sheet uses.
 */
function pairNetAsOf(gid, a, b, asOf, skipSettlementIds = new Set()) {
  let net = 0;
  for (const e of expensesByGroup.get(gid) || []) {
    if (!isActive(e)) continue;
    if (asOf !== null && (e.createdAt || 0) > asOf) continue;
    for (const s of e.splits || []) {
      if (s.uid === e.paidBy) continue;
      if (s.uid === a && e.paidBy === b) net += P(s.amount);
      if (s.uid === b && e.paidBy === a) net -= P(s.amount);
    }
  }
  for (const s of settlementsByGroup.get(gid) || []) {
    if (!isApproved(s)) continue;
    if (skipSettlementIds.has(s.id)) continue;
    if (asOf !== null && (s.createdAt || 0) > asOf) continue;
    if (s.fromUid === a && s.toUid === b) net -= P(s.amount);
    if (s.fromUid === b && s.toUid === a) net += P(s.amount);
  }
  return net;
}

const legsOf = (t) => {
  const entries = Object.entries(t.allocations || {});
  if (entries.length > 0) {
    return entries.map(([settlementId, x]) => ({
      settlementId,
      groupId: x?.groupId || "",
      amount: Number(x?.amount) || 0,
    }));
  }
  if (t.appliedGroupId && t.appliedSettlementId) {
    return [{ settlementId: t.appliedSettlementId, groupId: t.appliedGroupId, amount: t.amount }];
  }
  return [];
};

for (const t of matches) {
  const from = t.fromUid;
  const to = t.toUid;
  console.log("=".repeat(74));
  console.log(`TRANSFER ${t.id}`);
  console.log("=".repeat(74));
  console.log(`  ${inr(P(t.amount))}  ${nameOf(from)} -> ${nameOf(to)}`);
  console.log(`  status          ${t.status}`);
  console.log(`  created         ${when(t.createdAt)}`);
  console.log(`  updated         ${when(t.updatedAt)}`);
  console.log(`  note            ${t.note || "(none)"}`);
  console.log(`  allocatedAmount ${t.allocatedAmount === undefined ? "(absent)" : inr(P(t.allocatedAmount))}`);
  console.log(`  appliedGroupId  ${t.appliedGroupId || "(absent)"}`);

  const legs = legsOf(t);
  const legTotal = legs.reduce((s, l) => s + P(l.amount), 0);
  const unalloc = P(t.amount) - legTotal;
  const legIds = new Set(legs.map((l) => l.settlementId));
  const bookedAt = t.updatedAt || t.createdAt;

  console.log(`\n  BOOKED LEGS (${legs.length})`);
  if (legs.length === 0) console.log("    (none)");
  for (const leg of legs) {
    const g = groups.get(leg.groupId);
    // What the sender owed here just before the booking, excluding the legs
    // this very booking created.
    const owedBefore = pairNetAsOf(leg.groupId, from, to, bookedAt, legIds);
    const owedNow = pairNetAsOf(leg.groupId, from, to, null, new Set());
    console.log(`    group   ${g?.name || `(deleted ${leg.groupId.slice(0, 8)})`}`);
    console.log(`      booked          ${inr(P(leg.amount))}`);
    console.log(`      owed just before ${inr(owedBefore)}   <- the cap the sheet applied`);
    console.log(`      owed now         ${inr(owedNow)}`);
    if (owedBefore > P(leg.amount)) {
      console.log(
        `      ** UNDER-BOOKED by ${inr(owedBefore - P(leg.amount))}: there was more debt here than the sheet offered **`
      );
    }
  }

  console.log(`\n  UNASSIGNED REMAINDER  ${inr(unalloc)}`);

  // Every group the pair shares, and what is owed there right now. This is the
  // set the sheet would offer today.
  console.log(`\n  ALL SHARED GROUPS (what ${nameOf(from)} owes ${nameOf(to)})`);
  const shared = [...groups.values()].filter(
    (g) => (g.memberIds || []).includes(from) && (g.memberIds || []).includes(to)
  );
  let totalOwedNow = 0;
  for (const g of shared) {
    const nowNet = pairNetAsOf(g.id, from, to, null, new Set());
    const beforeNet = pairNetAsOf(g.id, from, to, bookedAt, legIds);
    totalOwedNow += Math.max(0, nowNet);
    const booked = legs.find((l) => l.groupId === g.id);
    console.log(
      `    ${g.name.padEnd(24)} owes now ${inr(nowNet).padStart(12)}   owed at booking ${inr(beforeNet).padStart(12)}${
        booked ? "   <- took " + inr(P(booked.amount)) : ""
      }`
    );
  }
  // Groups that are gone but still hold ledger rows for this pair.
  const orphanGids = new Set([...expensesByGroup.keys(), ...settlementsByGroup.keys()].filter((g) => !groups.has(g)));
  for (const gid of orphanGids) {
    const nowNet = pairNetAsOf(gid, from, to, null, new Set());
    if (nowNet !== 0) {
      console.log(
        `    ${`(deleted ${gid.slice(0, 8)})`.padEnd(24)} owes now ${inr(nowNet).padStart(12)}   <- UNREACHABLE: group doc deleted`
      );
    }
  }
  console.log(`\n    Total still owed to ${nameOf(to)} across live groups: ${inr(totalOwedNow)}`);
  console.log(
    `    Remainder of this transfer that could be booked today: ${inr(Math.min(unalloc, totalOwedNow))}\n`
  );
}
