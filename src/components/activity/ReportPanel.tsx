"use client";

import { useState } from "react";
import { formatCurrency } from "@/lib/balance";
import { isSettled } from "@/lib/money";
import {
  ActivityRecord,
  ActivityReport,
  Bucket,
  buildExportCsv,
  downloadTextFile,
  reportFilename,
} from "@/lib/report";
import { useToast } from "@/components/ui/Toast";

function Stat({
  label,
  value,
  tone = "neutral",
  hint,
}: {
  label: string;
  value: string;
  tone?: "neutral" | "pos" | "neg" | "brand";
  hint?: string;
}) {
  const color =
    tone === "pos"
      ? "text-[var(--pos)]"
      : tone === "neg"
      ? "text-[var(--neg)]"
      : tone === "brand"
      ? "text-[var(--brand)]"
      : "text-[var(--text-primary)]";
  return (
    <div className="min-w-0">
      <p className="text-[12px] text-[var(--text-tertiary)]">{label}</p>
      <p className={`text-[20px] font-bold mt-0.5 truncate ${color}`}>{value}</p>
      {hint && <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5 truncate">{hint}</p>}
    </div>
  );
}

function BarList({
  buckets,
  emptyLabel,
  showShare = true,
}: {
  buckets: (Bucket & { net?: number; settledPct?: number })[];
  emptyLabel: string;
  showShare?: boolean;
}) {
  if (buckets.length === 0) {
    return <p className="text-[13px] text-[var(--text-tertiary)] py-3">{emptyLabel}</p>;
  }
  const max = Math.max(...buckets.map((b) => b.total), 1);
  return (
    <div className="space-y-3">
      {buckets.map((b) => (
        <div key={b.key}>
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[14px] text-[var(--text-primary)] truncate">
              {b.emoji ? `${b.emoji} ` : ""}
              {b.label}
            </p>
            <p className="text-[14px] font-semibold text-[var(--text-primary)] shrink-0">
              {formatCurrency(b.total)}
            </p>
          </div>
          <div className="mt-1 h-2 rounded-full bg-[var(--fill)] overflow-hidden">
            <div
              className="h-full rounded-full bg-[var(--brand-solid)]"
              style={{ width: `${Math.max(2, (b.total / max) * 100)}%` }}
            />
          </div>
          <p className="text-[11px] text-[var(--text-tertiary)] mt-1">
            {b.count} expense{b.count !== 1 ? "s" : ""}
            {showShare ? ` · your share ${formatCurrency(b.myShare)}` : ""}
            {typeof b.settledPct === "number" ? ` · ${b.settledPct}% settled` : ""}
          </p>
        </div>
      ))}
    </div>
  );
}

/**
 * The dashboard the Activity screen previously lacked entirely: spend and
 * settlement analytics across all groups, plus a CSV export of every
 * underlying record so the numbers can be checked or archived.
 */
export default function ReportPanel({
  report,
  records,
}: {
  report: ActivityReport;
  records: ActivityRecord[];
}) {
  const [busy, setBusy] = useState(false);
  const showToast = useToast();

  async function handleDownload() {
    setBusy(true);
    try {
      await downloadTextFile(reportFilename("csv"), buildExportCsv(records, report));
      showToast({ message: "Report downloaded" });
    } catch (err) {
      showToast({
        message: err instanceof Error ? `Export failed: ${err.message}` : "Export failed",
      });
    } finally {
      setBusy(false);
    }
  }

  const period =
    report.expenseCount > 0
      ? `${new Date(report.from).toLocaleDateString("en-IN", {
          day: "numeric",
          month: "short",
        })} – ${new Date(report.to).toLocaleDateString("en-IN", {
          day: "numeric",
          month: "short",
          year: "numeric",
        })}`
      : "No activity yet";

  return (
    <div className="space-y-5">
      {/* Headline */}
      <div className="bg-[var(--surface)] rounded-[var(--radius-card)] p-5 shadow-[var(--shadow-card)]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[13px] text-[var(--text-tertiary)]">Total group spend</p>
            <p className="text-[32px] font-extrabold text-[var(--brand)] leading-tight truncate">
              {formatCurrency(report.totalSpend)}
            </p>
            <p className="text-[12px] text-[var(--text-tertiary)] mt-0.5">{period}</p>
          </div>
          <button
            onClick={handleDownload}
            disabled={busy}
            className="shrink-0 flex items-center gap-1.5 rounded-full bg-[var(--brand-solid)] text-white px-3.5 py-2 text-[13px] font-semibold tap-shrink disabled:opacity-50"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3v12M7 11l5 5 5-5M5 21h14" />
            </svg>
            {busy ? "…" : "CSV"}
          </button>
        </div>

        <div className="h-px bg-[var(--border-subtle)] my-4" />

        <div className="grid grid-cols-2 gap-x-4 gap-y-4">
          <Stat
            label="Your share"
            value={formatCurrency(report.myShare)}
            hint={`${report.expenseCount} expense${report.expenseCount !== 1 ? "s" : ""}`}
          />
          <Stat
            label="You paid upfront"
            value={formatCurrency(report.iPaid)}
            tone="brand"
            hint={
              report.netPosition >= 0
                ? `${formatCurrency(report.netPosition)} more than your share`
                : `${formatCurrency(-report.netPosition)} less than your share`
            }
          />
          <Stat
            label="Settlements sent"
            value={formatCurrency(report.paidOut)}
            tone="neg"
            hint={!isSettled(report.pendingOut) ? `${formatCurrency(report.pendingOut)} pending` : "all confirmed"}
          />
          <Stat
            label="Settlements received"
            value={formatCurrency(report.receivedIn)}
            tone="pos"
            hint={!isSettled(report.pendingIn) ? `${formatCurrency(report.pendingIn)} awaiting you` : "all confirmed"}
          />
        </div>
      </div>

      {/* Current position */}
      <div className="bg-[var(--surface)] rounded-[var(--radius-card)] p-5 shadow-[var(--shadow-card)]">
        <p className="text-[15px] font-bold text-[var(--text-primary)] mb-3">Where you stand now</p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-4">
          <Stat label="You owe" value={formatCurrency(report.totalOwe)} tone="neg" />
          <Stat label="You will receive" value={formatCurrency(report.totalReceive)} tone="pos" />
        </div>
        {!isSettled(report.offsetTotal) && (
          <p className="mt-3 rounded-[var(--radius-md)] bg-[var(--tint-accent)] px-3 py-2 text-[13px] text-[var(--text-secondary)]">
            {formatCurrency(report.offsetTotal)} was cleared by cancelling balances across
            groups — no money changed hands.
          </p>
        )}
        <div className="mt-4">
          <div className="flex items-baseline justify-between">
            <p className="text-[13px] text-[var(--text-tertiary)]">Settled overall</p>
            <p className="text-[15px] font-bold text-[var(--pos)]">{report.settledPct}%</p>
          </div>
          <div className="mt-1.5 h-2.5 rounded-full bg-[var(--fill)] overflow-hidden">
            <div
              className="h-full rounded-full bg-[var(--pos)]"
              style={{ width: `${report.settledPct}%` }}
            />
          </div>
          <p className="text-[11px] text-[var(--text-tertiary)] mt-1">
            Share of all money that ever needed to change hands and no longer does.
          </p>
        </div>
      </div>

      {/* Categories */}
      <section className="bg-[var(--surface)] rounded-[var(--radius-card)] p-5 shadow-[var(--shadow-card)]">
        <p className="text-[15px] font-bold text-[var(--text-primary)] mb-3">Spending by category</p>
        <BarList buckets={report.byCategory} emptyLabel="No expenses yet." />
      </section>

      {/* Groups */}
      <section className="bg-[var(--surface)] rounded-[var(--radius-card)] p-5 shadow-[var(--shadow-card)]">
        <p className="text-[15px] font-bold text-[var(--text-primary)] mb-3">By group</p>
        <BarList buckets={report.byGroup} emptyLabel="No groups yet." />
      </section>

      {/* Months */}
      <section className="bg-[var(--surface)] rounded-[var(--radius-card)] p-5 shadow-[var(--shadow-card)]">
        <p className="text-[15px] font-bold text-[var(--text-primary)] mb-3">Month by month</p>
        <BarList buckets={report.byMonth} emptyLabel="No expenses yet." />
      </section>

      {report.biggestExpense && (
        <section className="bg-[var(--tint-accent)] rounded-[var(--radius-card)] p-4 flex items-center gap-3">
          <span className="w-11 h-11 rounded-2xl bg-[var(--surface)] flex items-center justify-center text-[22px] shrink-0">
            {report.biggestExpense.categoryEmoji}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[12px] text-[var(--text-tertiary)]">Biggest single expense</p>
            <p className="text-[15px] font-semibold text-[var(--text-primary)] truncate">
              {report.biggestExpense.description}
            </p>
            <p className="text-[12px] text-[var(--text-tertiary)] truncate">
              {report.biggestExpense.groupName} · paid by {report.biggestExpense.paidByName}
            </p>
          </div>
          <p className="text-[17px] font-extrabold text-[var(--brand)] shrink-0">
            {formatCurrency(report.biggestExpense.amount)}
          </p>
        </section>
      )}
    </div>
  );
}
