"use client";

import { useState } from "react";
import { Expense } from "@/lib/types";
import { addSettlementRequest } from "@/lib/firestore";
import { uploadMultipleReceipts } from "@/lib/storage";
import { formatCurrency } from "@/lib/balance";
import { UPI_APPS, isLikelyAndroid, UpiPaymentParams } from "@/lib/upi";
import { UpiAppIcon } from "@/components/UpiAppIcon";
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
  toUpiId,
  suggestedAmount,
  expensesOwed,
  onClose,
}: {
  groupId: string;
  fromUid: string;
  toUid: string;
  toName: string;
  toUpiId?: string;
  suggestedAmount: number;
  expensesOwed: Expense[];
  onClose: () => void;
}) {
  // The amount owed is the netted balance. The expense list below is shown for
  // reference (which expenses this settlement covers) and never changes the
  // amount — ticking items only tags them, it doesn't "jump the rate".
  const [items, setItems] = useState<ExpenseWithSelection[]>(
    expensesOwed.map((e) => ({ expense: e, selected: true }))
  );
  const [amount, setAmount] = useState(suggestedAmount > 0 ? suggestedAmount.toFixed(2) : "");
  const [receiptFiles, setReceiptFiles] = useState<File[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [paidExternally, setPaidExternally] = useState(false);

  const parsedAmount = parseFloat(amount) || 0;
  const androidLikely = isLikelyAndroid();

  const upiParams: UpiPaymentParams | null = toUpiId
    ? {
        payeeVpa: toUpiId,
        payeeName: toName,
        amount: parsedAmount,
        note: note.trim() || "SplitIt settlement",
      }
    : null;

  function toggleItem(index: number) {
    setItems((prev) =>
      prev.map((it, i) => (i === index ? { ...it, selected: !it.selected } : it))
    );
  }

  function handleReceipts(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    setReceiptFiles((prev) => [...prev, ...files]);
  }

  function removeReceipt(index: number) {
    setReceiptFiles((prev) => prev.filter((_, i) => i !== index));
  }

  function handlePayWithApp(buildUri: (p: UpiPaymentParams) => string) {
    if (!upiParams || parsedAmount <= 0) return;
    const uri = buildUri(upiParams);
    // Launch the UPI app via a transient anchor rather than mutating
    // window.location directly.
    const anchor = document.createElement("a");
    anchor.href = uri;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setPaidExternally(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (parsedAmount <= 0) {
      setError("Enter a valid amount.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      let receiptUrls: string[] = [];
      if (receiptFiles.length > 0) {
        receiptUrls = await uploadMultipleReceipts(groupId, receiptFiles);
      }
      const expenseIds = items.filter((i) => i.selected).map((i) => i.expense.id);
      await addSettlementRequest(groupId, {
        fromUid,
        toUid,
        amount: parsedAmount,
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
        <div>
          <label className="text-sm font-medium text-[var(--label-secondary)] block mb-1">
            Amount
          </label>
          <input
            type="number"
            step="0.01"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--surface)] px-3.5 py-2.5 text-[15px] text-[var(--label-primary)] outline-none focus:border-[var(--accent)]"
          />
          {suggestedAmount > 0 && (
            <p className="text-[12px] text-[var(--label-tertiary)] mt-1">
              You owe {toName} {formatCurrency(suggestedAmount)}
            </p>
          )}
        </div>

        {items.length > 0 && (
          <div>
            <p className="text-sm font-medium text-[var(--label-secondary)] mb-2">
              What this covers
            </p>
            <div className="space-y-1 rounded-[var(--radius-md)] border border-[var(--border-subtle)] p-1 max-h-52 overflow-y-auto">
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

        {toUpiId ? (
          <div>
            <p className="text-sm font-medium text-[var(--label-secondary)] mb-2">
              Pay with UPI
            </p>
            <div className="grid grid-cols-2 gap-2">
              {UPI_APPS.map((app) => (
                <button
                  key={app.id}
                  type="button"
                  onClick={() => handlePayWithApp(app.buildUri)}
                  disabled={parsedAmount <= 0}
                  className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--surface)] px-3 py-2.5 text-sm font-medium text-[var(--label-primary)] tap-shrink disabled:opacity-40"
                >
                  <UpiAppIcon id={app.id} className="w-5 h-5 shrink-0" />
                  <span className="truncate">{app.label}</span>
                </button>
              ))}
            </div>
            {!androidLikely && (
              <p className="text-[12px] text-[var(--label-tertiary)] mt-2">
                UPI apps open automatically only on Android. On iOS, pay manually
                using {toName}&rsquo;s UPI ID:{" "}
                <span className="font-medium text-[var(--label-secondary)]">{toUpiId}</span>
              </p>
            )}
          </div>
        ) : (
          <p className="text-[13px] text-[var(--label-tertiary)]">
            {toName} hasn&rsquo;t added a UPI ID, so pay them directly (cash, UPI,
            etc.) and record it here.
          </p>
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
              : paidExternally
              ? "Add a screenshot of your payment"
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
