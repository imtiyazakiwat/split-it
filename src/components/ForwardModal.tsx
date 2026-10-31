"use client";

import { useState } from "react";
import { addSettlementRequest, updateSettlementStatus } from "@/lib/firestore";
import { formatCurrency } from "@/lib/balance";
import { toPaise } from "@/lib/money";
import GlassModal from "@/components/ui/GlassModal";
import { FieldRow, ListSection } from "@/components/ui/List";
import { EmptyState } from "@/components/ui/Controls";
import { Arrows, Checkmark } from "@/components/ui/Icons";
import { useToast } from "@/components/ui/Toast";

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
  const showToast = useToast();

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
    if (toPaise(amt) > toPaise(incomingAmount)) {
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
        createdBy: meUid,
        kind: "payment",
        note: `Forwarded from ${fromName}'s payment`,
        forwardedFromSettlementId: incomingId,
      });
      showToast({ message: `Payment forwarded to ${target.name}` });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to forward payment");
    } finally {
      setBusy(false);
    }
  }

  return (
    <GlassModal
      title="Forward Payment"
      onClose={onClose}
      confirm={
        creditors.length > 0
          ? { label: "Forward", formId: "forward-form", disabled: !target || !(parseFloat(amount) > 0), busy, onConfirm: () => {} }
          : undefined
      }
    >
      {creditors.length === 0 ? (
        <EmptyState
          icon={<Arrows size={48} weight={1.4} />}
          title="No One to Forward To"
          message="You don’t owe anyone in this group, so there’s no one to pass this payment on to."
        />
      ) : (
        <form id="forward-form" onSubmit={handleSubmit}>
          <p className="t-subhead text-[var(--text-secondary)] text-center px-4 pt-1">
            {fromName} is paying you {formatCurrency(incomingAmount)}. Pass it on to someone you owe.
          </p>

          <ListSection elevated header="Forward to">
            <div role="radiogroup" aria-label="Forward to">
              {creditors.map((c) => {
                const selected = c.uid === targetUid;
                return (
                  <button
                    key={c.uid}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => handleTargetChange(c.uid)}
                    className="list-row"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block t-body truncate text-[var(--text-primary)]">{c.name}</span>
                      <span className="block t-footnote text-[var(--text-secondary)]">You owe {formatCurrency(c.amount)}</span>
                    </span>
                    {selected && <span className="text-[var(--brand)]"><Checkmark size={20} /></span>}
                  </button>
                );
              })}
            </div>
          </ListSection>

          <ListSection
            elevated
            footer={`This approves ${fromName}'s payment and sends a request to ${target?.name ?? "them"}, who approves it.`}
          >
            <FieldRow label="Amount">
              <input
                type="number"
                step="0.01"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                aria-label="Amount"
                className="row-input is-trailing py-[13px] t-numeral"
              />
            </FieldRow>
          </ListSection>

          {error && <p className="list-footer !text-[var(--neg)]">{error}</p>}
        </form>
      )}
    </GlassModal>
  );
}
