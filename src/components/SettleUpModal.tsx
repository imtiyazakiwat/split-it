"use client";

import { useEffect, useState } from "react";
import { Expense } from "@/lib/types";
import { addSettlementRequest, resolveUpiId } from "@/lib/firestore";
import { uploadMultipleReceipts } from "@/lib/storage";
import { formatCurrency } from "@/lib/balance";
import { roundMoney } from "@/lib/money";
import { hapticSuccess } from "@/lib/haptics";
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
import { Checkmark, Copy, Paperclip } from "@/components/ui/Icons";
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
      hapticSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send settlement request");
    } finally {
      setBusy(false);
    }
  }

  return (
    <GlassModal
      title="Settle Up"
      large
      onClose={onClose}
      dirty={!busy && (receiptFiles.length > 0 || note.trim() !== "" || paidExternally)}
      footer={
        <button type="submit" form="settle-form" disabled={busy || parsedAmount <= 0} className="btn-prominent w-full">
          {busy ? "Sending…" : `Record ${parsedAmount > 0 ? formatCurrency(parsedAmount) : "Payment"}`}
        </button>
      }
    >
      <form id="settle-form" onSubmit={handleSubmit}>
        <div className="flex flex-col items-center pt-3 pb-1 text-center">
          <p className="t-subhead text-[var(--text-secondary)]">Paying {toName}</p>
          <AmountInput value={amount} onChange={setAmount} />
          {suggestedAmount > 0 && (
            <p className="t-footnote text-[var(--text-secondary)]">You owe {formatCurrency(suggestedAmount)}</p>
          )}
        </div>

        {overpayBy > 0 && (
          <ListSection elevated footer={`Once ${toName} approves it, they'll owe you ${formatCurrency(overpayBy)} and this group will still show a balance.`}>
            <Row title={<span className="text-[var(--warning)]">{formatCurrency(overpayBy)} more than you owe</span>} />
            <ButtonRow onClick={() => setAmount(suggestedAmount.toFixed(2))} title={`Pay Exactly ${formatCurrency(suggestedAmount)}`} action />
          </ListSection>
        )}

        {upiUsable ? (
          <ListSection
            elevated
            header="Pay with UPI"
            footer={
              !canHandOff
                ? `UPI apps open only on a phone. Copy ${toName}'s UPI ID and pay from your bank app.`
                : paidExternally
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
                    ? `${toName}'s saved UPI ID (${resolvedUpiId}) isn't a valid handle@bank address, so UPI apps can't open it. Ask them to fix it in Settings.`
                    : upiChecked
                    ? `${toName} hasn't added a UPI ID. Pay them however you like, then record it here.`
                    : "Checking for a UPI ID…"}
                </span>
              }
            />
          </ListSection>
        )}

        {items.length > 0 && (
          <ListSection elevated header="What this covers" footer="Ticking items only tags them. It never changes the amount.">
            {items.map((item, i) => {
              const myShare = item.expense.splits.find((s) => s.uid === fromUid)?.amount || 0;
              return (
                <button
                  key={item.expense.id}
                  type="button"
                  role="checkbox"
                  aria-checked={item.selected}
                  onClick={() => toggleItem(i)}
                  className="list-row"
                  style={{ ["--sep-inset" as string]: "50px" }}
                >
                  <span
                    className={`w-[22px] h-[22px] rounded-full grid place-items-center shrink-0 ${
                      item.selected ? "bg-[var(--brand-solid)] text-white" : "ring-[1.5px] ring-inset ring-[var(--text-tertiary)]"
                    }`}
                    aria-hidden
                  >
                    {item.selected && <Checkmark size={13} weight={3.2} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block t-body truncate text-[var(--text-primary)]">{item.expense.description}</span>
                    <span className="block t-footnote text-[var(--text-secondary)]">of {formatCurrency(item.expense.amount)}</span>
                  </span>
                  <span className="t-body t-numeral text-[var(--text-secondary)]">{formatCurrency(myShare)}</span>
                </button>
              );
            })}
          </ListSection>
        )}

        <ListSection elevated footer={`${toName} approves it before it counts in the group balance.`}>
          <FieldRow label="Note">
            <input
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
            aria-label="Add payment screenshots"
            onKeyDown={activateFileInputOnKey}
            className="list-row cursor-pointer active:bg-[var(--pressed)]"
          >
            <span className="text-[var(--brand)]"><Paperclip size={20} /></span>
            <span className="flex-1 t-body text-[var(--brand)]">
              {receiptFiles.length > 0 ? "Add Another Screenshot" : paidExternally ? "Attach Payment Screenshot" : "Attach Screenshot"}
            </span>
            <input type="file" accept="image/*" multiple onChange={handleReceipts} className="hidden" />
          </label>
          {receiptFiles.map((f, i) => (
            <Row
              key={`${f.name}-${i}`}
              title={<span className="text-[var(--text-secondary)]">{f.name}</span>}
              detail={
                <button type="button" onClick={() => removeReceipt(i)} className="t-body text-[var(--neg)] min-h-[44px] -my-3 px-1">
                  Remove
                </button>
              }
            />
          ))}
        </ListSection>

        {error && <p className="list-footer !text-[var(--neg)]">{error}</p>}
      </form>
    </GlassModal>
  );
}
