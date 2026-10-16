"use client";
import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
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
import Skeleton from "@/components/ui/Skeleton";
import Screen from "@/components/kit/Screen";
import { Card, List, RowLink, Section, sepInset } from "@/components/kit/List";
import { Avatar } from "@/components/kit/Avatar";
import { CategoryTile, GroupAvatar } from "@/components/kit/Tile";
import { EmptyState, Meter, Segmented } from "@/components/kit/Controls";
import { Menu } from "@/components/kit/Menu";
import { Icon } from "@/components/kit/Icon";
import { NavLink } from "@/components/kit/nav";
import { replaceSamePath } from "@/lib/nav-transitions";

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

/** The two-column ledger: each row lands in "You gave" or "You got". */
function StatementTable({ stmt, otherName }: { stmt: PairStatement; otherName: string }) {
  if (stmt.rows.length === 0) {
    return (
      <Card>
        <EmptyState compact icon="doc.text" title="Nothing Here Yet" message={`Nothing shared with ${otherName} in this scope.`} />
      </Card>
    );
  }
  const gave = stmt.rows.filter((r) => r.delta > 0).reduce((s, r) => s + r.delta, 0);
  const got = stmt.rows.filter((r) => r.delta < 0).reduce((s, r) => s - r.delta, 0);
  return (
    <Card>
      <div className="grid grid-cols-[1fr_80px_80px] gap-2 border-b-[0.5px] border-[var(--separator)] px-4 py-2.5">
        <span className="t-caption2 uppercase text-label-2">Date &amp; details</span>
        <span className="t-caption2 text-right uppercase text-pos">You gave</span>
        <span className="t-caption2 text-right uppercase text-neg">You got</span>
      </div>
      <ul className="list">
        {[...stmt.rows].reverse().map((row) => (
          <li key={row.key} className="grid grid-cols-[1fr_80px_80px] gap-2 px-4 py-3" style={sepInset(16)}>
            <div className="min-w-0">
              <p className="t-subhead truncate font-semibold">{row.label}</p>
              <p className="t-caption mt-0.5 text-label-2">{fullDate(row.ts)}</p>
              <p className="t-caption mt-0.5 text-label-2">{rowWording(row, otherName)}</p>
              <p className="t-caption mt-1 text-label-3">
                {isSettled(row.balance)
                  ? "Balance: settled"
                  : row.balance > 0
                  ? `Balance: ${otherName} owes you ${formatCurrency(row.balance)}`
                  : `Balance: you owe ${otherName} ${formatCurrency(-row.balance)}`}
              </p>
            </div>
            <span className="num t-subhead text-right font-semibold text-pos">
              {row.delta > 0.001 ? formatCurrency(row.delta) : ""}
            </span>
            <span className="num t-subhead text-right font-semibold text-neg">
              {row.delta < -0.001 ? formatCurrency(-row.delta) : ""}
            </span>
          </li>
        ))}
      </ul>
      <div className="grid grid-cols-[1fr_80px_80px] gap-2 border-t-[0.5px] border-[var(--separator)] bg-[var(--fill-4)] px-4 py-3">
        <span className="t-subhead font-semibold">Total</span>
        <span className="num t-subhead text-right font-bold text-pos">{formatCurrency(gave)}</span>
        <span className="num t-subhead text-right font-bold text-neg">{formatCurrency(got)}</span>
      </div>
    </Card>
  );
}

/** A pop-up menu row: label left, current choice right, ⌃⌄ glyph. */
function PickerRow({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { id: string; name: string }[];
  onChange: (id: string) => void;
}) {
  const current = options.find((o) => o.id === value)?.name ?? options[0]?.name;
  return (
    <Menu
      align="end"
      title={label}
      items={options.map((o) => ({ label: o.name, checked: o.id === value, onSelect: () => onChange(o.id) }))}
    >
      {(props) => (
        <button type="button" {...props} className="row is-pressable" style={sepInset(16)}>
          <span className="row-main">
            <span className="row-title">{label}</span>
          </span>
          <span className="flex min-w-0 items-center gap-1 text-label-2">
            <span className="t-body max-w-[46vw] truncate">{current}</span>
            <Icon name="chevron.up.down" size={15} strokeWidth={2.2} />
          </span>
        </button>
      )}
    </Menu>
  );
}

