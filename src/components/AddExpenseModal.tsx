"use client";

import { useRef, useState } from "react";
import { Expense, Group } from "@/lib/types";
import { addExpense } from "@/lib/firestore";
import { uploadMultipleReceipts } from "@/lib/storage";
import { rescaleSplits, splitEqually, formatCurrency } from "@/lib/balance";
import { EXPENSE_CATEGORIES } from "@/lib/categories";
import { useToast } from "@/components/ui/Toast";
import { hapticSuccess, hapticTap } from "@/lib/haptics";
import { Sheet, SheetIconButton, type SheetHandle } from "@/components/kit/Sheet";
import { List, Section, sepInset } from "@/components/kit/List";
import { Avatar } from "@/components/kit/Avatar";
import { CategoryTile } from "@/components/kit/Tile";
import { AmountField } from "@/components/kit/AmountField";
import { Attachments } from "@/components/kit/Attachments";
import { Menu } from "@/components/kit/Menu";
import { Icon } from "@/components/kit/Icon";

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

/**
 * Add or edit an expense: a large sheet, amount first.
 *
 * ✕ leading, ✓ trailing (disabled until there's an amount and at least one
 * person in the split). Closing with anything typed asks before discarding.
 */
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
   *  the sheet builds the input, hands it off, and closes immediately. */
  onSubmit?: (input: NewExpenseInput) => void;
  /** Editing reuses this whole sheet, so adding and editing behave the same. */
  expense?: Expense | null;
}) {
  const sheetRef = useRef<SheetHandle>(null);
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
  const valid = parsedAmount > 0 && splitMembers.length > 0;

  // A legacy exact/percentage expense keeps its shape on edit while the same
  // people are involved; the preview has to describe whichever will be saved.
  const originalSplits = expense?.splits ?? [];
  const sameMembers =
    originalSplits.length === splitMembers.length &&
    originalSplits.every((s) => splitMembers.includes(s.uid));
  const keepsCustomSplit = isEdit && expense!.splitType !== "equal" && sameMembers;
  const previewSplits = keepsCustomSplit
    ? rescaleSplits(originalSplits, parsedAmount)
    : splitEqually(parsedAmount, splitMembers);
  const shareOf = (uid: string) => previewSplits.find((s) => s.uid === uid)?.amount ?? 0;
  const memberName = (uid: string) =>
    uid === currentUid ? "You" : group.members[uid]?.displayName || "Member";
  const categoryLabel = EXPENSE_CATEGORIES.find((c) => c.id === category)?.label || "Expense";

  const dirty = isEdit
    ? amount !== String(expense!.amount) ||
      note !== (expense!.description || "") ||
      category !== (expense!.category || "meal") ||
      paidBy !== expense!.paidBy ||
      !sameMembers ||
      receiptFiles.length > 0
    : !!amount || !!note.trim() || receiptFiles.length > (prefillReceipt ? 1 : 0);

  function toggleSplit(uid: string) {
    hapticTap();
    setSplitMembers((prev) => (prev.includes(uid) ? prev.filter((m) => m !== uid) : [...prev, uid]));
  }

  async function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!valid) {
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

    // Optimistic path: the parent persists and reconciles; close at once.
    if (onSubmit) {
      onSubmit(input);
      sheetRef.current?.dismiss();
      return;
    }

    // Fallback path (share-receipt): persist here.
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
      sheetRef.current?.dismiss();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add expense");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      ref={sheetRef}
      large
      title={isEdit ? "Edit Expense" : "Add Expense"}
      subtitle={group.name}
      dirty={dirty && !busy}
      onClose={onClose}
      trailing={
        <SheetIconButton
          icon="checkmark"
          label={isEdit ? "Save expense" : "Add expense"}
          prominent
          disabled={!valid || busy}
          onClick={() => formRef.current?.requestSubmit()}
        />
      }
    >
      <form ref={formRef} onSubmit={handleSubmit} noValidate>
        {/* Amount */}
        <AmountField
          id="expense-amount"
          value={amount}
          onChange={setAmount}
          autoFocus={!isEdit}
          caption={
            splitMembers.length > 0 && parsedAmount > 0 && !keepsCustomSplit
              ? `${formatCurrency(shareOf(splitMembers[0]))} each · ${splitMembers.length} ${
                  splitMembers.length === 1 ? "person" : "people"
                }`
              : keepsCustomSplit
              ? "Each person keeps their original share"
              : "Indian rupees"
          }
        />

        {/* Description */}
        <List>
          <label className="row" style={{ cursor: "text" }}>
            <CategoryTile id={category} />
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={`What was it for? (${categoryLabel})`}
              aria-label="Description"
              maxLength={80}
              className="field"
            />
          </label>
        </List>

        {/* Category */}
        <Section header="Category">
          <div className="grid grid-cols-3 gap-2">
            {EXPENSE_CATEGORIES.map((c) => {
              const active = category === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    if (!active) hapticTap();
                    setCategory(c.id);
                  }}
                  className={`relative flex flex-col items-center gap-1.5 rounded-[18px] py-3 transition-[background-color,box-shadow] duration-200 ${
                    active
                      ? "bg-[var(--cell-elevated)] shadow-[0_0_0_2px_var(--tint)]"
                      : "bg-[var(--cell-elevated)]"
                  }`}
                >
                  <CategoryTile id={c.id} size="lg" />
                  <span className={`t-footnote ${active ? "font-semibold text-tint" : "text-label"}`}>{c.label}</span>
                </button>
              );
            })}
          </div>
        </Section>

        {/* Paid by */}
        <Section header="Paid by">
          <List>
            <Menu
              align="end"
              title="Who paid?"
              items={group.memberIds.map((uid) => ({
                label: memberName(uid),
                checked: paidBy === uid,
                onSelect: () => setPaidBy(uid),
              }))}
            >
              {(props) => (
                <button type="button" {...props} className="row is-pressable" style={sepInset(16)}>
                  <Avatar
                    name={group.members[paidBy]?.displayName || memberName(paidBy)}
                    photoURL={group.members[paidBy]?.photoURL}
                    size={30}
                  />
                  <span className="row-main">
                    <span className="row-title">{memberName(paidBy)}</span>
                  </span>
                  <span className="flex items-center gap-1 text-label-2">
                    <span className="t-subhead">Change</span>
                    <Icon name="chevron.up.down" size={15} strokeWidth={2.2} />
                  </span>
                </button>
              )}
            </Menu>
          </List>
        </Section>

        {/* Split between */}
        <Section
          header="Split between"
          footer={
            keepsCustomSplit
              ? "This expense had a custom split. Each person keeps their original share of the new total."
              : splitMembers.length === 0
              ? "Pick at least one person."
              : `Split equally between ${splitMembers.length} ${splitMembers.length === 1 ? "person" : "people"}.`
          }
        >
          <List>
            {group.memberIds.map((uid) => {
              const inSplit = splitMembers.includes(uid);
              return (
                <button
                  key={uid}
                  type="button"
                  role="checkbox"
                  aria-checked={inSplit}
                  onClick={() => toggleSplit(uid)}
                  className="row is-pressable"
                  style={sepInset(58)}
                >
                  <span className={inSplit ? "text-tint" : "text-label-3"} aria-hidden>
                    <Icon
                      name={inSplit ? "checkmark.circle.fill" : "circle"}
                      size={26}
                      strokeWidth={1.6}
                    />
                  </span>
                  <span className="row-main">
                    <span className="row-title">{memberName(uid)}</span>
                  </span>
                  <span className={`num t-body shrink-0 ${inSplit ? "text-label" : "text-label-3"}`}>
                    {inSplit ? formatCurrency(shareOf(uid)) : "—"}
                  </span>
                </button>
              );
            })}
          </List>
        </Section>

        {/* Receipt */}
        <Section header="Receipt">
          <Attachments
            files={receiptFiles}
            onChange={setReceiptFiles}
            label="Add Receipt Photo"
            addMoreLabel="Add Another Photo"
            footer="Images up to 10 MB."
          />
        </Section>

        {error && <p className="t-footnote mt-4 px-4 text-neg">{error}</p>}
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </Sheet>
  );
}
