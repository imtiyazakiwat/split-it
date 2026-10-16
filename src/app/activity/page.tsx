"use client";

import { useMemo, useState } from "react";
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
import Screen from "@/components/kit/Screen";
import { BarButton } from "@/components/kit/BarButton";
import { Menu } from "@/components/kit/Menu";
import { List, RowLink, Section, sepInset } from "@/components/kit/List";
import { CategoryTile, IconTile } from "@/components/kit/Tile";
import { EmptyState, SearchField, Segmented } from "@/components/kit/Controls";
import { Icon } from "@/components/kit/Icon";

type Tab = "all" | "expenses" | "settlements" | "report";

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
    year: d.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

function timeLabel(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
}

function ExpenseRow({ record }: { record: ExpenseRecord }) {
  return (
    <RowLink
      href={groupItemLink(record.groupId, { kind: "expense", id: record.id })}
      inset="tile"
      tall
      chevron={false}
      leading={<CategoryTile id={record.category} />}
      title={record.description}
      subtitle={
        <>
          {record.paidByName} paid · {record.groupName}
          {record.edited ? " · edited" : ""}
        </>
      }
      trailing={
        <span className="flex shrink-0 flex-col items-end">
          <span className="num t-subhead font-semibold">{formatCurrency(record.amount)}</span>
          <span className="t-caption text-label-2">
            {record.myShare > 0 ? `your share ${formatCurrency(record.myShare)}` : timeLabel(record.ts)}
          </span>
        </span>
      }
    />
  );
}

function SettlementRow({ record }: { record: SettlementRecord }) {
  const isOffset = record.settlementKind === "offset";
  const tile = isOffset ? (
    <IconTile icon="arrow.left.right" color="var(--indigo)" />
  ) : record.status === "approved" ? (
    <IconTile icon="checkmark" color="var(--green)" />
  ) : record.status === "pending" ? (
    <IconTile icon="clock" color="var(--orange)" />
  ) : (
    <IconTile icon="xmark" color="var(--gray)" />
  );
  const title = isOffset
    ? `${record.fromName} ⇄ ${record.toName}`
    : `${record.fromName} paid ${record.toName}`;
  const status = isOffset
    ? "Offset · no money moved"
    : record.status === "approved"
    ? "Settled"
    : record.status === "pending"
    ? "Awaiting approval"
    : "Declined";
  return (
    <RowLink
      href={groupItemLink(record.groupId, { kind: "settlement", id: record.id })}
      inset="tile"
      tall
      chevron={false}
      leading={tile}
      title={title}
      subtitle={
        <>
          <span className={record.status === "pending" && !isOffset ? "text-warn" : undefined}>{status}</span>
          {` · ${record.groupName}`}
          {record.note ? ` · ${record.note}` : ""}
        </>
      }
      trailing={
        <span className="flex shrink-0 flex-col items-end">
          <span
            className={`num t-subhead font-semibold ${record.status === "rejected" ? "text-label-3 line-through" : ""}`}
          >
            {formatCurrency(record.amount)}
          </span>
          <span className="t-caption text-label-2">{timeLabel(record.ts)}</span>
        </span>
      }
    />
  );
}

