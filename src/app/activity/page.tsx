"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useGroupData } from "@/lib/group-data-context";
import { formatCurrency } from "@/lib/balance";
import {
  ActivityRecord,
  ExpenseRecord,
  SettlementRecord,
  buildActivityRecords,
  buildActivityReport,
} from "@/lib/report";
import LoginScreen from "@/components/LoginScreen";
import BottomNav from "@/components/home/BottomNav";
import ReportPanel from "@/components/activity/ReportPanel";
import Skeleton from "@/components/ui/Skeleton";

type Tab = "all" | "expenses" | "settlements" | "report";

const TABS: { id: Tab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "expenses", label: "Expenses" },
  { id: "settlements", label: "Payments" },
  { id: "report", label: "Report" },
];

function dateBucket(ts: number): string {
  const now = new Date();
  const d = new Date(ts);
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function timeLabel(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
}

function ExpenseRow({ record }: { record: ExpenseRecord }) {
  return (
    <>
      <span className="relative z-[1] w-9 h-9 rounded-full flex items-center justify-center shrink-0 bg-[var(--tint-accent-2)] text-[17px]">
        {record.categoryEmoji}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-[15px] text-[var(--text-primary)]">
          <span className="font-semibold">{record.paidByName}</span>
          <span className="text-[var(--text-tertiary)]"> paid for </span>
          <span className="font-semibold text-[var(--brand)]">{record.description}</span>
        </p>
        <p className="text-[13px] text-[var(--text-tertiary)] mt-0.5 truncate">
          {formatCurrency(record.amount)} · split {record.splitCount} way
          {record.splitCount !== 1 ? "s" : ""}
          {record.myShare > 0 ? ` · your share ${formatCurrency(record.myShare)}` : ""}
        </p>
        <div className="flex items-center gap-1.5 mt-1">
          <span className="inline-block rounded-full bg-[var(--fill)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-secondary)]">
            {record.groupName}
          </span>
          {record.edited && (
            <span className="inline-block rounded-full bg-[var(--tint-warning)] px-2 py-0.5 text-[11px] font-medium text-[var(--warning)]">
              edited
            </span>
          )}
        </div>
      </div>
    </>
  );
}

function SettlementRow({ record }: { record: SettlementRecord }) {
  const isOffset = record.settlementKind === "offset";
  const tone =
    record.status === "approved"
      ? "bg-[var(--tint-success)]"
      : record.status === "pending"
      ? "bg-[var(--tint-warning)]"
      : "bg-[var(--tint-danger-soft)]";
  const stroke =
    record.status === "approved"
      ? "var(--pos)"
      : record.status === "pending"
      ? "var(--warning)"
      : "var(--neg)";
  return (
    <>
      <span className={`relative z-[1] w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${tone}`}>
        {isOffset ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 8h13M7 8l3-3M7 8l3 3M17 16H4M17 16l-3-3M17 16l-3 3" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="m8.5 12 2.5 2.5 4.5-5" />
          </svg>
        )}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-[15px] text-[var(--text-primary)]">
          {isOffset ? (
            <>
              <span className="text-[var(--text-tertiary)]">Cross-group offset between </span>
              <span className="font-semibold">{record.fromName}</span>
              <span className="text-[var(--text-tertiary)]"> and </span>
              <span className="font-semibold">{record.toName}</span>
            </>
          ) : record.status === "approved" ? (
            <>
              <span className="font-semibold">{record.fromName}</span>
              <span className="text-[var(--text-tertiary)]"> paid </span>
              <span className="font-semibold text-[var(--pos)]">{record.toName}</span>
            </>
          ) : record.status === "pending" ? (
            <>
              <span className="font-semibold">{record.fromName}</span>
              <span className="text-[var(--text-tertiary)]"> → </span>
              <span className="font-semibold">{record.toName}</span>
              <span className="text-[var(--text-tertiary)]"> awaiting approval</span>
            </>
          ) : (
            <>
              <span className="font-semibold">{record.fromName}</span>
              <span className="text-[var(--text-tertiary)]"> → {record.toName} declined</span>
            </>
          )}
        </p>
        <p className="text-[13px] text-[var(--text-tertiary)] mt-0.5 truncate">
          {formatCurrency(record.amount)}
          {isOffset ? " · no money moved" : ""}
          {record.note ? ` · ${record.note}` : ""}
        </p>
        <span className="inline-block mt-1 rounded-full bg-[var(--fill)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-secondary)]">
          {record.groupName}
        </span>
      </div>
    </>
  );
}

