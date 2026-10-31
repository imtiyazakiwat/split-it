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
import { ButtonRow, FieldRow, ListSection, Row } from "@/components/ui/List";
import { AmountInput } from "@/components/ui/Controls";
import { Copy, Paperclip } from "@/components/ui/Icons";
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
    <GlassModal
      title={`Pay ${toName}`}
      large
      onClose={onClose}
      dirty={!busy && (note.trim() !== "" || receiptFiles.length > 0 || handedOff)}
      footer={
        <button type="submit" form="send-form" disabled={busy || parsedAmount <= 0} className="btn-prominent w-full">
          {busy ? "Recording…" : parsedAmount > 0 ? `I’ve Sent ${formatCurrency(parsedAmount)}` : "I’ve Sent It"}
        </button>
      }
    >
      <form id="send-form" onSubmit={handleSubmit}>
        <div className="flex flex-col items-center pt-3 pb-1 text-center">
          <AmountInput id="send-amount" value={amount} onChange={setAmount} autoFocus />
          {contextLine && <p className="t-footnote text-[var(--text-secondary)] max-w-[300px]">{contextLine}</p>}
        </div>

        {overpayBy > 0 && (
          <ListSection
            elevated
            footer={`After this, ${toName} will owe you ${formatCurrency(overpayBy)}, and your groups keep showing a balance until it comes back.`}
          >
            <Row title={<span className="text-[var(--warning)]">{formatCurrency(overpayBy)} more than you owe</span>} />
            <ButtonRow onClick={() => setAmount(suggestedAmount.toFixed(2))} title={`Send Exactly ${formatCurrency(suggestedAmount)}`} action />
          </ListSection>
        )}

        {upiUsable ? (
          <ListSection
            elevated
            header="Pay with UPI"
            footer={
              !canHandOff
                ? `UPI apps open only on a phone. Copy ${toName}'s UPI ID and pay from your bank app.`
                : handedOff
                ? "Nothing opened? Copy the UPI ID and pay from your bank app."
                : "Opens the app with the amount filled in. Come back here to record it."
            }
          >
            <div className="grid grid-cols-4 gap-1 px-2 py-3">
              {UPI_APPS.map((app) => (
                <button
                  key={app.id}
                  type="button"
                  onClick={() => handlePayWithApp(app)}
                  className="flex flex-col items-center gap-1.5 py-1 tap-shrink"
                >
                  <span className="w-12 h-12 rounded-[13px] bg-[var(--surface)] grid place-items-center shadow-[0_0_0_0.5px_var(--separator)]">
                    <UpiAppIcon id={app.id} className="w-7 h-7" />
                  </span>
                  <span className="t-caption text-[var(--text-primary)] truncate max-w-full">{app.label}</span>
                </button>
              ))}
            </div>
            <ButtonRow
              onClick={handleCopyUpi}
              leading={<span className="text-[var(--brand)]"><Copy size={19} /></span>}
              title="Copy UPI ID"
              detail={<span className="selectable">{resolvedUpiId}</span>}
              action
            />
          </ListSection>
        ) : (
          <ListSection elevated>
            <Row
              title={
                <span className="whitespace-normal t-subhead text-[var(--text-secondary)]">
                  {resolvedUpiId
                    ? `${toName}'s saved UPI ID (${resolvedUpiId}) isn't a valid handle@bank address, so UPI apps can't open it.`
                    : upiChecked
                    ? `${toName} hasn't added a UPI ID. Pay them however you like (cash, UPI, bank transfer) and record it here.`
                    : "Checking for a UPI ID…"}
                </span>
              }
            />
          </ListSection>
        )}

        <ListSection
          elevated
          footer={`${toName} confirms the payment and chooses whether it settles a group balance. Until then it shows as a personal balance between you.`}
        >
          <FieldRow label="Note">
            <input
              id="send-note"
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional"
              aria-label="Note"
              className="row-input py-[13px]"
            />
          </FieldRow>
          <label
            role="button"
            tabIndex={0}
            aria-label="Add a payment screenshot"
            onKeyDown={activateFileInputOnKey}
            className="list-row cursor-pointer active:bg-[var(--pressed)]"
          >
            <span className="text-[var(--brand)]"><Paperclip size={20} /></span>
            <span className="flex-1 t-body text-[var(--brand)]">
              {receiptFiles.length > 0 ? "Add Another Screenshot" : "Attach Screenshot"}
            </span>
            {receiptFiles.length > 0 && <span className="t-body text-[var(--text-secondary)]">{receiptFiles.length}</span>}
            <input type="file" accept="image/*" multiple onChange={handleReceipts} className="hidden" />
          </label>
        </ListSection>

        {error && <p className="list-footer !text-[var(--neg)]">{error}</p>}
      </form>
    </GlassModal>
  );
}
