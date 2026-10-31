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
import { hapticSuccess } from "@/lib/haptics";
import GlassModal from "@/components/ui/GlassModal";
import { ButtonRow, ListSection, Row } from "@/components/ui/List";
import { Checkmark } from "@/components/ui/Icons";
import { useToast } from "@/components/ui/Toast";

/**
 * What the receiver does with money someone says they sent.
 *
 * The choice matters, which is why it's an explicit screen rather than a silent
 * default. Booking the payment into a group settles a real balance there;
 * confirming it without a group keeps it as a personal balance between the two
 * of them (visible in Pay, Home and Reports) until it is attached later.
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
      hapticSuccess();
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
    <GlassModal
      title="Payment Received?"
      large
      onClose={onClose}
      footer={
        settleable.length > 0 ? (
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
            className="btn-prominent w-full"
          >
            {busy === "book" ? "Recording…" : bookLabel}
          </button>
        ) : undefined
      }
    >
      <div className="flex flex-col items-center text-center pt-3 pb-1">
        <p className="t-subhead text-[var(--text-secondary)]">{fromName} says they sent you</p>
        <p className="t-large-title t-numeral text-[var(--text-primary)]">{formatCurrency(transfer.amount)}</p>
        {transfer.note && <p className="t-subhead text-[var(--text-secondary)] mt-0.5 selectable">“{transfer.note}”</p>}
        <p className="t-footnote text-[var(--text-secondary)] mt-2 max-w-[300px]">
          Check your bank or UPI app before confirming.
        </p>
        {transfer.receiptUrls.length > 0 && (
          <div className="flex flex-wrap justify-center gap-3 mt-2">
            {transfer.receiptUrls.map((url, i) => (
              <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="t-subhead font-medium text-[var(--brand)]">
                Screenshot {i + 1}
              </a>
            ))}
          </div>
        )}
      </div>

      {alreadyBooked.length > 0 && (
        <ListSection elevated>
          <Row title="Already counted" detail={formatCurrency(roundMoney(transfer.amount - available))} />
          <Row title="Left to assign" detail={<span className="font-semibold text-[var(--text-primary)]">{formatCurrency(available)}</span>} />
        </ListSection>
      )}

      <ListSection
        elevated
        header="Settle group balances"
        footer={
          settleable.length === 0
            ? `${fromName} doesn’t owe you anything in the groups you share. Confirm below and it counts as a personal balance between you.`
            : `Pick every group this payment was for. Each takes at most what ${fromName} owes there; anything left stays unassigned.`
        }
      >
        {settleable.length === 0 ? (
          <Row title={<span className="text-[var(--text-secondary)]">No group balances to settle</span>} />
        ) : (
          settleable.map((o) => {
            const on = o.groupId in amounts;
            const leg = plan.legs.find((l) => l.groupId === o.groupId);
            return (
              <div key={o.groupId} className="list-row-wrap">
                <div className="list-row">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    disabled={!!busy}
                    onClick={() => toggle(o)}
                    aria-label={`Use this payment in ${o.groupName}`}
                    className="flex items-center gap-3 flex-1 min-w-0 text-left -my-2.5 py-2.5"
                  >
                    <span
                      className={`w-[22px] h-[22px] rounded-full grid place-items-center shrink-0 ${
                        on ? "bg-[var(--brand-solid)] text-white" : "ring-[1.5px] ring-inset ring-[var(--text-tertiary)]"
                      }`}
                      aria-hidden
                    >
                      {on && <Checkmark size={13} weight={3.2} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block t-body truncate text-[var(--text-primary)]">{o.groupName}</span>
                      <span className="block t-footnote text-[var(--pos)]">Owes you {formatCurrency(o.theyOweMe)}</span>
                    </span>
                  </button>
                  {on && (
                    <label className="shrink-0 flex items-center gap-0.5 rounded-[10px] bg-[var(--fill-soft)] px-2.5 h-9">
                      <span className="t-body text-[var(--text-secondary)]">₹</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        max={o.theyOweMe}
                        inputMode="decimal"
                        value={amounts[o.groupId]}
                        disabled={!!busy}
                        onChange={(e) => setAmounts((prev) => ({ ...prev, [o.groupId]: e.target.value }))}
                        aria-label={`Amount to count in ${o.groupName}`}
                        className="w-[84px] bg-transparent outline-none text-right t-body font-semibold t-numeral text-[var(--text-primary)]"
                      />
                    </label>
                  )}
                </div>
                {on && leg && leg.amount < parseFloat(amounts[o.groupId] || "0") && (
                  <p className="t-footnote text-[var(--warning)] px-4 pb-2.5 pl-[50px] -mt-1">
                    Capped at {formatCurrency(leg.amount)}: that’s all that’s owed here, or all the payment has left.
                  </p>
                )}
                {on && leg?.clearsGroup && (
                  <p className="t-footnote text-[var(--pos)] px-4 pb-2.5 pl-[50px] -mt-1">Clears this group completely.</p>
                )}
              </div>
            );
          })
        )}
      </ListSection>

      {settleable.length > 0 && (
        <ListSection
          elevated
          footer={
            !isSettled(plan.leftover)
              ? `${formatCurrency(plan.leftover)} isn’t going into any group. It stays as a personal balance, and you can assign it later from the chat.`
              : undefined
          }
        >
          <Row title="Counted in groups" detail={<span className="t-numeral text-[var(--text-primary)]">{formatCurrency(plan.allocated)}</span>} />
          <Row
            title="Left unassigned"
            detail={
              <span className={`t-numeral ${isSettled(plan.leftover) ? "" : "text-[var(--warning)]"}`}>{formatCurrency(plan.leftover)}</span>
            }
          />
        </ListSection>
      )}

      {error && <p className="list-footer !text-[var(--neg)]">{error}</p>}

      <ListSection elevated footer="You can confirm now and attach it to a group later, from the chat.">
        <ButtonRow
          disabled={!!busy}
          onClick={() => run("ack", () => acknowledgeTransfer(transfer), "Payment confirmed as personal balance")}
          title={busy === "ack" ? "Confirming…" : "Received, Not for a Group"}
          action
        />
        {alreadyBooked.length === 0 && (
          <ButtonRow
            disabled={!!busy}
            onClick={() => run("decline", () => declineTransfer(transfer), "Marked as not received")}
            title={busy === "decline" ? "Saving…" : "I Didn’t Receive This"}
            destructive
          />
        )}
      </ListSection>
    </GlassModal>
  );
}
