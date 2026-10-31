"use client";
import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useGroupData } from "@/lib/group-data-context";
import { usePayments } from "@/lib/payments-context";
import { computeCounterpartyBalances, GroupDataset } from "@/lib/global-balance";
import { summariseSpending } from "@/lib/spending";
import { buildPairStatement, describeNet, PairStatement, StatementRow } from "@/lib/statement";
import { formatCurrency } from "@/lib/balance";
import { isSettled } from "@/lib/money";
import { toCsv, downloadTextFile } from "@/lib/report";
import { Expense, Group, Settlement } from "@/lib/types";
import LoginScreen from "@/components/LoginScreen";
import { useToast } from "@/components/ui/Toast";
import Screen, { BarButton } from "@/components/ui/Screen";
import Menu from "@/components/ui/Menu";
import { ButtonRow, LinkRow, ListSection, Row } from "@/components/ui/List";
import { Avatar, EmptyState, Segmented } from "@/components/ui/Controls";
import { Doc, Download, Ellipsis } from "@/components/ui/Icons";
import Skeleton from "@/components/ui/Skeleton";

const ALL = "all";

function fullDate(ts: number): string {
  return new Date(ts).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

/** Khatabook wording: money you put in is "You gave", money back is "You got". */
function rowWording(row: StatementRow, otherName: string): string {
  switch (row.kind) {
    case "expense-i-paid":
      return `You paid for this · ${otherName}'s share`;
    case "expense-they-paid":
      return `${otherName} paid for this · your share`;
    case "payment-i-sent":
      return row.informationalOnly ? `You sent a payment · ${row.status}` : "You settled up";
    case "payment-they-sent":
      return row.informationalOnly ? `${otherName} sent a payment · ${row.status}` : `${otherName} settled up`;
    case "direct-i-sent":
      if (row.informationalOnly) return `You sent a direct payment · ${row.status}`;
      if ((row.allocatedAmount || 0) > 0)
        return `Direct payment · ${formatCurrency(row.allocatedAmount || 0)} counted in groups`;
      return "Direct payment · personal";
    case "direct-they-sent":
      if (row.informationalOnly) return `${otherName} sent a direct payment · ${row.status}`;
      if ((row.allocatedAmount || 0) > 0)
        return `Direct payment · ${formatCurrency(row.allocatedAmount || 0)} counted in groups`;
      return "Direct payment · personal";
  }
}

function StatementTable({ stmt, otherName }: { stmt: PairStatement; otherName: string }) {
  if (stmt.rows.length === 0) {
    return (
      <ListSection header="Entries">
        <Row title={<span className="text-[var(--text-secondary)]">Nothing shared with {otherName} here yet</span>} />
      </ListSection>
    );
  }
  const gave = stmt.rows.filter((r) => r.delta > 0).reduce((s, r) => s + r.delta, 0);
  const got = stmt.rows.filter((r) => r.delta < 0).reduce((s, r) => s - r.delta, 0);
  return (
    <>
      <ListSection header={`${stmt.rows.length} ${stmt.rows.length === 1 ? "Entry" : "Entries"}`}>
        {[...stmt.rows].reverse().map((row) => (
          <div key={row.key} className="list-row is-tall !items-start">
            <span className="min-w-0 flex-1">
              <span className="block t-body text-[var(--text-primary)] truncate">{row.label}</span>
              <span className="block t-subhead text-[var(--text-secondary)] mt-px">{rowWording(row, otherName)}</span>
              <span className="block t-footnote text-[var(--text-secondary)] mt-0.5">
                {fullDate(row.ts)} ·{" "}
                {isSettled(row.balance)
                  ? "settled"
                  : row.balance > 0
                  ? `${otherName} owes you ${formatCurrency(row.balance)}`
                  : `you owe ${formatCurrency(-row.balance)}`}
              </span>
            </span>
            <span className="shrink-0 text-right pt-px">
              {row.delta > 0.001 ? (
                <>
                  <span className="block t-caption text-[var(--text-secondary)]">you gave</span>
                  <span className="block t-subhead font-semibold t-numeral text-[var(--pos)]">{formatCurrency(row.delta)}</span>
                </>
              ) : row.delta < -0.001 ? (
                <>
                  <span className="block t-caption text-[var(--text-secondary)]">you got</span>
                  <span className="block t-subhead font-semibold t-numeral text-[var(--neg)]">{formatCurrency(-row.delta)}</span>
                </>
              ) : (
                <span className="block t-subhead text-[var(--text-secondary)]">—</span>
              )}
            </span>
          </div>
        ))}
      </ListSection>
      <ListSection header="Totals">
        <Row title="You gave" detail={<span className="t-numeral text-[var(--pos)]">{formatCurrency(gave)}</span>} />
        <Row title="You got" detail={<span className="t-numeral text-[var(--neg)]">{formatCurrency(got)}</span>} />
      </ListSection>
    </>
  );
}

/** Proportion row used by the category and payer breakdowns. */
function SpendBar({
  label,
  value,
  max,
  sub,
}: {
  label: string;
  emoji?: string;
  value: number;
  max: number;
  sub?: string;
}) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div className="list-row !block">
      <div className="flex items-baseline justify-between gap-3">
        <span className="t-body text-[var(--text-primary)] truncate">{label}</span>
        <span className="t-body font-semibold t-numeral text-[var(--text-primary)] shrink-0">{formatCurrency(value)}</span>
      </div>
      <div className="meter mt-2 !h-[6px]">
        <span style={{ width: `${pct}%`, background: "var(--brand-solid)" }} />
      </div>
      {sub && <p className="t-footnote text-[var(--text-secondary)] mt-1.5">{sub}</p>}
    </div>
  );
}

