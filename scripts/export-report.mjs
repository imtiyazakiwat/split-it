/**
 * Exports every split, settlement and balance across all groups to CSV.
 *
 * Usage:  node scripts/export-report.mjs [outDir]
 * Default outDir: ./reports
 *
 * Credentials: read from .env.local (FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY),
 * falling back to Application Default Credentials.
 *
 * Notes on data semantics (mirrors src/lib/firestore.ts + src/lib/balance.ts):
 *  - Expenses are soft-deleted: editAction === "deleted" means removed in the UI.
 *    Those rows are exported but flagged and excluded from every total.
 *  - Legacy settlements written before the approval flow have no `status` field.
 *    The app treats those as "approved", so we default the same way.
 *  - splits[] already holds final rupee amounts, even for equal/percentage.
 *  - All createdAt/updatedAt are epoch milliseconds.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// ── env loading ──────────────────────────────────────────────
function loadEnv(file) {
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return;
  }
  raw = raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  // Supports KEY=bare, KEY="quoted", KEY='quoted' and quoted values that span
  // multiple lines (how a PEM private key is usually pasted into .env.local).
  const re = /^[ \t]*(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)[ \t]*=[ \t]*("(?:[^"\\]|\\[\s\S])*"|'(?:[^'\\]|\\[\s\S])*'|[^\n]*)/gm;
  let m;
  while ((m = re.exec(raw)) !== null) {
    const key = m[1];
    let val = m[2];
    if (val.startsWith('"') && val.endsWith('"') && val.length > 1) {
      val = val.slice(1, -1);
    } else if (val.startsWith("'") && val.endsWith("'") && val.length > 1) {
      val = val.slice(1, -1);
    } else {
      val = val.trim().replace(/\s+#.*$/, "");
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadEnv(".env.local");

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY;

if (!projectId) {
  console.error("Missing NEXT_PUBLIC_FIREBASE_PROJECT_ID (checked .env.local and the environment).");
  process.exit(1);
}

initializeApp(
  clientEmail && privateKey
    ? { credential: cert({ projectId, clientEmail, privateKey: privateKey.replace(/\\n/g, "\n") }) }
    : { projectId }
);
const db = getFirestore();

// ── csv helpers ──────────────────────────────────────────────
const esc = (v) => {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const iso = (ms) => (typeof ms === "number" && isFinite(ms) ? new Date(ms).toISOString() : "");
const dateOnly = (ms) => (typeof ms === "number" && isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : "");

function writeCsv(outDir, name, columns, rows) {
  const lines = [columns.join(",")];
  for (const row of rows) lines.push(columns.map((c) => esc(row[c])).join(","));
  const path = join(outDir, name);
  writeFileSync(path, lines.join("\n") + "\n", "utf8");
  console.log(`  ${name.padEnd(26)} ${rows.length} rows`);
  return path;
}

// ── fetch ────────────────────────────────────────────────────
const outDir = process.argv[2] || "reports";
mkdirSync(outDir, { recursive: true });

console.log(`Project: ${projectId}`);
console.log(`Auth:    ${clientEmail && privateKey ? "service account from .env.local" : "application default credentials"}`);
console.log("Reading Firestore...");

const [usersSnap, groupsSnap, expenseSnap, settlementSnap] = await Promise.all([
  db.collection("users").get(),
  db.collection("groups").get(),
  db.collectionGroup("expenses").get(),
  db.collectionGroup("settlements").get(),
]);

const users = new Map();
usersSnap.docs.forEach((d) => users.set(d.id, d.data()));

const groups = new Map();
groupsSnap.docs.forEach((d) => groups.set(d.id, { id: d.id, ...d.data() }));

// collectionGroup catches expenses/settlements orphaned by a deleted group doc.
const groupIdOf = (doc) => doc.ref.parent.parent?.id || doc.get("groupId") || "";

const expensesByGroup = new Map();
for (const d of expenseSnap.docs) {
  const gid = groupIdOf(d);
  const data = d.data();
  const e = {
    id: d.id,
    groupId: gid,
    description: data.description ?? "",
    amount: Number(data.amount) || 0,
    paidBy: data.paidBy || "",
    splitType: data.splitType || "",
    splits: Array.isArray(data.splits) ? data.splits : [],
    receiptUrls: data.receiptUrls || [],
    createdBy: data.createdBy || "",
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    editAction: data.editAction || "",
    category: data.category || "",
  };
  if (!expensesByGroup.has(gid)) expensesByGroup.set(gid, []);
  expensesByGroup.get(gid).push(e);
}

const settlementsByGroup = new Map();
for (const d of settlementSnap.docs) {
  const gid = groupIdOf(d);
  const data = d.data();
  const s = {
    id: d.id,
    groupId: gid,
    fromUid: data.fromUid || "",
    toUid: data.toUid || "",
    amount: Number(data.amount) || 0,
    status: data.status || "approved", // legacy docs have no status; app treats them as approved
    statusWasMissing: !data.status,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt ?? data.createdAt,
    note: data.note || "",
    receiptUrls: data.receiptUrls || [],
    expenseIds: data.expenseIds || [],
    forwardedFromSettlementId: data.forwardedFromSettlementId || "",
  };
  if (!settlementsByGroup.has(gid)) settlementsByGroup.set(gid, []);
  settlementsByGroup.get(gid).push(s);
}

const allGroupIds = new Set([...groups.keys(), ...expensesByGroup.keys(), ...settlementsByGroup.keys()]);

// name resolution: group member map -> users doc -> raw uid
function nameOf(group, uid) {
  if (!uid) return "";
  return group?.members?.[uid]?.displayName || users.get(uid)?.displayName || `(unknown ${uid.slice(0, 6)})`;
}
function emailOf(group, uid) {
  return users.get(uid)?.email || group?.members?.[uid]?.email || "";
}

// ── build rows ───────────────────────────────────────────────
const splitRows = [];
const expenseRows = [];
const settlementRows = [];
const pairRows = [];
const memberRows = [];
const groupRows = [];

for (const gid of [...allGroupIds].sort()) {
  const group = groups.get(gid);
  const groupName = group?.name || `(deleted group ${gid.slice(0, 6)})`;
  const expenses = (expensesByGroup.get(gid) || []).sort(
    (a, b) => (a.createdAt || 0) - (b.createdAt || 0)
  );
  const settlements = (settlementsByGroup.get(gid) || []).sort(
    (a, b) => (a.createdAt || 0) - (b.createdAt || 0)
  );

  // every uid ever seen in this group, not just current members
  const uids = new Set(group?.memberIds || []);
  Object.keys(group?.members || {}).forEach((u) => uids.add(u));
  for (const e of expenses) {
    if (e.paidBy) uids.add(e.paidBy);
    e.splits.forEach((s) => s.uid && uids.add(s.uid));
  }
  for (const s of settlements) {
    if (s.fromUid) uids.add(s.fromUid);
    if (s.toUid) uids.add(s.toUid);
  }

  const paid = {};        // uid -> total they fronted (active expenses)
  const share = {};       // uid -> total of their splits
  const paidAll = {};     // same, but including soft-deleted expenses
  const shareAll = {};    // same, but including soft-deleted expenses
  const owesGross = {};   // owesGross[a][b] = a owes b from expenses
  const settledApproved = {}; // [a][b] = approved amount a paid b
  const settledPending = {};
  const settledRejected = {};
  const bump = (bag, a, b, amt) => {
    if (!bag[a]) bag[a] = {};
    bag[a][b] = round2((bag[a][b] || 0) + amt);
  };

  for (const e of expenses) {
    const deleted = e.editAction === "deleted";
    const splitSum = round2(e.splits.reduce((t, s) => t + (Number(s.amount) || 0), 0));
    const participants = e.splits.map((s) => nameOf(group, s.uid));

    paidAll[e.paidBy] = round2((paidAll[e.paidBy] || 0) + e.amount);
    if (!deleted) {
      paid[e.paidBy] = round2((paid[e.paidBy] || 0) + e.amount);
    }

    for (const s of e.splits) {
      const amt = round2(s.amount);
      const isPayer = s.uid === e.paidBy;
      shareAll[s.uid] = round2((shareAll[s.uid] || 0) + amt);
      if (!deleted) {
        share[s.uid] = round2((share[s.uid] || 0) + amt);
        if (!isPayer) bump(owesGross, s.uid, e.paidBy, amt);
      }
      splitRows.push({
        group_id: gid,
        group_name: groupName,
        expense_id: e.id,
        date: dateOnly(e.createdAt),
        created_at: iso(e.createdAt),
        description: e.description,
        category: e.category,
        split_type: e.splitType,
        expense_total: round2(e.amount),
        paid_by_uid: e.paidBy,
        paid_by_name: nameOf(group, e.paidBy),
        member_uid: s.uid,
        member_name: nameOf(group, s.uid),
        member_email: emailOf(group, s.uid),
        share_amount: amt,
        share_pct_of_expense: e.amount ? round2((amt / e.amount) * 100) : "",
        is_payer: isPayer ? "yes" : "no",
        owes_payer: isPayer ? 0 : amt,
        participant_count: e.splits.length,
        expense_status: e.editAction || "active",
        counted_in_totals: deleted ? "no" : "yes",
        splits_sum_matches_total: splitSum === round2(e.amount) ? "yes" : "no",
      });
    }

    expenseRows.push({
      group_id: gid,
      group_name: groupName,
      expense_id: e.id,
      date: dateOnly(e.createdAt),
      created_at: iso(e.createdAt),
      updated_at: iso(e.updatedAt),
      description: e.description,
      category: e.category,
      amount: round2(e.amount),
      split_type: e.splitType,
      paid_by_uid: e.paidBy,
      paid_by_name: nameOf(group, e.paidBy),
      participant_count: e.splits.length,
      participants: participants.join(" | "),
      split_breakdown: e.splits.map((s) => `${nameOf(group, s.uid)}:${round2(s.amount)}`).join(" | "),
      splits_sum: splitSum,
      splits_sum_matches_total: splitSum === round2(e.amount) ? "yes" : "no",
      expense_status: e.editAction || "active",
      counted_in_totals: e.editAction === "deleted" ? "no" : "yes",
      created_by_name: nameOf(group, e.createdBy),
      receipt_count: (e.receiptUrls || []).length,
    });
  }

  for (const s of settlements) {
    const bag =
      s.status === "approved" ? settledApproved : s.status === "pending" ? settledPending : settledRejected;
    bump(bag, s.fromUid, s.toUid, s.amount);

    settlementRows.push({
      group_id: gid,
      group_name: groupName,
      settlement_id: s.id,
      date: dateOnly(s.createdAt),
      created_at: iso(s.createdAt),
      updated_at: iso(s.updatedAt),
      from_uid: s.fromUid,
      from_name: nameOf(group, s.fromUid),
      to_uid: s.toUid,
      to_name: nameOf(group, s.toUid),
      amount: round2(s.amount),
      status: s.status,
      status_inferred_legacy: s.statusWasMissing ? "yes" : "no",
      counts_as_settled: s.status === "approved" ? "yes" : "no",
      note: s.note,
      tagged_expense_count: (s.expenseIds || []).length,
      tagged_expense_ids: (s.expenseIds || []).join(" | "),
      receipt_count: (s.receiptUrls || []).length,
      forwarded_from_settlement_id: s.forwardedFromSettlementId,
    });
  }

  // pairwise: one row per unordered pair that has any activity
  const uidList = [...uids].sort();
  const seen = new Set();
  for (const a of uidList) {
    for (const b of uidList) {
      if (a === b) continue;
      const key = [a, b].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      const [x, y] = key.split("|");
      const xy = owesGross[x]?.[y] || 0;
      const yx = owesGross[y]?.[x] || 0;
      const apXY = settledApproved[x]?.[y] || 0;
      const apYX = settledApproved[y]?.[x] || 0;
      const peXY = settledPending[x]?.[y] || 0;
      const peYX = settledPending[y]?.[x] || 0;
      if (!xy && !yx && !apXY && !apYX && !peXY && !peYX) continue;

      const netGross = round2(xy - yx);                       // >0 => x owes y
      const netOutstanding = round2(netGross - apXY + apYX);   // approved payments reduce it
      const settledTotal = round2(apXY + apYX);
      const grossExposure = round2(Math.abs(netGross));
      // net approved payment in the direction of the debt (positive = paid down)
      const settledNet = round2(netGross >= 0 ? apXY - apYX : apYX - apXY);

      pairRows.push({
        group_id: gid,
        group_name: groupName,
        person_a_uid: x,
        person_a_name: nameOf(group, x),
        person_b_uid: y,
        person_b_name: nameOf(group, y),
        a_owes_b_from_expenses: round2(xy),
        b_owes_a_from_expenses: round2(yx),
        net_before_settlement_direction:
          netGross > 0.01
            ? `${nameOf(group, x)} -> ${nameOf(group, y)}`
            : netGross < -0.01
            ? `${nameOf(group, y)} -> ${nameOf(group, x)}`
            : "even",
        net_before_settlement_amount: grossExposure,
        settled_a_to_b_approved: apXY,
        settled_b_to_a_approved: apYX,
        settled_total_approved: settledTotal,
        settled_a_to_b_pending: peXY,
        settled_b_to_a_pending: peYX,
        settled_net_toward_creditor: settledNet,
        settlement_progress_pct: grossExposure ? round2((settledNet / grossExposure) * 100) : "",
        outstanding_direction:
          netOutstanding > 0.01
            ? `${nameOf(group, x)} -> ${nameOf(group, y)}`
            : netOutstanding < -0.01
            ? `${nameOf(group, y)} -> ${nameOf(group, x)}`
            : "settled",
        outstanding_amount: round2(Math.abs(netOutstanding)),
        fully_settled: Math.abs(netOutstanding) <= 0.01 ? "yes" : "no",
      });
    }
  }

  // per-member rollup
  for (const uid of uidList) {
    const sumRow = (bag, dir) =>
      round2(
        Object.entries(bag).reduce((t, [a, inner]) => {
          if (dir === "out") return a === uid ? t + Object.values(inner).reduce((x, v) => x + v, 0) : t;
          return t + (a === uid ? 0 : inner[uid] || 0);
        }, 0)
      );
    const paidOut = sumRow(settledApproved, "out");
    const received = sumRow(settledApproved, "in");
    const pendingOut = sumRow(settledPending, "out");
    const pendingIn = sumRow(settledPending, "in");
    const totalPaid = round2(paid[uid] || 0);
    const totalShare = round2(share[uid] || 0);
    const netBefore = round2(totalPaid - totalShare);
    const net = round2(netBefore + paidOut - received);
    // Diagnostic only: what the net would be if soft-deleted expenses still
    // counted. The app does NOT do this - both callers of computeBalances filter
    // editAction first (groups/[id]/page.tsx:126, home/GroupRow.tsx:77) - so a
    // difference here just means the group has deleted expenses.
    const netInclDeleted = round2((paidAll[uid] || 0) - (shareAll[uid] || 0) + paidOut - received);

    memberRows.push({
      group_id: gid,
      group_name: groupName,
      member_uid: uid,
      member_name: nameOf(group, uid),
      member_email: emailOf(group, uid),
      still_in_group: (group?.memberIds || []).includes(uid) ? "yes" : "no",
      expenses_paid_count: expenses.filter((e) => e.editAction !== "deleted" && e.paidBy === uid).length,
      total_paid_for_group: totalPaid,
      expenses_shared_count: expenses.filter(
        (e) => e.editAction !== "deleted" && e.splits.some((s) => s.uid === uid)
      ).length,
      total_own_share: totalShare,
      net_before_settlements: netBefore,
      settlements_paid_approved: paidOut,
      settlements_received_approved: received,
      settlements_paid_pending: pendingOut,
      settlements_received_pending: pendingIn,
      net_balance: net,
      position: net > 0.01 ? "is owed" : net < -0.01 ? "owes" : "settled",
      amount_abs: round2(Math.abs(net)),
      net_if_deleted_expenses_counted: netInclDeleted,
      group_has_deleted_expenses: Math.abs(netInclDeleted - net) <= 0.01 ? "no" : "yes",
    });
  }

  const active = expenses.filter((e) => e.editAction !== "deleted");
  const approved = settlements.filter((s) => s.status === "approved");
  const totalSpend = round2(active.reduce((t, e) => t + e.amount, 0));
  const totalSettled = round2(approved.reduce((t, s) => t + s.amount, 0));
  const gPairs = pairRows.filter((p) => p.group_id === gid);
  const outstanding = round2(gPairs.reduce((t, p) => t + p.outstanding_amount, 0));
  const debtBefore = round2(gPairs.reduce((t, p) => t + p.net_before_settlement_amount, 0));
  const settledNetGroup = round2(gPairs.reduce((t, p) => t + p.settled_net_toward_creditor, 0));

  groupRows.push({
    group_id: gid,
    group_name: groupName,
    group_exists: group ? "yes" : "no (orphaned subcollection)",
    settlement_mode: group?.settlementMode || "simplified",
    created_at: iso(group?.createdAt),
    created_by_name: nameOf(group, group?.createdBy),
    current_member_count: (group?.memberIds || []).length,
    people_seen_in_data: uidList.length,
    expense_count_active: active.length,
    expense_count_deleted: expenses.filter((e) => e.editAction === "deleted").length,
    expense_count_edited: expenses.filter((e) => e.editAction === "edited").length,
    total_spend: totalSpend,
    avg_expense: active.length ? round2(totalSpend / active.length) : 0,
    first_expense_date: dateOnly(active[0]?.createdAt),
    last_expense_date: dateOnly(active[active.length - 1]?.createdAt),
    settlement_count_total: settlements.length,
    settlement_count_approved: approved.length,
    settlement_count_pending: settlements.filter((s) => s.status === "pending").length,
    settlement_count_rejected: settlements.filter((s) => s.status === "rejected").length,
    total_settled_approved: totalSettled,
    total_pending_amount: round2(
      settlements.filter((s) => s.status === "pending").reduce((t, s) => t + s.amount, 0)
    ),
    debt_before_settlement: debtBefore,
    settled_net_toward_creditors: settledNetGroup,
    outstanding_amount: outstanding,
    settlement_progress_pct: debtBefore ? round2((settledNetGroup / debtBefore) * 100) : "",
  });
}

// ── write ────────────────────────────────────────────────────
console.log(`\nWriting CSVs to ${outDir}/`);

writeCsv(outDir, "splits.csv", [
  "group_id","group_name","expense_id","date","created_at","description","category","split_type",
  "expense_total","paid_by_uid","paid_by_name","member_uid","member_name","member_email",
  "share_amount","share_pct_of_expense","is_payer","owes_payer","participant_count",
  "expense_status","counted_in_totals","splits_sum_matches_total",
], splitRows);

writeCsv(outDir, "expenses.csv", [
  "group_id","group_name","expense_id","date","created_at","updated_at","description","category",
  "amount","split_type","paid_by_uid","paid_by_name","participant_count","participants",
  "split_breakdown","splits_sum","splits_sum_matches_total","expense_status","counted_in_totals",
  "created_by_name","receipt_count",
], expenseRows);

writeCsv(outDir, "settlements.csv", [
  "group_id","group_name","settlement_id","date","created_at","updated_at","from_uid","from_name",
  "to_uid","to_name","amount","status","status_inferred_legacy","counts_as_settled","note",
  "tagged_expense_count","tagged_expense_ids","receipt_count","forwarded_from_settlement_id",
], settlementRows);

writeCsv(outDir, "who_owes_whom.csv", [
  "group_id","group_name","person_a_uid","person_a_name","person_b_uid","person_b_name",
  "a_owes_b_from_expenses","b_owes_a_from_expenses","net_before_settlement_direction",
  "net_before_settlement_amount","settled_a_to_b_approved","settled_b_to_a_approved",
  "settled_total_approved","settled_a_to_b_pending","settled_b_to_a_pending",
  "settled_net_toward_creditor","settlement_progress_pct",
  "outstanding_direction","outstanding_amount","fully_settled",
], pairRows);

writeCsv(outDir, "member_balances.csv", [
  "group_id","group_name","member_uid","member_name","member_email","still_in_group",
  "expenses_paid_count","total_paid_for_group","expenses_shared_count","total_own_share",
  "net_before_settlements","settlements_paid_approved","settlements_received_approved",
  "settlements_paid_pending","settlements_received_pending","net_balance","position","amount_abs",
  "net_if_deleted_expenses_counted","group_has_deleted_expenses",
], memberRows);

writeCsv(outDir, "group_summary.csv", [
  "group_id","group_name","group_exists","settlement_mode","created_at","created_by_name",
  "current_member_count","people_seen_in_data","expense_count_active","expense_count_deleted",
  "expense_count_edited","total_spend","avg_expense","first_expense_date","last_expense_date",
  "settlement_count_total","settlement_count_approved","settlement_count_pending",
  "settlement_count_rejected","total_settled_approved","total_pending_amount",
  "debt_before_settlement","settled_net_toward_creditors","outstanding_amount","settlement_progress_pct",
], groupRows);

const grandSpend = round2(groupRows.reduce((t, g) => t + g.total_spend, 0));
const grandSettled = round2(groupRows.reduce((t, g) => t + g.total_settled_approved, 0));
const grandOutstanding = round2(groupRows.reduce((t, g) => t + g.outstanding_amount, 0));

console.log(`\nTotals across ${groupRows.length} group(s):`);
console.log(`  active expenses   ${groupRows.reduce((t, g) => t + g.expense_count_active, 0)}  (${expenseRows.length} incl. deleted)`);
console.log(`  split lines       ${splitRows.length}`);
console.log(`  total spend       INR ${grandSpend}`);
console.log(`  settled approved  INR ${grandSettled}`);
console.log(`  outstanding       INR ${grandOutstanding}`);
console.log(`  settlements       ${settlementRows.length} (${settlementRows.filter(s => s.status === "pending").length} pending, ${settlementRows.filter(s => s.status === "rejected").length} rejected)`);
