"use client";
import { useRef } from "react";
import { Expense, Group, Settlement } from "@/lib/types";
import { formatCurrency } from "@/lib/balance";
import { isSettled } from "@/lib/money";
import { buildPairStatement, describeNet, StatementRow } from "@/lib/statement";
import { Sheet, type SheetHandle } from "@/components/kit/Sheet";
import { DetailRow, List, Row, Section } from "@/components/kit/List";
import { Avatar } from "@/components/kit/Avatar";
import { Button } from "@/components/kit/Controls";
import { useNav } from "@/components/kit/nav";

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

/** "Why do I owe this?" — the running account with one person in one group. */
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
  const nav = useNav();
  const sheetRef = useRef<SheetHandle>(null);
  const otherName = group.members[otherUid]?.displayName || "Member";
  const stmt = buildPairStatement(meUid, otherUid, expenses, settlements);
  const settled = isSettled(stmt.net);
  const iOwe = !settled && stmt.net < 0;
  // With simplified debts on, the group's plan chains balances through third
  // parties, so this pairwise figure is history — not an amount to pay.
  const simplified = group.useSimplifiedDebts === true;
  const pending = !isSettled(stmt.pendingFromMe) || !isSettled(stmt.pendingFromThem);

  return (
    <Sheet
      ref={sheetRef}
      large
      title={otherName}
      subtitle={group.name}
      onClose={onClose}
      footer={
        <div className="flex gap-2">
          {iOwe && !simplified && (
            <Button
              block
              onClick={() => {
                onSettle(otherUid, Math.round(-stmt.net * 100) / 100);
                sheetRef.current?.dismiss();
              }}
            >
              Settle {formatCurrency(-stmt.net)}
            </Button>
          )}
          <Button
            block
            variant={iOwe && !simplified ? "tinted" : "prominent"}
            onClick={() => nav.push(`/reports?person=${otherUid}&group=${group.id}`)}
          >
            Full Statement
          </Button>
        </div>
      }
    >
      <div className="flex flex-col items-center px-2 pb-2 pt-3 text-center">
        <Avatar name={otherName} photoURL={group.members[otherUid]?.photoURL} size={64} />
        <p
          className={`t-title3 mt-3 ${settled ? "text-label" : iOwe ? "text-neg" : "text-pos"}`}
        >
          {describeNet(stmt.net, otherName, formatCurrency)}
        </p>
        <p className="t-footnote mt-1 text-label-2">Just between you two, in {group.name}</p>
        {pending && (
          <p className="t-footnote mt-2 max-w-[320px] text-warn">
            {!isSettled(stmt.pendingFromThem)
              ? `${formatCurrency(stmt.pendingFromThem)} from ${otherName} is waiting for your approval`
              : `${formatCurrency(stmt.pendingFromMe)} you sent is waiting for ${otherName} to approve`}
            . Not counted above.
          </p>
        )}
      </div>

      <Section header="Where it comes from">
        <List>
          <DetailRow label={`You covered for ${otherName}`} value={formatCurrency(stmt.iCoveredForThem)} />
          <DetailRow label={`${otherName} covered for you`} value={formatCurrency(stmt.theyCoveredForMe)} />
          {!isSettled(stmt.iPaid) && (
            <DetailRow label="Payments you sent" value={formatCurrency(stmt.iPaid)} valueClassName="text-pos" />
          )}
          {!isSettled(stmt.theyPaid) && (
            <DetailRow label={`Payments ${otherName} sent`} value={formatCurrency(stmt.theyPaid)} valueClassName="text-pos" />
          )}
        </List>
      </Section>

      <Section
        header={
          stmt.rows.length > 0
            ? `${stmt.rows.length} entr${stmt.rows.length === 1 ? "y" : "ies"} between you`
            : "History"
        }
        footer={
          simplified && !settled
            ? "This group combines payments, so these amounts are your shared history. The group's balances show who to pay."
            : undefined
        }
      >
        {stmt.rows.length === 0 ? (
          <div className="card p-4">
            <p className="t-subhead text-label-2">You haven&rsquo;t shared any expenses with {otherName} in this group.</p>
          </div>
        ) : (
          <List>
            {[...stmt.rows].reverse().map((row) => {
              const words = rowWords(row, otherName);
              return (
                <Row
                  key={row.key}
                  tall
                  title={row.label}
                  subtitle={`${shortDate(row.ts)} · ${words.text}`}
                  trailing={
                    <span className="flex shrink-0 flex-col items-end">
                      <span
                        className={`num t-subhead font-semibold ${
                          words.tone === "owe" ? "text-neg" : words.tone === "get" ? "text-pos" : "text-label-3"
                        }`}
                      >
                        {row.informationalOnly
                          ? "—"
                          : `${row.delta > 0 ? "+" : "−"}${formatCurrency(Math.abs(row.delta))}`}
                      </span>
                      <span className="t-caption text-label-2">
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
            })}
          </List>
        )}
      </Section>
    </Sheet>
  );
}
