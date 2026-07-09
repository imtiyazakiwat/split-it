"use client";

import { useState } from "react";
import { addSettlement } from "@/lib/firestore";
import { uploadReceipt } from "@/lib/storage";
import { formatCurrency } from "@/lib/balance";
import { UPI_APPS, isLikelyAndroid, UpiPaymentParams } from "@/lib/upi";
import GlassModal from "@/components/ui/GlassModal";
import { GlassField } from "@/components/ui/GlassField";
import GlassButton from "@/components/ui/GlassButton";

export default function SettleUpModal({
  groupId,
  fromUid,
  toUid,
  toName,
  toUpiId,
  suggestedAmount,
  onClose,
}: {
  groupId: string;
  fromUid: string;
  toUid: string;
  toName: string;
  toUpiId?: string;
  suggestedAmount: number;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState(suggestedAmount.toFixed(2));
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [paidExternally, setPaidExternally] = useState(false);

  const parsedAmount = parseFloat(amount) || 0;
  const androidLikely = isLikelyAndroid();

  const upiParams: UpiPaymentParams | null = toUpiId
    ? { payeeVpa: toUpiId, payeeName: toName, amount: parsedAmount, note: "SplitIt settlement" }
    : null;

  function handlePayWithApp(buildUri: (p: UpiPaymentParams) => string) {
    if (!upiParams || parsedAmount <= 0) return;
    const uri = buildUri(upiParams);
    // Navigate via a transient anchor rather than mutating
    // window.location directly, so this stays a DOM-API side effect
    // instead of reassigning a browser global in place.
    const anchor = document.createElement("a");
    anchor.href = uri;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // Once they've launched a UPI app, prompt them to confirm it went through
    // and optionally attach a screenshot before we record the settlement.
    setPaidExternally(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) {
      setError("Enter a valid amount.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      let receiptUrl: string | undefined;
      if (receiptFile) {
        receiptUrl = await uploadReceipt(groupId, receiptFile, receiptFile.name);
      }
      await addSettlement(groupId, { fromUid, toUid, amount: amt, receiptUrl });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record settlement");
    } finally {
      setBusy(false);
    }
  }

  return (
    <GlassModal title={`Settle up with ${toName}`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <GlassField
          label="Amount"
          autoFocus
          type="number"
          inputMode="decimal"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />

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
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: app.color }}
                    aria-hidden
                  />
                  <span className="truncate">{app.label}</span>
                </button>
              ))}
            </div>
            {!androidLikely && (
              <p className="text-[12px] text-[var(--label-tertiary)] mt-2">
                UPI apps only open automatically on Android. On iOS, use the
                app manually with {toName}&rsquo;s UPI ID:{" "}
                <span className="font-medium text-[var(--label-secondary)]">{toUpiId}</span>
              </p>
            )}
          </div>
        ) : (
          <p className="text-[13px] text-[var(--label-tertiary)]">
            {toName} hasn&rsquo;t added a UPI ID yet, so you&rsquo;ll need to pay them
            directly (cash, UPI, etc.) and just record it here.
          </p>
        )}

        {(paidExternally || !toUpiId) && (
          <label className="block text-sm font-medium text-[var(--label-secondary)]">
            Payment screenshot (optional)
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setReceiptFile(e.target.files?.[0] || null)}
              className="mt-1.5 w-full text-sm text-[var(--label-secondary)] file:mr-3 file:rounded-full file:border-0 file:bg-[var(--accent)]/10 file:text-[var(--accent)] file:px-3 file:py-1.5 file:text-sm"
            />
          </label>
        )}

        <p className="text-[13px] text-[var(--label-tertiary)]">
          Confirming here records that you paid {toName}{" "}
          {formatCurrency(parsedAmount)}. SplitIt doesn&rsquo;t process the
          payment itself — this just logs it.
        </p>

        {error && <p className="text-sm text-[var(--danger)]">{error}</p>}

        <GlassButton disabled={busy} className="w-full">
          {busy ? "Recording…" : "Confirm Payment"}
        </GlassButton>
      </form>
    </GlassModal>
  );
}
