"use client";

import { Expense, Settlement } from "@/lib/types";
import { formatCurrency } from "@/lib/balance";
import { fromPaise, toPaise } from "@/lib/money";
import { List, RowButton, Section } from "@/components/kit/List";
import { CategoryTile, IconTile } from "@/components/kit/Tile";
import { SwipeRow } from "@/components/kit/SwipeRow";
import { EmptyState } from "@/components/kit/Controls";

type Item =
  | { type: "expense"; data: Expense; ts: number }
  | { type: "settlement"; data: Settlement; ts: number };

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

/** What this expense did to *my* balance, in words. Display only. */
function myEffect(e: Expense, me: string): { text: string; tone: "pos" | "neg" | "flat" } {
  const mine = e.splits.find((s) => s.uid === me)?.amount ?? 0;
  if (e.paidBy === me) {
    const lent = fromPaise(toPaise(e.amount) - toPaise(mine));
    return lent > 0 ? { text: `you lent ${formatCurrency(lent)}`, tone: "pos" } : { text: "just you", tone: "flat" };
  }
  if (mine > 0) return { text: `you borrowed ${formatCurrency(mine)}`, tone: "neg" };
  return { text: "not involved", tone: "flat" };
}

function settlementTile(s: Settlement) {
  if (s.kind === "offset") return <IconTile icon="arrow.left.right" color="var(--indigo)" />;
  if (s.kind === "transfer") return <IconTile icon="rupee.bubble" color="var(--teal)" />;
  if (s.status === "pending") return <IconTile icon="clock" color="var(--orange)" />;
  if (s.status === "rejected") return <IconTile icon="xmark" color="var(--gray)" />;
  return <IconTile icon="checkmark" color="var(--green)" />;
}

/**
 * The group's ledger, newest first, in date sections — one row per record,
 * one tap target per row (it opens the detail sheet). Admins can also swipe
 * an expense to delete it; the detail sheet is the non-gesture path, and
 * either way the delete waits out an Undo window.
 */
export default function ActivityTimeline({
  expenses,
  settlements,
  memberName,
  currentUid,
  isAdmin,
  onDeleteExpense,
  onOpenExpense,
  onOpenSettlement,
  emptyAction,
}: {
  expenses: Expense[];
  settlements: Settlement[];
  memberName: (uid: string) => string;
  currentUid: string;
  isAdmin: boolean;
  onDeleteExpense: (e: Expense) => void;
  onOpenExpense: (e: Expense) => void;
  onOpenSettlement: (s: Settlement) => void;
  emptyAction?: React.ReactNode;
}) {
  const items: Item[] = [
    ...expenses
      .filter((e) => e.editAction !== "deleted")
      .map((e) => ({ type: "expense" as const, data: e, ts: e.updatedAt || e.createdAt })),
    ...settlements.map((s) => ({ type: "settlement" as const, data: s, ts: s.createdAt })),
  ].sort((a, b) => b.ts - a.ts);

  if (items.length === 0) {
    return (
      <Section header="Activity">
        <div className="card">
          <EmptyState
            compact
            icon="receipt"
            title="No Expenses Yet"
            message="Add the first bill and everyone's share is worked out for you."
            action={emptyAction}
          />
        </div>
      </Section>
    );
  }

  // Bucket in order; items are already newest first.
  const buckets: { label: string; items: Item[] }[] = [];
  for (const item of items) {
    const label = dateBucket(item.ts);
    const last = buckets[buckets.length - 1];
    if (last && last.label === label) last.items.push(item);
    else buckets.push({ label, items: [item] });
  }

  return (
    <>
      {buckets.map((bucket, bi) => (
        <Section key={bucket.label} header={bi === 0 ? `Activity · ${bucket.label}` : bucket.label}>
          <List>
            {bucket.items.map((item) => {
              if (item.type === "expense") {
                const e = item.data;
                const effect = myEffect(e, currentUid);
                const row = (
                  <RowButton
                    key={`expense-${e.id}`}
                    onClick={() => onOpenExpense(e)}
                    inset="tile"
                    leading={<CategoryTile id={e.category} />}
                    title={e.description}
                    subtitle={
                      <>
                        {memberName(e.paidBy)} paid {formatCurrency(e.amount)}
                        {e.editAction === "edited" ? " · edited" : ""}
                      </>
                    }
                    trailing={
                      <span className="flex shrink-0 flex-col items-end">
                        <span
                          className={`t-footnote font-semibold ${
                            effect.tone === "pos" ? "text-pos" : effect.tone === "neg" ? "text-neg" : "text-label-3"
                          }`}
                        >
                          {effect.text}
                        </span>
                        <span className="t-caption text-label-3">{timeLabel(item.ts)}</span>
                      </span>
                    }
                    chevron
                  />
                );
                return isAdmin ? (
                  <SwipeRow
                    key={`expense-${e.id}`}
                    inset={58}
                    actions={[
                      { label: "Delete", icon: "trash", color: "var(--red)", removesRow: true, onAction: () => onDeleteExpense(e) },
                    ]}
                  >
                    {row}
                  </SwipeRow>
                ) : (
                  row
                );
              }
              const s = item.data;
              const isOffset = s.kind === "offset";
              // "You" leads; mid-sentence it's "paid you".
              const toName = s.toUid === currentUid ? "you" : memberName(s.toUid);
              const title =
                s.kind === "transfer"
                  ? `${memberName(s.fromUid)} sent ${toName}`
                  : isOffset
                  ? `${memberName(s.fromUid)} ⇄ ${memberName(s.toUid)}`
                  : `${memberName(s.fromUid)} paid ${toName}`;
              const status = isOffset
                ? "Offset · no money moved"
                : s.kind === "transfer"
                ? "Direct payment"
                : s.status === "pending"
                ? "Waiting for approval"
                : s.status === "rejected"
                ? "Declined"
                : "Settled up";
              return (
                <RowButton
                  key={`settlement-${s.id}`}
                  onClick={() => onOpenSettlement(s)}
                  inset="tile"
                  leading={settlementTile(s)}
                  title={title}
                  subtitle={
                    <>
                      <span className={s.status === "pending" && !isOffset ? "text-warn" : undefined}>{status}</span>
                      {s.note ? ` · ${s.note}` : ""}
                    </>
                  }
                  trailing={
                    <span className="flex shrink-0 flex-col items-end">
                      <span
                        className={`num t-subhead font-semibold ${
                          s.status === "rejected" ? "text-label-3 line-through" : "text-label"
                        }`}
                      >
                        {formatCurrency(s.amount)}
                      </span>
                      <span className="t-caption text-label-3">{timeLabel(item.ts)}</span>
                    </span>
                  }
                  chevron
                />
              );
            })}
          </List>
        </Section>
      ))}
    </>
  );
}
