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
import { groupItemLink } from "@/lib/statement";
import LoginScreen from "@/components/LoginScreen";
import ReportPanel from "@/components/activity/ReportPanel";
import Skeleton from "@/components/ui/Skeleton";
import Screen, { BarButton } from "@/components/ui/Screen";
import Menu from "@/components/ui/Menu";
import { ListSection } from "@/components/ui/List";
import { EmptyState, SearchField, Segmented } from "@/components/ui/Controls";
import { Arrows, CategoryGlyph, CheckCircle, ChevronRight, Clock, categoryTint } from "@/components/ui/Icons";

type Tab = "all" | "expenses" | "settlements" | "report";

const TABS: { id: Tab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "expenses", label: "Expenses" },
  { id: "settlements", label: "Payments" },
  { id: "report", label: "Summary" },
];

function dateBucket(ts: number): string {
  const now = new Date();
  const d = new Date(ts);
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return d.toLocaleDateString("en-IN", { weekday: "long" });
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  });
}

function ExpenseRow({ record }: { record: ExpenseRecord }) {
  return (
    <>
      <span className="icon-tile" style={{ background: categoryTint(record.category) }}>
        <CategoryGlyph id={record.category} size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block t-body text-[var(--text-primary)] truncate">{record.description}</span>
        <span className="block t-subhead text-[var(--text-secondary)] truncate mt-px">
          {record.groupName} · {record.paidByName} paid
          {record.edited ? " · Edited" : ""}
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block t-subhead font-semibold t-numeral text-[var(--text-primary)]">{formatCurrency(record.amount)}</span>
        {record.myShare > 0 && (
          <span className="block t-caption text-[var(--text-secondary)] t-numeral">yours {formatCurrency(record.myShare)}</span>
        )}
      </span>
    </>
  );
}

function SettlementRow({ record }: { record: SettlementRecord }) {
  const isOffset = record.settlementKind === "offset";
  const color =
    isOffset ? "var(--indigo)" : record.status === "approved" ? "var(--green)" : record.status === "pending" ? "var(--orange)" : "var(--gray)";
  const status =
    isOffset ? "Offset · no money moved" : record.status === "approved" ? "Settled" : record.status === "pending" ? "Waiting for approval" : "Declined";
  return (
    <>
      <span className="icon-tile" style={{ background: color }}>
        {isOffset ? <Arrows size={17} /> : <CheckCircle size={18} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block t-body text-[var(--text-primary)] truncate">
          {record.fromName} → {record.toName}
        </span>
        <span
          className={`block t-subhead truncate mt-px ${
            record.status === "pending" ? "text-[var(--warning)]" : record.status === "rejected" ? "text-[var(--neg)]" : "text-[var(--text-secondary)]"
          }`}
        >
          {status} <span className="text-[var(--text-secondary)]">· {record.groupName}{record.note ? ` · ${record.note}` : ""}</span>
        </span>
      </span>
      <span className="shrink-0 t-subhead font-semibold t-numeral text-[var(--text-primary)]">{formatCurrency(record.amount)}</span>
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

  if (loading) return <Screen title="Activity" large>{null}</Screen>;
  if (!user) return <LoginScreen />;

  const sections: { bucket: string; records: ActivityRecord[] }[] = [];
  for (const record of visible) {
    const bucket = dateBucket(record.ts);
    const last = sections[sections.length - 1];
    if (last && last.bucket === bucket) last.records.push(record);
    else sections.push({ bucket, records: [record] });
  }

  const scopeName = groupFilter === "all" ? "All Groups" : groups.find((g) => g.id === groupFilter)?.name || "Group";

  const stillLoading = !groupsLoaded || (groups.length > 0 && !allLoaded);

  return (
    <Screen
      title="Activity"
      large
      subtitle={groupFilter === "all" ? "Across all your groups" : scopeName}
      trailing={
        groups.length > 1 ? (
          <Menu
            label="Show activity from"
            items={[
              { label: "All Groups", checked: groupFilter === "all", onSelect: () => setGroupFilter("all") },
              { divider: true },
              ...groups.map((g) => ({ label: g.name, checked: groupFilter === g.id, onSelect: () => setGroupFilter(g.id) })),
            ]}
            trigger={(t) => (
              <BarButton {...t} text aria-label={`Filter: ${scopeName}`}>
                <span className="max-w-[140px] truncate">{groupFilter === "all" ? "Filter" : scopeName}</span>
              </BarButton>
            )}
          />
        ) : undefined
      }
    >
      <Segmented label="Activity views" value={tab} onChange={setTab} options={TABS} />

      {tab !== "report" && (groupScopedRecords.length > 8 || search !== "") && (
        <SearchField
          value={search}
          onChange={setSearch}
          placeholder="Search"
          label="Search activity"
          className="mt-3"
        />
      )}

      <div className="mt-4">
        {stillLoading && scopedRecords.length === 0 ? (
          <div className="list-section">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="list-row is-tall">
                <Skeleton className="w-[30px] h-[30px] rounded-[8px]" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-3/4 rounded-md" />
                  <Skeleton className="h-3 w-1/2 rounded-md" />
                </div>
              </div>
            ))}
          </div>
        ) : tab === "report" && report ? (
          <ReportPanel report={report} records={groupScopedRecords} />
        ) : sections.length === 0 ? (
          <EmptyState
            icon={<Clock size={56} weight={1.4} />}
            title={search ? "No Results" : "No Activity"}
            message={
              search
                ? `Nothing matches “${search}”.`
                : tab === "expenses"
                ? "Expenses added in any of your groups show up here."
                : tab === "settlements"
                ? "Payments and settle-ups show up here."
                : "Expenses and payments across your groups show up here."
            }
          />
        ) : (
          sections.map((section) => (
            <ListSection key={section.records[0].key} header={section.bucket} className="!mt-5 first:!mt-0">
              {section.records.map((record) => (
                <button
                  key={record.key}
                  type="button"
                  onClick={() => router.push(groupItemLink(record.groupId, { kind: record.kind, id: record.id }))}
                  className="list-row is-tall"
                  style={{ ["--sep-inset" as string]: "58px" }}
                >
                  {record.kind === "expense" ? <ExpenseRow record={record} /> : <SettlementRow record={record} />}
                  <ChevronRight className="row-chevron -mr-1" />
                </button>
              ))}
            </ListSection>
          ))
        )}
      </div>
    </Screen>
  );
}
