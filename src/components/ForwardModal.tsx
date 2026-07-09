"use client";

import { useState } from "react";
import { addSettlementRequest, updateSettlementStatus } from "@/lib/firestore";
import { formatCurrency } from "@/lib/balance";
import GlassModal from "@/components/ui/GlassModal";
import GlassButton from "@/components/ui/GlassButton";

interface Creditor {
  uid: string;
  name: string;
  amount: number;
}

/**
 * Forwarding (option b): when a payment is coming in to you, pass it onward to
 * someone you owe. This approves the incoming settlement and raises a new
 * settlement request from you to the chosen creditor.
 */
export default function ForwardModal({
  groupId,
  meUid,
  incomingId,
  incomingAmount,
  fromName,
  creditors,
  onClose,
}: {
  groupId: string;
  meUid: string;
  incomingId: string;
  incomingAmount: number;
  fromName: string;
  creditors: Creditor[];
  onClose: () => void;
}) {
  const [targetUid, setTargetUid] = useState(creditors[0]?.uid || "");
  const target = creditors.find((c) => c.uid === targetUid);
  const defaultAmount = target
    ? Math.min(incomingAmount, target.amount)
    : incomingAmount;
  const [amount, setAmount] = useState(String(defaultAmount));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function handleTargetChange(uid: string) {
    setTargetUid(uid);
    const c = creditors.find((x) => x.uid === uid);
    if (c) setAmount(String(Math.min(incomingAmount, c.amount)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amt = parseFloat(amount) || 0;
    if (!target) {
      setError("Select who to forward to.");
      return;
    }
    if (amt <= 0) {
      setError("Enter a valid amount.");
      return;
    }
    if (amt > incomingAmount + 0.01) {
      setError(`You can forward at most ${formatCurrency(incomingAmount)}.`);
      return;
    }
    setBusy(true);
    setError("");
    try {
      // Approve the incoming payment, then pass it on.
      await updateSettlementStatus(groupId, incomingId, "approved");
      await addSettlementRequest(groupId, {
        fromUid: meUid,
        toUid: target.uid,
        amount: amt,
        note: `Forwarded from ${fromName}'s payment`,
        forwardedFromSettlementId: incomingId,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to forward payment");
    } finally {
      setBusy(false);
    }
  }

  return (
    <GlassModal title="Forward payment" onClose={onClose}>
      {creditors.length === 0 ? (
        <div className="space-y-4">
          <p className="text-sm text-[var(--label-secondary)]">
            You don&apos;t owe anyone in this group, so there&apos;s no one to
            forward this payment to.
          </p>
          <GlassButton type="button" variant="ghost" onClick={onClose} className="w-full">
            Close
          </GlassButton>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-[13px] text-[var(--label-tertiary)]">
            {fromName} is paying you {formatCurrency(incomingAmount)}. Pass it on
            to someone you owe.
          </p>

          <div>
            <label className="text-sm font-medium text-[var(--label-secondary)] block mb-1">
              Forward to
            </label>
            <select
              value={targetUid}
              onChange={(e) => handleTargetChange(e.target.value)}
              className="w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--surface)] px-3.5 py-2.5 text-[15px] text-[var(--label-primary)] outline-none focus:border-[var(--accent)]"
            >
              {creditors.map((c) => (
                <option key={c.uid} value={c.uid}>
                  {c.name} (you owe {formatCurrency(c.amount)})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-sm font-medium text-[var(--label-secondary)] block mb-1">
              Amount
            </label>
            <input
              type="number"
              step="0.01"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--surface)] px-3.5 py-2.5 text-[15px] text-[var(--label-primary)] outline-none focus:border-[var(--accent)]"
            />
          </div>

          <p className="text-[13px] text-[var(--label-tertiary)]">
            This approves {fromName}&apos;s payment and sends a settlement request
            to {target?.name}, who will need to approve it.
          </p>

          {error && <p className="text-sm text-[var(--danger)]">{error}</p>}

          <GlassButton disabled={busy} className="w-full">
            {busy ? "Forwarding…" : "Forward Payment"}
          </GlassButton>
        </form>
      )}
    </GlassModal>
  );
}
