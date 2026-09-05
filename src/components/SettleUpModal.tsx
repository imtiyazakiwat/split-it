"use client";

import { useEffect, useState } from "react";
import { Expense } from "@/lib/types";
import { addSettlementRequest, resolveUpiId } from "@/lib/firestore";
import { uploadMultipleReceipts } from "@/lib/storage";
import { formatCurrency } from "@/lib/balance";
import { roundMoney } from "@/lib/money";
import {
  UPI_APPS,
  UpiApp,
  UpiPaymentParams,
  copyToClipboard,
  isLikelyAndroid,
  isLikelyIOS,
  isValidUpiId,
  launchUpi,
} from "@/lib/upi";
import { UpiAppIcon } from "@/components/UpiAppIcon";
import GlassModal from "@/components/ui/GlassModal";
import GlassButton from "@/components/ui/GlassButton";
import { useToast } from "@/components/ui/Toast";
import { activateFileInputOnKey } from "@/lib/keyboard";

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
  const [resolvedUpiId, setResolvedUpiId] = useState<string | undefined>(toUpiId);
  const [upiChecked, setUpiChecked] = useState(false);
  const showToast = useToast();

  // Snapped to whole paise, so a settlement can't leave behind a fraction of a
  // paise that no payment could ever clear.
  const parsedAmount = roundMoney(parseFloat(amount) || 0);
  // Paying more than you owe flips the balance rather than failing, which is how
  // a group ends up looking permanently unsettled after everyone thinks they've
  // paid up. Flag it while the number can still be changed.
  const overpayBy = suggestedAmount > 0 ? roundMoney(parsedAmount - suggestedAmount) : 0;
  // Both Android (intent://) and iOS (app-specific schemes) can hand off to a
  // named UPI app; desktop can't, and there the copy-the-ID route is the answer.
  const canHandOff = isLikelyAndroid() || isLikelyIOS();

  /**
   * The group document's copy of a member's UPI ID is a mirror that can be
   * missing (it was never written before the profile-sync fix) or stale, which
   * is why "Pay with UPI" never appeared even after the payee had saved an ID.
   * Fall back to reading their user document directly.
   */
  useEffect(() => {
    let cancelled = false;
    resolveUpiId(toUid, toUpiId).then((resolved) => {
      if (cancelled) return;
      setResolvedUpiId(resolved);
      setUpiChecked(true);
    });
    return () => {
      cancelled = true;
    };
  }, [toUid, toUpiId]);

  const upiUsable = !!resolvedUpiId && isValidUpiId(resolvedUpiId);

  const upiParams: UpiPaymentParams | null = resolvedUpiId
    ? {
        payeeVpa: resolvedUpiId,
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

  function handlePayWithApp(app: UpiApp) {
    if (!upiParams) return;
    if (parsedAmount <= 0) {
      setError("Enter the amount you're paying first.");
      return;
    }
    if (!upiUsable) {
      setError(`${toName}'s UPI ID doesn't look valid, so no app can open it.`);
      return;
    }
    // Handing off via `window.location` (see lib/upi) works in installed PWAs,
    // where a synthesised anchor click on a non-http scheme is ignored.
    if (!launchUpi(app, upiParams)) {
      setError("Couldn't open a UPI app. Copy the UPI ID and pay manually.");
      return;
    }
    setError("");
    setPaidExternally(true);
  }

  async function handleCopyUpi() {
    if (!resolvedUpiId) return;
    const ok = await copyToClipboard(resolvedUpiId);
    showToast({ message: ok ? "UPI ID copied" : "Couldn't copy — long-press to select" });
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
        createdBy: fromUid,
        kind: "payment",
        note: note.trim() || undefined,
        receiptUrls,
        expenseIds: expenseIds.length > 0 ? expenseIds : undefined,
      });
      showToast({ message: `Settlement request sent to ${toName}` });
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
          {overpayBy > 0 && (
            <div className="mt-2 rounded-[var(--radius-md)] bg-[var(--tint-warning)] p-3">
              <p className="text-[13px] text-[var(--label-secondary)]">
                That&rsquo;s {formatCurrency(overpayBy)} more than you owe. Once{" "}
                {toName} approves it,{" "}
                <span className="font-medium">
                  they&rsquo;ll owe you {formatCurrency(overpayBy)}
                </span>{" "}
                and this group will still show a balance.
              </p>
              <button
                type="button"
                onClick={() => setAmount(suggestedAmount.toFixed(2))}
                className="mt-2 rounded-full bg-[var(--surface)] px-3 py-1.5 text-[13px] font-semibold text-[var(--accent)] tap-shrink"
              >
                Pay exactly {formatCurrency(suggestedAmount)}
              </button>
            </div>
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

        {upiUsable ? (
          <div>
            <p className="text-sm font-medium text-[var(--label-secondary)] mb-2">
              Pay with UPI
            </p>
            <div className="grid grid-cols-2 gap-2">
              {UPI_APPS.map((app) => (
                <button
                  key={app.id}
                  type="button"
                  onClick={() => handlePayWithApp(app)}
                  className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--surface)] px-3 py-2.5 text-sm font-medium text-[var(--label-primary)] tap-shrink"
                >
                  <UpiAppIcon id={app.id} className="w-5 h-5 shrink-0" />
                  <span className="truncate">{app.label}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={handleCopyUpi}
              className="mt-2 w-full rounded-[var(--radius-md)] bg-[var(--fill-soft)] px-3 py-2 text-[13px] font-medium text-[var(--label-secondary)] tap-shrink"
            >
              Copy UPI ID · {resolvedUpiId}
            </button>
            {!canHandOff ? (
              <p className="text-[12px] text-[var(--label-tertiary)] mt-2">
                UPI apps can only be opened from a phone. On desktop, copy{" "}
                {toName}&rsquo;s UPI ID above and pay from your bank app.
              </p>
            ) : (
              paidExternally && (
                // The browser can't tell us whether the hand-off worked, so
                // always offer the manual route once we've tried.
                <p className="text-[12px] text-[var(--label-tertiary)] mt-2">
                  Nothing opened? Copy the UPI ID above and pay from your bank app.
                </p>
              )
            )}
          </div>
        ) : resolvedUpiId ? (
          <div className="rounded-[var(--radius-md)] bg-[var(--tint-warning)] p-3">
            <p className="text-[13px] text-[var(--label-secondary)]">
              {toName}&rsquo;s saved UPI ID (
              <span className="font-medium">{resolvedUpiId}</span>) isn&rsquo;t a valid
              handle@bank address, so UPI apps can&rsquo;t open it. Ask them to fix it in
              Settings.
            </p>
          </div>
        ) : (
          <p className="text-[13px] text-[var(--label-tertiary)]">
            {upiChecked
              ? `${toName} hasn't added a UPI ID, so pay them directly (cash, UPI, etc.) and record it here.`
              : "Checking for a UPI ID…"}
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
          <label
            role="button"
            tabIndex={0}
            aria-label="Add payment screenshots"
            onKeyDown={activateFileInputOnKey}
            className="block cursor-pointer rounded-[var(--radius-md)] border border-dashed border-[var(--border-subtle)] px-3 py-2.5 text-sm text-[var(--label-tertiary)] tap-shrink"
          >
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
