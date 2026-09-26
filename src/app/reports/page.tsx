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
import BottomNav from "@/components/home/BottomNav";
import LoginScreen from "@/components/LoginScreen";
import { useToast } from "@/components/ui/Toast";

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
      <p className="text-[14px] text-[var(--text-tertiary)] px-4 py-6 text-center">
        Nothing shared with {otherName} here yet.
      </p>
    );
  }
  const gave = stmt.rows.filter((r) => r.delta > 0).reduce((s, r) => s + r.delta, 0);
  const got = stmt.rows.filter((r) => r.delta < 0).reduce((s, r) => s - r.delta, 0);
  return (
    <div>
      {/* Column key, spelled out — the two columns are the whole idea. */}
      <div className="grid grid-cols-[1fr_auto_auto] gap-3 px-4 py-2 border-b border-[var(--border-subtle)] bg-[var(--fill-soft)]">
        <span className="text-[11px] font-bold tracking-wide text-[var(--text-tertiary)]">DATE &amp; DETAILS</span>
        <span className="text-[11px] font-bold tracking-wide text-[var(--pos)] text-right w-[72px]">YOU GAVE</span>
        <span className="text-[11px] font-bold tracking-wide text-[var(--neg)] text-right w-[72px]">YOU GOT</span>
      </div>
      <ul>
        {[...stmt.rows].reverse().map((row) => (
          <li
            key={row.key}
            className="grid grid-cols-[1fr_auto_auto] gap-3 px-4 py-3 border-b border-[var(--border-subtle)]"
          >
            <div className="min-w-0">
              <p className="text-[14px] font-semibold text-[var(--text-primary)] truncate">{row.label}</p>
              <p className="text-[12px] text-[var(--text-tertiary)] mt-0.5">{fullDate(row.ts)}</p>
              <p className="text-[12px] text-[var(--text-secondary)] mt-0.5">{rowWording(row, otherName)}</p>
              <p className="text-[11px] text-[var(--text-tertiary)] mt-1">
                {isSettled(row.balance)
                  ? "Balance: settled"
                  : row.balance > 0
                  ? `Balance: ${otherName} owes you ${formatCurrency(row.balance)}`
                  : `Balance: you owe ${otherName} ${formatCurrency(-row.balance)}`}
              </p>
            </div>
            <span className="text-[14px] font-semibold text-[var(--pos)] text-right w-[72px]">
              {row.delta > 0.001 ? formatCurrency(row.delta) : ""}
            </span>
            <span className="text-[14px] font-semibold text-[var(--neg)] text-right w-[72px]">
              {row.delta < -0.001 ? formatCurrency(-row.delta) : ""}
            </span>
          </li>
        ))}
      </ul>
      <div className="grid grid-cols-[1fr_auto_auto] gap-3 px-4 py-3 bg-[var(--fill-soft)]">
        <span className="text-[13px] font-bold text-[var(--text-primary)]">Total</span>
        <span className="text-[13px] font-bold text-[var(--pos)] text-right w-[72px]">{formatCurrency(gave)}</span>
        <span className="text-[13px] font-bold text-[var(--neg)] text-right w-[72px]">{formatCurrency(got)}</span>
      </div>
    </div>
  );
}

/** Horizontal proportion bar used by the category and payer breakdowns. */
function SpendBar({
  label,
  emoji,
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
    <div className="py-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[14px] font-medium text-[var(--text-primary)] truncate">
          {emoji ? `${emoji} ` : ""}
          {label}
        </span>
        <span className="text-[14px] font-semibold text-[var(--text-primary)] shrink-0">
          {formatCurrency(value)}
        </span>
      </div>
      <div className="mt-1.5 h-2 rounded-full bg-[var(--fill)] overflow-hidden">
        <div className="h-full rounded-full bg-[var(--brand-solid)]" style={{ width: `${pct}%` }} />
      </div>
      {sub && <p className="text-[12px] text-[var(--text-tertiary)] mt-1">{sub}</p>}
    </div>
  );
}