export default function ActivityPage() {
  const { user, loading } = useAuth();
  const { groups, groupsLoaded, datasets, allLoaded } = useGroupData();
  const [tab, setTab] = useState<Tab>("all");
  const [groupFilter, setGroupFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const uid = user?.uid;

  const allRecords = useMemo(() => (uid ? buildActivityRecords(uid, datasets) : []), [uid, datasets]);

  const scopedDatasets = useMemo(
    () => (groupFilter === "all" ? datasets : datasets.filter((d) => d.group.id === groupFilter)),
    [datasets, groupFilter]
  );

  // Records in scope for the report: filtered by group only. Mixing the text
  // search in would give a report whose spend totals were filtered but whose
  // balances and settled-% (from the full ledger) were not.
  const groupScopedRecords = useMemo(
    () => (groupFilter === "all" ? allRecords : allRecords.filter((r) => r.groupId === groupFilter)),
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
      <Screen title="Activity" large tabBar>
        <ActivitySkeleton />
      </Screen>
    );
  }
  if (!user) return <LoginScreen />;

  const buckets: { label: string; records: ActivityRecord[] }[] = [];
  for (const record of visible) {
    const label = dateBucket(record.ts);
    const last = buckets[buckets.length - 1];
    if (last && last.label === label) last.records.push(record);
    else buckets.push({ label, records: [record] });
  }

  const stillLoading = !groupsLoaded || (groups.length > 0 && !allLoaded);
  const filteredGroup = groupFilter === "all" ? null : groups.find((g) => g.id === groupFilter);

  return (
    <Screen
      title="Activity"
      large
      tabBar
      trailing={
        groups.length > 1 ? (
          <Menu
            title="Show activity from"
            items={[
              { label: "All Groups", checked: groupFilter === "all", onSelect: () => setGroupFilter("all") },
              "separator",
              ...groups.map((g) => ({
                label: g.name,
                checked: groupFilter === g.id,
                onSelect: () => setGroupFilter(g.id),
              })),
            ]}
          >
            {(props) => (
              <BarButton
                icon="line.3.decrease"
                label={filteredGroup ? `Filtered by ${filteredGroup.name}. Change filter` : "Filter by group"}
                className={filteredGroup ? "!text-tint" : ""}
                {...props}
              />
            )}
          </Menu>
        ) : undefined
      }
    >
      <Segmented
        label="Activity views"
        value={tab}
        onChange={setTab}
        options={[
          { id: "all", label: "All" },
          { id: "expenses", label: "Expenses" },
          { id: "settlements", label: "Payments" },
          { id: "report", label: "Report" },
        ]}
      />

      {filteredGroup && (
        <div className="mt-3 flex">
          <button
            type="button"
            onClick={() => setGroupFilter("all")}
            className="capsule is-tint h-8 gap-1.5 px-3 text-[13px]"
            aria-label={`Showing only ${filteredGroup.name}. Show all groups`}
          >
            <span className="max-w-[60vw] truncate">{filteredGroup.name}</span>
            <Icon name="xmark" size={12} strokeWidth={3} />
          </button>
        </div>
      )}

      {tab !== "report" && (
        <SearchField
          value={search}
          onChange={setSearch}
          placeholder={tab === "settlements" ? "Search payments" : "Search expenses, people, groups"}
          label="Search activity"
          className="mt-3"
        />
      )}

      {stillLoading && scopedRecords.length === 0 ? (
        <div className="section">
          <ActivitySkeleton />
        </div>
      ) : tab === "report" && report ? (
        <div className="mt-4">
          <ReportPanel report={report} records={groupScopedRecords} />
        </div>
      ) : buckets.length === 0 ? (
        <div className="card mt-4">
          <EmptyState
            compact
            icon={search ? "magnifyingglass" : "clock"}
            title={search ? "No Results" : tab === "expenses" ? "No Expenses Yet" : tab === "settlements" ? "No Payments Yet" : "No Activity Yet"}
            message={
              search
                ? `Nothing matches “${search}”.`
                : "Expenses and payments from all your groups show up here as they happen."
            }
          />
        </div>
      ) : (
        buckets.map((bucket) => (
          <Section key={bucket.label} header={bucket.label}>
            <List>
              {bucket.records.map((record) =>
                record.kind === "expense" ? (
                  <ExpenseRow key={record.key} record={record} />
                ) : (
                  <SettlementRow key={record.key} record={record} />
                )
              )}
            </List>
          </Section>
        ))
      )}
    </Screen>
  );
}

function ActivitySkeleton() {
  return (
    <div className="card list" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="row is-tall" style={sepInset(58)}>
          <Skeleton className="h-[30px] w-[30px] rounded-[8px]" />
          <div className="flex-1">
            <Skeleton className="h-4 w-3/4 rounded-md" />
            <Skeleton className="mt-2 h-3 w-1/2 rounded-md" />
          </div>
        </div>
      ))}
    </div>
  );
}
