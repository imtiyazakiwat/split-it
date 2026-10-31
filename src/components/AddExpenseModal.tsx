"use client";

import { useRef, useState } from "react";
import { Expense, Group } from "@/lib/types";
import { addExpense } from "@/lib/firestore";
import { uploadMultipleReceipts } from "@/lib/storage";
import { rescaleSplits, splitEqually, formatCurrency } from "@/lib/balance";
import { EXPENSE_CATEGORIES } from "@/lib/categories";
import { useToast } from "@/components/ui/Toast";
import { hapticSuccess } from "@/lib/haptics";
import { activateFileInputOnKey } from "@/lib/keyboard";
import GlassModal from "@/components/ui/GlassModal";
import { FieldRow, ListSection, Row } from "@/components/ui/List";
import { AmountInput, Avatar } from "@/components/ui/Controls";
import { CategoryGlyph, Checkmark, Paperclip, categoryTint } from "@/components/ui/Icons";

export interface NewExpenseInput {
  description: string;
  amount: number;
  paidBy: string;
  /** Equal split across `splitMemberIds`, precomputed for the add path. */
  splits: { uid: string; amount: number }[];
  /** Who the expense is split between. Editing needs this so the caller can
   *  decide how to re-split rather than being handed an equal split it may
   *  not want (a legacy exact/percentage expense should keep its shape). */
  splitMemberIds: string[];
  category: string;
  receiptFiles: File[];
}

