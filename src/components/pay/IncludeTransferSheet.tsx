"use client";

import { useState } from "react";
import { DirectTransfer } from "@/lib/types";
import { formatCurrency, pairwiseNet } from "@/lib/balance";
import { GroupDataset } from "@/lib/global-balance";
import {
  acknowledgeTransfer,
  declineTransfer,
  includeTransferInGroup,
} from "@/lib/transfers";
import GlassModal from "@/components/ui/GlassModal";
import { useToast } from "@/components/ui/Toast";

interface GroupOption {
  groupId: string;
  groupName: string;
  /** Positive: the sender owes me here, so this payment can settle it. */
  theyOweMe: number;
}

/**
 * What the receiver does with money someone says they sent.
 *
 * The choice matters, which is why it's an explicit screen rather than a silent
 * default. Booking the payment into a group settles a real balance there;
 * confirming it without a group records that the money arrived and leaves every
 * balance alone. Guessing on the user's behalf would either leave a debt looking
 * unpaid or clear one that was never owed.
 */
export default function IncludeTransferSheet({
  transfer,
  meUid,
  fromName,
  datasets,
  onClose,
}: {
  transfer: DirectTransfer;
  meUid: string;
  fromName: string;
  datasets: GroupDataset[];
  onClose: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const showToast = useToast();

  const options: GroupOption[] = datasets
    .filter(
      (d) =>
        d.group.memberIds?.includes(meUid) &&
        d.group.memberIds?.includes(transfer.fromUid)
    )
    .map((d) => ({
      groupId: d.group.id,
      groupName: d.group.name,
      // pairwiseNet(a, b, …) is what `a` owes `b`, netted over just the two of
      // them — never routed through a third person, which is what makes it
      // comparable across groups.
      theyOweMe: pairwiseNet(transfer.fromUid, meUid, d.expenses, d.settlements),
    }))
    .sort((a, b) => b.theyOweMe - a.theyOweMe);

  async function run(label: string, action: () => Promise<unknown>, message: string) {
    setBusy(label);
    setError("");
    try {
      await action();
      showToast({ message });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <GlassModal title={`${formatCurrency(transfer.amount)} from ${fromName}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="rounded-[var(--radius-inner)] bg-[var(--tint-accent)] p-4">
          <p className="text-[15px] font-semibold text-[var(--text-primary)]">
            Did you receive this?
          </p>
          <p className="text-[13px] text-[var(--text-tertiary)] mt-1">
            {fromName} says they sent you {formatCurrency(transfer.amount)}
            {transfer.note ? ` — “${transfer.note}”` : ""}. Check your bank or UPI app
            before confirming.
          </p>
          {transfer.receiptUrls.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {transfer.receiptUrls.map((url, i) => (
                <a
                  key={url}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[12px] font-medium text-[var(--brand)]"
                >
                  Screenshot {i + 1}
                </a>
              ))}
            </div>
          )}
        </div>

        <div>
          <p className="text-sm font-medium text-[var(--label-secondary)] mb-1">
            Settle a group balance with it
          </p>
          <p className="text-[12px] text-[var(--label-tertiary)] mb-2">
            Pick the group this payment was for. It records {fromName} paying you{" "}
            {formatCurrency(transfer.amount)} there, and the balance updates for both of
            you straight away.
          </p>

          {options.length === 0 ? (
            <p className="text-[13px] text-[var(--label-tertiary)]">
              You don&rsquo;t share a group with {fromName} yet, so there&rsquo;s no
              balance to settle. Confirm it below to record that the money arrived.
            </p>
          ) : (
            <div className="space-y-1.5">
              {options.map((o) => {
                const owed = o.theyOweMe > 0.01;
                const covers = Math.min(transfer.amount, Math.max(0, o.theyOweMe));
                const leftover = Math.round((transfer.amount - covers) * 100) / 100;
                return (
                  <button
                    key={o.groupId}
                    type="button"
                    disabled={!!busy}
                    onClick={() =>
                      run(
                        o.groupId,
                        () => includeTransferInGroup(transfer, o.groupId),
                        `Counted in ${o.groupName}`
                      )
                    }
                    className="w-full text-left rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--surface)] px-3.5 py-3 tap-shrink disabled:opacity-50"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[15px] font-semibold text-[var(--text-primary)] truncate">
                        {o.groupName}
                      </span>
                      <span
                        className={`text-[13px] font-semibold shrink-0 ${
                          owed ? "text-[var(--pos)]" : "text-[var(--text-tertiary)]"
                        }`}
                      >
                        {owed
                          ? `owes you ${formatCurrency(o.theyOweMe)}`
                          : o.theyOweMe < -0.01
                          ? `you owe ${formatCurrency(-o.theyOweMe)}`
                          : "settled"}
                      </span>
                    </div>
                    {/* Overpayment isn't an error, but it does flip the balance,
                        so say so before it happens rather than after. */}
                    {leftover > 0.01 && (
                      <p className="text-[12px] text-[var(--warning)] mt-1">
                        {formatCurrency(leftover)} more than they owe here — you&rsquo;ll
                        end up owing them that much in {o.groupName}.
                      </p>
                    )}
                    {busy === o.groupId && (
                      <p className="text-[12px] text-[var(--text-tertiary)] mt-1">
                        Recording…
                      </p>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {error && <p className="text-sm text-[var(--danger)]">{error}</p>}

        <div className="border-t border-[var(--border-subtle)] pt-3 space-y-2">
          <button
            type="button"
            disabled={!!busy}
            onClick={() =>
              run(
                "ack",
                () => acknowledgeTransfer(transfer),
                "Payment confirmed — no group balance changed"
              )
            }
            className="w-full rounded-full bg-[var(--fill)] px-4 py-2.5 text-[15px] font-medium text-[var(--text-primary)] tap-shrink disabled:opacity-50"
          >
            {busy === "ack" ? "Confirming…" : "Got it, but not for a group"}
          </button>
          <button
            type="button"
            disabled={!!busy}
            onClick={() =>
              run("decline", () => declineTransfer(transfer), "Marked as not received")
            }
            className="w-full rounded-full bg-[var(--tint-danger-soft)] px-4 py-2.5 text-[15px] font-medium text-[var(--neg)] tap-shrink disabled:opacity-50"
          >
            {busy === "decline" ? "Saving…" : "I didn't receive this"}
          </button>
          <p className="text-[12px] text-[var(--label-tertiary)]">
            You can confirm now and attach it to a group later, from this chat.
          </p>
        </div>
      </div>
    </GlassModal>
  );
}
