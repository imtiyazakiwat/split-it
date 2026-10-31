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
import { ButtonRow, ListSection, Row } from "@/components/ui/List";
import { CategoryGlyph, Download, categoryTint } from "@/components/ui/Icons";

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
    tone === "pos" ? "text-[var(--pos)]" : tone === "neg" ? "text-[var(--neg)]" : "text-[var(--text-primary)]";
  return (
    <div className="min-w-0">
      <p className="t-caption text-[var(--text-secondary)]">{label}</p>
      <p className={`t-title3 t-numeral truncate ${color}`}>{value}</p>
      {hint && <p className="t-caption text-[var(--text-secondary)] truncate">{hint}</p>}
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
    return <p className="list-row t-body text-[var(--text-secondary)]">{emptyLabel}</p>;
  }
  const max = Math.max(...buckets.map((b) => b.total), 1);
  return (
    <>
      {buckets.map((b) => (
        <div key={b.key} className="list-row !block">
          <div className="flex items-baseline justify-between gap-3">
            <p className="t-body text-[var(--text-primary)] truncate">{b.label}</p>
            <p className="t-body font-semibold t-numeral text-[var(--text-primary)] shrink-0">{formatCurrency(b.total)}</p>
          </div>
          <div className="meter mt-2 !h-[6px]">
            <span style={{ width: `${Math.max(2, (b.total / max) * 100)}%`, background: "var(--brand-solid)" }} />
          </div>
          <p className="t-footnote text-[var(--text-secondary)] mt-1.5">
            {b.count} expense{b.count !== 1 ? "s" : ""}
            {showShare ? ` · your share ${formatCurrency(b.myShare)}` : ""}
            {typeof b.settledPct === "number" ? ` · ${b.settledPct}% settled` : ""}
          </p>
        </div>
      ))}
    </>
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
    <div>
      <div className="list-section px-4 pt-3.5 pb-4">
        <p className="t-subhead text-[var(--text-secondary)]">Total group spend</p>
        <p className="t-large-title t-numeral text-[var(--text-primary)] truncate">{formatCurrency(report.totalSpend)}</p>
        <p className="t-footnote text-[var(--text-secondary)]">{period}</p>
        <div className="mt-4 pt-3.5 grid grid-cols-2 gap-x-4 gap-y-3.5 relative before:absolute before:inset-x-0 before:top-0 before:h-[0.5px] before:bg-[var(--separator)]">
          <Stat
            label="Your share"
            value={formatCurrency(report.myShare)}
            hint={`${report.expenseCount} expense${report.expenseCount !== 1 ? "s" : ""}`}
          />
          <Stat
            label="You paid up front"
            value={formatCurrency(report.iPaid)}
            hint={
              report.netPosition >= 0
                ? `${formatCurrency(report.netPosition)} over your share`
                : `${formatCurrency(-report.netPosition)} under your share`
            }
          />
          <Stat
            label="Payments sent"
            value={formatCurrency(report.paidOut)}
            hint={!isSettled(report.pendingOut) ? `${formatCurrency(report.pendingOut)} pending` : "All confirmed"}
          />
          <Stat
            label="Payments received"
            value={formatCurrency(report.receivedIn)}
            hint={!isSettled(report.pendingIn) ? `${formatCurrency(report.pendingIn)} awaiting you` : "All confirmed"}
          />
        </div>
      </div>

      <ListSection
        header="Where you stand"
        footer={
          !isSettled(report.offsetTotal)
            ? `${formatCurrency(report.offsetTotal)} was cleared by cancelling balances across groups. No money changed hands.`
            : "Settled overall is the share of all money that ever needed to change hands and no longer does."
        }
      >
        <Row title="You owe" detail={<span className="t-numeral text-[var(--neg)]">{formatCurrency(report.totalOwe)}</span>} />
        <Row title="You’re owed" detail={<span className="t-numeral text-[var(--pos)]">{formatCurrency(report.totalReceive)}</span>} />
        <div className="list-row !block">
          <div className="flex items-baseline justify-between">
            <span className="t-body text-[var(--text-primary)]">Settled overall</span>
            <span className="t-body font-semibold text-[var(--text-primary)]">{report.settledPct}%</span>
          </div>
          <div className="meter mt-2">
            <span style={{ width: `${report.settledPct}%` }} />
          </div>
        </div>
      </ListSection>

      <ListSection header="By category">
        <BarList buckets={report.byCategory} emptyLabel="No expenses yet" />
      </ListSection>

      <ListSection header="By group">
        <BarList buckets={report.byGroup} emptyLabel="No groups yet" />
      </ListSection>

      <ListSection header="By month">
        <BarList buckets={report.byMonth} emptyLabel="No expenses yet" />
      </ListSection>

      {report.biggestExpense && (
        <ListSection header="Biggest expense">
          <Row
            leading={
              <span className="icon-tile" style={{ background: categoryTint(report.biggestExpense.category) }}>
                <CategoryGlyph id={report.biggestExpense.category} size={18} />
              </span>
            }
            separatorInset={58}
            title={report.biggestExpense.description}
            subtitle={`${report.biggestExpense.groupName} · paid by ${report.biggestExpense.paidByName}`}
            detail={<span className="t-numeral font-semibold text-[var(--text-primary)]">{formatCurrency(report.biggestExpense.amount)}</span>}
          />
        </ListSection>
      )}

      <ListSection footer="A spreadsheet of every expense and payment in this view.">
        <ButtonRow
          onClick={handleDownload}
          disabled={busy}
          leading={<span className="text-[var(--brand)]"><Download size={20} /></span>}
          title={busy ? "Exporting…" : "Export CSV"}
          action
        />
      </ListSection>
    </div>
  );
}
