"use client";

import { useState } from "react";
import { Group, Expense, Settlement } from "@/lib/types";
import { formatCurrency } from "@/lib/balance";
import { categoryMeta } from "@/lib/categories";
import GlassModal from "@/components/ui/GlassModal";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { ButtonRow, ListSection, Row } from "@/components/ui/List";
import { Avatar } from "@/components/ui/Controls";
import { CategoryGlyph, CheckCircle, categoryTint } from "@/components/ui/Icons";

function fullDate(ts: number): string {
  return new Date(ts).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function Receipts({ urls, label }: { urls: string[]; label: string }) {
  if (urls.length === 0) return null;
  return (
    <ListSection elevated header={label}>
      <div className="flex gap-2.5 flex-wrap p-3">
        {urls.map((url, i) => (
          <a key={url + i} href={url} target="_blank" rel="noopener noreferrer" className="tap-shrink">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={`${label} ${i + 1}`} className="w-[72px] h-[72px] rounded-[12px] object-cover bg-[var(--fill-soft)]" />
          </a>
        ))}
      </div>
    </ListSection>
  );
}

/**
 * Detail for one ledger item. Edit opens the edit sheet; Delete lives at the
 * bottom behind a confirmation (the list also offers swipe-to-delete with
 * Undo).
 */
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
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (expense) {
    const cat = categoryMeta(expense.category);
    return (
      <GlassModal title="Expense" onClose={onClose}>
        <div className="flex flex-col items-center text-center pt-2 pb-1">
          <span className="w-14 h-14 rounded-[16px] grid place-items-center text-white" style={{ background: categoryTint(expense.category) }}>
            <CategoryGlyph id={expense.category} size={28} />
          </span>
          <p className="t-headline text-[var(--text-primary)] mt-3 max-w-full truncate selectable">{expense.description}</p>
          <p className="t-large-title t-numeral text-[var(--text-primary)] mt-0.5">{formatCurrency(expense.amount)}</p>
          <p className="t-subhead text-[var(--text-secondary)]">{cat.label}</p>
        </div>

        <ListSection elevated>
          <Row title="Paid by" detail={memberName(expense.paidBy)} />
          <Row
            title="Split"
            detail={`${expense.splitType === "equal" ? "Equally" : expense.splitType === "exact" ? "By amount" : "By percentage"} · ${expense.splits.length}`}
          />
          <Row title="Date" detail={fullDate(expense.updatedAt || expense.createdAt)} />
        </ListSection>

        <ListSection elevated header="Shares">
          {expense.splits.map((sp) => (
            <Row
              key={sp.uid}
              leading={<Avatar name={group.members[sp.uid]?.displayName || memberName(sp.uid)} photoURL={group.members[sp.uid]?.photoURL} size={30} seed={sp.uid} uid={sp.uid} />}
              separatorInset={58}
              title={sp.uid === currentUid ? "You" : memberName(sp.uid)}
              subtitle={sp.uid === expense.paidBy ? "Paid" : undefined}
              detail={<span className="t-numeral text-[var(--text-primary)]">{formatCurrency(sp.amount)}</span>}
            />
          ))}
        </ListSection>

        <Receipts urls={expense.receiptUrls} label="Receipts" />

        {isAdmin && (onEditExpense || onDeleteExpense) && (
          <ListSection elevated>
            {onEditExpense && (
              <ButtonRow
                onClick={() => {
                  onEditExpense(expense);
                  onClose();
                }}
                title="Edit Expense"
                action
              />
            )}
            {onDeleteExpense && <ButtonRow onClick={() => setConfirmDelete(true)} title="Delete Expense" destructive />}
          </ListSection>
        )}

        {confirmDelete && onDeleteExpense && (
          <ConfirmDialog
            title={`Delete “${expense.description}”?`}
            message="It’s removed from everyone’s balances. You can undo for a few seconds."
            confirmLabel="Delete Expense"
            destructive
            onConfirm={() => {
              onDeleteExpense(expense);
              onClose();
            }}
            onClose={() => setConfirmDelete(false)}
          />
        )}
      </GlassModal>
    );
  }

  if (settlement) {
    const s = settlement;
    const isOffset = s.kind === "offset";
    const statusText =
      s.status === "pending"
        ? "Waiting for approval"
        : s.status === "rejected"
        ? "Declined"
        : isOffset
        ? "Offset · no money moved"
        : "Settled";
    const statusColor =
      s.status === "approved" ? "var(--green)" : s.status === "pending" ? "var(--orange)" : "var(--gray)";
    return (
      <GlassModal title="Payment" onClose={onClose}>
        <div className="flex flex-col items-center text-center pt-2 pb-1">
          <span className="w-14 h-14 rounded-full grid place-items-center text-white" style={{ background: statusColor }}>
            <CheckCircle size={28} />
          </span>
          <p className="t-large-title t-numeral text-[var(--text-primary)] mt-3">{formatCurrency(s.amount)}</p>
          <p className="t-subhead text-[var(--text-secondary)] mt-0.5">
            {memberName(s.fromUid)} → {memberName(s.toUid)}
          </p>
        </div>

        <ListSection elevated>
          <Row title="Status" detail={statusText} />
          <Row title="Date" detail={fullDate(s.createdAt)} />
          {s.note && <Row title="Note" detail={<span className="selectable">{s.note}</span>} />}
          {s.expenseIds && s.expenseIds.length > 0 && (
            <Row title="Covers" detail={`${s.expenseIds.length} expense${s.expenseIds.length !== 1 ? "s" : ""}`} />
          )}
        </ListSection>

        <Receipts urls={s.receiptUrls} label="Screenshots" />
      </GlassModal>
    );
  }

  return null;
}
