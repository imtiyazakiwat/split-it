"use client";
import GlassModal from "@/components/ui/GlassModal";
import { LinkRow, ListSection, Row } from "@/components/ui/List";
import { Avatar } from "@/components/ui/Controls";
import { Expense, Group, Settlement } from "@/lib/types";
import { formatCurrency } from "@/lib/balance";
import { isSettled } from "@/lib/money";
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
    case "direct-i-sent":
      return row.informationalOnly
        ? { text: `You sent direct · ${row.status}`, tone: "flat" }
        : { text: "You sent direct", tone: "get" };
    case "direct-they-sent":
      return row.informationalOnly
        ? { text: `${otherName} sent direct · ${row.status}`, tone: "flat" }
        : { text: `${otherName} sent direct`, tone: "owe" };
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
  const otherName = group.members[otherUid]?.displayName || "Member";
  const stmt = buildPairStatement(meUid, otherUid, expenses, settlements);
  const settled = isSettled(stmt.net);
  const iOwe = !settled && stmt.net < 0;
  // With simplified debts on, the group's payment plan chains balances through
  // third parties, so this pairwise figure is history between the two of you —
  // not an amount to pay. Offering "Settle X" here would contradict the plan on
  // the group screen, so the action is withheld and we point at the plan instead.
  const simplified = group.useSimplifiedDebts === true;

  return (
    <GlassModal
      title={otherName}
      large
      onClose={onClose}
      footer={
        iOwe && !simplified ? (
          <button
            type="button"
            onClick={() => {
              onSettle(otherUid, Math.round(-stmt.net * 100) / 100);
              onClose();
            }}
            className="btn-prominent w-full"
          >
            Settle {formatCurrency(-stmt.net)}
          </button>
        ) : undefined
      }
    >
      <div className="flex flex-col items-center text-center pt-2 pb-1">
        <Avatar name={otherName} photoURL={group.members[otherUid]?.photoURL} size={64} seed={otherUid} />
        <p
          className={`t-title2 mt-3 ${
            settled ? "text-[var(--text-primary)]" : iOwe ? "text-[var(--neg)]" : "text-[var(--pos)]"
          }`}
        >
          {describeNet(stmt.net, otherName, formatCurrency)}
        </p>
        <p className="t-footnote text-[var(--text-secondary)] mt-0.5">Just between you two, in {group.name}</p>
        {(!isSettled(stmt.pendingFromMe) || !isSettled(stmt.pendingFromThem)) && (
          <p className="t-footnote text-[var(--warning)] mt-2 max-w-[320px]">
            {!isSettled(stmt.pendingFromThem)
              ? `${formatCurrency(stmt.pendingFromThem)} from ${otherName} is waiting for your approval`
              : `${formatCurrency(stmt.pendingFromMe)} you sent is waiting for ${otherName} to approve`}
            . Not counted above.
          </p>
        )}
      </div>

      <ListSection elevated>
        <Row title={`You covered for ${otherName}`} detail={<span className="t-numeral">{formatCurrency(stmt.iCoveredForThem)}</span>} />
        <Row title={`${otherName} covered for you`} detail={<span className="t-numeral">{formatCurrency(stmt.theyCoveredForMe)}</span>} />
        {!isSettled(stmt.iPaid) && (
          <Row title="Payments you sent" detail={<span className="t-numeral text-[var(--pos)]">{formatCurrency(stmt.iPaid)}</span>} />
        )}
        {!isSettled(stmt.theyPaid) && (
          <Row title={`Payments ${otherName} sent`} detail={<span className="t-numeral text-[var(--pos)]">{formatCurrency(stmt.theyPaid)}</span>} />
        )}
      </ListSection>

      <ListSection
        elevated
        header={stmt.rows.length > 0 ? `${stmt.rows.length} ${stmt.rows.length === 1 ? "Entry" : "Entries"}` : "History"}
        footer={
          simplified && !settled
            ? "This group combines payments, so these amounts are your shared history. Use the group’s balances to see who to pay."
            : undefined
        }
      >
        {stmt.rows.length === 0 ? (
          <Row title={<span className="text-[var(--text-secondary)]">No shared expenses in this group yet</span>} />
        ) : (
          [...stmt.rows].reverse().map((row) => {
            const words = rowWords(row, otherName);
            return (
              <Row
                key={row.key}
                title={row.label}
                subtitle={`${shortDate(row.ts)} · ${words.text}`}
                detail={
                  <span className="flex flex-col items-end leading-tight">
                    <span
                      className={`t-subhead font-semibold t-numeral ${
                        words.tone === "owe" ? "text-[var(--neg)]" : words.tone === "get" ? "text-[var(--pos)]" : "text-[var(--text-secondary)]"
                      }`}
                    >
                      {row.informationalOnly ? "—" : `${row.delta > 0 ? "+" : "−"}${formatCurrency(Math.abs(row.delta))}`}
                    </span>
                    <span className="t-caption text-[var(--text-secondary)]">
                      {isSettled(row.balance)
                        ? "settled"
                        : row.balance > 0
                        ? `owes you ${formatCurrency(row.balance)}`
                        : `you owe ${formatCurrency(-row.balance)}`}
                    </span>
                  </span>
                }
              />
            );
          })
        )}
      </ListSection>

      <ListSection elevated>
        <LinkRow href={`/reports?person=${otherUid}&group=${group.id}`} title="Full Statement" subtitle="Every group you share, with export" />
      </ListSection>
    </GlassModal>
  );
}
