"use client";

import { useState } from "react";
import { Group } from "@/lib/types";
import { addExpense } from "@/lib/firestore";
import { uploadReceipt } from "@/lib/storage";
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
  const [receiptFile, setReceiptFile] = useState<File | null>(prefillReceipt || null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function toggleMember(uid: string) {
    setSelectedMembers((prev) =>
      prev.includes(uid) ? prev.filter((m) => m !== uid) : [...prev, uid]
    );
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
      let receiptUrl: string | undefined;
      if (receiptFile) {
        receiptUrl = await uploadReceipt(group.id, receiptFile, receiptFile.name);
      }
      const splits = splitEqually(amt, selectedMembers);
      await addExpense(group.id, {
        description: description.trim(),
        amount: amt,
        paidBy,
        splitType: "equal",
        splits,
        createdBy: currentUid,
        receiptUrl,
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

        <label className="block text-sm font-medium text-[var(--label-secondary)]">
          Receipt (optional)
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setReceiptFile(e.target.files?.[0] || null)}
            className="mt-1.5 w-full text-sm text-[var(--label-secondary)] file:mr-3 file:rounded-full file:border-0 file:bg-[var(--accent)]/10 file:text-[var(--accent)] file:px-3 file:py-1.5 file:text-sm"
          />
        </label>

        {error && <p className="text-sm text-[var(--danger)]">{error}</p>}

        <GlassButton disabled={busy} className="w-full">
          {busy ? "Saving…" : "Save Expense"}
        </GlassButton>
      </form>
    </GlassModal>
  );
}
