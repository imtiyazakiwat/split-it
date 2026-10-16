"use client";

import { useMemo, useRef, useState } from "react";
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
import { acknowledgeTransfer, declineTransfer, includeTransferInGroups } from "@/lib/transfers";
import { hapticSuccess, hapticTap } from "@/lib/haptics";
import { useToast } from "@/components/ui/Toast";
import { Sheet, type SheetHandle } from "@/components/kit/Sheet";
import { Button } from "@/components/kit/Controls";
import { DetailRow, List, Section, sepInset } from "@/components/kit/List";
import { Avatar } from "@/components/kit/Avatar";
import { GroupAvatar } from "@/components/kit/Tile";
import { Icon } from "@/components/kit/Icon";

/**
 * What the receiver does with money someone says they sent.
 *
 * An explicit screen rather than a silent default: booking the payment into
 * a group settles a real balance there; confirming it without a group keeps it
 * as a personal balance between the two of them until it's attached later.
 *
 * One payment can cover several groups and be larger than any of them, so the
 * receiver picks any number of groups, each leg is capped at what the sender
 * owed there, and the remainder is shown rather than forced into the last group.
 */
export default function IncludeTransferSheet({
  transfer,
  meUid,
  fromName,
  fromPhotoURL,
  datasets,
  onClose,
}: {
  transfer: DirectTransfer;
  meUid: string;
  fromName: string;
  fromPhotoURL?: string;
  datasets: GroupDataset[];
  onClose: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const sheetRef = useRef<SheetHandle>(null);
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
        // pairwiseNet(a, b, …) is what `a` owes `b`, netted over just the two
        // of them — never routed through a third person.
        theyOweMe: pairwiseNet(transfer.fromUid, meUid, d.expenses, d.settlements),
      }))
      .sort((a, b) => b.theyOweMe - a.theyOweMe);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasets, meUid, transfer.fromUid, transfer.allocations]);

  const settleable = options.filter((o) => o.theyOweMe > 0);

  // Raw input strings keyed by group id. A present key means "booking this
  // group"; the string is what was typed, so half a number isn't clobbered.
  const [amounts, setAmounts] = useState<Record<string, string>>(() => {
    const seeded = suggestAllocation(available, settleable);
    const initial: Record<string, string> = {};
    for (const [groupId, amount] of seeded) initial[groupId] = (amount ?? 0).toFixed(2);
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
    hapticTap();
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
      sheetRef.current?.dismiss();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(null);
    }
  }

  const bookLabel =
    legs.length === 0
      ? "Pick a Group"
      : legs.length === 1
      ? `Count ${formatCurrency(plan.allocated)} in ${plan.legs.find((l) => l.amount > 0)?.groupName}`
      : `Count ${formatCurrency(plan.allocated)} in ${legs.length} Groups`;

  const groupById = new Map(datasets.map((d) => [d.group.id, d.group]));

  return (
    <Sheet
      ref={sheetRef}
      large
      title="Confirm Payment"
      subtitle={`From ${fromName}`}
      onClose={onClose}
      footer={
        <div className="space-y-2">
          {settleable.length > 0 && (
            <Button
              block
              busy={busy === "book"}
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
            >
              {bookLabel}
            </Button>
          )}
          <Button
            block
            variant={settleable.length > 0 ? "tinted" : "prominent"}
            busy={busy === "ack"}
            disabled={!!busy}
            onClick={() => run("ack", () => acknowledgeTransfer(transfer), "Confirmed as a personal balance")}
          >
            Received — Not for a Group
          </Button>
          {alreadyBooked.length === 0 && (
            <Button
              block
              variant="plain"
              className="!text-[var(--red)]"
              busy={busy === "decline"}
              disabled={!!busy}
              onClick={() => run("decline", () => declineTransfer(transfer), "Marked as not received")}
            >
              I Didn&rsquo;t Receive This
            </Button>
          )}
        </div>
      }
    >
      <div className="flex flex-col items-center px-2 pb-2 pt-3 text-center">
        <Avatar name={fromName} photoURL={fromPhotoURL} size={56} />
        <p className="amount-hero mt-3 text-[40px]">{formatCurrency(transfer.amount)}</p>
        <p className="t-subhead mt-1 text-label-2">
          {fromName} says they sent you this{transfer.note ? ` — “${transfer.note}”` : ""}.
        </p>
        <p className="t-footnote mt-1 text-label-2">Check your bank or UPI app before confirming.</p>
        {transfer.receiptUrls.length > 0 && (
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {transfer.receiptUrls.map((url, i) => (
              <a
                key={url}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="capsule is-tint"
              >
                <Icon name="photo" size={14} />
                Screenshot {i + 1}
              </a>
            ))}
          </div>
        )}
      </div>

      {alreadyBooked.length > 0 && (
        <div className="card mt-2 p-4">
          <p className="t-footnote text-label-2">
            {formatCurrency(roundMoney(transfer.amount - available))} of this is already counted in{" "}
            {alreadyBooked.length} {alreadyBooked.length === 1 ? "group" : "groups"}.{" "}
            <span className="font-semibold text-label">{formatCurrency(available)} left to assign.</span>
          </p>
        </div>
      )}

      <Section
        header="Settle group balances with it"
        footer={
          settleable.length === 0
            ? `${fromName} doesn't owe you anything in the groups you share, so there's no group balance for this to settle. Confirm it below — it counts as a personal balance between you two.`
            : `Pick every group this payment was for. Each takes at most what ${fromName} owes there; anything left over stays unassigned rather than tipping a group into the red.`
        }
      >
        {settleable.length > 0 && (
          <List>
            {settleable.map((o) => {
              const on = o.groupId in amounts;
              const leg = plan.legs.find((l) => l.groupId === o.groupId);
              const g = groupById.get(o.groupId);
              const capped = on && leg && leg.amount < parseFloat(amounts[o.groupId] || "0");
              return (
                <div key={o.groupId} className="px-4 py-3" style={sepInset(58)}>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      disabled={!!busy}
                      onClick={() => toggle(o)}
                      aria-label={`Use this payment in ${o.groupName}`}
                      className={on ? "text-tint" : "text-label-3"}
                    >
                      <Icon name={on ? "checkmark.circle.fill" : "circle"} size={26} strokeWidth={1.6} />
                    </button>
                    <GroupAvatar id={o.groupId} name={o.groupName} photoURL={g?.photoURL} size={32} />
                    <button
                      type="button"
                      onClick={() => toggle(o)}
                      disabled={!!busy}
                      className="min-w-0 flex-1 text-left"
                      tabIndex={-1}
                    >
                      <span className="row-title">{o.groupName}</span>
                      <span className="row-subtitle !text-pos">owes you {formatCurrency(o.theyOweMe)}</span>
                    </button>
                    {on && (
                      <label className="flex shrink-0 items-center gap-1 rounded-[12px] bg-[var(--fill-3)] px-2.5 py-1.5">
                        <span className="t-subhead text-label-2">₹</span>
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
                          className="num w-20 bg-transparent text-right text-[17px] font-semibold outline-none"
                        />
                      </label>
                    )}
                  </div>
                  {capped && (
                    <p className="t-footnote mt-1.5 pl-[38px] text-warn">
                      Capped at {formatCurrency(leg!.amount)} — all that&rsquo;s owed here, or all the payment has left.
                    </p>
                  )}
                  {on && leg?.clearsGroup && (
                    <p className="t-footnote mt-1.5 pl-[38px] text-pos">Clears this group completely.</p>
                  )}
                </div>
              );
            })}
          </List>
        )}
      </Section>

      {settleable.length > 0 && (
        <Section
          footer={
            !isSettled(plan.leftover)
              ? `${formatCurrency(plan.leftover)} isn't going into any group. It stays as a personal balance between you two — you can assign it later from your conversation if a new balance comes up.`
              : "You can confirm now and attach it to a group later, from your conversation."
          }
        >
          <List>
            <DetailRow label="Counted in groups" value={formatCurrency(plan.allocated)} valueClassName="!text-label font-semibold" />
            <DetailRow
              label="Left unassigned"
              value={formatCurrency(plan.leftover)}
              valueClassName={isSettled(plan.leftover) ? "" : "!text-warn font-semibold"}
            />
          </List>
        </Section>
      )}

      {error && <p className="t-footnote mt-4 px-4 text-neg">{error}</p>}
    </Sheet>
  );
}
