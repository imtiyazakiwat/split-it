"use client";

import { useEffect, useRef, useState } from "react";
import { Expense } from "@/lib/types";
import { addSettlementRequest, resolveUpiId } from "@/lib/firestore";
import { uploadMultipleReceipts } from "@/lib/storage";
import { formatCurrency } from "@/lib/balance";
import { roundMoney } from "@/lib/money";
import { hapticSuccess, hapticTap } from "@/lib/haptics";
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
import { FieldRow, Button } from "@/components/kit/Controls";
import { List, Section, sepInset } from "@/components/kit/List";
import { Avatar } from "@/components/kit/Avatar";
import { Icon } from "@/components/kit/Icon";
import UpiPayPanel from "@/components/pay/UpiPayPanel";

interface ExpenseWithSelection {
  expense: Expense;
  selected: boolean;
}

/**
 * Settle up with one person in a group: pay them over UPI (hand-off), then
 * record it. Recording sends a request the payee approves — only then does
 * the balance move.
 */
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
  // The amount owed is the netted balance. The expense list is for reference
  // (what this covers) and never changes the amount.
  const [items, setItems] = useState<ExpenseWithSelection[]>(
    expensesOwed.map((e) => ({ expense: e, selected: true }))
  );
  const initialAmount = suggestedAmount > 0 ? suggestedAmount.toFixed(2) : "";
  const [amount, setAmount] = useState(initialAmount);
  const [receiptFiles, setReceiptFiles] = useState<File[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [paidExternally, setPaidExternally] = useState(false);
  const [resolvedUpiId, setResolvedUpiId] = useState<string | undefined>(toUpiId);
  const [upiChecked, setUpiChecked] = useState(false);
  const sheetRef = useRef<SheetHandle>(null);
  const showToast = useToast();

  // Whole paise, so a settlement can't leave a fraction no payment can clear.
  const parsedAmount = roundMoney(parseFloat(amount) || 0);
  // Overpaying flips the balance rather than failing — flag it while the
  // number can still change.
  const overpayBy = suggestedAmount > 0 ? roundMoney(parsedAmount - suggestedAmount) : 0;
  const canHandOff = isLikelyAndroid() || isLikelyIOS();

  /**
   * The group's copy of a member's UPI ID can be missing or stale; fall back
   * to their user document.
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

  const dirty = amount !== initialAmount || !!note.trim() || receiptFiles.length > 0 || paidExternally;

  function toggleItem(index: number) {
    hapticTap();
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, selected: !it.selected } : it)));
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
    // Hand-off via window.location (lib/upi) works in installed PWAs, where a
    // synthesised anchor click on a non-http scheme is ignored.
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

  async function handleSubmit() {
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
      showToast({ message: `Request sent to ${toName}` });
      hapticSuccess();
      sheetRef.current?.dismiss();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send settlement request");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      ref={sheetRef}
      large
      title="Settle Up"
      subtitle={`with ${toName}`}
      dirty={dirty && !busy}
      onClose={onClose}
      footer={
        <>
          <Button block busy={busy} disabled={parsedAmount <= 0} onClick={() => void handleSubmit()}>
            {parsedAmount > 0 ? `Record ${formatCurrency(parsedAmount)} Payment` : "Record Payment"}
          </Button>
          <p className="t-caption mt-2 text-center text-label-2">
            {toName} approves it before it changes the balance.
          </p>
        </>
      }
    >
      <div className="flex justify-center pt-3">
        <Avatar name={toName} size={56} />
      </div>
      <AmountField
        id="settle-amount"
        value={amount}
        onChange={setAmount}
        caption={suggestedAmount > 0 ? `You owe ${toName} ${formatCurrency(suggestedAmount)}` : undefined}
      />

      {overpayBy > 0 && (
        <div className="card mb-1 flex items-start gap-3 p-4 rise-in">
          <span className="mt-0.5 text-[var(--orange)]">
            <Icon name="exclamationmark.triangle" size={20} />
          </span>
          <div className="min-w-0">
            <p className="t-footnote text-label-2">
              That&rsquo;s {formatCurrency(overpayBy)} more than you owe. Once {toName} approves it,{" "}
              <span className="font-semibold text-label">they&rsquo;ll owe you {formatCurrency(overpayBy)}</span> and
              this group will still show a balance.
            </p>
            <Button size="sm" variant="tinted" className="mt-2" onClick={() => setAmount(suggestedAmount.toFixed(2))}>
              Pay Exactly {formatCurrency(suggestedAmount)}
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
        handedOff={paidExternally}
        onPay={handlePayWithApp}
        onCopy={handleCopyUpi}
      />

      {items.length > 0 && (
        <Section header="What this covers" footer="For reference only — it doesn't change the amount.">
          <List>
            {items.map((item, i) => {
              const myShare = item.expense.splits.find((s) => s.uid === fromUid)?.amount || 0;
              return (
                <button
                  key={item.expense.id}
                  type="button"
                  role="checkbox"
                  aria-checked={item.selected}
                  onClick={() => toggleItem(i)}
                  className="row is-pressable is-tall"
                  style={sepInset(58)}
                >
                  <span className={item.selected ? "text-tint" : "text-label-3"} aria-hidden>
                    <Icon name={item.selected ? "checkmark.circle.fill" : "circle"} size={26} strokeWidth={1.6} />
                  </span>
                  <span className="row-main">
                    <span className="row-title">{item.expense.description}</span>
                    <span className="row-subtitle">
                      Your share of {formatCurrency(item.expense.amount)}
                    </span>
                  </span>
                  <span className="num t-body shrink-0">{formatCurrency(myShare)}</span>
                </button>
              );
            })}
          </List>
        </Section>
      )}

      <Section header="Note">
        <List>
          <FieldRow
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="For: dinner on Friday…"
            aria-label="Note"
            maxLength={120}
          />
        </List>
      </Section>

      <Section header="Payment screenshot">
        <Attachments
          files={receiptFiles}
          onChange={setReceiptFiles}
          label={paidExternally ? "Add a Screenshot of Your Payment" : "Add Screenshot"}
        />
      </Section>

      {error && <p className="t-footnote mt-4 px-4 text-neg">{error}</p>}
    </Sheet>
  );
}
