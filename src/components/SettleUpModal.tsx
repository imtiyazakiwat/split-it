"use client";

import { useState } from "react";
import { Expense, SettlementMode } from "@/lib/types";
import { addSettlementRequest } from "@/lib/firestore";
import { uploadMultipleReceipts } from "@/lib/storage";
import { formatCurrency } from "@/lib/balance";
import GlassModal from "@/components/ui/GlassModal";
import GlassButton from "@/components/ui/GlassButton";

interface ExpenseWithSelection {
  expense: Expense;
  selected: boolean;
}

export default function SettleUpModal({
  groupId,
  fromUid,
  toUid,
  toName,
  suggestedAmount,
  expensesOwed,
  mode,
  onClose,
}: {
  groupId: string;
  fromUid: string;
  toUid: string;
  toName: string;
  suggestedAmount: number;
  expensesOwed: Expense[];
  mode: SettlementMode;
  onClose: () => void;
}) {
  // The per-expense picker only makes sense in "direct" mode, where the person
  // you pay is tied to the expenses they actually paid. In "simplified" mode
  // the payee may not have paid any expense you shared, so we settle the net.
  const showPicker = mode === "direct" && expensesOwed.length > 0;

  const [items, setItems] = useState<ExpenseWithSelection[]>(
    expensesOwed.map((e) => ({ expense: e, selected: false }))
  );
  const [customAmount, setCustomAmount] = useState("");
  const [useCustom, setUseCustom] = useState(false);
  const [receiptFiles, setReceiptFiles] = useState<File[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const selectedTotal = items
    .filter((i) => i.selected)
    .reduce((sum, i) => {
      const split = i.expense.splits.find((s) => s.uid === fromUid);
      return sum + (split?.amount || 0);
    }, 0);

  const baseAmount = showPicker ? selectedTotal : suggestedAmount;
  const displayAmount = useCustom ? (parseFloat(customAmount) || 0) : baseAmount;

  function toggleItem(index: number) {
    setItems((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], selected: !next[index].selected };
      return next;
    });
    if (useCustom) setUseCustom(false);
  }

  function handleReceipts(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    setReceiptFiles((prev) => [...prev, ...files]);
  }

  function removeReceipt(index: number) {
    setReceiptFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amt = useCustom ? (parseFloat(customAmount) || 0) : baseAmount;
    if (amt <= 0) {
      setError(
        useCustom
          ? "Enter a valid amount."
          : showPicker
          ? "Select at least one expense."
          : "Nothing to settle."
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      let receiptUrls: string[] = [];
      if (receiptFiles.length > 0) {
        receiptUrls = await uploadMultipleReceipts(groupId, receiptFiles);
      }
      const expenseIds = showPicker
        ? items.filter((i) => i.selected).map((i) => i.expense.id)
        : [];
      await addSettlementRequest(groupId, {
        fromUid,
        toUid,
        amount: amt,
        note: note.trim() || undefined,
        receiptUrls,
        expenseIds: expenseIds.length > 0 ? expenseIds : undefined,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send settlement request");
    } finally {
      setBusy(false);
    }
  }

  return (
    <GlassModal title={`Settle with ${toName}`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {showPicker && (
        <div>
          <p className="text-sm font-medium text-[var(--label-secondary)] mb-2">
            Select expenses to settle
          </p>
          <div className="space-y-1 rounded-[var(--radius-md)] border border-[var(--border-subtle)] p-1 max-h-60 overflow-y-auto">
            {items.map((item, i) => {
              const myShare = item.expense.splits.find((s) => s.uid === fromUid)?.amount || 0;
              return (
                <label
                  key={item.expense.id}
                  className="flex items-center gap-2.5 py-2 px-2.5 rounded-[var(--radius-sm)] tap-shrink"
                >
                  <input
                    type="checkbox"
                    checked={item.selected}
                    onChange={() => toggleItem(i)}
                    className="rounded accent-[var(--accent)] w-4 h-4 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] text-[var(--label-primary)] truncate font-medium">
                      {item.expense.description}
                    </p>
                    <p className="text-[12px] text-[var(--label-tertiary)]">
                      {formatCurrency(myShare)} of {formatCurrency(item.expense.amount)}
                    </p>
                  </div>
                  <span className="text-[14px] font-medium text-[var(--label-primary)] shrink-0">
                    {formatCurrency(myShare)}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
        )}

        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-[var(--label-secondary)]">
            Total: {formatCurrency(displayAmount)}
          </span>
          <button
            type="button"
            onClick={() => setUseCustom(!useCustom)}
            className="text-[13px] text-[var(--accent)] tap-shrink"
          >
            {useCustom ? (showPicker ? "Use selected" : "Use suggested") : "Custom amount"}
          </button>
        </div>

        {useCustom && (
          <div>
            <label className="text-sm font-medium text-[var(--label-secondary)] block mb-1">
              Custom amount
            </label>
            <input
              type="number"
              step="0.01"
              inputMode="decimal"
              value={customAmount}
              onChange={(e) => setCustomAmount(e.target.value)}
              placeholder="0.00"
              autoFocus
              className="w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--surface)] px-3.5 py-2.5 text-[15px] text-[var(--label-primary)] outline-none focus:border-[var(--accent)]"
            />
          </div>
        )}

        <div>
          <label className="text-sm font-medium text-[var(--label-secondary)] block mb-1">
            Note (optional)
          </label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="For: dinner on Friday…"
            className="w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--surface)] px-3.5 py-2.5 text-[15px] text-[var(--label-primary)] outline-none focus:border-[var(--accent)]"
          />
        </div>

        <div>
          <p className="text-sm font-medium text-[var(--label-secondary)] mb-2">
            Payment screenshots (optional)
          </p>
          <label className="block cursor-pointer rounded-[var(--radius-md)] border border-dashed border-[var(--border-subtle)] px-3 py-2.5 text-sm text-[var(--label-tertiary)] tap-shrink">
            {receiptFiles.length > 0
              ? `${receiptFiles.length} file(s) selected — tap to add more`
              : "Tap to select screenshots"}
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={handleReceipts}
              className="hidden"
            />
          </label>
          {receiptFiles.length > 0 && (
            <div className="mt-2 space-y-1">
              {receiptFiles.map((f, i) => (
                <div key={i} className="flex items-center justify-between text-[13px] text-[var(--label-secondary)]">
                  <span className="truncate">{f.name}</span>
                  <button
                    type="button"
                    onClick={() => removeReceipt(i)}
                    className="text-[var(--danger)] ml-2 shrink-0 tap-shrink"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <p className="text-[13px] text-[var(--label-tertiary)]">
          This sends a settlement request to {toName}. They will need to approve
          it for it to be reflected in the group balance.
        </p>

        {error && <p className="text-sm text-[var(--danger)]">{error}</p>}

        <GlassButton disabled={busy} className="w-full">
          {busy ? "Sending…" : "Send Settlement Request"}
        </GlassButton>
      </form>
    </GlassModal>
  );
}
