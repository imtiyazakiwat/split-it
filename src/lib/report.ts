import { Settlement } from "./types";
import {
  activeExpenses,
  computeBalances,
  computeSettlementProgress,
} from "./balance";
import { categoryMeta } from "./categories";
import { GroupDataset } from "./global-balance";

/**
 * Flat, exportable records + roll-ups for the Activity dashboard.
 *
 * The activity feed used to be a render-only list of React nodes, which made
 * it impossible to filter by type, aggregate, or export. Everything is derived
 * from plain data here so the same numbers drive the UI, the per-expense tab
 * and the CSV download.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface ExpenseRecord {
  kind: "expense";
  key: string;
  id: string;
  ts: number;
  groupId: string;
  groupName: string;
  description: string;
  category: string;
  categoryLabel: string;
  categoryEmoji: string;
  amount: number;
  paidByUid: string;
  paidByName: string;
  createdByUid: string;
  createdByName: string;
  /** The current user's slice of this expense (0 if they aren't in the split). */
  myShare: number;
  iPaid: boolean;
  splitCount: number;
  edited: boolean;
  receiptCount: number;
}

export interface SettlementRecord {
  kind: "settlement";
  key: string;
  id: string;
  ts: number;
  groupId: string;
  groupName: string;
  amount: number;
  status: Settlement["status"];
  settlementKind: "payment" | "offset";
  fromUid: string;
  fromName: string;
  toUid: string;
  toName: string;
  createdByUid: string;
  note?: string;
  /** "out" = current user pays, "in" = current user receives. */
  direction: "out" | "in" | "other";
  crossGroupId?: string;
  settlement: Settlement;
}

export type ActivityRecord = ExpenseRecord | SettlementRecord;

function memberNameOf(dataset: GroupDataset, uid: string, meUid: string): string {
  if (uid === meUid) return "You";
  return dataset.group.members?.[uid]?.displayName || "Former member";
}

export function buildActivityRecords(
  meUid: string,
  datasets: GroupDataset[]
): ActivityRecord[] {
  const records: ActivityRecord[] = [];

  for (const dataset of datasets) {
    const { group } = dataset;
    // Only "deleted" removes an item from the ledger; edited expenses stay
    // visible (they were previously dropped from the feed entirely).
    for (const expense of activeExpenses(dataset.expenses)) {
      const cat = categoryMeta(expense.category);
      const myShare = expense.splits?.find((s) => s.uid === meUid)?.amount || 0;
      records.push({
        kind: "expense",
        key: `e-${group.id}-${expense.id}`,
        id: expense.id,
        ts: expense.updatedAt || expense.createdAt,
        groupId: group.id,
        groupName: group.name,
        description: expense.description,
        category: expense.category || "others",
        categoryLabel: cat.label,
        categoryEmoji: cat.emoji,
        amount: expense.amount,
        paidByUid: expense.paidBy,
        paidByName: memberNameOf(dataset, expense.paidBy, meUid),
        createdByUid: expense.createdBy,
        createdByName: memberNameOf(dataset, expense.createdBy, meUid),
        myShare: round2(myShare),
        iPaid: expense.paidBy === meUid,
        splitCount: expense.splits?.length || 0,
        edited: expense.editAction === "edited",
        receiptCount: expense.receiptUrls?.length || 0,
      });
    }

    for (const s of dataset.settlements) {
      records.push({
        kind: "settlement",
        key: `s-${group.id}-${s.id}`,
        id: s.id,
        ts: s.updatedAt || s.createdAt,
        groupId: group.id,
        groupName: group.name,
        amount: s.amount,
        status: s.status,
        settlementKind: s.kind === "offset" ? "offset" : "payment",
        fromUid: s.fromUid,
        fromName: memberNameOf(dataset, s.fromUid, meUid),
        toUid: s.toUid,
        toName: memberNameOf(dataset, s.toUid, meUid),
        createdByUid: s.createdBy || s.fromUid,
        note: s.note,
        direction: s.fromUid === meUid ? "out" : s.toUid === meUid ? "in" : "other",
        crossGroupId: s.crossGroupId,
        settlement: s,
      });
    }
  }

  return records.sort((a, b) => b.ts - a.ts);
}

export interface Bucket {
  key: string;
  label: string;
  emoji?: string;
  total: number;
  myShare: number;
  count: number;
}

export interface GroupBucket extends Bucket {
  net: number;
  settledPct: number;
}

export interface ActivityReport {
  from: number;
  to: number;
  /** Everything the group spent, across all groups. */
  totalSpend: number;
  /** The part of that which is the current user's responsibility. */
  myShare: number;
  /** How much the current user fronted. */
  iPaid: number;
  /** iPaid - myShare, before settlements: what they're up or down overall. */
  netPosition: number;
  expenseCount: number;
  /** Money the current user has actually sent (approved settlements). */
  paidOut: number;
  /** Money the current user has actually received (approved settlements). */
  receivedIn: number;
  pendingOut: number;
  pendingIn: number;
  /** Value cleared by cross-group offsets, where no money moved. */
  offsetTotal: number;
  /** Current net across all groups: positive means the user is owed money. */
  currentNet: number;
  totalOwe: number;
  totalReceive: number;
  settledPct: number;
  byCategory: Bucket[];
  byGroup: GroupBucket[];
  byMonth: Bucket[];
  biggestExpense?: ExpenseRecord;
}

function monthKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(ts: number): string {
  return new Date(ts).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}

export function buildActivityReport(
  meUid: string,
  datasets: GroupDataset[],
  records: ActivityRecord[]
): ActivityReport {
  const expenses = records.filter((r): r is ExpenseRecord => r.kind === "expense");
  const settlements = records.filter((r): r is SettlementRecord => r.kind === "settlement");

  const totalSpend = round2(expenses.reduce((s, e) => s + e.amount, 0));
  const myShare = round2(expenses.reduce((s, e) => s + e.myShare, 0));
  const iPaid = round2(expenses.reduce((s, e) => s + (e.iPaid ? e.amount : 0), 0));

  // Offsets clear a balance without any money changing hands, so they must not
  // be counted as cash sent or received — they get their own line.
  const cash = settlements.filter((s) => s.settlementKind === "payment");
  const approved = cash.filter((s) => s.status === "approved");
  const pending = cash.filter((s) => s.status === "pending");
  const paidOut = round2(
    approved.filter((s) => s.direction === "out").reduce((s, x) => s + x.amount, 0)
  );
  const receivedIn = round2(
    approved.filter((s) => s.direction === "in").reduce((s, x) => s + x.amount, 0)
  );
  const pendingOut = round2(
    pending.filter((s) => s.direction === "out").reduce((s, x) => s + x.amount, 0)
  );
  const pendingIn = round2(
    pending.filter((s) => s.direction === "in").reduce((s, x) => s + x.amount, 0)
  );
  const offsetTotal = round2(
    settlements
      .filter((s) => s.settlementKind === "offset" && s.status === "approved")
      .reduce((sum, s) => sum + s.amount, 0)
  );

  const catMap = new Map<string, Bucket>();
  expenses.forEach((e) => {
    const bucket = catMap.get(e.category) || {
      key: e.category,
      label: e.categoryLabel,
      emoji: e.categoryEmoji,
      total: 0,
      myShare: 0,
      count: 0,
    };
    bucket.total = round2(bucket.total + e.amount);
    bucket.myShare = round2(bucket.myShare + e.myShare);
    bucket.count += 1;
    catMap.set(e.category, bucket);
  });

  const monthMap = new Map<string, Bucket>();
  expenses.forEach((e) => {
    const key = monthKey(e.ts);
    const bucket = monthMap.get(key) || {
      key,
      label: monthLabel(e.ts),
      total: 0,
      myShare: 0,
      count: 0,
    };
    bucket.total = round2(bucket.total + e.amount);
    bucket.myShare = round2(bucket.myShare + e.myShare);
    bucket.count += 1;
    monthMap.set(key, bucket);
  });

  const byGroup: GroupBucket[] = datasets.map((dataset) => {
    const groupExpenses = expenses.filter((e) => e.groupId === dataset.group.id);
    const balances = computeBalances(
      dataset.group.memberIds,
      dataset.expenses,
      dataset.settlements
    );
    const progress = computeSettlementProgress(
      dataset.group.memberIds,
      dataset.expenses,
      dataset.settlements
    );
    return {
      key: dataset.group.id,
      label: dataset.group.name,
      total: round2(groupExpenses.reduce((s, e) => s + e.amount, 0)),
      myShare: round2(groupExpenses.reduce((s, e) => s + e.myShare, 0)),
      count: groupExpenses.length,
      net: balances.find((b) => b.uid === meUid)?.netAmount ?? 0,
      settledPct: progress.pct,
    };
  });

  const currentNet = round2(byGroup.reduce((s, g) => s + g.net, 0));
  const totalReceive = round2(byGroup.reduce((s, g) => s + (g.net > 0 ? g.net : 0), 0));
  const totalOwe = round2(byGroup.reduce((s, g) => s + (g.net < 0 ? -g.net : 0), 0));

  const totalDebt = datasets.reduce((sum, d) => {
    const p = computeSettlementProgress(d.group.memberIds, d.expenses, d.settlements);
    return sum + p.totalDebt;
  }, 0);
  const clearedDebt = datasets.reduce((sum, d) => {
    const p = computeSettlementProgress(d.group.memberIds, d.expenses, d.settlements);
    return sum + p.clearedDebt;
  }, 0);
  const settledPct =
    totalDebt <= 0.01 ? 100 : Math.max(0, Math.min(100, Math.round((clearedDebt / totalDebt) * 100)));

  const timestamps = records.map((r) => r.ts);

  return {
    from: timestamps.length ? Math.min(...timestamps) : Date.now(),
    to: timestamps.length ? Math.max(...timestamps) : Date.now(),
    totalSpend,
    myShare,
    iPaid,
    netPosition: round2(iPaid - myShare),
    expenseCount: expenses.length,
    paidOut,
    receivedIn,
    pendingOut,
    pendingIn,
    offsetTotal,
    currentNet,
    totalOwe,
    totalReceive,
    settledPct,
    byCategory: Array.from(catMap.values()).sort((a, b) => b.total - a.total),
    byGroup: byGroup.sort((a, b) => b.total - a.total),
    byMonth: Array.from(monthMap.values()).sort((a, b) => b.key.localeCompare(a.key)),
    biggestExpense: [...expenses].sort((a, b) => b.amount - a.amount)[0],
  };
}

