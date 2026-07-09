"use client";

import { Group, Expense, Settlement } from "@/lib/types";
import { formatCurrency } from "@/lib/balance";
import { categoryMeta } from "@/lib/categories";
import GlassModal from "@/components/ui/GlassModal";

function fullDate(ts: number): string {
  return new Date(ts).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function ActivityDetailModal({
  expense,
  settlement,
  group,
  memberName,
  currentUid,
  isAdmin,
  onEditExpense,
  onDeleteExpense,
  onClose,
}: {
  expense?: Expense | null;
  settlement?: Settlement | null;
  group: Group;
  memberName: (uid: string) => string;
  currentUid: string;
  isAdmin: boolean;
  onEditExpense?: (e: Expense) => void;
  onDeleteExpense?: (e: Expense) => void;
  onClose: () => void;
}) {
  if (expense) {
    const cat = categoryMeta(expense.category);
    return (
      <GlassModal title="Expense details" onClose={onClose}>
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <span className="w-12 h-12 rounded-2xl bg-indigo-100 flex items-center justify-center text-[24px] shrink-0">
              {cat.emoji}
            </span>
            <div className="min-w-0">
              <p className="text-[18px] font-bold text-slate-800 truncate">{expense.description}</p>
              <p className="text-[13px] text-slate-400">{cat.label}</p>
            </div>
            <p className="ml-auto text-[22px] font-extrabold text-slate-800">{formatCurrency(expense.amount)}</p>
          </div>

          <div className="rounded-[var(--radius-md)] bg-slate-50 p-3 space-y-1.5">
            <div className="flex justify-between text-[14px]">
              <span className="text-slate-400">Paid by</span>
              <span className="font-medium text-slate-700">{memberName(expense.paidBy)}</span>
            </div>
            <div className="flex justify-between text-[14px]">
              <span className="text-slate-400">Split</span>
              <span className="font-medium text-slate-700">
                {expense.splitType === "equal" ? "Equally" : expense.splitType} · {expense.splits.length} ways
              </span>
            </div>
            <div className="flex justify-between text-[14px]">
              <span className="text-slate-400">Date</span>
              <span className="font-medium text-slate-700">{fullDate(expense.updatedAt || expense.createdAt)}</span>
            </div>
          </div>

          <div>
            <p className="text-sm font-semibold text-slate-600 mb-2">Breakdown</p>
            <div className="space-y-1.5">
              {expense.splits.map((sp) => {
                const isPayer = sp.uid === expense.paidBy;
                const isMe = sp.uid === currentUid;
                return (
                  <div key={sp.uid} className="flex items-center gap-2.5">
                    {group.members[sp.uid]?.photoURL ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={group.members[sp.uid].photoURL} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
                    ) : (
                      <span className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-[12px] font-medium text-slate-500 shrink-0">
                        {(group.members[sp.uid]?.displayName || "?").charAt(0).toUpperCase()}
                      </span>
                    )}
                    <span className="text-[14px] text-slate-700 flex-1 truncate">
                      {isMe ? "You" : memberName(sp.uid)}
                      {isPayer && <span className="ml-1.5 text-[11px] text-green-600 font-medium">paid</span>}
                    </span>
                    <span className="text-[14px] font-semibold text-slate-800">{formatCurrency(sp.amount)}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {expense.receiptUrls.length > 0 && (
            <div>
              <p className="text-sm font-semibold text-slate-600 mb-2">Receipts</p>
              <div className="flex gap-2 flex-wrap">
                {expense.receiptUrls.map((url, i) => (
                  <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt={`Receipt ${i + 1}`} className="w-16 h-16 rounded-lg object-cover border border-slate-200" />
                  </a>
                ))}
              </div>
            </div>
          )}

          {isAdmin && (
            <div className="flex gap-2 pt-1">
              {onEditExpense && (
                <button
                  onClick={() => { onEditExpense(expense); onClose(); }}
                  className="flex-1 rounded-full bg-indigo-600 text-white py-2.5 text-[14px] font-medium tap-shrink"
                >
                  Edit
                </button>
              )}
              {onDeleteExpense && (
                <button
                  onClick={() => { onDeleteExpense(expense); onClose(); }}
                  className="flex-1 rounded-full bg-red-50 text-red-500 py-2.5 text-[14px] font-medium tap-shrink"
                >
                  Delete
                </button>
              )}
            </div>
          )}
        </div>
      </GlassModal>
    );
  }

  if (settlement) {
    const s = settlement;
    const statusColor =
      s.status === "approved" ? "text-green-600 bg-green-50" : s.status === "pending" ? "text-amber-600 bg-amber-50" : "text-red-500 bg-red-50";
    return (
      <GlassModal title="Payment details" onClose={onClose}>
        <div className="space-y-4">
          <div className="text-center">
            <p className="text-[28px] font-extrabold text-slate-800">{formatCurrency(s.amount)}</p>
            <p className="text-[14px] text-slate-500 mt-1">
              <span className="font-medium">{memberName(s.fromUid)}</span> → <span className="font-medium">{memberName(s.toUid)}</span>
            </p>
            <span className={`inline-block mt-2 rounded-full px-3 py-0.5 text-[12px] font-medium capitalize ${statusColor}`}>
              {s.status}
            </span>
          </div>

          <div className="rounded-[var(--radius-md)] bg-slate-50 p-3 space-y-1.5">
            <div className="flex justify-between text-[14px]">
              <span className="text-slate-400">Date</span>
              <span className="font-medium text-slate-700">{fullDate(s.createdAt)}</span>
            </div>
            {s.note && (
              <div className="flex justify-between text-[14px] gap-4">
                <span className="text-slate-400">Note</span>
                <span className="font-medium text-slate-700 text-right">{s.note}</span>
              </div>
            )}
            {s.expenseIds && s.expenseIds.length > 0 && (
              <div className="flex justify-between text-[14px]">
                <span className="text-slate-400">Covers</span>
                <span className="font-medium text-slate-700">{s.expenseIds.length} expense{s.expenseIds.length !== 1 ? "s" : ""}</span>
              </div>
            )}
          </div>

          {s.receiptUrls.length > 0 && (
            <div>
              <p className="text-sm font-semibold text-slate-600 mb-2">Screenshots</p>
              <div className="flex gap-2 flex-wrap">
                {s.receiptUrls.map((url, i) => (
                  <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt={`Screenshot ${i + 1}`} className="w-16 h-16 rounded-lg object-cover border border-slate-200" />
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      </GlassModal>
    );
  }

  return null;
}