/** A pop-up menu row: label left, current value + up/down chevrons right. */
function PickerRow({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (id: string) => void;
  options: { id: string; name: string }[];
}) {
  const current = options.find((o) => o.id === value)?.name ?? options[0]?.name;
  return (
    <Menu
      label={label}
      align="right"
      items={options.map((o) => ({ label: o.name, checked: o.id === value, onSelect: () => onChange(o.id) }))}
      trigger={(t) => (
        <button {...t} type="button" className="list-row">
          <span className="flex-1 t-body text-[var(--text-primary)]">{label}</span>
          <span className="t-body text-[var(--text-secondary)] truncate max-w-[55%] flex items-center gap-1">
            {current}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="m7 9 5-5 5 5M7 15l5 5 5-5" />
            </svg>
          </span>
        </button>
      )}
    />
  );
}

/**
 * Spending dashboard: pick a group, optionally pick a person, see what was
 * spent. With a person selected the figures cover only the expenses the two of
 * you shared, which is a different question from "what did this group spend".
 */
function SpendingDashboard({
  meUid,
  groups,
  datasets,
}: {
  meUid: string;
  groups: Group[];
  datasets: GroupDataset[];
}) {
  const [groupId, setGroupId] = useState("all");
  const [personUid, setPersonUid] = useState("all");

  const scopedGroups = groupId === "all" ? groups : groups.filter((g) => g.id === groupId);
  const expenses = scopedGroups.flatMap(
    (g) => datasets.find((d) => d.group.id === g.id)?.expenses ?? []
  );

  // Everyone who shares one of the groups in scope.
  const peopleMap = new Map<string, string>();
  for (const g of scopedGroups) {
    for (const uid of g.memberIds || []) {
      if (uid === meUid) continue;
      peopleMap.set(uid, g.members?.[uid]?.displayName || "Member");
    }
  }
  const people = Array.from(peopleMap, ([id, name]) => ({ id, name })).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  // Switching group can strip out the person who was selected; fall back to
  // everyone rather than reporting zero against someone who isn't here.
  const activePerson = personUid !== "all" && peopleMap.has(personUid) ? personUid : null;
  const summary = summariseSpending(meUid, expenses, activePerson);
  const otherName = activePerson ? peopleMap.get(activePerson) : null;
  const maxCategory = summary.byCategory[0]?.total ?? 0;
  const maxPayer = summary.byPayer[0]?.paid ?? 0;
  const nameOf = (uid: string) =>
    uid === meUid ? "You" : peopleMap.get(uid) || "Former member";

  return (
    <div>
      <ListSection className="!mt-4">
        <PickerRow
          label="Group"
          value={groupId}
          onChange={setGroupId}
          options={[{ id: "all", name: "All Groups" }, ...groups.map((g) => ({ id: g.id, name: g.name }))]}
        />
        {people.length > 0 && (
          <PickerRow
            label="Spent With"
            value={activePerson ?? "all"}
            onChange={setPersonUid}
            options={[{ id: "all", name: "Everyone" }, ...people]}
          />
        )}
      </ListSection>

      <div className="list-section px-4 pt-3.5 pb-4 mt-5">
        <p className="t-subhead text-[var(--text-secondary)] truncate">
          {otherName ? `Shared with ${otherName}` : "Total spent"}
          {groupId !== "all" && scopedGroups[0] ? ` · ${scopedGroups[0].name}` : ""}
        </p>
        <p className="t-large-title t-numeral text-[var(--text-primary)] truncate">{formatCurrency(summary.total)}</p>
        <p className="t-footnote text-[var(--text-secondary)]">
          {summary.expenseCount} expense{summary.expenseCount !== 1 ? "s" : ""}
          {summary.expenseCount > 0 && ` · ${formatCurrency(summary.average)} average`}
          {summary.firstTs && summary.lastTs ? ` · ${fullDate(summary.firstTs)} – ${fullDate(summary.lastTs)}` : ""}
        </p>
      </div>

      {summary.expenseCount > 0 && (
        <ListSection>
          <Row title="Your share" detail={<span className="t-numeral">{formatCurrency(summary.myShare)}</span>} />
          <Row title="You paid up front" detail={<span className="t-numeral">{formatCurrency(summary.iPaid)}</span>} />
          {otherName && (
            <>
              <Row title={`${otherName}’s share`} detail={<span className="t-numeral">{formatCurrency(summary.theirShare)}</span>} />
              <Row title={`${otherName} paid up front`} detail={<span className="t-numeral">{formatCurrency(summary.theyPaid)}</span>} />
            </>
          )}
        </ListSection>
      )}

      {summary.expenseCount === 0 ? (
        <EmptyState
          icon={<Doc size={52} weight={1.4} />}
          title="No Expenses"
          message={otherName ? `No expenses shared with ${otherName} in this scope yet.` : "No expenses in this scope yet."}
        />
      ) : (
        <>
          <ListSection header="Where it went">
            {summary.byCategory.map((c) => (
              <SpendBar
                key={c.id}
                label={c.label}
                value={c.total}
                max={maxCategory}
                sub={`${c.count} expense${c.count !== 1 ? "s" : ""} · your share ${formatCurrency(c.myShare)}`}
              />
            ))}
          </ListSection>
          <ListSection header="Who paid">
            {summary.byPayer.map((p) => (
              <SpendBar
                key={p.uid}
                label={nameOf(p.uid)}
                value={p.paid}
                max={maxPayer}
                sub={`paid for ${p.count} expense${p.count !== 1 ? "s" : ""}`}
              />
            ))}
          </ListSection>
        </>
      )}
    </div>
  );
}

function ReportsInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { user, loading } = useAuth();
  const { groups, datasets, allLoaded, groupsLoaded } = useGroupData();
  const { transfers } = usePayments();
  const showToast = useToast();
  const personParam = params.get("person");
  const groupParam = params.get("group");
  const tabParam = params.get("tab") === "spending" ? "spending" : "statements";
  // Switching person keeps this component mounted, so a scope left over from the
  // previous person would carry across: if that group isn't shared with the new
  // person the statement renders empty, and when they share fewer than two groups
  // the chip row is hidden, leaving no way to clear it. Tagging the choice with
  // the person it was made for lets it expire by derivation.
  const [pickedScope, setPickedScope] = useState<{ person: string | null; value: string } | null>(null);
  const scope = pickedScope?.person === personParam ? pickedScope.value : groupParam || ALL;
  const setScope = (value: string) => setPickedScope({ person: personParam, value });

  const uid = user?.uid;
  const counterparties = useMemo(
    () => (uid ? computeCounterpartyBalances(uid, datasets, transfers) : []),
    [uid, datasets, transfers]
  );

  if (loading || (!groupsLoaded && user)) {
    return (
      <Screen title="Statements" large>
        <div className="list-section">
          {[0, 1, 2].map((i) => (
            <div key={i} className="list-row is-tall">
              <Skeleton className="w-10 h-10 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-1/2 rounded-md" />
                <Skeleton className="h-3 w-2/3 rounded-md" />
              </div>
            </div>
          ))}
        </div>
      </Screen>
    );
  }
  if (!user) return <LoginScreen />;
  const meUid = user.uid;

  // ── Person list ────────────────────────────────────────────
  if (!personParam) {
    const people = counterparties.filter(
      (c) => c.sharedGroupCount > 0 || !isSettled(c.directNet || 0)
    );
    return (
      <Screen title="Statements" large>
        <Segmented
          label="Statements view"
          value={tabParam}
          onChange={(id) => router.replace(id === "spending" ? "/reports?tab=spending" : "/reports", { scroll: false })}
          options={[
            { id: "statements", label: "People" },
            { id: "spending", label: "Spending" },
          ]}
        />
        {tabParam === "spending" ? (
          <SpendingDashboard meUid={meUid} groups={groups} datasets={datasets} />
        ) : people.length === 0 ? (
          <EmptyState
            icon={<Doc size={56} weight={1.4} />}
            title="No Statements"
            message="Add an expense in a group and a running account with each person shows up here."
          />
        ) : (
          <ListSection
            className="!mt-4"
            footer={
              !allLoaded
                ? "Still loading every group…"
                : "A running account with each person: who paid for what, and what’s left between you."
            }
          >
            {people.map((p) => (
              <LinkRow
                key={p.uid}
                href={`/reports?person=${p.uid}`}
                tall
                leading={<Avatar name={p.displayName} photoURL={p.photoURL} size={40} seed={p.uid} />}
                separatorInset={68}
                title={p.displayName}
                subtitle={
                  p.sharedGroupCount > 0
                    ? `${p.sharedGroupCount} shared group${p.sharedGroupCount !== 1 ? "s" : ""}`
                    : "Direct payments"
                }
                detail={
                  isSettled(p.net) ? (
                    "Settled"
                  ) : (
                    <span className="flex flex-col items-end leading-tight">
                      <span className="t-caption text-[var(--text-secondary)]">{p.net > 0 ? "you owe" : "owes you"}</span>
                      <span className={`t-subhead font-semibold t-numeral ${p.net > 0 ? "text-[var(--neg)]" : "text-[var(--pos)]"}`}>
                        {formatCurrency(Math.abs(p.net))}
                      </span>
                    </span>
                  )
                }
              />
            ))}
          </ListSection>
        )}
      </Screen>
    );
  }

  // ── One person's statement ─────────────────────────────────
  const person = counterparties.find((c) => c.uid === personParam);
  const otherName = person?.displayName || "This person";
  const sharedGroups = groups.filter((g) => g.memberIds?.includes(personParam) && g.memberIds?.includes(meUid));
  // Second guard, for the render that happens before the reset effect commits:
  // a scope this person doesn't share falls back to showing every shared group.
  const effectiveScope =
    scope === ALL || sharedGroups.some((g) => g.id === scope) ? scope : ALL;
  const scopedGroups =
    effectiveScope === ALL ? sharedGroups : sharedGroups.filter((g) => g.id === effectiveScope);

  const expenses: Expense[] = [];
  const settlements: Settlement[] = [];
  for (const g of scopedGroups) {
    const d = datasets.find((x) => x.group.id === g.id);
    if (!d) continue;
    expenses.push(...d.expenses);
    settlements.push(...d.settlements);
  }
  // Direct payments belong to no group: show them when viewing all shared
  // groups, hide them when scoped to one group.
  const scopedTransfers = effectiveScope === ALL ? transfers : [];
  const stmt = buildPairStatement(meUid, personParam, expenses, settlements, scopedTransfers);

  async function handleDownload() {
    const rows: (string | number)[][] = [
      ["Statement between", user?.displayName || "You", "and", otherName],
      ["Scope", effectiveScope === ALL ? "All shared groups" : scopedGroups[0]?.name || ""],
      [],
      ["Date", "Details", "What happened", "You gave", "You got", "Balance after", "Who owes"],
    ];
    for (const row of stmt.rows) {
      rows.push([
        fullDate(row.ts),
        row.label,
        rowWording(row, otherName),
        row.delta > 0.001 ? row.delta : "",
        row.delta < -0.001 ? -row.delta : "",
        Math.abs(row.balance).toFixed(2),
        isSettled(row.balance) ? "settled" : row.balance > 0 ? `${otherName} owes you` : `you owe ${otherName}`,
      ]);
    }
    rows.push([]);
    rows.push(["Final", describeNet(stmt.net, otherName, formatCurrency)]);
    try {
      await downloadTextFile(`statement-${otherName.replace(/\s+/g, "-").toLowerCase()}.csv`, toCsv(rows));
    } catch {
      showToast({ message: "Couldn't export the statement" });
    }
  }

  return (
    <Screen
      title={otherName}
      backHref="/reports"
      inlineTitleAfter={90}
      trailing={
        stmt.rows.length > 0 ? (
          <Menu
            label="Statement actions"
            items={[{ label: "Export CSV", icon: <Download size={20} />, onSelect: handleDownload }]}
            trigger={(t) => (
              <BarButton {...t} aria-label="More">
                <Ellipsis size={21} />
              </BarButton>
            )}
          />
        ) : undefined
      }
    >
      <div className="flex flex-col items-center text-center pt-1 pb-4">
        <Avatar name={otherName} photoURL={person?.photoURL} size={72} seed={personParam} />
        <h1 className="t-title2 text-[var(--text-primary)] mt-2.5 max-w-full truncate px-4">{otherName}</h1>
        <p
          className={`t-headline mt-1 ${
            isSettled(stmt.net) ? "text-[var(--text-secondary)]" : stmt.net > 0 ? "text-[var(--pos)]" : "text-[var(--neg)]"
          }`}
        >
          {describeNet(stmt.net, otherName, formatCurrency)}
        </p>
      </div>

      {sharedGroups.length > 1 && (
        <ListSection className="!mt-0">
          <PickerRow
            label="Groups"
            value={effectiveScope}
            onChange={setScope}
            options={[{ id: ALL, name: "All Shared Groups" }, ...sharedGroups.map((g) => ({ id: g.id, name: g.name }))]}
          />
        </ListSection>
      )}

      <ListSection
        footer={
          !isSettled(stmt.pendingFromMe) || !isSettled(stmt.pendingFromThem)
            ? "A payment is still waiting to be approved, so it isn’t counted here."
            : undefined
        }
      >
        <Row title={`You covered for ${otherName}`} detail={<span className="t-numeral">{formatCurrency(stmt.iCoveredForThem)}</span>} />
        <Row title={`${otherName} covered for you`} detail={<span className="t-numeral">{formatCurrency(stmt.theyCoveredForMe)}</span>} />
        {!isSettled(stmt.directNet || 0) && (
          <Row
            title="Direct (not in a group)"
            subtitle={stmt.directNet > 0 ? `${otherName} owes you` : `You owe ${otherName}`}
            detail={<span className="t-numeral">{formatCurrency(Math.abs(stmt.directNet))}</span>}
          />
        )}
      </ListSection>

      <StatementTable stmt={stmt} otherName={otherName} />

      {stmt.rows.length > 0 && (
        <ListSection>
          <ButtonRow
            onClick={handleDownload}
            leading={<span className="text-[var(--brand)]"><Download size={20} /></span>}
            title="Export Statement"
            action
          />
        </ListSection>
      )}
    </Screen>
  );
}

export default function ReportsPage() {
  // useSearchParams needs a Suspense boundary for static rendering.
  return (
    <Suspense fallback={<Screen title="Statements" large>{null}</Screen>}>
      <ReportsInner />
    </Suspense>
  );
}