/** Proportion rows for the spending breakdowns. */
function SpendRows({
  rows,
}: {
  rows: { key: string; leading: React.ReactNode; label: string; value: number; max: number; sub?: string }[];
}) {
  return (
    <List>
      {rows.map((r) => (
        <div key={r.key} className="row is-tall" style={sepInset(58)}>
          {r.leading}
          <span className="row-main">
            <span className="flex items-baseline justify-between gap-3">
              <span className="row-title">{r.label}</span>
              <span className="num t-subhead shrink-0 font-semibold">{formatCurrency(r.value)}</span>
            </span>
            <span className="mt-1.5 block">
              <Meter value={r.max > 0 ? Math.max(2, Math.round((r.value / r.max) * 100)) : 0} color="var(--tint)" label={r.label} />
            </span>
            {r.sub && <span className="row-detail">{r.sub}</span>}
          </span>
        </div>
      ))}
    </List>
  );
}

/**
 * Pick a group, optionally a person, see what was spent. With a person picked
 * the figures cover only expenses the two of you shared — a different
 * question from "what did this group spend".
 */
function SpendingDashboard({ meUid, groups, datasets }: { meUid: string; groups: Group[]; datasets: GroupDataset[] }) {
  const [groupId, setGroupId] = useState("all");
  const [personUid, setPersonUid] = useState("all");

  const scopedGroups = groupId === "all" ? groups : groups.filter((g) => g.id === groupId);
  const expenses = scopedGroups.flatMap((g) => datasets.find((d) => d.group.id === g.id)?.expenses ?? []);

  // Everyone who shares one of the groups in scope.
  const peopleMap = new Map<string, string>();
  for (const g of scopedGroups) {
    for (const uid of g.memberIds || []) {
      if (uid === meUid) continue;
      peopleMap.set(uid, g.members?.[uid]?.displayName || "Member");
    }
  }
  const people = Array.from(peopleMap, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  // Switching group can strip out the selected person; fall back to everyone
  // rather than reporting zero against someone who isn't here.
  const activePerson = personUid !== "all" && peopleMap.has(personUid) ? personUid : null;
  const summary = summariseSpending(meUid, expenses, activePerson);
  const otherName = activePerson ? peopleMap.get(activePerson) : null;
  const maxCategory = summary.byCategory[0]?.total ?? 0;
  const maxPayer = summary.byPayer[0]?.paid ?? 0;
  const nameOf = (uid: string) => (uid === meUid ? "You" : peopleMap.get(uid) || "Former member");
  const photoOf = (uid: string) => {
    for (const g of scopedGroups) {
      const p = g.members?.[uid]?.photoURL;
      if (p) return p;
    }
    return undefined;
  };

  return (
    <>
      <Section tight>
        <List>
          <PickerRow
            label="Group"
            value={groupId}
            onChange={setGroupId}
            options={[{ id: "all", name: "All Groups" }, ...groups.map((g) => ({ id: g.id, name: g.name }))]}
          />
          {people.length > 0 && (
            <PickerRow
              label="Spent with"
              value={activePerson ?? "all"}
              onChange={setPersonUid}
              options={[{ id: "all", name: "Everyone" }, ...people]}
            />
          )}
        </List>
      </Section>

      <Section>
        <Card className="p-4">
          <p className="t-footnote text-label-2">
            {otherName ? `Spent on things you and ${otherName} shared` : "Total spent"}
            {groupId !== "all" && scopedGroups[0] ? ` · ${scopedGroups[0].name}` : ""}
          </p>
          <p className="amount-hero mt-1 truncate text-[34px]">{formatCurrency(summary.total)}</p>
          <p className="t-footnote mt-1 text-label-2">
            {summary.expenseCount} expense{summary.expenseCount !== 1 ? "s" : ""}
            {summary.expenseCount > 0 && ` · ${formatCurrency(summary.average)} on average`}
          </p>
          {summary.firstTs && summary.lastTs && (
            <p className="t-caption mt-0.5 text-label-2">
              {fullDate(summary.firstTs)} – {fullDate(summary.lastTs)}
            </p>
          )}
          {summary.expenseCount > 0 && (
            <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t-[0.5px] border-[var(--separator)] pt-4">
              <div>
                <p className="t-caption text-label-2">Your share</p>
                <p className="num t-headline">{formatCurrency(summary.myShare)}</p>
              </div>
              <div>
                <p className="t-caption text-label-2">You paid up front</p>
                <p className="num t-headline">{formatCurrency(summary.iPaid)}</p>
              </div>
              {otherName && (
                <>
                  <div>
                    <p className="t-caption truncate text-label-2">{otherName}&rsquo;s share</p>
                    <p className="num t-headline">{formatCurrency(summary.theirShare)}</p>
                  </div>
                  <div>
                    <p className="t-caption truncate text-label-2">{otherName} paid up front</p>
                    <p className="num t-headline">{formatCurrency(summary.theyPaid)}</p>
                  </div>
                </>
              )}
            </div>
          )}
        </Card>
      </Section>

      {summary.expenseCount === 0 ? (
        <p className="section-footer mt-2">
          {otherName ? `No expenses shared with ${otherName} in this scope yet.` : "No expenses in this scope yet."}
        </p>
      ) : (
        <>
          <Section header="Where it went">
            <SpendRows
              rows={summary.byCategory.map((c) => ({
                key: c.id,
                leading: <CategoryTile id={c.id} />,
                label: c.label,
                value: c.total,
                max: maxCategory,
                sub: `${c.count} expense${c.count !== 1 ? "s" : ""} · your share ${formatCurrency(c.myShare)}`,
              }))}
            />
          </Section>
          <Section header="Who put the money in">
            <SpendRows
              rows={summary.byPayer.map((p) => ({
                key: p.uid,
                leading: <Avatar name={nameOf(p.uid)} photoURL={photoOf(p.uid)} size={30} />,
                label: nameOf(p.uid),
                value: p.paid,
                max: maxPayer,
                sub: `paid for ${p.count} expense${p.count !== 1 ? "s" : ""}`,
              }))}
            />
          </Section>
        </>
      )}
    </>
  );
}

function ReportsSkeleton() {
  return (
    <Screen title="Reports" large tabBar>
      <Skeleton className="h-9 w-full rounded-full" />
      <div className="card list mt-4" aria-hidden>
        {[0, 1, 2].map((i) => (
          <div key={i} className="row is-tall" style={sepInset(68)}>
            <Skeleton className="h-10 w-10 rounded-full" />
            <div className="flex-1">
              <Skeleton className="h-4 w-32 rounded-md" />
              <Skeleton className="mt-2 h-3 w-48 rounded-md" />
            </div>
          </div>
        ))}
      </div>
    </Screen>
  );
}

function ReportsInner() {
  const params = useSearchParams();
  const { user, loading } = useAuth();
  const { groups, datasets, allLoaded, groupsLoaded } = useGroupData();
  const { transfers } = usePayments();
  const showToast = useToast();
  const personParam = params.get("person");
  const groupParam = params.get("group");
  const tabParam = params.get("tab") === "spending" ? "spending" : "statements";
  // Tagging the scope with the person it was chosen for lets it expire by
  // derivation when the person changes (a stale scope could otherwise render
  // an empty statement with no way to clear it).
  const [pickedScope, setPickedScope] = useState<{ person: string | null; value: string } | null>(null);
  const scope = pickedScope?.person === personParam ? pickedScope.value : groupParam || ALL;
  const setScope = (value: string) => setPickedScope({ person: personParam, value });

  const uid = user?.uid;
  const counterparties = useMemo(
    () => (uid ? computeCounterpartyBalances(uid, datasets, transfers) : []),
    [uid, datasets, transfers]
  );

  if (loading || (!groupsLoaded && user)) return <ReportsSkeleton />;
  if (!user) return <LoginScreen />;
  const meUid = user.uid;

  // ── People ───────────────────────────────────────────────────
  if (!personParam) {
    const people = counterparties.filter((c) => c.sharedGroupCount > 0 || !isSettled(c.directNet || 0));
    return (
      <Screen key="list" title="Reports" large tabBar>
        <Segmented
          label="Report type"
          value={tabParam}
          // A query-only change on this static page: the History API (which the
          // router follows) rather than router.replace, which in Next 16.2 can
          // restore a cold-start query instead (see replaceSamePath).
          onChange={(id) => replaceSamePath(id === "spending" ? "/reports?tab=spending" : "/reports")}
          options={[
            { id: "statements", label: "Statements" },
            { id: "spending", label: "Spending" },
          ]}
        />
        {tabParam === "spending" ? (
          <SpendingDashboard meUid={meUid} groups={groups} datasets={datasets} />
        ) : (
          <Section
            footer={
              <>
                A running account with each person, entry by entry — who paid for what, and what&rsquo;s left
                between you.
                {!allLoaded && " Still loading every group…"}
              </>
            }
          >
            {people.length === 0 ? (
              <Card>
                <EmptyState
                  compact
                  icon="doc.text"
                  title="No Statements Yet"
                  message="Add an expense in a group and a statement with each person appears here."
                />
              </Card>
            ) : (
              <List>
                {people.map((p) => {
                  const settled = isSettled(p.net);
                  const iOwe = !settled && p.net > 0;
                  const groupsText =
                    p.sharedGroupCount > 0
                      ? `${p.sharedGroupCount} shared group${p.sharedGroupCount !== 1 ? "s" : ""}`
                      : "Direct payments";
                  return (
                    <RowLink
                      key={p.uid}
                      href={`/reports?person=${p.uid}`}
                      inset="avatar"
                      tall
                      leading={<Avatar name={p.displayName} photoURL={p.photoURL} size={40} />}
                      title={p.displayName}
                      titleClassName="font-semibold"
                      subtitle={
                        !isSettled(p.directNet || 0)
                          ? `${groupsText} · ${formatCurrency(Math.abs(p.directNet))} direct`
                          : groupsText
                      }
                      trailing={
                        <span className="flex shrink-0 flex-col items-end">
                          <span className="t-caption text-label-2">
                            {settled ? "" : iOwe ? "you owe" : "owes you"}
                          </span>
                          <span className={`num t-headline ${settled ? "text-label-3" : iOwe ? "text-neg" : "text-pos"}`}>
                            {settled ? "Settled" : formatCurrency(Math.abs(p.net))}
                          </span>
                        </span>
                      }
                      ariaLabel={`${p.displayName}, ${describeNet(-p.net, p.displayName, formatCurrency)}. View statement`}
                    />
                  );
                })}
              </List>
            )}
          </Section>
        )}
      </Screen>
    );
  }

  // ── One person's statement ─────────────────────────────────
  const person = counterparties.find((c) => c.uid === personParam);
  const otherName = person?.displayName || "This person";
  const sharedGroups = groups.filter((g) => g.memberIds?.includes(personParam) && g.memberIds?.includes(meUid));
  // A scope this person doesn't share falls back to every shared group.
  const effectiveScope = scope === ALL || sharedGroups.some((g) => g.id === scope) ? scope : ALL;
  const scopedGroups = effectiveScope === ALL ? sharedGroups : sharedGroups.filter((g) => g.id === effectiveScope);

  const expenses: Expense[] = [];
  const settlements: Settlement[] = [];
  for (const g of scopedGroups) {
    const d = datasets.find((x) => x.group.id === g.id);
    if (!d) continue;
    expenses.push(...d.expenses);
    settlements.push(...d.settlements);
  }
  // Direct payments belong to no group: shown across all shared groups,
  // hidden when scoped to one.
  const scopedTransfers = effectiveScope === ALL ? transfers : [];
  const stmt = buildPairStatement(meUid, personParam, expenses, settlements, scopedTransfers);
  const net = stmt.net;

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

  const tileCls =
    "flex h-16 flex-col items-center justify-center gap-1 rounded-[18px] bg-[var(--cell)] text-tint transition-transform duration-150 active:scale-95";

  return (
    <Screen key={`person-${personParam}`} title={otherName} back="/reports" heroTitle tabBar>
      <div className="flex flex-col items-center px-2 pt-1 text-center">
        <Avatar name={otherName} photoURL={person?.photoURL} size={84} />
        <h2 data-hero-title className="t-title2 mt-3 max-w-full [overflow-wrap:anywhere]">{otherName}</h2>
        <p className={`t-headline mt-1 ${isSettled(net) ? "text-label-2" : net > 0 ? "text-pos" : "text-neg"}`}>
          {describeNet(net, otherName, formatCurrency)}
        </p>
      </div>

      {/* Contacts-style action tiles. */}
      <div className="mt-5 grid grid-cols-3 gap-2">
        <NavLink href={`/chat/${personParam}`} className={tileCls}>
          <Icon name="message" size={22} />
          <span className="t-caption font-medium">Message</span>
        </NavLink>
        <NavLink href={`/chat/${personParam}?pay=1`} className={tileCls}>
          <Icon name="indianrupee" size={22} />
          <span className="t-caption font-medium">Pay</span>
        </NavLink>
        <button
          type="button"
          onClick={() => void handleDownload()}
          disabled={stmt.rows.length === 0}
          className={`${tileCls} disabled:text-label-3`}
        >
          <Icon name="square.and.arrow.down" size={22} />
          <span className="t-caption font-medium">Export CSV</span>
        </button>
      </div>

      <Section header="As things stand">
        <Card className="p-4">
          <p className="t-subhead text-label-2">
            You covered <span className="num font-semibold text-label">{formatCurrency(stmt.iCoveredForThem)}</span> of{" "}
            {otherName}&rsquo;s share. {otherName} covered{" "}
            <span className="num font-semibold text-label">{formatCurrency(stmt.theyCoveredForMe)}</span> of yours.
          </p>
          {!isSettled(stmt.directNet || 0) && (
            <p className="t-subhead mt-2 text-label-2">
              {formatCurrency(Math.abs(stmt.directNet))} is direct (not in any group) —{" "}
              {stmt.directNet > 0 ? `${otherName} owes you` : `you owe ${otherName}`}.
            </p>
          )}
          {(!isSettled(stmt.pendingFromMe) || !isSettled(stmt.pendingFromThem)) && (
            <p className="t-footnote mt-2 text-warn">
              A payment is still waiting to be approved, so it isn&rsquo;t counted above.
            </p>
          )}
        </Card>
      </Section>

      {sharedGroups.length > 1 && (
        <Section>
          <List>
            <PickerRow
              label="Groups"
              value={effectiveScope}
              onChange={setScope}
              options={[{ id: ALL, name: "All Shared Groups" }, ...sharedGroups.map((g) => ({ id: g.id, name: g.name }))]}
            />
          </List>
          {effectiveScope !== ALL && (
            <p className="section-footer">Direct payments aren&rsquo;t part of any group, so they&rsquo;re hidden here.</p>
          )}
        </Section>
      )}

      <Section header="Statement">
        <StatementTable stmt={stmt} otherName={otherName} />
      </Section>

      {sharedGroups.length > 0 && (
        <Section header="Shared groups">
          <List>
            {sharedGroups.map((g) => (
              <RowLink
                key={g.id}
                href={`/groups/${g.id}`}
                inset={58}
                leading={<GroupAvatar id={g.id} name={g.name} photoURL={g.photoURL} size={30} />}
                title={g.name}
              />
            ))}
          </List>
        </Section>
      )}
    </Screen>
  );
}

export default function ReportsPage() {
  // useSearchParams needs a Suspense boundary for static rendering.
  return (
    <Suspense fallback={<ReportsSkeleton />}>
      <ReportsInner />
    </Suspense>
  );
}