export default function AddExpenseModal({
  group,
  currentUid,
  onClose,
  prefillReceipt,
  onSubmit,
  expense,
}: {
  group: Group;
  currentUid: string;
  onClose: () => void;
  prefillReceipt?: File | null;
  /** When provided, the parent persists the expense (enabling optimistic UI):
   *  the modal builds the input, hands it off, and closes immediately. */
  onSubmit?: (input: NewExpenseInput) => void;
  /** Editing an existing expense reuses this whole screen rather than a
   *  cut-down form, so adding and editing look and behave the same. */
  expense?: Expense | null;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const isEdit = !!expense;
  const [amount, setAmount] = useState(expense ? String(expense.amount) : "");
  const [category, setCategory] = useState(expense?.category || "meal");
  const [paidBy, setPaidBy] = useState(expense?.paidBy || currentUid);
  const [splitMembers, setSplitMembers] = useState<string[]>(
    expense ? expense.splits.map((s) => s.uid) : group.memberIds
  );
  const [note, setNote] = useState(expense?.description || "");
  const [receiptFiles, setReceiptFiles] = useState<File[]>(prefillReceipt ? [prefillReceipt] : []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const showToast = useToast();

  const parsedAmount = parseFloat(amount) || 0;
  const eachPays = splitMembers.length > 0 ? parsedAmount / splitMembers.length : 0;

  // A legacy exact/percentage expense keeps its shape on edit: the parent
  // rescales the original amounts instead of re-splitting evenly, and that only
  // happens while the same people are involved. The panel below has to describe
  // whichever of the two is actually going to be saved — it used to always say
  // "Split equally", which was wrong for every uneven expense.
  const originalSplits = expense?.splits ?? [];
  const sameMembers =
    originalSplits.length === splitMembers.length &&
    originalSplits.every((s) => splitMembers.includes(s.uid));
  const keepsCustomSplit = isEdit && expense!.splitType !== "equal" && sameMembers;
  const previewSplits = keepsCustomSplit
    ? rescaleSplits(originalSplits, parsedAmount)
    : splitEqually(parsedAmount, splitMembers);
  const memberName = (uid: string) => (uid === currentUid ? "You" : group.members[uid]?.displayName || "User");
  const categoryLabel = EXPENSE_CATEGORIES.find((c) => c.id === category)?.label || "Expense";

  function toggleSplit(uid: string) {
    setSplitMembers((prev) => (prev.includes(uid) ? prev.filter((m) => m !== uid) : [...prev, uid]));
  }

  function handleReceipts(e: React.ChangeEvent<HTMLInputElement>) {
    setReceiptFiles((prev) => [...prev, ...Array.from(e.target.files || [])]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (parsedAmount <= 0 || splitMembers.length === 0) {
      setError("Enter an amount and pick who's splitting.");
      return;
    }
    setError("");
    const splits = splitEqually(parsedAmount, splitMembers);
    const input: NewExpenseInput = {
      description: note.trim() || categoryLabel,
      amount: parsedAmount,
      paidBy,
      splits,
      splitMemberIds: splitMembers,
      category,
      receiptFiles,
    };

    // Optimistic path: parent persists + reconciles; close instantly.
    if (onSubmit) {
      onSubmit(input);
      onClose();
      return;
    }

    // Fallback path (e.g. share-receipt): persist here.
    setBusy(true);
    try {
      let receiptUrls: string[] = [];
      if (receiptFiles.length > 0) {
        receiptUrls = await uploadMultipleReceipts(group.id, receiptFiles);
      }
      await addExpense(group.id, {
        description: input.description,
        amount: input.amount,
        paidBy,
        splitType: "equal",
        splits,
        createdBy: currentUid,
        receiptUrls,
        category,
      });
      showToast({ message: `Expense added · ${formatCurrency(parsedAmount)}` });
      hapticSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add expense");
    } finally {
      setBusy(false);
    }
  }

  const dirty = isEdit
    ? amount !== String(expense!.amount) ||
      note !== (expense!.description || "") ||
      category !== (expense!.category || "meal") ||
      paidBy !== expense!.paidBy ||
      receiptFiles.length > 0 ||
      !sameMembers
    : amount !== "" || note.trim() !== "" || receiptFiles.length > (prefillReceipt ? 1 : 0);
  const valid = parsedAmount > 0 && splitMembers.length > 0;

  return (
    <GlassModal
      title={isEdit ? "Edit Expense" : "New Expense"}
      large
      onClose={onClose}
      dirty={dirty && !busy}
      confirm={{ label: isEdit ? "Save" : "Add", formId: "expense-form", disabled: !valid, busy, onConfirm: () => {} }}
    >
      <form id="expense-form" ref={formRef} onSubmit={handleSubmit}>
        {/* Amount first: money is the point. */}
        <div className="flex flex-col items-center pt-3 pb-1">
          <AmountInput value={amount} onChange={setAmount} autoFocus={!isEdit} />
          <p className="t-footnote text-[var(--text-secondary)]">{group.name}</p>
        </div>

        <ListSection elevated>
          <FieldRow label="Description">
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={categoryLabel}
              aria-label="Description"
              enterKeyHint="done"
              className="row-input py-[13px]"
            />
          </FieldRow>
        </ListSection>

        <ListSection elevated header="Category">
          <div className="grid grid-cols-3 gap-2 p-2.5">
            {EXPENSE_CATEGORIES.map((c) => {
              const active = category === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCategory(c.id)}
                  aria-pressed={active}
                  className={`flex flex-col items-center gap-1.5 rounded-[14px] py-2.5 tap-shrink ${
                    active ? "bg-[var(--tint-accent)]" : ""
                  }`}
                >
                  <span className="icon-tile !w-9 !h-9 !rounded-[10px]" style={{ background: categoryTint(c.id) }}>
                    <CategoryGlyph id={c.id} size={19} />
                  </span>
                  <span className={`t-footnote ${active ? "font-semibold text-[var(--brand)]" : "text-[var(--text-primary)]"}`}>
                    {c.label}
                  </span>
                </button>
              );
            })}
          </div>
        </ListSection>

        <ListSection elevated header="Paid by">
          <div className="flex gap-1 overflow-x-auto no-scrollbar px-2 py-3">
            {group.memberIds.map((uid) => {
              const active = paidBy === uid;
              return (
                <button
                  key={uid}
                  type="button"
                  onClick={() => setPaidBy(uid)}
                  aria-pressed={active}
                  className="flex flex-col items-center gap-1.5 shrink-0 w-[72px] tap-shrink"
                >
                  <span className={`relative rounded-full p-[2.5px] ${active ? "bg-[var(--brand-solid)]" : ""}`}>
                    <span className="block rounded-full p-[2px] bg-[var(--surface-elevated)]">
                      <Avatar name={group.members[uid]?.displayName || memberName(uid)} photoURL={group.members[uid]?.photoURL} size={46} seed={uid} />
                    </span>
                  </span>
                  <span className={`t-footnote truncate w-full text-center ${active ? "font-semibold text-[var(--brand)]" : "text-[var(--text-primary)]"}`}>
                    {memberName(uid)}
                  </span>
                </button>
              );
            })}
          </div>
        </ListSection>

        <ListSection
          elevated
          header="Split between"
          footer={
            keepsCustomSplit
              ? "Each person keeps their original share of the total."
              : splitMembers.length > 0
              ? `Split equally · ${formatCurrency(eachPays)} each`
              : "Pick at least one person."
          }
        >
          {group.memberIds.map((uid) => {
            const inSplit = splitMembers.includes(uid);
            const share = previewSplits.find((p) => p.uid === uid)?.amount ?? 0;
            return (
              <button
                key={uid}
                type="button"
                role="checkbox"
                aria-checked={inSplit}
                onClick={() => toggleSplit(uid)}
                className="list-row"
                style={{ ["--sep-inset" as string]: "60px" }}
              >
                <Avatar name={group.members[uid]?.displayName || memberName(uid)} photoURL={group.members[uid]?.photoURL} size={32} seed={uid} />
                <span className="flex-1 min-w-0 t-body truncate text-[var(--text-primary)]">{memberName(uid)}</span>
                {inSplit && parsedAmount > 0 && (
                  <span className="t-body t-numeral text-[var(--text-secondary)]">{formatCurrency(share)}</span>
                )}
                <span
                  className={`w-[22px] h-[22px] rounded-full grid place-items-center shrink-0 ${
                    inSplit ? "bg-[var(--brand-solid)] text-white" : "ring-[1.5px] ring-inset ring-[var(--text-tertiary)]"
                  }`}
                  aria-hidden
                >
                  {inSplit && <Checkmark size={13} weight={3.2} />}
                </span>
              </button>
            );
          })}
        </ListSection>

        <ListSection elevated footer="Images only, up to 10 MB each.">
          <label
            role="button"
            tabIndex={0}
            aria-label="Add receipt image"
            onKeyDown={activateFileInputOnKey}
            className="list-row cursor-pointer active:bg-[var(--pressed)]"
          >
            <span className="text-[var(--brand)]"><Paperclip size={20} /></span>
            <span className="flex-1 t-body text-[var(--brand)]">
              {receiptFiles.length > 0 ? "Add Another Receipt" : "Attach Receipt"}
            </span>
            {receiptFiles.length > 0 && (
              <span className="t-body text-[var(--text-secondary)]">{receiptFiles.length}</span>
            )}
            <input type="file" accept="image/*" multiple onChange={handleReceipts} className="hidden" />
          </label>
          {receiptFiles.map((f, i) => (
            <Row
              key={`${f.name}-${i}`}
              title={<span className="text-[var(--text-secondary)]">{f.name}</span>}
              detail={
                <button
                  type="button"
                  onClick={() => setReceiptFiles((prev) => prev.filter((_, j) => j !== i))}
                  className="t-body text-[var(--neg)] min-h-[44px] -my-3 px-1"
                >
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