// ── Export ──────────────────────────────────────────────────

function csvCell(value: string | number): string {
  const s = String(value ?? "");
  // Guard against CSV formula injection in spreadsheet apps.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(rows: (string | number)[][]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

function isoDate(ts: number): string {
  return new Date(ts).toISOString();
}

export function buildExportCsv(records: ActivityRecord[], report: ActivityReport): string {
  const rows: (string | number)[][] = [];

  rows.push(["SplitIt report"]);
  rows.push(["Generated", isoDate(Date.now())]);
  rows.push(["Period", isoDate(report.from), isoDate(report.to)]);
  rows.push([]);
  rows.push(["Summary"]);
  rows.push(["Total group spend", report.totalSpend]);
  rows.push(["Your share", report.myShare]);
  rows.push(["You paid upfront", report.iPaid]);
  rows.push(["Settlements sent (approved)", report.paidOut]);
  rows.push(["Settlements received (approved)", report.receivedIn]);
  rows.push(["Pending out", report.pendingOut]);
  rows.push(["Pending in", report.pendingIn]);
  rows.push(["Cleared by cross-group offsets", report.offsetTotal]);
  rows.push(["You currently owe", report.totalOwe]);
  rows.push(["You will receive", report.totalReceive]);
  rows.push(["Settled", `${report.settledPct}%`]);
  rows.push([]);

  rows.push(["By category", "Total", "Your share", "Count"]);
  report.byCategory.forEach((c) => rows.push([c.label, c.total, c.myShare, c.count]));
  rows.push([]);

  rows.push(["By group", "Total", "Your share", "Your net", "Settled %", "Expenses"]);
  report.byGroup.forEach((g) =>
    rows.push([g.label, g.total, g.myShare, g.net, g.settledPct, g.count])
  );
  rows.push([]);

  rows.push(["By month", "Total", "Your share", "Count"]);
  report.byMonth.forEach((m) => rows.push([m.label, m.total, m.myShare, m.count]));
  rows.push([]);

  rows.push([
    "Expenses",
    "Date",
    "Group",
    "Description",
    "Category",
    "Amount",
    "Paid by",
    "Your share",
    "Split ways",
    "Edited",
  ]);
  records
    .filter((r): r is ExpenseRecord => r.kind === "expense")
    .forEach((e) =>
      rows.push([
        "",
        isoDate(e.ts),
        e.groupName,
        e.description,
        e.categoryLabel,
        e.amount,
        e.paidByName,
        e.myShare,
        e.splitCount,
        e.edited ? "yes" : "no",
      ])
    );
  rows.push([]);

  rows.push([
    "Settlements",
    "Date",
    "Group",
    "From",
    "To",
    "Amount",
    "Type",
    "Status",
    "Note",
  ]);
  records
    .filter((r): r is SettlementRecord => r.kind === "settlement")
    .forEach((s) =>
      rows.push([
        "",
        isoDate(s.ts),
        s.groupName,
        s.fromName,
        s.toName,
        s.amount,
        s.settlementKind,
        s.status,
        s.note || "",
      ])
    );

  return toCsv(rows);
}

/**
 * Saves a file from the browser. Uses the Web Share sheet on mobile when
 * available (Android Chrome ignores `download` for some PWA contexts), and
 * falls back to a regular object-URL download everywhere else.
 */
export async function downloadTextFile(
  filename: string,
  content: string,
  mime = "text/csv;charset=utf-8"
): Promise<void> {
  const blob = new Blob([`\uFEFF${content}`], { type: mime });

  const nav = navigator as Navigator & {
    canShare?: (data: { files: File[] }) => boolean;
    share?: (data: { files: File[]; title?: string }) => Promise<void>;
  };
  if (typeof File !== "undefined" && nav.canShare && nav.share) {
    const file = new File([blob], filename, { type: mime });
    if (nav.canShare({ files: [file] })) {
      try {
        await nav.share({ files: [file], title: filename });
        return;
      } catch (err) {
        // User cancelled or sharing failed — fall through to download.
        if ((err as Error)?.name === "AbortError") return;
      }
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function reportFilename(ext: string): string {
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(
    d.getDate()
  ).padStart(2, "0")}`;
  return `splitit-report-${stamp}.${ext}`;
}
