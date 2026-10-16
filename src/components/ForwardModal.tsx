"use client";

import { useRef, useState } from "react";
import { addSettlementRequest, updateSettlementStatus } from "@/lib/firestore";
import { formatCurrency } from "@/lib/balance";
import { toPaise } from "@/lib/money";
import { hapticTap } from "@/lib/haptics";
import { useToast } from "@/components/ui/Toast";
import { Sheet, type SheetHandle } from "@/components/kit/Sheet";
import { AmountField } from "@/components/kit/AmountField";
import { Button, EmptyState } from "@/components/kit/Controls";
import { List, Section, sepInset } from "@/components/kit/List";
import { Avatar } from "@/components/kit/Avatar";
import { Icon } from "@/components/kit/Icon";

interface Creditor {
  uid: string;
  name: string;
  amount: number;
}

/**
 * Forwarding: when a payment is coming in to you, pass it on to someone you
 * owe. Approves the incoming settlement and raises a new request from you to
 * the chosen creditor.
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
  const defaultAmount = target ? Math.min(incomingAmount, target.amount) : incomingAmount;
  const [amount, setAmount] = useState(String(defaultAmount));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const sheetRef = useRef<SheetHandle>(null);
  const showToast = useToast();

  function handleTargetChange(uid: string) {
    hapticTap();
    setTargetUid(uid);
    const c = creditors.find((x) => x.uid === uid);
    if (c) setAmount(String(Math.min(incomingAmount, c.amount)));
  }

  async function handleSubmit() {
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
      sheetRef.current?.dismiss();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to forward payment");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      ref={sheetRef}
      title="Forward Payment"
      subtitle={`${formatCurrency(incomingAmount)} from ${fromName}`}
      onClose={onClose}
      footer={
        creditors.length > 0 ? (
          <>
            <Button block busy={busy} onClick={() => void handleSubmit()}>
              Forward to {target?.name ?? "…"}
            </Button>
            <p className="t-caption mt-2 text-center text-label-2">
              Approves {fromName}&rsquo;s payment and sends {target?.name ?? "them"} a request to approve.
            </p>
          </>
        ) : undefined
      }
    >
      {creditors.length === 0 ? (
        <EmptyState
          compact
          icon="forward"
          title="No One to Forward To"
          message="You don't owe anyone in this group, so there's no one to pass this payment on to."
        />
      ) : (
        <>
          <AmountField id="forward-amount" value={amount} onChange={setAmount} size={48} />
          <Section header="Forward to" tight>
            <List>
              <div role="radiogroup" aria-label="Forward to" className="contents">
                {creditors.map((c) => {
                  const selected = c.uid === targetUid;
                  return (
                    <button
                      key={c.uid}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => handleTargetChange(c.uid)}
                      className="row is-pressable is-tall"
                      style={sepInset(68)}
                    >
                      <Avatar name={c.name} size={40} />
                      <span className="row-main">
                        <span className="row-title">{c.name}</span>
                        <span className="row-subtitle">You owe {formatCurrency(c.amount)}</span>
                      </span>
                      {selected && (
                        <span className="text-tint" aria-hidden>
                          <Icon name="checkmark" size={20} strokeWidth={2.6} />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </List>
          </Section>
          {error && <p className="t-footnote mt-4 px-4 text-neg">{error}</p>}
        </>
      )}
    </Sheet>
  );
}
