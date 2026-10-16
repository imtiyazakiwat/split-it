"use client";

import { useEffect, useRef, useState } from "react";
import { resolveUpiId } from "@/lib/firestore";
import { createTransfer } from "@/lib/transfers";
import { uploadImage } from "@/lib/storage";
import { formatCurrency } from "@/lib/balance";
import { roundMoney } from "@/lib/money";
import { hapticSuccess } from "@/lib/haptics";
import {
  UpiApp,
  UpiPaymentParams,
  copyToClipboard,
  isLikelyAndroid,
  isLikelyIOS,
  isValidUpiId,
  launchUpi,
} from "@/lib/upi";
import { useToast } from "@/components/ui/Toast";
import { Sheet, type SheetHandle } from "@/components/kit/Sheet";
import { AmountField } from "@/components/kit/AmountField";
import { Attachments } from "@/components/kit/Attachments";
import { Button, FieldRow } from "@/components/kit/Controls";
import { List, Section } from "@/components/kit/List";
import { Avatar } from "@/components/kit/Avatar";
import { Icon } from "@/components/kit/Icon";
import UpiPayPanel from "@/components/pay/UpiPayPanel";

/**
 * Send money straight to a person, no group involved.
 *
 * The app doesn't move money — UPI, cash or a bank app does. So: hand off to
 * a UPI app to pay, then record that you paid. The other person confirms it
 * and decides whether it settles a group balance (IncludeTransferSheet); until
 * then it counts as a personal balance between the two of you.
 */
export default function SendMoneyModal({
  fromUid,
  toUid,
  toName,
  toPhotoURL,
  toUpiId,
  suggestedAmount = 0,
  contextLine,
  onClose,
  onSent,
}: {
  fromUid: string;
  toUid: string;
  toName: string;
  toPhotoURL?: string;
  toUpiId?: string;
  suggestedAmount?: number;
  /** e.g. "You owe Asha ₹450 across 2 groups". */
  contextLine?: string;
  onClose: () => void;
  onSent?: () => void;
}) {
  const initialAmount = suggestedAmount > 0 ? suggestedAmount.toFixed(2) : "";
  const [amount, setAmount] = useState(initialAmount);
  const [note, setNote] = useState("");
  const [receiptFiles, setReceiptFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [handedOff, setHandedOff] = useState(false);
  const [resolvedUpiId, setResolvedUpiId] = useState<string | undefined>(toUpiId);
  const [upiChecked, setUpiChecked] = useState(false);
  const sheetRef = useRef<SheetHandle>(null);
  const showToast = useToast();

  // Whole paise: no payment rail can move a third of a paise.
  const parsedAmount = roundMoney(parseFloat(amount) || 0);
  /**
   * Overpaying doesn't fail, it flips the balance — exactly how a stubborn
   * leftover appears. Say so before the money moves.
   */
  const overpayBy = suggestedAmount > 0 ? roundMoney(parsedAmount - suggestedAmount) : 0;
  const canHandOff = isLikelyAndroid() || isLikelyIOS();

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

  const dirty = amount !== initialAmount || !!note.trim() || receiptFiles.length > 0 || handedOff;

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

  async function handleSubmit() {
    if (parsedAmount <= 0) {
      setError("Enter a valid amount.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      // A transfer belongs to no group, so the group receipt helper doesn't apply.
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
      hapticSuccess();
      showToast({ message: `Sent ${formatCurrency(parsedAmount)} to ${toName}` });
      onSent?.();
      sheetRef.current?.dismiss();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't record the payment");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      ref={sheetRef}
      large
      title={`Pay ${toName}`}
      dirty={dirty && !busy}
      onClose={onClose}
      footer={
        <>
          <Button block busy={busy} disabled={parsedAmount <= 0} onClick={() => void handleSubmit()}>
            {parsedAmount > 0 ? `I've Sent ${formatCurrency(parsedAmount)}` : "I've Sent It"}
          </Button>
          <p className="t-caption mt-2 text-center text-label-2">
            {toName} confirms it and chooses whether it settles a group balance.
          </p>
        </>
      }
    >
      <div className="flex justify-center pt-3">
        <Avatar name={toName} photoURL={toPhotoURL} size={56} />
      </div>
      <AmountField
        id="send-amount"
        value={amount}
        onChange={setAmount}
        autoFocus={!initialAmount}
        caption={contextLine}
      />

      {overpayBy > 0 && (
        <div className="card mb-1 flex items-start gap-3 p-4 rise-in">
          <span className="mt-0.5 text-[var(--orange)]">
            <Icon name="exclamationmark.triangle" size={20} />
          </span>
          <div className="min-w-0">
            <p className="t-footnote text-label-2">
              That&rsquo;s {formatCurrency(overpayBy)} more than the {formatCurrency(suggestedAmount)} you owe.
              After this,{" "}
              <span className="font-semibold text-label">
                {toName} will owe you {formatCurrency(overpayBy)}
              </span>
              , and your groups keep showing a balance until it comes back.
            </p>
            <Button size="sm" variant="tinted" className="mt-2" onClick={() => setAmount(suggestedAmount.toFixed(2))}>
              Send Exactly {formatCurrency(suggestedAmount)}
            </Button>
          </div>
        </div>
      )}

      <UpiPayPanel
        toName={toName}
        upiId={resolvedUpiId}
        checked={upiChecked}
        usable={upiUsable}
        canHandOff={canHandOff}
        handedOff={handedOff}
        onPay={handlePayWithApp}
        onCopy={handleCopyUpi}
      />

      <Section header="Note">
        <List>
          <FieldRow
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="For Friday's dinner…"
            aria-label="Note"
            maxLength={120}
          />
        </List>
      </Section>

      <Section header="Payment screenshot" footer="Until they book it into a group, it shows as a personal balance between you two.">
        <Attachments files={receiptFiles} onChange={setReceiptFiles} label="Add Screenshot" />
      </Section>

      {error && <p className="t-footnote mt-4 px-4 text-neg">{error}</p>}
    </Sheet>
  );
}
