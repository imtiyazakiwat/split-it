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
import { Card, List, RowButton, Section, sepInset } from "@/components/kit/List";
import { CategoryTile, GroupAvatar, IconTile } from "@/components/kit/Tile";
import { Meter, Spinner } from "@/components/kit/Controls";

function Stat({
  label,
  value,
  tone = "neutral",
  hint,
}: {
  label: string;
  value: string;
  tone?: "neutral" | "pos" | "neg";
  hint?: string;
}) {
  const color = tone === "pos" ? "text-pos" : tone === "neg" ? "text-neg" : "text-label";
  return (
    <div className="min-w-0 p-4">
      <p className="t-footnote text-label-2">{label}</p>
      <p className={`num t-title3 mt-0.5 truncate ${color}`}>{value}</p>
      {hint && <p className="t-caption mt-0.5 truncate text-label-2">{hint}</p>}
    </div>
  );
}

/** Rows with a proportion meter: category, group and month breakdowns. */
function BarRows({
  buckets,
  leading,
  showShare = true,
  emptyLabel,
}: {
  buckets: (Bucket & { net?: number; settledPct?: number })[];
  leading?: (b: Bucket) => React.ReactNode;
  showShare?: boolean;
  emptyLabel: string;
}) {
  if (buckets.length === 0) {
    return (
      <Card className="p-4">
        <p className="t-subhead text-label-2">{emptyLabel}</p>
      </Card>
    );
  }
  const max = Math.max(...buckets.map((b) => b.total), 1);
  return (
    <List>
      {buckets.map((b) => (
        <div key={b.key} className="row is-tall" style={sepInset(leading ? 58 : 16)}>
          {leading?.(b)}
          <span className="row-main">
            <span className="flex items-baseline justify-between gap-3">
              <span className="row-title">{b.label}</span>
              <span className="num t-subhead shrink-0 font-semibold">{formatCurrency(b.total)}</span>
            </span>
            <span className="mt-1.5 block">
              <Meter value={Math.max(2, (b.total / max) * 100)} color="var(--tint)" label={`${b.label} share of spend`} />
            </span>
            <span className="row-detail">
              {b.count} expense{b.count !== 1 ? "s" : ""}
              {showShare ? ` · your share ${formatCurrency(b.myShare)}` : ""}
              {typeof b.settledPct === "number" ? ` · ${b.settledPct}% settled` : ""}
            </span>
          </span>
        </div>
      ))}
    </List>
  );
}

/**
 * Spend and settlement analytics across groups, plus a CSV of every
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
      showToast({ message: err instanceof Error ? `Export failed: ${err.message}` : "Export failed" });
    } finally {
      setBusy(false);
    }
  }

  const period =
    report.expenseCount > 0
      ? `${new Date(report.from).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} – ${new Date(
          report.to
        ).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`
      : "No activity yet";

  return (
    <>
      <Card className="p-4">
        <p className="t-footnote text-label-2">Total group spend</p>
        <p className="amount-hero mt-1 truncate text-[34px]">{formatCurrency(report.totalSpend)}</p>
        <p className="t-footnote mt-1 text-label-2">{period}</p>
      </Card>

      <Section header="Your money">
        <Card className="grid grid-cols-2">
          <Stat
            label="Your share"
            value={formatCurrency(report.myShare)}
            hint={`${report.expenseCount} expense${report.expenseCount !== 1 ? "s" : ""}`}
          />
          <div className="border-l-[0.5px] border-[var(--separator)]">
            <Stat
              label="You paid upfront"
              value={formatCurrency(report.iPaid)}
              hint={
                report.netPosition >= 0
                  ? `${formatCurrency(report.netPosition)} more than your share`
                  : `${formatCurrency(-report.netPosition)} less than your share`
              }
            />
          </div>
          <div className="border-t-[0.5px] border-[var(--separator)]">
            <Stat
              label="Settlements sent"
              value={formatCurrency(report.paidOut)}
              tone="neg"
              hint={!isSettled(report.pendingOut) ? `${formatCurrency(report.pendingOut)} pending` : "All confirmed"}
            />
          </div>
          <div className="border-l-[0.5px] border-t-[0.5px] border-[var(--separator)]">
            <Stat
              label="Settlements received"
              value={formatCurrency(report.receivedIn)}
              tone="pos"
              hint={!isSettled(report.pendingIn) ? `${formatCurrency(report.pendingIn)} awaiting you` : "All confirmed"}
            />
          </div>
        </Card>
      </Section>

      <Section
        header="Where you stand"
        footer="Settled overall is the share of all money that ever needed to change hands and no longer does."
      >
        <Card>
          <div className="grid grid-cols-2">
            <Stat label="You owe" value={formatCurrency(report.totalOwe)} tone="neg" />
            <div className="border-l-[0.5px] border-[var(--separator)]">
              <Stat label="You'll receive" value={formatCurrency(report.totalReceive)} tone="pos" />
            </div>
          </div>
          <div className="border-t-[0.5px] border-[var(--separator)] p-4">
            <div className="t-footnote mb-1.5 flex justify-between text-label-2">
              <span>Settled overall</span>
              <span className="font-semibold text-pos">{report.settledPct}%</span>
            </div>
            <Meter value={report.settledPct} label="Settled overall" />
            {!isSettled(report.offsetTotal) && (
              <p className="t-footnote mt-3 text-label-2">
                {formatCurrency(report.offsetTotal)} was cleared by cancelling balances across groups — no money
                changed hands.
              </p>
            )}
          </div>
        </Card>
      </Section>

      <Section header="By category">
        <BarRows
          buckets={report.byCategory}
          leading={(b) => <CategoryTile id={b.key} />}
          emptyLabel="No expenses yet."
        />
      </Section>

      <Section header="By group">
        <BarRows
          buckets={report.byGroup}
          leading={(b) => <GroupAvatar id={b.key} name={b.label} size={30} />}
          emptyLabel="No groups yet."
        />
      </Section>

      <Section header="Month by month">
        <BarRows buckets={report.byMonth} emptyLabel="No expenses yet." />
      </Section>

      {report.biggestExpense && (
        <Section header="Biggest single expense">
          <List>
            <div className="row is-tall" style={sepInset(58)}>
              <CategoryTile id={report.biggestExpense.category} />
              <span className="row-main">
                <span className="row-title font-semibold">{report.biggestExpense.description}</span>
                <span className="row-subtitle">
                  {report.biggestExpense.groupName} · paid by {report.biggestExpense.paidByName}
                </span>
              </span>
              <span className="num t-headline shrink-0">{formatCurrency(report.biggestExpense.amount)}</span>
            </div>
          </List>
        </Section>
      )}

      <Section footer="Every expense and payment in this view, as a spreadsheet.">
        <List>
          <RowButton
            onClick={() => void handleDownload()}
            disabled={busy}
            leading={<IconTile icon="square.and.arrow.down" color="var(--green)" />}
            title="Export CSV"
            action
            trailing={busy ? <Spinner size={18} className="text-label-2" /> : undefined}
          />
        </List>
      </Section>
    </>
  );
}
