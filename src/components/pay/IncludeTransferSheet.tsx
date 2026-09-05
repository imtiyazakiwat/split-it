"use client";

import { useMemo, useState } from "react";
import { DirectTransfer } from "@/lib/types";
import { formatCurrency, pairwiseNet } from "@/lib/balance";
import { GroupDataset } from "@/lib/global-balance";
import { isSettled, roundMoney } from "@/lib/money";
import {
  AllocatableGroup,
  buildAllocationPlan,
  payableLegs,
  suggestAllocation,
  transferAllocations,
  unallocatedAmount,
} from "@/lib/transfer-allocation";
import {
  acknowledgeTransfer,
  declineTransfer,
  includeTransferInGroups,
} from "@/lib/transfers";
import GlassModal from "@/components/ui/GlassModal";
import { useToast } from "@/components/ui/Toast";

/**
 * What the receiver does with money someone says they sent.
 *
 * The choice matters, which is why it's an explicit screen rather than a silent
 * default. Booking the payment into a group settles a real balance there;
 * confirming it without a group records that the money arrived and leaves every
 * balance alone. Guessing on the user's behalf would either leave a debt looking
 * unpaid or clear one that was never owed.
 *
 * One payment usually isn't one group's problem. It can cover a trip *and* the
 * rent, and it can be larger than either. So the receiver picks any number of
 * groups, each leg is capped at what the sender actually owed there, and the
 * remainder is shown rather than forced into the last group — pushing the excess
 * in would flip that group's balance and leave it reading unsettled forever.
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

  const available = unallocatedAmount(transfer);
  const alreadyBooked = transferAllocations(transfer);

  const options: AllocatableGroup[] = useMemo(() => {
    const bookedGroups = new Set(alreadyBooked.map((a) => a.groupId));
    return datasets
      .filter(
        (d) =>
          d.group.memberIds?.includes(meUid) &&
          d.group.memberIds?.includes(transfer.fromUid) &&
          !bookedGroups.has(d.group.id)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasets, meUid, transfer.fromUid, transfer.allocations]);

  const settleable = options.filter((o) => o.theyOweMe > 0);

  // Raw input strings keyed by group id. A present key means "booking this
  // group"; the string is what the receiver typed, so a half-finished number
  // doesn't get clobbered on every keystroke.
  const [amounts, setAmounts] = useState<Record<string, string>>(() => {
    const seeded = suggestAllocation(available, settleable);
    const initial: Record<string, string> = {};
    for (const [groupId, amount] of seeded) {
      initial[groupId] = (amount ?? 0).toFixed(2);
    }
    return initial;
  });

  const plan = useMemo(() => {
    const desired = new Map<string, number | undefined>();
    for (const [groupId, raw] of Object.entries(amounts)) {
      const parsed = parseFloat(raw);
      desired.set(groupId, Number.isFinite(parsed) ? parsed : undefined);
    }
    return buildAllocationPlan(available, settleable, desired);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amounts, available, options]);

  const legs = payableLegs(plan);

  function toggle(group: AllocatableGroup) {
    setAmounts((prev) => {
      const next = { ...prev };
      if (group.groupId in next) {
        delete next[group.groupId];
        return next;
      }
      // Take as much as this group can absorb from what's still unassigned.
      const assigned = Object.entries(next).reduce((sum, [, raw]) => {
        const v = parseFloat(raw);
        return sum + (Number.isFinite(v) ? v : 0);
      }, 0);
      const room = roundMoney(Math.max(0, available - assigned));
      next[group.groupId] = Math.min(group.theyOweMe, room).toFixed(2);
      return next;
    });
  }

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

  const bookLabel =
    legs.length === 0
      ? "Pick a group"
      : legs.length === 1
      ? `Count ${formatCurrency(plan.allocated)} in ${plan.legs.find((l) => l.amount > 0)?.groupName}`
      : `Count ${formatCurrency(plan.allocated)} across ${legs.length} groups`;

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

        {alreadyBooked.length > 0 && (
          <div className="rounded-[var(--radius-md)] bg-[var(--fill-soft)] p-3">
            <p className="text-[13px] text-[var(--label-secondary)]">
              {formatCurrency(roundMoney(transfer.amount - available))} of this payment is
              already counted in {alreadyBooked.length}{" "}
              {alreadyBooked.length === 1 ? "group" : "groups"}.{" "}
              <span className="font-medium">
                {formatCurrency(available)} left to assign.
              </span>
            </p>
          </div>
        )}

        <div>
          <p className="text-sm font-medium text-[var(--label-secondary)] mb-1">
            Settle group balances with it
          </p>
          <p className="text-[12px] text-[var(--label-tertiary)] mb-2">
            Pick every group this payment was for. Each one takes at most what{" "}
            {fromName} owes there — anything left over stays unassigned rather than
            tipping a group into the red.
          </p>

          {settleable.length === 0 ? (
            <p className="text-[13px] text-[var(--label-tertiary)]">
              {fromName} doesn&rsquo;t owe you anything in the groups you share, so
              there&rsquo;s no balance for this to settle. Confirm it below to record that
              the money arrived.
            </p>
          ) : (
            <div className="space-y-1.5">
              {settleable.map((o) => {
                const on = o.groupId in amounts;
                const leg = plan.legs.find((l) => l.groupId === o.groupId);
                return (
                  <div
                    key={o.groupId}
                    className={`rounded-[var(--radius-md)] border px-3.5 py-3 ${
                      on
                        ? "border-[var(--brand)] bg-[var(--tint-accent)]"
                        : "border-[var(--border-subtle)] bg-[var(--surface)]"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={!!busy}
                        onChange={() => toggle(o)}
                        aria-label={`Use this payment in ${o.groupName}`}
                        className="rounded accent-[var(--accent)] w-4 h-4 shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-[15px] font-semibold text-[var(--text-primary)] truncate">
                          {o.groupName}
                        </p>
                        <p className="text-[12px] text-[var(--pos)]">
                          owes you {formatCurrency(o.theyOweMe)}
                        </p>
                      </div>
                      {on && (
                        <div className="shrink-0 flex items-center gap-1">
                          <span className="text-[14px] text-[var(--label-tertiary)]">₹</span>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            max={o.theyOweMe}
                            inputMode="decimal"
                            value={amounts[o.groupId]}
                            disabled={!!busy}
                            onChange={(e) =>
                              setAmounts((prev) => ({ ...prev, [o.groupId]: e.target.value }))
                            }
                            aria-label={`Amount to count in ${o.groupName}`}
                            className="w-24 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--surface)] px-2 py-1.5 text-[14px] font-semibold text-right text-[var(--label-primary)] outline-none focus:border-[var(--accent)]"
                          />
                        </div>
                      )}
                    </div>
                    {on && leg && leg.amount < parseFloat(amounts[o.groupId] || "0") && (
                      <p className="text-[12px] text-[var(--warning)] mt-1.5">
                        Capped at {formatCurrency(leg.amount)} — that&rsquo;s all that&rsquo;s
                        owed here, or all the payment has left.
                      </p>
                    )}
                    {on && leg?.clearsGroup && (
                      <p className="text-[12px] text-[var(--pos)] mt-1.5">
                        Clears this group completely.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {settleable.length > 0 && (
          <div className="rounded-[var(--radius-md)] bg-[var(--fill-soft)] p-3 space-y-1">
            <div className="flex items-center justify-between text-[13px]">
              <span className="text-[var(--label-secondary)]">Counted in groups</span>
              <span className="font-semibold text-[var(--label-primary)]">
                {formatCurrency(plan.allocated)}
              </span>
            </div>
            <div className="flex items-center justify-between text-[13px]">
              <span className="text-[var(--label-secondary)]">Left unassigned</span>
              <span
                className={`font-semibold ${
                  isSettled(plan.leftover)
                    ? "text-[var(--label-tertiary)]"
                    : "text-[var(--warning)]"
                }`}
              >
                {formatCurrency(plan.leftover)}
              </span>
            </div>
            {!isSettled(plan.leftover) && (
              <p className="text-[12px] text-[var(--label-tertiary)] pt-1">
                {formatCurrency(plan.leftover)} isn&rsquo;t going into any group. It stays
                recorded as money you received, and you can assign it later from this
                chat if a new balance comes up.
              </p>
            )}
          </div>
        )}

        {error && <p className="text-sm text-[var(--danger)]">{error}</p>}

        {settleable.length > 0 && (
          <button
            type="button"
            disabled={!!busy || legs.length === 0}
            onClick={() =>
              run(
                "book",
                () => includeTransferInGroups(transfer, legs),
                legs.length === 1
                  ? `Counted in ${plan.legs.find((l) => l.amount > 0)?.groupName}`
                  : `Counted across ${legs.length} groups`
              )
            }
            className="w-full rounded-full bg-[var(--brand-solid)] px-4 py-3 text-[15px] font-semibold text-white tap-shrink disabled:opacity-50"
          >
            {busy === "book" ? "Recording…" : bookLabel}
          </button>
        )}

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
          {alreadyBooked.length === 0 && (
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
          )}
          <p className="text-[12px] text-[var(--label-tertiary)]">
            You can confirm now and attach it to a group later, from this chat.
          </p>
        </div>
      </div>
    </GlassModal>
  );
}
