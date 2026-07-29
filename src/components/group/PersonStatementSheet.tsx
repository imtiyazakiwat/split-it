"use client";
import { useRouter } from "next/navigation";
import GlassModal from "@/components/ui/GlassModal";
import { Expense, Group, Settlement } from "@/lib/types";
import { formatCurrency } from "@/lib/balance";
import { buildPairStatement, describeNet, StatementRow } from "@/lib/statement";

function shortDate(ts: number): string {
  return new Date(ts).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

/** Plain wording for what a row did to the balance, from the viewer's side. */
function rowWords(row: StatementRow, otherName: string): { text: string; tone: "owe" | "get" | "flat" } {
  switch (row.kind) {
    case "expense-they-paid":
      return { text: `${otherName} paid · you owe`, tone: "owe" };
    case "expense-i-paid":
      return { text: `You paid · ${otherName} owes`, tone: "get" };
    case "payment-i-sent":
      return row.informationalOnly
        ? { text: `You sent · ${row.status}`, tone: "flat" }
        : { text: "You settled", tone: "get" };
    case "payment-they-sent":
      return row.informationalOnly
        ? { text: `${otherName} sent · ${row.status}`, tone: "flat" }
        : { text: `${otherName} settled`, tone: "owe" };
  }
}

export default function PersonStatementSheet({
  group,
  meUid,
  otherUid,
  expenses,
  settlements,
  onClose,
  onSettle,
}: {
  group: Group;
  meUid: string;
  otherUid: string;
  expenses: Expense[];
  settlements: Settlement[];
  onClose: () => void;
  onSettle: (toUid: string, amount: number) => void;
}) {
  const router = useRouter();
  const otherName = group.members[otherUid]?.displayName || "Member";
  const stmt = buildPairStatement(meUid, otherUid, expenses, settlements);
  const iOwe = stmt.net < -0.01;
  const settled = Math.abs(stmt.net) < 0.01;
  // With simplified debts on, the group's payment plan chains balances through
  // third parties, so this pairwise figure is history between the two of you —
  // not an amount to pay. Offering "Settle X" here would contradict the plan on
  // the group screen, so the action is withheld and we point at the plan instead.
  const simplified = group.useSimplifiedDebts === true;

  return (
    <GlassModal title={otherName} onClose={onClose}>
      <div className="space-y-4">
        {/* The headline answer, in words rather than a signed number. */}
        <div
          className={`rounded-[var(--radius-inner)] p-4 text-center ${
            settled
              ? "bg-[var(--fill-soft)]"
              : iOwe
              ? "bg-[var(--tint-danger-soft)]"
              : "bg-[var(--tint-success-soft)]"
          }`}
        >
          <p className="text-[15px] font-semibold text-[var(--text-primary)]">
            {describeNet(stmt.net, otherName, formatCurrency)}
          </p>
          <p className="text-[12px] text-[var(--text-tertiary)] mt-1">
            Just between you two, in {group.name}
          </p>
          {(stmt.pendingFromMe > 0.01 || stmt.pendingFromThem > 0.01) && (
            <p className="text-[12px] text-[var(--warning)] mt-2">
              {stmt.pendingFromThem > 0.01
                ? `${formatCurrency(stmt.pendingFromThem)} from ${otherName} is waiting for your approval`
                : `${formatCurrency(stmt.pendingFromMe)} you sent is waiting for ${otherName} to approve`}
              . Not counted above.
            </p>
          )}
        </div>

        {/* Where the number comes from */}
        <div className="rounded-[var(--radius-inner)] bg-[var(--fill-soft)] p-3 space-y-1.5">
          <div className="flex justify-between text-[14px]">
            <span className="text-[var(--text-tertiary)]">You covered for {otherName}</span>
            <span className="font-medium text-[var(--text-primary)]">{formatCurrency(stmt.iCoveredForThem)}</span>
          </div>
          <div className="flex justify-between text-[14px]">
            <span className="text-[var(--text-tertiary)]">{otherName} covered for you</span>
            <span className="font-medium text-[var(--text-primary)]">{formatCurrency(stmt.theyCoveredForMe)}</span>
          </div>
          {stmt.iPaid > 0.01 && (
            <div className="flex justify-between text-[14px]">
              <span className="text-[var(--text-tertiary)]">Payments you sent</span>
              <span className="font-medium text-[var(--pos)]">{formatCurrency(stmt.iPaid)}</span>
            </div>
          )}
          {stmt.theyPaid > 0.01 && (
            <div className="flex justify-between text-[14px]">
              <span className="text-[var(--text-tertiary)]">Payments {otherName} sent</span>
              <span className="font-medium text-[var(--pos)]">{formatCurrency(stmt.theyPaid)}</span>
            </div>
          )}
        </div>

        {/* Row-by-row history */}
        <div>
          <p className="text-[13px] font-semibold text-[var(--text-secondary)] mb-2">
            {stmt.rows.length > 0
              ? `${stmt.rows.length} entr${stmt.rows.length === 1 ? "y" : "ies"} between you`
              : "Nothing shared yet"}
          </p>
          {stmt.rows.length === 0 ? (
            <p className="text-[13px] text-[var(--text-tertiary)]">
              You haven&rsquo;t shared any expenses with {otherName} in this group.
            </p>
          ) : (
            <ul className="divide-y divide-[var(--border-subtle)]">
              {[...stmt.rows].reverse().map((row) => {
                const words = rowWords(row, otherName);
                return (
                  <li key={row.key} className="py-2.5 flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] font-medium text-[var(--text-primary)] truncate">
                        {row.label}
                      </p>
                      <p className="text-[12px] text-[var(--text-tertiary)] mt-0.5">
                        {shortDate(row.ts)} · {words.text}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p
                        className={`text-[14px] font-semibold ${
                          words.tone === "owe"
                            ? "text-[var(--neg)]"
                            : words.tone === "get"
                            ? "text-[var(--pos)]"
                            : "text-[var(--text-tertiary)]"
                        }`}
                      >
                        {row.informationalOnly
                          ? "—"
                          : `${row.delta > 0 ? "+" : "−"}${formatCurrency(Math.abs(row.delta))}`}
                      </p>
                      <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5">
                        {Math.abs(row.balance) < 0.01
                          ? "settled"
                          : row.balance > 0
                          ? `owes you ${formatCurrency(row.balance)}`
                          : `you owe ${formatCurrency(-row.balance)}`}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {simplified && !settled && (
          <p className="text-[12px] text-[var(--text-tertiary)] text-center">
            This group uses simplified debts, so the amounts above are your shared
            history. Use the group&rsquo;s settle-up plan to see who to pay.
          </p>
        )}
        <div className="flex gap-2">
          {iOwe && !simplified && (
            <button
              type="button"
              onClick={() => {
                onSettle(otherUid, Math.round(-stmt.net * 100) / 100);
                onClose();
              }}
              className="flex-1 rounded-full bg-[var(--brand-solid)] text-white px-4 py-3 text-[15px] font-semibold tap-shrink"
            >
              Settle {formatCurrency(-stmt.net)}
            </button>
          )}
          <button
            type="button"
            onClick={() => router.push(`/reports?person=${otherUid}&group=${group.id}`)}
            className="flex-1 rounded-full bg-[var(--surface)] border border-[var(--border-subtle)] text-[var(--text-primary)] px-4 py-3 text-[15px] font-semibold tap-shrink"
          >
            Full statement
          </button>
        </div>
      </div>
    </GlassModal>
  );
}
