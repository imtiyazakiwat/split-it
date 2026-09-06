"use client";

import { useEffect, useState } from "react";
import { resolveUpiId } from "@/lib/firestore";
import { createTransfer } from "@/lib/transfers";
import { uploadImage } from "@/lib/storage";
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

/**
 * Send money straight to a person, with no group involved.
 *
 * The app doesn't move money — UPI, cash or a bank app does. So this screen has
 * two halves: hand off to a UPI app to actually pay, then record that you paid.
 * Recording is what the other person sees, and only they can decide whether it
 * settles a group balance (see IncludeTransferSheet). Until they book it into
 * a group it counts as a personal direct balance once they confirm it.
 */
export default function SendMoneyModal({
  fromUid,
  toUid,
  toName,
  toUpiId,
  suggestedAmount = 0,
  /** Optional context line, e.g. "You owe Asha ₹450 across 2 groups". */
  contextLine,
  onClose,
  onSent,
}: {
  fromUid: string;
  toUid: string;
  toName: string;
  toUpiId?: string;
  suggestedAmount?: number;
  contextLine?: string;
  onClose: () => void;
  onSent?: () => void;
}) {
  const [amount, setAmount] = useState(suggestedAmount > 0 ? suggestedAmount.toFixed(2) : "");
  const [note, setNote] = useState("");
  const [receiptFiles, setReceiptFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [handedOff, setHandedOff] = useState(false);
  const [resolvedUpiId, setResolvedUpiId] = useState<string | undefined>(toUpiId);
  const [upiChecked, setUpiChecked] = useState(false);
  const showToast = useToast();

  // Snapped to whole paise: a sub-paise transfer leaves a balance that can
  // never be paid off, since no payment rail can move a third of a paise.
  const parsedAmount = roundMoney(parseFloat(amount) || 0);
  /**
   * Overpaying doesn't fail, it flips the balance — and that is exactly how a
   * stubborn leftover appears. Sending ₹438.68 against a ₹279.09 debt makes the
   * other person owe you ₹159.59; if they then round their refund up, you owe
   * them the difference and the group looks unsettled forever. So say so before
   * the money moves rather than leaving it to be discovered in the ledger.
   */
  const overpayBy = suggestedAmount > 0 ? roundMoney(parsedAmount - suggestedAmount) : 0;
  // Both Android (intent://) and iOS (app-specific schemes) can hand off to a
  // named UPI app; desktop can't, and there the copy-the-ID route is the answer.
  const canHandOff = isLikelyAndroid() || isLikelyIOS();

  // The group's copy of a member's UPI ID can be missing or stale, so fall back
  // to their user document — the same resolution the settle-up sheet does.
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
        note: note.trim() || "SplitIt payment",
      }
    : null;

  function handlePayWithApp(app: UpiApp) {
    if (!upiParams) return;
    if (parsedAmount <= 0) {
      setError("Enter the amount you're sending first.");
      return;
    }
    if (!upiUsable) {
      setError(`${toName}'s UPI ID doesn't look valid, so no app can open it.`);
      return;
    }
    if (!launchUpi(app, upiParams)) {
      setError("Couldn't open a UPI app. Copy the UPI ID and pay manually.");
      return;
    }
    setError("");
    setHandedOff(true);
  }

  async function handleCopyUpi() {
    if (!resolvedUpiId) return;
    const ok = await copyToClipboard(resolvedUpiId);
    showToast({ message: ok ? "UPI ID copied" : "Couldn't copy — long-press to select" });
  }

  function handleReceipts(e: React.ChangeEvent<HTMLInputElement>) {
    setReceiptFiles((prev) => [...prev, ...Array.from(e.target.files || [])]);
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
      // A transfer belongs to no group, so the group-scoped receipt helper
      // doesn't apply here.
      const receiptUrls =
        receiptFiles.length > 0
          ? await Promise.all(receiptFiles.map((f) => uploadImage(f, "transfer-receipt")))
          : [];
      await createTransfer({
        fromUid,
        toUid,
        amount: parsedAmount,
        note: note.trim() || undefined,
        receiptUrls,
      });
      showToast({ message: `Sent ${formatCurrency(parsedAmount)} to ${toName}` });
      onSent?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't record the payment");
    } finally {
      setBusy(false);
    }
  }

  return (
    <GlassModal title={`Pay ${toName}`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label
            htmlFor="send-amount"
            className="text-sm font-medium text-[var(--label-secondary)] block mb-1"
          >
            Amount
          </label>
          <input
            id="send-amount"
            type="number"
            step="0.01"
            min="0"
            inputMode="decimal"
            autoFocus
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--surface)] px-3.5 py-2.5 text-[22px] font-semibold text-[var(--label-primary)] outline-none focus:border-[var(--accent)]"
          />
          {contextLine && (
            <p className="text-[12px] text-[var(--label-tertiary)] mt-1">{contextLine}</p>
          )}
          {overpayBy > 0 && (
            <div className="mt-2 rounded-[var(--radius-md)] bg-[var(--tint-warning)] p-3">
              <p className="text-[13px] text-[var(--label-secondary)]">
                That&rsquo;s {formatCurrency(overpayBy)} more than the{" "}
                {formatCurrency(suggestedAmount)} you owe. After this,{" "}
                <span className="font-medium">
                  {toName} will owe you {formatCurrency(overpayBy)}
                </span>
                , and your groups will keep showing a balance until that comes back.
              </p>
              <button
                type="button"
                onClick={() => setAmount(suggestedAmount.toFixed(2))}
                className="mt-2 rounded-full bg-[var(--surface)] px-3 py-1.5 text-[13px] font-semibold text-[var(--accent)] tap-shrink"
              >
                Send exactly {formatCurrency(suggestedAmount)}
              </button>
            </div>
          )}
        </div>

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
                {toName}&rsquo;s UPI ID and pay from your bank app.
              </p>
            ) : (
              handedOff && (
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
              handle@bank address, so UPI apps can&rsquo;t open it.
            </p>
          </div>
        ) : (
          <p className="text-[13px] text-[var(--label-tertiary)]">
            {upiChecked
              ? `${toName} hasn't added a UPI ID. Pay them however you like (cash, UPI, bank transfer) and record it here.`
              : "Checking for a UPI ID…"}
          </p>
        )}

        <div>
          <label
            htmlFor="send-note"
            className="text-sm font-medium text-[var(--label-secondary)] block mb-1"
          >
            Note (optional)
          </label>
          <input
            id="send-note"
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="For Friday's dinner…"
            className="w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--surface)] px-3.5 py-2.5 text-[16px] text-[var(--label-primary)] outline-none focus:border-[var(--accent)]"
          />
        </div>

        <div>
          <p className="text-sm font-medium text-[var(--label-secondary)] mb-2">
            Payment screenshot (optional)
          </p>
          <label
            role="button"
            tabIndex={0}
            aria-label="Add a payment screenshot"
            onKeyDown={activateFileInputOnKey}
            className="block cursor-pointer rounded-[var(--radius-md)] border border-dashed border-[var(--border-subtle)] px-3 py-2.5 text-sm text-[var(--label-tertiary)] tap-shrink"
          >
            {receiptFiles.length > 0
              ? `${receiptFiles.length} file(s) selected — tap to add more`
              : "Tap to select a screenshot"}
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={handleReceipts}
              className="hidden"
            />
          </label>
        </div>

        <p className="text-[13px] text-[var(--label-tertiary)]">
          This tells {toName} you sent the money. They confirm it, and they choose
          whether it settles a group balance — until they book it into a group
          it shows as a personal balance between you two.
        </p>

        {error && <p className="text-sm text-[var(--danger)]">{error}</p>}

        <GlassButton disabled={busy || parsedAmount <= 0} className="w-full">
          {busy
            ? "Recording…"
            : parsedAmount > 0
            ? `I've sent ${formatCurrency(parsedAmount)}`
            : "I've sent it"}
        </GlassButton>
      </form>
    </GlassModal>
  );
}