export default function ActivityPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const { groups, groupsLoaded, datasets, allLoaded } = useGroupData();
  const [tab, setTab] = useState<Tab>("all");
  const [groupFilter, setGroupFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const uid = user?.uid;

  const allRecords = useMemo(
    () => (uid ? buildActivityRecords(uid, datasets) : []),
    [uid, datasets]
  );

  const scopedDatasets = useMemo(
    () =>
      groupFilter === "all"
        ? datasets
        : datasets.filter((d) => d.group.id === groupFilter),
    [datasets, groupFilter]
  );

  // Records in scope for the report: filtered by group only. Mixing the text
  // search in here would produce a report whose spend totals were filtered but
  // whose balances and settled-% (derived from the full ledger) were not.
  const groupScopedRecords = useMemo(
    () =>
      groupFilter === "all"
        ? allRecords
        : allRecords.filter((r) => r.groupId === groupFilter),
    [allRecords, groupFilter]
  );

  const scopedRecords = useMemo(() => {
    const term = search.trim().toLowerCase();
    return allRecords.filter((r) => {
      if (groupFilter !== "all" && r.groupId !== groupFilter) return false;
      if (!term) return true;
      if (r.kind === "expense") {
        return (
          r.description.toLowerCase().includes(term) ||
          r.categoryLabel.toLowerCase().includes(term) ||
          r.paidByName.toLowerCase().includes(term) ||
          r.groupName.toLowerCase().includes(term)
        );
      }
      return (
        r.fromName.toLowerCase().includes(term) ||
        r.toName.toLowerCase().includes(term) ||
        r.groupName.toLowerCase().includes(term) ||
        (r.note || "").toLowerCase().includes(term)
      );
    });
  }, [allRecords, groupFilter, search]);

  const report = useMemo(
    () => (uid ? buildActivityReport(uid, scopedDatasets, groupScopedRecords) : null),
    [uid, scopedDatasets, groupScopedRecords]
  );

  const visible: ActivityRecord[] = useMemo(() => {
    if (tab === "expenses") return scopedRecords.filter((r) => r.kind === "expense");
    if (tab === "settlements") return scopedRecords.filter((r) => r.kind === "settlement");
    return scopedRecords;
  }, [scopedRecords, tab]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-[var(--label-tertiary)]">Loading…</p>
      </div>
    );
  }
  if (!user) return <LoginScreen />;

  const rows = visible.map((record, i) => {
    const bucket = dateBucket(record.ts);
    const prevBucket = i > 0 ? dateBucket(visible[i - 1].ts) : null;
    return { record, bucket, showBucket: bucket !== prevBucket };
  });

  const expenseCount = scopedRecords.filter((r) => r.kind === "expense").length;
  const settlementCount = scopedRecords.filter((r) => r.kind === "settlement").length;
  const counts: Record<Tab, number | null> = {
    all: scopedRecords.length,
    expenses: expenseCount,
    settlements: settlementCount,
    report: null,
  };

  const stillLoading = !groupsLoaded || (groups.length > 0 && !allLoaded);

  return (
    <div className="flex-1 flex flex-col bg-[var(--background)] min-h-full">
      <main className="flex-1 max-w-md w-full mx-auto px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-32 scroll-momentum">
        <div className="flex items-center justify-between pt-3">
          <h1 className="text-[30px] font-extrabold text-[var(--text-primary)]">Activity</h1>
          <button
            onClick={() => router.push("/settings")}
            aria-label="Settings"
            className="w-11 h-11 rounded-2xl bg-[var(--surface)] shadow-[var(--shadow-button)] flex items-center justify-center tap-shrink"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="1.8">
              <path d="M12 15a3 3 0 100-6 3 3 0 000 6z" />
              <path d="M19.4 13a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V19a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H4a2 2 0 110-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33h0a1.65 1.65 0 001-1.51V4a2 2 0 114 0v.09a1.65 1.65 0 001 1.51h0a1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82v0a1.65 1.65 0 001.51 1H20a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" />
            </svg>
          </button>
        </div>
        <p className="text-[15px] text-[var(--text-tertiary)] mt-1 mb-4">
          Everything happening across your groups
        </p>

        {/* Tabs */}
        <div
          role="tablist"
          aria-label="Activity views"
          className="flex gap-1 bg-[var(--fill-soft)] rounded-full p-1"
        >
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t.id)}
                className={`flex-1 rounded-full py-2 text-[13px] font-semibold tap-shrink transition ${
                  active
                    ? "bg-[var(--surface)] text-[var(--brand)] shadow-[var(--shadow-sm)]"
                    : "text-[var(--text-secondary)]"
                }`}
              >
                {t.label}
                {counts[t.id] !== null && counts[t.id]! > 0 && (
                  <span className="ml-1 text-[11px] opacity-70">{counts[t.id]}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Group filter */}
        {groups.length > 1 && (
          <div className="flex gap-2 overflow-x-auto scroll-momentum -mx-4 px-4 mt-3 pb-1">
            <button
              onClick={() => setGroupFilter("all")}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-medium tap-shrink ${
                groupFilter === "all"
                  ? "bg-[var(--brand-solid)] text-white"
                  : "bg-[var(--surface)] text-[var(--text-secondary)] shadow-[var(--shadow-sm)]"
              }`}
            >
              All groups
            </button>
            {groups.map((g) => (
              <button
                key={g.id}
                onClick={() => setGroupFilter(g.id)}
                className={`shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-medium tap-shrink max-w-[10rem] truncate ${
                  groupFilter === g.id
                    ? "bg-[var(--brand-solid)] text-white"
                    : "bg-[var(--surface)] text-[var(--text-secondary)] shadow-[var(--shadow-sm)]"
                }`}
              >
                {g.name}
              </button>
            ))}
          </div>
        )}

        {/* Search (list tabs only) */}
        {tab !== "report" && (
          <div className="mt-3">
            <div className="flex items-center gap-2.5 bg-[var(--fill)] rounded-full px-4 h-11">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-[var(--text-tertiary)]" strokeWidth="2" strokeLinecap="round">
                <circle cx="11" cy="11" r="7" />
                <path d="m21 21-4.3-4.3" />
              </svg>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={tab === "settlements" ? "Search payments…" : "Search expenses, people…"}
                className="flex-1 bg-transparent outline-none text-[15px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  aria-label="Clear search"
                  className="text-[var(--text-tertiary)] text-lg leading-none tap-shrink"
                >
                  ×
                </button>
              )}
            </div>
          </div>
        )}

        <div className="mt-4">
          {stillLoading && scopedRecords.length === 0 ? (
            <div className="space-y-3">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex items-start gap-3">
                  <Skeleton className="w-9 h-9 rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-4 w-3/4 rounded-md" />
                    <Skeleton className="h-3 w-1/2 rounded-md" />
                  </div>
                </div>
              ))}
            </div>
          ) : tab === "report" && report ? (
            <ReportPanel report={report} records={groupScopedRecords} />
          ) : rows.length === 0 ? (
            <p className="text-center text-[var(--text-tertiary)] text-sm py-20">
              {search
                ? "Nothing matches your search."
                : tab === "expenses"
                ? "No expenses yet."
                : tab === "settlements"
                ? "No payments yet."
                : "No activity yet."}
            </p>
          ) : (
            <div className="relative">
              <div className="absolute left-[18px] top-2 bottom-2 w-px bg-[var(--fill)]" aria-hidden />
              <div className="space-y-1">
                {rows.map(({ record, bucket, showBucket }) => (
                  <div key={record.key}>
                    {showBucket && (
                      <div className="relative z-[1] inline-block bg-[var(--background)] rounded-full px-2.5 py-0.5 my-1.5 ml-0.5">
                        <span className="text-[12px] font-medium text-[var(--text-secondary)]">
                          {bucket}
                        </span>
                      </div>
                    )}
                    <button
                      onClick={() => router.push(`/groups/${record.groupId}`)}
                      className="w-full text-left relative flex items-start gap-3 py-1.5 tap-shrink"
                    >
                      {record.kind === "expense" ? (
                        <ExpenseRow record={record} />
                      ) : (
                        <SettlementRow record={record} />
                      )}
                      <span className="text-[12px] text-[var(--text-tertiary)] shrink-0">
                        {timeLabel(record.ts)}
                      </span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>

      <BottomNav active="activity" />
    </div>
  );
}
