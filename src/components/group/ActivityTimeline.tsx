"use client";

import { Expense, Settlement } from "@/lib/types";
import { canRespondToSettlement, formatCurrency } from "@/lib/balance";
import { ListSection, SwipeRow } from "@/components/ui/List";
import { EmptyState } from "@/components/ui/Controls";
import { Arrows, CategoryGlyph, CheckCircle, ChevronRight, Clock, categoryTint } from "@/components/ui/Icons";

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
    ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  });
}

function timeLabel(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
}

/**
 * The group's ledger as an inset-grouped list, sectioned by day. One row =
 * one tap target (opens the detail sheet). Expenses swipe left to delete
 * (with Undo, handled by the parent); the detail sheet holds Edit and Delete
 * for anyone not using gestures. Settlement requests keep their decision
 * buttons inline, because that decision is the reason the row exists.
 */
export default function ActivityTimeline({
  expenses,
  settlements,
  memberName,
  currentUid,
  isAdmin,
  limit,
  onDeleteExpense,
  onApprove,
  onReject,
  onForward,
  canForward,
  onOpenExpense,
  onOpenSettlement,
}: {
  expenses: Expense[];
  settlements: Settlement[];
  memberName: (uid: string) => string;
  currentUid: string;
  isAdmin: boolean;
  limit?: number;
  onEditExpense?: (e: Expense) => void;
  onDeleteExpense: (e: Expense) => void;
  onApprove: (s: Settlement) => void;
  onReject: (s: Settlement) => void;
  onForward: (s: Settlement) => void;
  canForward: boolean;
  onOpenExpense: (e: Expense) => void;
  onOpenSettlement: (s: Settlement) => void;
}) {
  const items: Item[] = [
    ...expenses
      .filter((e) => e.editAction !== "deleted")
      .map((e) => ({ type: "expense" as const, data: e, ts: e.updatedAt || e.createdAt })),
    ...settlements.map((s) => ({ type: "settlement" as const, data: s, ts: s.createdAt })),
  ].sort((a, b) => b.ts - a.ts);

  const shown = limit ? items.slice(0, limit) : items;

  if (shown.length === 0) {
    return (
      <EmptyState
        icon={<Clock size={52} weight={1.4} />}
        title="No Expenses Yet"
        message="Tap + to add the first expense. Everyone in the group sees it straight away."
      />
    );
  }

  // Group into day sections, preserving order.
  const sections: { bucket: string; items: Item[] }[] = [];
  for (const item of shown) {
    const bucket = dateBucket(item.ts);
    const last = sections[sections.length - 1];
    if (last && last.bucket === bucket) last.items.push(item);
    else sections.push({ bucket, items: [item] });
  }

  return (
    <>
      {sections.map((section) => (
        <ListSection key={`${section.items[0].type}-${section.items[0].data.id}`} header={section.bucket} className="!mt-5 first:!mt-0">
          {section.items.map((item) => {
            if (item.type === "expense") {
              const e = item.data;
              const myShare = e.splits.find((sp) => sp.uid === currentUid)?.amount ?? 0;
              const iPaid = e.paidBy === currentUid;
              const row = (
                <button
                  type="button"
                  onClick={() => onOpenExpense(e)}
                  className="list-row is-tall"
                  style={{ ["--sep-inset" as string]: "58px" }}
                >
                  <span className="icon-tile" style={{ background: categoryTint(e.category) }}>
                    <CategoryGlyph id={e.category} size={18} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block t-body text-[var(--text-primary)] truncate">{e.description}</span>
                    <span className="block t-subhead text-[var(--text-secondary)] truncate mt-px">
                      {memberName(e.paidBy)} paid {formatCurrency(e.amount)}
                      {e.editAction === "edited" ? " · Edited" : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    {myShare > 0 || iPaid ? (
                      <>
                        <span className="block t-caption text-[var(--text-secondary)]">
                          {iPaid ? "you lent" : "you owe"}
                        </span>
                        <span
                          className={`block t-subhead font-semibold t-numeral ${
                            iPaid ? "text-[var(--pos)]" : "text-[var(--neg)]"
                          }`}
                        >
                          {formatCurrency(iPaid ? e.amount - myShare : myShare)}
                        </span>
                      </>
                    ) : (
                      <span className="t-footnote text-[var(--text-secondary)]">not involved</span>
                    )}
                  </span>
                  <ChevronRight className="row-chevron -mr-1" />
                </button>
              );
              return isAdmin && !e.id.startsWith("tmp-") ? (
                <SwipeRow
                  key={`expense-${e.id}`}
                  separatorInset={58}
                  actions={[{ label: "Delete", tone: "destructive", onClick: () => onDeleteExpense(e) }]}
                >
                  {row}
                </SwipeRow>
              ) : (
                <div key={`expense-${e.id}`} className="list-row-wrap" style={{ ["--sep-inset" as string]: "58px" }}>
                  {row}
                </div>
              );
            }

            const s = item.data;
            const isOffset = s.kind === "offset";
            const respond = canRespondToSettlement(s, currentUid);
            const title =
              s.kind === "transfer"
                ? `${memberName(s.fromUid)} paid ${memberName(s.toUid)} directly`
                : isOffset
                ? `${memberName(s.fromUid)} and ${memberName(s.toUid)} offset balances`
                : s.status === "pending"
                ? `${memberName(s.fromUid)} → ${memberName(s.toUid)}`
                : s.status === "rejected"
                ? `${memberName(s.fromUid)} → ${memberName(s.toUid)}`
                : `${memberName(s.fromUid)} paid ${memberName(s.toUid)}`;
            const status =
              s.status === "pending"
                ? respond
                  ? "Waiting for you"
                  : "Waiting for approval"
                : s.status === "rejected"
                ? "Declined"
                : isOffset
                ? "No money moved"
                : "Settled";
            const statusTone =
              s.status === "pending" ? "text-[var(--warning)]" : s.status === "rejected" ? "text-[var(--neg)]" : "text-[var(--text-secondary)]";
            return (
              <div key={`settlement-${s.id}`} className="list-row-wrap" style={{ ["--sep-inset" as string]: "58px" }}>
                <button type="button" onClick={() => onOpenSettlement(s)} className="list-row is-tall">
                  <span
                    className="icon-tile"
                    style={{
                      background: isOffset ? "var(--indigo)" : s.status === "rejected" ? "var(--gray)" : s.status === "pending" ? "var(--orange)" : "var(--green)",
                    }}
                  >
                    {isOffset ? <Arrows size={17} /> : <CheckCircle size={18} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block t-body text-[var(--text-primary)] truncate">{title}</span>
                    <span className={`block t-subhead truncate mt-px ${statusTone}`}>
                      {status}
                      {s.note ? <span className="text-[var(--text-secondary)]"> · {s.note}</span> : null}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block t-subhead font-semibold t-numeral text-[var(--text-primary)]">
                      {formatCurrency(s.amount)}
                    </span>
                    <span className="block t-caption text-[var(--text-secondary)]">{timeLabel(item.ts)}</span>
                  </span>
                  <ChevronRight className="row-chevron -mr-1" />
                </button>
                {respond && (
                  <div className="flex gap-2 px-4 pb-3 -mt-0.5 pl-[58px]">
                    <button
                      type="button"
                      onClick={() => onApprove(s)}
                      className="btn-prominent btn-small"
                    >
                      {isOffset ? "Accept" : "Approve"}
                    </button>
                    {canForward && !isOffset && s.toUid === currentUid && (
                      <button type="button" onClick={() => onForward(s)} className="btn-gray btn-small">
                        Forward
                      </button>
                    )}
                    <button type="button" onClick={() => onReject(s)} className="btn-gray btn-small !text-[var(--neg)]">
                      Decline
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </ListSection>
      ))}
    </>
  );
}