function FilterChips({
  options,
  value,
  onChange,
  label,
}: {
  options: { id: string; name: string }[];
  value: string;
  onChange: (id: string) => void;
  label: string;
}) {
  return (
    <div className="mt-4">
      <p className="text-[11px] font-bold tracking-wide text-[var(--text-tertiary)] mb-2">{label}</p>
      <div className="flex gap-2 overflow-x-auto scroll-momentum -mx-4 px-4 pb-1">
        {options.map((o) => (
          <button
            key={o.id}
            onClick={() => onChange(o.id)}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-semibold tap-shrink ${
              value === o.id
                ? "bg-[var(--brand-solid)] text-white"
                : "bg-[var(--surface)] text-[var(--text-secondary)] shadow-[var(--shadow-sm)]"
            }`}
          >
            {o.name}
          </button>
        ))}
      </div>
    </div>
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
      <FilterChips
        label="GROUP"
        value={groupId}
        onChange={setGroupId}
        options={[{ id: "all", name: "All groups" }, ...groups.map((g) => ({ id: g.id, name: g.name }))]}
      />
      {people.length > 0 && (
        <FilterChips
          label="SPENT WITH"
          value={activePerson ?? "all"}
          onChange={setPersonUid}
          options={[{ id: "all", name: "Everyone" }, ...people]}
        />
      )}

      <div className="mt-5 rounded-[var(--radius-card)] bg-[var(--surface)] p-5 shadow-[var(--shadow-card)]">
        <p className="text-[13px] text-[var(--text-tertiary)]">
          {otherName ? `Spent on things you and ${otherName} shared` : "Total spent"}
          {groupId !== "all" && scopedGroups[0] ? ` · ${scopedGroups[0].name}` : ""}
        </p>
        <p className="text-[34px] font-extrabold text-[var(--brand)] leading-tight mt-1">
          {formatCurrency(summary.total)}
        </p>
        <p className="text-[13px] text-[var(--text-secondary)] mt-1">
          {summary.expenseCount} expense{summary.expenseCount !== 1 ? "s" : ""}
          {summary.expenseCount > 0 && ` · ${formatCurrency(summary.average)} on average`}
        </p>
        {summary.firstTs && summary.lastTs && (
          <p className="text-[12px] text-[var(--text-tertiary)] mt-0.5">
            {fullDate(summary.firstTs)} — {fullDate(summary.lastTs)}
          </p>
        )}

        {summary.expenseCount > 0 && (
          <div className="mt-4 pt-4 border-t border-[var(--border-subtle)] grid grid-cols-2 gap-y-3 gap-x-4">
            <div>
              <p className="text-[12px] text-[var(--text-tertiary)]">Your share</p>
              <p className="text-[17px] font-bold text-[var(--text-primary)]">
                {formatCurrency(summary.myShare)}
              </p>
            </div>
            <div>
              <p className="text-[12px] text-[var(--text-tertiary)]">You paid up front</p>
              <p className="text-[17px] font-bold text-[var(--text-primary)]">
                {formatCurrency(summary.iPaid)}
              </p>
            </div>
            {otherName && (
              <>
                <div>
                  <p className="text-[12px] text-[var(--text-tertiary)]">{otherName}&rsquo;s share</p>
                  <p className="text-[17px] font-bold text-[var(--text-primary)]">
                    {formatCurrency(summary.theirShare)}
                  </p>
                </div>
                <div>
                  <p className="text-[12px] text-[var(--text-tertiary)]">{otherName} paid up front</p>
                  <p className="text-[17px] font-bold text-[var(--text-primary)]">
                    {formatCurrency(summary.theyPaid)}
                  </p>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {summary.expenseCount === 0 ? (
        <p className="text-[14px] text-[var(--text-tertiary)] mt-5">
          {otherName
            ? `No expenses shared with ${otherName} in this scope yet.`
            : "No expenses in this scope yet."}
        </p>
      ) : (
        <>
          <section className="mt-6">
            <h2 className="text-[17px] font-bold text-[var(--text-primary)]">Where it went</h2>
            <div className="mt-1 rounded-[var(--radius-card)] bg-[var(--surface)] px-4 py-2 shadow-[var(--shadow-card)] divide-y divide-[var(--border-subtle)]">
              {summary.byCategory.map((c) => (
                <SpendBar
                  key={c.id}
                  label={c.label}
                  emoji={c.emoji}
                  value={c.total}
                  max={maxCategory}
                  sub={`${c.count} expense${c.count !== 1 ? "s" : ""} · your share ${formatCurrency(c.myShare)}`}
                />
              ))}
            </div>
          </section>

          <section className="mt-6">
            <h2 className="text-[17px] font-bold text-[var(--text-primary)]">Who put the money in</h2>
            <div className="mt-1 rounded-[var(--radius-card)] bg-[var(--surface)] px-4 py-2 shadow-[var(--shadow-card)] divide-y divide-[var(--border-subtle)]">
              {summary.byPayer.map((p) => (
                <SpendBar
                  key={p.uid}
                  label={nameOf(p.uid)}
                  value={p.paid}
                  max={maxPayer}
                  sub={`paid for ${p.count} expense${p.count !== 1 ? "s" : ""}`}
                />
              ))}
            </div>
          </section>
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
    return <p className="p-6 text-[15px] text-[var(--text-tertiary)]">Loading…</p>;
  }
  if (!user) return <LoginScreen />;
  const meUid = user.uid;

  // ── Person list ────────────────────────────────────────────
  if (!personParam) {
    const people = counterparties.filter(
      (c) => c.sharedGroupCount > 0 || !isSettled(c.directNet || 0)
    );
    return (
      <div className="flex-1 flex flex-col bg-[var(--background)] min-h-full">
        <main className="flex-1 max-w-md w-full mx-auto px-4 pt-6 pb-[calc(var(--nav-h)+env(safe-area-inset-bottom)+2rem)]">
          <h1 className="text-[30px] font-extrabold text-[var(--text-primary)]">Reports</h1>
          <div className="flex gap-2 mt-4 mb-1">
            {[
              { id: "statements", label: "Statements" },
              { id: "spending", label: "Spending" },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() =>
                  router.replace(t.id === "spending" ? "/reports?tab=spending" : "/reports", {
                    scroll: false,
                  })
                }
                className={`rounded-full px-4 py-1.5 text-[14px] font-semibold tap-shrink ${
                  tabParam === t.id
                    ? "bg-[var(--brand-solid)] text-white"
                    : "bg-[var(--surface)] text-[var(--text-secondary)] shadow-[var(--shadow-sm)]"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          {tabParam === "spending" ? (
            <SpendingDashboard meUid={meUid} groups={groups} datasets={datasets} />
          ) : (
          <>
          <p className="text-[15px] text-[var(--text-tertiary)] mt-2 mb-5">
            A running account with each person, entry by entry — who paid for what, and what&rsquo;s
            left between you.
          </p>
          {!allLoaded && (
            <p className="text-[13px] text-[var(--text-tertiary)] mb-3">Still loading every group…</p>
          )}
          {people.length === 0 ? (
            <p className="text-[14px] text-[var(--text-tertiary)]">
              No shared expenses yet. Add one in a group and it&rsquo;ll show up here.
            </p>
          ) : (
            <div className="space-y-2.5 stagger">
              {people.map((p) => (
                <button
                  key={p.uid}
                  onClick={() => router.push(`/reports?person=${p.uid}`)}
                  className="w-full text-left bg-[var(--surface)] rounded-[var(--radius-card)] p-4 flex items-center gap-3 shadow-[var(--shadow-card)] tap-shrink"
                >
                  {p.photoURL ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.photoURL} alt="" className="w-11 h-11 rounded-full object-cover shrink-0" />
                  ) : (
                    <span className="w-11 h-11 rounded-full bg-[var(--fill)] flex items-center justify-center text-[16px] font-semibold text-[var(--text-secondary)] shrink-0">
                      {p.displayName.charAt(0).toUpperCase()}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-[16px] font-semibold text-[var(--text-primary)] truncate">
                      {p.displayName}
                    </p>
                    <p className="text-[13px] text-[var(--text-secondary)] mt-0.5">
                      {describeNet(-p.net, p.displayName, formatCurrency)}
                      {!isSettled(p.directNet || 0)
                        ? ` (incl. ${formatCurrency(Math.abs(p.directNet))} direct)`
                        : ""}
                    </p>
                    <p className="text-[12px] text-[var(--text-tertiary)] mt-0.5 truncate">
                      {p.sharedGroupCount > 0
                        ? `${p.sharedGroupCount} shared group${p.sharedGroupCount !== 1 ? "s" : ""}`
                        : "Direct payment"}
                    </p>
                  </div>
                  <span className="text-[var(--text-quaternary)] text-lg shrink-0">›</span>
                </button>
              ))}
            </div>
          )}
          </>
          )}
        </main>
        <BottomNav active="reports" />
      </div>
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
    <div className="flex-1 flex flex-col bg-[var(--background)] min-h-full">
      <main className="flex-1 max-w-md w-full mx-auto px-4 pt-4 pb-[calc(var(--nav-h)+env(safe-area-inset-bottom)+2rem)]">
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={() => router.push("/reports")}
            aria-label="Back to statements"
            className="w-10 h-10 rounded-full bg-[var(--surface)] shadow-[var(--shadow-sm)] flex items-center justify-center tap-shrink"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
          </button>
          <h1 className="text-[22px] font-extrabold text-[var(--text-primary)] truncate">{otherName}</h1>
        </div>

        {/* The bottom line, in words */}
        <div
          className={`mt-4 rounded-[var(--radius-card)] p-5 ${
            isSettled(stmt.net)
              ? "bg-[var(--fill-soft)]"
              : stmt.net > 0
              ? "bg-[var(--tint-success-soft)]"
              : "bg-[var(--tint-danger-soft)]"
          }`}
        >
          <p className="text-[13px] text-[var(--text-tertiary)]">As things stand</p>
          <p className="text-[20px] font-extrabold text-[var(--text-primary)] mt-1">
            {describeNet(stmt.net, otherName, formatCurrency)}
          </p>
          <p className="text-[13px] text-[var(--text-secondary)] mt-2">
            You covered {formatCurrency(stmt.iCoveredForThem)} of {otherName}&rsquo;s share.{" "}
            {otherName} covered {formatCurrency(stmt.theyCoveredForMe)} of yours.
          </p>
          {!isSettled(stmt.directNet || 0) && (
            <p className="text-[13px] text-[var(--text-secondary)] mt-1">
              {formatCurrency(Math.abs(stmt.directNet))} is direct (not in any group)
              {stmt.directNet > 0
                ? ` ${otherName} owes you`
                : ` you owe ${otherName}`}
              .
            </p>
          )}
          {(!isSettled(stmt.pendingFromMe) || !isSettled(stmt.pendingFromThem)) && (
            <p className="text-[13px] text-[var(--warning)] mt-2">
              A payment is still waiting to be approved, so it isn&rsquo;t counted above.
            </p>
          )}
        </div>

        {/* Group scope */}
        {sharedGroups.length > 1 && (
          <div className="flex gap-2 overflow-x-auto scroll-momentum -mx-4 px-4 mt-4 pb-1">
            {[{ id: ALL, name: "All groups" }, ...sharedGroups.map((g) => ({ id: g.id, name: g.name }))].map((opt) => (
              <button
                key={opt.id}
                onClick={() => setScope(opt.id)}
                className={`shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-semibold tap-shrink ${
                  effectiveScope === opt.id
                    ? "bg-[var(--brand-solid)] text-white"
                    : "bg-[var(--surface)] text-[var(--text-secondary)] shadow-[var(--shadow-sm)]"
                }`}
              >
                {opt.name}
              </button>
            ))}
          </div>
        )}

        <div className="mt-4 bg-[var(--surface)] rounded-[var(--radius-card)] overflow-hidden shadow-[var(--shadow-card)]">
          <StatementTable stmt={stmt} otherName={otherName} />
        </div>

        {stmt.rows.length > 0 && (
          <button
            onClick={handleDownload}
            className="mt-4 w-full rounded-full bg-[var(--surface)] border border-[var(--border-subtle)] px-4 py-3 text-[15px] font-semibold text-[var(--text-primary)] tap-shrink"
          >
            Export this statement (CSV)
          </button>
        )}
      </main>
      <BottomNav active="reports" />
    </div>
  );
}

export default function ReportsPage() {
  // useSearchParams needs a Suspense boundary for static rendering.
  return (
    <Suspense fallback={<p className="p-6 text-[15px] text-[var(--text-tertiary)]">Loading…</p>}>
      <ReportsInner />
    </Suspense>
  );
}
