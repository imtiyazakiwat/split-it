"use client";

import { Expense, Settlement } from "@/lib/types";
import { formatCurrency } from "@/lib/balance";

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
  if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function timeLabel(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
}

function ReceiptIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z" />
      <path d="M9 8h6M9 12h6" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--pos)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12 2.5 2.5 4.5-5" />
    </svg>
  );
}

export default function ActivityTimeline({
  expenses,
  settlements,
  memberName,
  currentUid,
  isAdmin,
  limit,
  onEditExpense,
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
  onEditExpense: (e: Expense) => void;
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
    return <p className="text-center text-[var(--text-tertiary)] text-sm py-10">No activity yet.</p>;
  }

  const rows = shown.map((item, i) => {
    const bucket = dateBucket(item.ts);
    const prevBucket = i > 0 ? dateBucket(shown[i - 1].ts) : null;
    return { item, bucket, showBucket: bucket !== prevBucket };
  });

  return (
    <div className="relative">
      {/* connecting line */}
      <div className="absolute left-[18px] top-2 bottom-2 w-px bg-[var(--fill)]" aria-hidden />
      <div className="space-y-1">
        {rows.map(({ item, bucket, showBucket }, i) => {
          const isSettlement = item.type === "settlement";
          const s = isSettlement ? (item.data as Settlement) : null;
          const e = !isSettlement ? (item.data as Expense) : null;

          return (
            <div key={i}>
              {showBucket && (
                <div className="relative z-[1] inline-block bg-[var(--background)] rounded-full px-2.5 py-0.5 my-1.5 ml-0.5">
                  <span className="text-[12px] font-medium text-[var(--text-secondary)]">{bucket}</span>
                </div>
              )}
              <div
                className="relative flex items-start gap-3 py-1.5 cursor-pointer"
                onClick={() => (e ? onOpenExpense(e) : s ? onOpenSettlement(s) : undefined)}
              >
                <span
                  className={`relative z-[1] w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
                    isSettlement ? "bg-[var(--tint-success)]" : "bg-[var(--tint-accent-2)]"
                  }`}
                >
                  {isSettlement ? <CheckIcon /> : <ReceiptIcon />}
                </span>

                <div className="flex-1 min-w-0">
                  {e && (
                    <>
                      <p className="text-[15px] text-[var(--text-primary)]">
                        <span className="font-semibold">{memberName(e.createdBy)}</span>
                        <span className="text-[var(--text-tertiary)]">
                          {e.editAction === "edited" ? " edited " : " added "}
                        </span>
                        <span className="font-semibold text-[var(--brand)]">{e.description}</span>
                      </p>
                      <p className="text-[13px] text-[var(--text-tertiary)] mt-0.5">
                        {formatCurrency(e.amount)} · split {e.splits.length} ways
                      </p>
                      {isAdmin && (
                        <div className="flex gap-3 mt-1">
                          <button onClick={(ev) => { ev.stopPropagation(); onEditExpense(e); }} className="text-[12px] text-[var(--brand)] tap-shrink">Edit</button>
                          <button onClick={(ev) => { ev.stopPropagation(); onDeleteExpense(e); }} className="text-[12px] text-[var(--neg)] tap-shrink">Delete</button>
                        </div>
                      )}
                    </>
                  )}

                  {s && (
                    <>
                      <p className="text-[15px] text-[var(--text-primary)]">
                        {s.status === "pending" ? (
                          <><span className="font-semibold">{memberName(s.fromUid)}</span><span className="text-[var(--text-tertiary)]"> requested from </span><span className="font-semibold">{memberName(s.toUid)}</span></>
                        ) : s.status === "rejected" ? (
                          <><span className="font-semibold">{memberName(s.fromUid)}</span><span className="text-[var(--text-tertiary)]"> — request rejected</span></>
                        ) : (
                          <><span className="font-semibold">{memberName(s.fromUid)}</span><span className="text-[var(--text-tertiary)]"> paid </span><span className="font-semibold text-[var(--pos)]">{memberName(s.toUid)}</span></>
                        )}
                      </p>
                      <p className="text-[13px] text-[var(--text-tertiary)] mt-0.5">
                        {formatCurrency(s.amount)}{s.note ? ` · ${s.note}` : ""}
                      </p>
                      {s.receiptUrls.length > 0 && (
                        <div className="flex gap-2 mt-1">
                          {s.receiptUrls.map((url, ri) => (
                            <a key={ri} href={url} target="_blank" rel="noopener noreferrer" className="text-[12px] text-[var(--brand)]">Screenshot {ri + 1}</a>
                          ))}
                        </div>
                      )}
                      {s.status === "pending" && s.toUid === currentUid && (
                        <div className="flex gap-2 mt-1.5">
                          <button onClick={(ev) => { ev.stopPropagation(); onApprove(s); }} className="rounded-full bg-[var(--brand-solid)] text-white px-3 py-1 text-[12px] font-medium tap-shrink">Approve</button>
                          {canForward && (
                            <button onClick={(ev) => { ev.stopPropagation(); onForward(s); }} className="rounded-full bg-[var(--fill)] text-[var(--text-secondary)] px-3 py-1 text-[12px] font-medium tap-shrink">Forward</button>
                          )}
                          <button onClick={(ev) => { ev.stopPropagation(); onReject(s); }} className="rounded-full bg-[var(--fill)] text-[var(--text-secondary)] px-3 py-1 text-[12px] font-medium tap-shrink">Reject</button>
                        </div>
                      )}
                    </>
                  )}
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <span className="text-[12px] text-[var(--text-tertiary)]">{timeLabel(item.ts)}</span>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-quaternary)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
