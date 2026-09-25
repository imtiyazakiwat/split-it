/**
 * Measures the per-render ledger cost the UI actually pays, using the real
 * compiled functions from src/lib against real Firestore data.
 *
 * Exists because "the group screen recomputes four ledgers per render" is a
 * code-reading claim, not a measurement. Steering rule 0: get the number before
 * writing the fix. If the number is small, the render work is not the problem
 * and the fix belongs elsewhere.
 *
 * Usage: node scripts/bench-render.mjs            (real data)
 *        node scripts/bench-render.mjs --scale=20 (real data cloned 20x)
 */
import { db } from "./lib/admin.mjs";

const L = "/tmp/bench";
const { computeBalances, computeDirectDebts, computeSettlementProgress, simplifyDebts } =
  await import(`${L}/balance.js`);
const { computeCounterpartyBalances } = await import(`${L}/global-balance.js`);
const { buildPairStatement } = await import(`${L}/statement.js`);

const args = process.argv.slice(2);
const scale = Number((args.find((a) => a.startsWith("--scale=")) || "--scale=1").slice(8));

// ── load real data ───────────────────────────────────────────
const groups = [];
for await (const d of db.collection("groups").stream()) {
  groups.push({ id: d.id, ...d.data(), memberIds: d.get("memberIds") || [], members: d.get("members") || {} });
}
const exByGroup = new Map();
for await (const d of db.collectionGroup("expenses").stream()) {
  const g = d.ref.parent.parent?.id;
  if (!exByGroup.has(g)) exByGroup.set(g, []);
  exByGroup.get(g).push({ id: d.id, ...d.data(), splits: d.get("splits") || [] });
}
const stByGroup = new Map();
for await (const d of db.collectionGroup("settlements").stream()) {
  const g = d.ref.parent.parent?.id;
  if (!stByGroup.has(g)) stByGroup.set(g, []);
  stByGroup.get(g).push({ id: d.id, ...d.data(), status: d.get("status") || "approved" });
}
const transfers = [];
for await (const d of db.collection("transfers").stream()) transfers.push({ id: d.id, ...d.data() });

// Clone to simulate growth. Ids are suffixed so nothing collides.
function inflate(rows, n, idKey = "id") {
  if (n <= 1) return rows;
  const out = [];
  for (let k = 0; k < n; k++) {
    for (const r of rows) out.push({ ...r, [idKey]: `${r[idKey]}_c${k}` });
  }
  return out;
}

const datasets = groups.map((group) => ({
  group,
  expenses: inflate(exByGroup.get(group.id) || [], scale),
  settlements: inflate(stByGroup.get(group.id) || [], scale),
}));

const totalEx = datasets.reduce((s, d) => s + d.expenses.length, 0);
const totalSt = datasets.reduce((s, d) => s + d.settlements.length, 0);

// Pick the heaviest group and the busiest user — the worst realistic case.
const heaviest = [...datasets].sort(
  (a, b) => b.expenses.length + b.settlements.length - (a.expenses.length + a.settlements.length)
)[0];
const counts = new Map();
for (const g of groups) for (const uid of g.memberIds) counts.set(uid, (counts.get(uid) || 0) + 1);
const meUid = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];

console.log(`scale x${scale}  groups=${groups.length}  expenses=${totalEx}  settlements=${totalSt}  transfers=${transfers.length}`);
console.log(`heaviest group: ${heaviest.group.name} (${heaviest.expenses.length} exp, ${heaviest.settlements.length} settle)`);
console.log(`busiest uid in ${counts.get(meUid)} groups\n`);

function bench(label, fn, iters = 200) {
  fn(); // warm
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < iters; i++) fn();
  const t1 = process.hrtime.bigint();
  const perCall = Number(t1 - t0) / 1e6 / iters;
  console.log(`  ${label.padEnd(56)} ${perCall.toFixed(3)} ms`);
  return perCall;
}

// ── what groups/[id]/page.tsx does per render ────────────────
console.log("GROUP DETAIL SCREEN — per render, unmemoized (current behaviour)");
const g = heaviest;
const live = g.expenses.filter((e) => e.editAction !== "deleted");
let groupTotal = 0;
groupTotal += bench("computeBalances", () => computeBalances(g.group.memberIds, live, g.settlements));
groupTotal += bench("computeDirectDebts  (O(P^2) pairwise)", () =>
  computeDirectDebts(g.group.memberIds, live, g.settlements)
);
groupTotal += bench("computeSettlementProgress (calls computeBalances again)", () =>
  computeSettlementProgress(g.group.memberIds, live, g.settlements)
);
groupTotal += bench("simplifyDebts", () => simplifyDebts(computeBalances(g.group.memberIds, live, g.settlements)));
console.log(`  ${"TOTAL per render".padEnd(56)} ${groupTotal.toFixed(3)} ms\n`);

// ── what home + pay + chat + reports each do ─────────────────
console.log("CROSS-GROUP (home, pay, chat, reports — 5 call sites)");
const cpOne = bench("computeCounterpartyBalances (all groups)", () =>
  computeCounterpartyBalances(meUid, datasets, transfers)
);
const homeRows = bench("computeBalances inside .map() over every group", () => {
  for (const d of datasets) computeBalances(d.group.memberIds, d.expenses, d.settlements);
});
console.log(`  ${"home screen per render (rows + counterparties)".padEnd(56)} ${(cpOne + homeRows).toFixed(3)} ms`);

const other = [...counts.keys()].find((u) => u !== meUid);
bench("buildPairStatement (reports, unmemoized)", () =>
  buildPairStatement(meUid, other, g.expenses, g.settlements, transfers)
);
console.log("");

// ── cold start: 2G snapshots each invalidating every memo ────
const G = groups.length;
console.log(`COLD START — ${2 * G} snapshots, each invalidating datasets identity`);
console.log(`  ${"counterparty recompute x".padEnd(56)}${2 * G} = ${(cpOne * 2 * G).toFixed(1)} ms of main thread`);
console.log("");

console.log("BUDGET CHECK (steering §1: single task <= 50 ms, INP p75 <= 200 ms)");
const verdict = (n, label) =>
  console.log(`  ${label.padEnd(56)} ${n.toFixed(2)} ms  ${n > 50 ? "OVER BUDGET" : "within budget"}`);
verdict(groupTotal, "group screen, one render");
verdict(cpOne + homeRows, "home screen, one render");
verdict(cpOne * 2 * G, "cold start recompute storm");
