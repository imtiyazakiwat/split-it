"use client";

import { useRef } from "react";
import { Group, Expense, Settlement } from "@/lib/types";
import { canRespondToSettlement, formatCurrency } from "@/lib/balance";
import { categoryMeta } from "@/lib/categories";
import { Sheet, SheetTextButton, type SheetHandle } from "@/components/kit/Sheet";
import { DetailRow, List, Row, RowButton, Section } from "@/components/kit/List";
import { Avatar } from "@/components/kit/Avatar";
import { CategoryTile } from "@/components/kit/Tile";
import { Button } from "@/components/kit/Controls";
import { Icon } from "@/components/kit/Icon";

function fullDate(ts: number): string {
  return new Date(ts).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function Thumbs({ urls, label }: { urls: string[]; label: string }) {
  return (
    <div className="flex flex-wrap gap-2 px-1">
      {urls.map((url, i) => (
        <a
          key={url + i}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="relative block h-[72px] w-[72px] overflow-hidden rounded-[14px] bg-[var(--fill-3)]"
          aria-label={`${label} ${i + 1}, opens in a new tab`}
        >
          <span className="absolute inset-0 flex items-center justify-center text-label-3">
            <Icon name="photo" size={22} />
          </span>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt=""
            loading="lazy"
            className="relative h-full w-full object-cover"
            onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")}
          />
        </a>
      ))}
    </div>
  );
}

const STATUS = {
  approved: { text: "Approved", cls: "is-green" },
  pending: { text: "Waiting for approval", cls: "is-orange" },
  rejected: { text: "Declined", cls: "is-gray" },
} as const;

/**
 * Detail for one ledger record, opened from its row (or a notification deep
 * link). Expenses: who paid, how it splits, receipts; admins get Edit in the
 * header and Delete at the bottom (with Undo). Settlements: the payment and
 * its status, plus Approve / Forward / Decline when it's this user's call.
 */
export default function ActivityDetailModal({
  expense,
  settlement,
  group,
  memberName,
  currentUid,
  isAdmin,
  canForward = false,
  busy = false,
  onEditExpense,
  onDeleteExpense,
  onApprove,
  onReject,
  onForward,
  onClose,
}: {
  expense?: Expense | null;
  settlement?: Settlement | null;
  group: Group;
  memberName: (uid: string) => string;
  currentUid: string;
  isAdmin: boolean;
  canForward?: boolean;
  busy?: boolean;
  onEditExpense?: (e: Expense) => void;
  onDeleteExpense?: (e: Expense) => void;
  onApprove?: (s: Settlement) => void;
  onReject?: (s: Settlement) => void;
  onForward?: (s: Settlement) => void;
  onClose: () => void;
}) {
  const sheetRef = useRef<SheetHandle>(null);

  if (expense) {
    const cat = categoryMeta(expense.category);
    const splitText =
      expense.splitType === "equal"
        ? `Equally · ${expense.splits.length} ways`
        : `${expense.splitType === "exact" ? "Exact amounts" : "By percentage"} · ${expense.splits.length} ways`;
    return (
      <Sheet
        ref={sheetRef}
        title="Expense"
        subtitle={group.name}
        onClose={onClose}
        trailing={
          isAdmin && onEditExpense ? (
            <SheetTextButton
              onClick={() => {
                onEditExpense(expense);
                sheetRef.current?.dismiss();
              }}
            >
              Edit
            </SheetTextButton>
          ) : undefined
        }
      >
        <div className="flex flex-col items-center px-2 pb-2 pt-2 text-center">
          <CategoryTile id={expense.category} size="xl" />
          <p className="t-title3 mt-3 [overflow-wrap:anywhere]">{expense.description}</p>
          <p className="amount-hero mt-1 text-[40px]">{formatCurrency(expense.amount)}</p>
          <p className="t-footnote mt-1 text-label-2">
            {cat.label}
            {expense.editAction === "edited" ? " · Edited" : ""}
          </p>
        </div>

        <Section tight>
          <List>
            <DetailRow label="Paid by" value={memberName(expense.paidBy)} />
            <DetailRow label="Split" value={splitText} />
            <DetailRow label="Date" value={fullDate(expense.updatedAt || expense.createdAt)} />
            {expense.createdBy !== expense.paidBy && (
              <DetailRow label="Added by" value={memberName(expense.createdBy)} />
            )}
          </List>
        </Section>

        <Section header="Shares">
          <List>
            {expense.splits.map((sp) => {
              const isPayer = sp.uid === expense.paidBy;
              const name = sp.uid === currentUid ? "You" : memberName(sp.uid);
              return (
                <Row
                  key={sp.uid}
                  inset="avatar"
                  leading={
                    <Avatar
                      name={group.members[sp.uid]?.displayName || name}
                      photoURL={group.members[sp.uid]?.photoURL}
                      size={36}
                    />
                  }
                  title={name}
                  subtitle={isPayer ? "Paid the bill" : undefined}
                  trailing={<span className="num t-body shrink-0">{formatCurrency(sp.amount)}</span>}
                />
              );
            })}
          </List>
        </Section>

        {expense.receiptUrls.length > 0 && (
          <Section header="Receipts">
            <Thumbs urls={expense.receiptUrls} label="Receipt" />
          </Section>
        )}

        {isAdmin && onDeleteExpense && (
          <Section footer="You can undo for a few seconds after deleting.">
            <List>
              <RowButton
                onClick={() => {
                  onDeleteExpense(expense);
                  sheetRef.current?.dismiss();
                }}
                title="Delete Expense"
                destructive
                centered
              />
            </List>
          </Section>
        )}
      </Sheet>
    );
  }

  if (settlement) {
    const s = settlement;
    const status = STATUS[s.status];
    const canRespond = canRespondToSettlement(s, currentUid);
    const isOffset = s.kind === "offset";
    const fromName = memberName(s.fromUid);
    // "You" leads a sentence; mid-sentence it reads "paid you".
    const toName = s.toUid === currentUid ? "you" : memberName(s.toUid);
    return (
      <Sheet
        ref={sheetRef}
        title={isOffset ? "Offset" : s.kind === "transfer" ? "Direct Payment" : "Payment"}
        subtitle={group.name}
        onClose={onClose}
        footer={
          canRespond ? (
            <div className="flex gap-2">
              <Button block busy={busy} onClick={() => onApprove?.(s)}>
                {isOffset ? "Accept Offset" : "Approve"}
              </Button>
              {canForward && !isOffset && s.toUid === currentUid && (
                <Button variant="gray" disabled={busy} onClick={() => onForward?.(s)}>
                  Forward
                </Button>
              )}
              <Button variant="gray" disabled={busy} onClick={() => onReject?.(s)}>
                Decline
              </Button>
            </div>
          ) : undefined
        }
      >
        <div className="flex flex-col items-center px-2 pb-2 pt-2 text-center">
          <div className="flex items-center gap-3">
            <Avatar name={group.members[s.fromUid]?.displayName || fromName} photoURL={group.members[s.fromUid]?.photoURL} size={52} />
            <span className="text-label-3" aria-hidden>
              <Icon name={isOffset ? "arrow.left.right" : "chevron.right"} size={22} strokeWidth={2.2} />
            </span>
            <Avatar name={group.members[s.toUid]?.displayName || toName} photoURL={group.members[s.toUid]?.photoURL} size={52} />
          </div>
          <p className="amount-hero mt-4 text-[40px]">{formatCurrency(s.amount)}</p>
          <p className="t-subhead mt-1 text-label-2">
            {isOffset ? `${fromName} and ${toName} cancelled out balances` : `${fromName} paid ${toName}`}
          </p>
          <span className={`capsule mt-3 ${isOffset ? "is-tint" : status.cls}`}>
            {isOffset ? "No money moved" : status.text}
          </span>
        </div>

        <Section tight>
          <List>
            <DetailRow label="Date" value={fullDate(s.createdAt)} />
            {s.note && (
              <div className="row items-start">
                <span className="row-main">
                  <span className="row-title">Note</span>
                </span>
                <span className="t-body max-w-[60%] text-right text-label-2 [overflow-wrap:anywhere]">{s.note}</span>
              </div>
            )}
            {s.expenseIds && s.expenseIds.length > 0 && (
              <DetailRow
                label="Covers"
                value={`${s.expenseIds.length} expense${s.expenseIds.length !== 1 ? "s" : ""}`}
              />
            )}
          </List>
        </Section>

        {s.receiptUrls.length > 0 && (
          <Section header="Screenshots">
            <Thumbs urls={s.receiptUrls} label="Screenshot" />
          </Section>
        )}

        {canRespond && (
          <p className="section-footer mt-4">
            Check your bank or UPI app before approving. Approving updates everyone&rsquo;s balance.
          </p>
        )}
      </Sheet>
    );
  }

  return null;
}
