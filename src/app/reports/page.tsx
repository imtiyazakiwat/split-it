"use client";
import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useGroupData } from "@/lib/group-data-context";
import { computeCounterpartyBalances } from "@/lib/global-balance";
import { buildPairStatement, describeNet, PairStatement, StatementRow } from "@/lib/statement";
import { formatCurrency } from "@/lib/balance";
import { toCsv, downloadTextFile } from "@/lib/report";
import { Expense, Settlement } from "@/lib/types";
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
                {Math.abs(row.balance) < 0.01
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

function ReportsInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { user, loading } = useAuth();
  const { groups, datasets, allLoaded, groupsLoaded } = useGroupData();
  const showToast = useToast();
  const personParam = params.get("person");
  const groupParam = params.get("group");
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
    () => (uid ? computeCounterpartyBalances(uid, datasets) : []),
    [uid, datasets]
  );

  if (loading || (!groupsLoaded && user)) {
    return <p className="p-6 text-[15px] text-[var(--text-tertiary)]">Loading…</p>;
  }
  if (!user) return <LoginScreen />;
  const meUid = user.uid;

  // ── Person list ────────────────────────────────────────────
  if (!personParam) {
    const people = counterparties.filter((c) => c.sharedGroupCount > 0);
    return (
      <div className="flex-1 flex flex-col bg-[var(--background)] min-h-full">
        <main className="flex-1 max-w-md w-full mx-auto px-4 pt-6 pb-[calc(var(--nav-h)+env(safe-area-inset-bottom)+2rem)]">
          <h1 className="text-[30px] font-extrabold text-[var(--text-primary)]">Statements</h1>
          <p className="text-[15px] text-[var(--text-tertiary)] mt-1 mb-5">
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
            <div className="space-y-2.5">
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
                    </p>
                    <p className="text-[12px] text-[var(--text-tertiary)] mt-0.5 truncate">
                      {p.sharedGroupCount} shared group{p.sharedGroupCount !== 1 ? "s" : ""}
                    </p>
                  </div>
                  <span className="text-[var(--text-quaternary)] text-lg shrink-0">›</span>
                </button>
              ))}
            </div>
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
  const stmt = buildPairStatement(meUid, personParam, expenses, settlements);

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
        Math.abs(row.balance) < 0.01 ? "settled" : row.balance > 0 ? `${otherName} owes you` : `you owe ${otherName}`,
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
            Math.abs(stmt.net) < 0.01
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
          {(stmt.pendingFromMe > 0.01 || stmt.pendingFromThem > 0.01) && (
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
