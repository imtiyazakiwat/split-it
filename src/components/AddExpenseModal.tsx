"use client";

import { useState } from "react";
import { Group } from "@/lib/types";
import { addExpense } from "@/lib/firestore";
import { uploadMultipleReceipts } from "@/lib/storage";
import { splitEqually } from "@/lib/balance";
import GlassModal from "@/components/ui/GlassModal";
import { GlassField, GlassSelect } from "@/components/ui/GlassField";
import GlassButton from "@/components/ui/GlassButton";

export default function AddExpenseModal({
  group,
  currentUid,
  onClose,
  prefillReceipt,
}: {
  group: Group;
  currentUid: string;
  onClose: () => void;
  prefillReceipt?: File | null;
}) {
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [paidBy, setPaidBy] = useState(currentUid);
  const [selectedMembers, setSelectedMembers] = useState<string[]>(group.memberIds);
  const [receiptFiles, setReceiptFiles] = useState<File[]>(prefillReceipt ? [prefillReceipt] : []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function toggleMember(uid: string) {
    setSelectedMembers((prev) =>
      prev.includes(uid) ? prev.filter((m) => m !== uid) : [...prev, uid]
    );
  }

  function handleReceipts(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    setReceiptFiles((prev) => [...prev, ...files]);
  }

  function removeReceipt(index: number) {
    setReceiptFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amt = parseFloat(amount);
    if (!description.trim() || !amt || amt <= 0 || selectedMembers.length === 0) {
      setError("Fill in a description, valid amount, and select at least one member.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      let receiptUrls: string[] = [];
      if (receiptFiles.length > 0) {
        receiptUrls = await uploadMultipleReceipts(group.id, receiptFiles);
      }
      const splits = splitEqually(amt, selectedMembers);
      await addExpense(group.id, {
        description: description.trim(),
        amount: amt,
        paidBy,
        splitType: "equal",
        splits,
        createdBy: currentUid,
        receiptUrls,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add expense");
    } finally {
      setBusy(false);
    }
  }

  return (
    <GlassModal title="Add Expense" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <GlassField
          label="Description"
          autoFocus
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Dinner, Cab, Groceries…"
        />

        <GlassField
          label="Amount"
          type="number"
          inputMode="decimal"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
        />

        <GlassSelect label="Paid by" value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
          {group.memberIds.map((uid) => (
            <option key={uid} value={uid}>
              {uid === currentUid ? "You" : group.members[uid]?.displayName || uid}
            </option>
          ))}
        </GlassSelect>

        <div>
          <p className="text-sm font-medium text-[var(--label-secondary)] mb-2">
            Split equally between
          </p>
          <div className="space-y-1 rounded-[var(--radius-md)] border border-[var(--border-subtle)] p-1">
            {group.memberIds.map((uid) => (
              <label
                key={uid}
                className="flex items-center gap-2.5 py-2 px-2.5 rounded-[var(--radius-sm)] tap-shrink"
              >
                <input
                  type="checkbox"
                  checked={selectedMembers.includes(uid)}
                  onChange={() => toggleMember(uid)}
                  className="rounded accent-[var(--accent)] w-4 h-4"
                />
                <span className="text-[15px] text-[var(--label-primary)]">
                  {uid === currentUid ? "You" : group.members[uid]?.displayName || uid}
                </span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <p className="text-sm font-medium text-[var(--label-secondary)] mb-2">
            Receipts (optional)
          </p>
          <label className="block cursor-pointer rounded-[var(--radius-md)] border border-dashed border-[var(--border-subtle)] px-3 py-2.5 text-sm text-[var(--label-tertiary)] tap-shrink">
            {receiptFiles.length > 0
              ? `${receiptFiles.length} file(s) selected — tap to add more`
              : "Tap to select receipt images"}
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

        {error && <p className="text-sm text-[var(--danger)]">{error}</p>}

        <GlassButton disabled={busy} className="w-full">
          {busy ? "Saving…" : "Save Expense"}
        </GlassButton>
      </form>
    </GlassModal>
  );
}
