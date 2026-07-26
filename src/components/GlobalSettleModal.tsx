"use client";

import { useEffect, useMemo, useState } from "react";
import { formatCurrency } from "@/lib/balance";
import {
  CounterpartyBalance,
  buildGlobalSettlementPlan,
} from "@/lib/global-balance";
import { addSettlementRequests, resolveUpiId, NewSettlement } from "@/lib/firestore";
import { UPI_APPS, isValidUpiId, launchUpi, copyToClipboard, isLikelyAndroid } from "@/lib/upi";
import { UpiAppIcon } from "@/components/UpiAppIcon";
import GlassModal from "@/components/ui/GlassModal";
import GlassButton from "@/components/ui/GlassButton";
import { useToast } from "@/components/ui/Toast";

/**
 * Settle with one person across every group you share with them.
 *
 * Two things happen here that per-group settling can't do:
 *
 *  - **Offsetting.** If you owe them ₹500 in "Goa Trip" and they owe you ₹500
 *    in "Flatmates", nobody needs to send anything — both balances just need
 *    writing off. That's recorded as a linked pair of `offset` settlements, one
 *    in each group, which the other person approves in a single action.
 *  - **Netting.** Anything left over after offsetting is collected into one
 *    payment, then split back across the groups it came from so each group's
 *    ledger stays correct.
 */
export default function GlobalSettleModal({
  meUid,
  counterparty,
  onClose,
}: {
  meUid: string;
  counterparty: CounterpartyBalance;
  onClose: () => void;
}) {
  const [useOffsets, setUseOffsets] = useState(true);
  const [payCash, setPayCash] = useState(true);
  // Null means "follow the computed remainder"; typing takes over from there.
  // Deriving this instead of syncing it in an effect keeps the field correct
  // when toggling the offset checkbox changes the maximum.
  const [cashOverride, setCashOverride] = useState<string | null>(null);
  const [upiId, setUpiId] = useState<string | undefined>(counterparty.upiId);
  const [upiChecked, setUpiChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [launched, setLaunched] = useState(false);
  const showToast = useToast();

  const maxCash = Math.max(
    0,
    Math.round((counterparty.iOwe - (useOffsets ? counterparty.offsetable : 0)) * 100) / 100
  );
  const cashInput = cashOverride ?? (maxCash > 0 ? maxCash.toFixed(2) : "");

  // The group copy of a member's UPI ID can be stale (or missing for members
  // who set it before profiles were synced), so fall back to their user doc.
  useEffect(() => {
    let cancelled = false;
    resolveUpiId(counterparty.uid, counterparty.upiId).then((resolved) => {
      if (cancelled) return;
      setUpiId(resolved);
      setUpiChecked(true);
    });
    return () => {
      cancelled = true;
    };
  }, [counterparty.uid, counterparty.upiId]);

  const cashAmount = Math.min(maxCash, Math.max(0, parseFloat(cashInput) || 0));

  const plan = useMemo(
    () =>
      buildGlobalSettlementPlan(counterparty, {
        includeOffsets: useOffsets,
        includeCash: payCash,
        cashAmount,
      }),
    [counterparty, useOffsets, payCash, cashAmount]
  );

  const legCount = plan.offsetLegs.length + plan.paymentLegs.length;
  const upiUsable = !!upiId && isValidUpiId(upiId);

  function handlePayWithApp(appId: string) {
    const app = UPI_APPS.find((a) => a.id === appId);
    if (!app || !upiId || plan.cashAmount <= 0) return;
    const ok = launchUpi(app, {
      payeeVpa: upiId,
      payeeName: counterparty.displayName,
      amount: plan.cashAmount,
      note: "SplitIt settlement",
    });
    if (!ok) {
      setError("Couldn't open a UPI app. Copy the UPI ID and pay manually.");
      return;
    }
    setLaunched(true);
  }

  async function handleCopyUpi() {
    if (!upiId) return;
    const ok = await copyToClipboard(upiId);
    showToast({ message: ok ? "UPI ID copied" : "Couldn't copy — long-press to select" });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (legCount === 0) {
      setError("Nothing selected to settle.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const crossGroupId = `cg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const multiLeg = legCount > 1;
      // Recorded on every leg so the approver can tell whether they're seeing
      // the whole set before applying it.
      const legTotal = legCount;

      const legs: { groupId: string; data: NewSettlement }[] = [];

      plan.offsetLegs.forEach((leg) => {
        const iPay = leg.direction === "i-pay-them";
        legs.push({
          groupId: leg.groupId,
          data: {
            fromUid: iPay ? meUid : counterparty.uid,
            toUid: iPay ? counterparty.uid : meUid,
            amount: leg.amount,
            createdBy: meUid,
            kind: "offset",
            note: `Offset across groups with ${counterparty.displayName}`,
            crossGroupId,
            crossGroupLegCount: legTotal,
          },
        });
      });

      plan.paymentLegs.forEach((leg) => {
        legs.push({
          groupId: leg.groupId,
          data: {
            fromUid: meUid,
            toUid: counterparty.uid,
            amount: leg.amount,
            createdBy: meUid,
            kind: "payment",
            note: multiLeg ? "Part of a cross-group settlement" : undefined,
            crossGroupId: multiLeg ? crossGroupId : undefined,
            crossGroupLegCount: multiLeg ? legTotal : undefined,
          },
        });
      });

      await addSettlementRequests(legs);
      showToast({
        message: `Sent to ${counterparty.displayName} for approval · ${legs.length} group${
          legs.length !== 1 ? "s" : ""
        }`,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send settlement");
    } finally {
      setBusy(false);
    }
  }

  return (
    <GlassModal title={`Settle with ${counterparty.displayName}`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Global position */}
        <div
          className={`rounded-[var(--radius-md)] p-4 ${
            counterparty.net > 0.01
              ? "bg-[var(--tint-danger-soft)]"
              : counterparty.net < -0.01
              ? "bg-[var(--tint-success-soft)]"
              : "bg-[var(--tint-accent)]"
          }`}
        >
          <p className="text-[12px] font-semibold tracking-wide text-[var(--text-tertiary)]">
            {counterparty.net > 0.01
              ? "ACROSS ALL GROUPS, YOU OWE"
              : counterparty.net < -0.01
              ? "ACROSS ALL GROUPS, YOU'RE OWED"
              : "ACROSS ALL GROUPS"}
          </p>
          <p
            className={`text-[30px] font-extrabold leading-tight ${
              counterparty.net > 0.01
                ? "text-[var(--neg)]"
                : counterparty.net < -0.01
                ? "text-[var(--pos)]"
                : "text-[var(--text-primary)]"
            }`}
          >
            {Math.abs(counterparty.net) < 0.01
              ? "All square"
              : formatCurrency(Math.abs(counterparty.net))}
          </p>
          {counterparty.offsetable > 0.01 && (
            <p className="text-[13px] text-[var(--text-secondary)] mt-1">
              {formatCurrency(counterparty.offsetable)} of this cancels out between groups.
            </p>
          )}
        </div>

        {/* Per-group breakdown */}
        <div>
          <p className="text-sm font-medium text-[var(--label-secondary)] mb-2">
            Group by group
          </p>
          <div className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] divide-y divide-[var(--border-subtle)]">
            {counterparty.groups.map((g) => (
              <div key={g.groupId} className="flex items-center justify-between px-3 py-2.5">
                <span className="text-[14px] text-[var(--label-primary)] truncate pr-2">
                  {g.groupName}
                </span>
                <span
                  className={`text-[14px] font-semibold shrink-0 ${
                    g.net > 0 ? "text-[var(--neg)]" : "text-[var(--pos)]"
                  }`}
                >
                  {g.net > 0 ? "you owe " : "owes you "}
                  {formatCurrency(Math.abs(g.net))}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Offset toggle */}
        {counterparty.offsetable > 0.01 && (
          <label className="flex items-start gap-2.5 rounded-[var(--radius-md)] bg-[var(--fill-soft)] p-3">
            <input
              type="checkbox"
              checked={useOffsets}
              onChange={(e) => setUseOffsets(e.target.checked)}
              className="mt-0.5 rounded accent-[var(--accent)] w-4 h-4 shrink-0"
            />
            <span className="min-w-0">
              <span className="block text-[14px] font-medium text-[var(--label-primary)]">
                Cancel out {formatCurrency(counterparty.offsetable)} between groups
              </span>
              <span className="block text-[12px] text-[var(--label-tertiary)] mt-0.5">
                No money moves. Balances are written off in{" "}
                {plan.offsetLegs.length || counterparty.groups.length} groups at once, once{" "}
                {counterparty.displayName} approves.
              </span>
            </span>
          </label>
        )}

        {/* Cash remainder */}
        {maxCash > 0.01 && (
          <div>
            <label className="flex items-center gap-2.5 mb-2">
              <input
                type="checkbox"
                checked={payCash}
                onChange={(e) => setPayCash(e.target.checked)}
                className="rounded accent-[var(--accent)] w-4 h-4 shrink-0"
              />
              <span className="text-sm font-medium text-[var(--label-secondary)]">
                Also pay the remaining {formatCurrency(maxCash)}
              </span>
            </label>
            {payCash && (
              <>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max={maxCash}
                  inputMode="decimal"
                  value={cashInput}
                  onChange={(e) => setCashOverride(e.target.value)}
                  className="w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--surface)] px-3.5 py-2.5 text-[15px] text-[var(--label-primary)] outline-none focus:border-[var(--accent)]"
                />
                <p className="text-[12px] text-[var(--label-tertiary)] mt-1">
                  Applied across {plan.paymentLegs.length || 1} group
                  {plan.paymentLegs.length !== 1 ? "s" : ""} so each ledger stays correct.
                </p>
              </>
            )}
          </div>
        )}

        {/* UPI */}
        {payCash && plan.cashAmount > 0.01 && (
          <div>
            <p className="text-sm font-medium text-[var(--label-secondary)] mb-2">
              Pay {formatCurrency(plan.cashAmount)} with UPI
            </p>
            {upiUsable ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  {UPI_APPS.map((app) => (
                    <button
                      key={app.id}
                      type="button"
                      onClick={() => handlePayWithApp(app.id)}
                      className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--surface)] px-3 py-2.5 text-sm font-medium text-[var(--label-primary)] tap-shrink"
                    >
                      <UpiAppIcon id={app.id} className="w-5 h-5 shrink-0" />
                      <span className="truncate">{app.label}</span>
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={handleCopyUpi}
                  className="mt-2 w-full rounded-[var(--radius-md)] bg-[var(--fill-soft)] px-3 py-2 text-[13px] font-medium text-[var(--label-secondary)] tap-shrink"
                >
                  Copy UPI ID · {upiId}
                </button>
                {!isLikelyAndroid() && (
                  <p className="text-[12px] text-[var(--label-tertiary)] mt-2">
                    UPI apps only open automatically on Android. Elsewhere, copy the ID and
                    pay from your bank app.
                  </p>
                )}
              </>
            ) : (
              <p className="text-[13px] text-[var(--label-tertiary)]">
                {upiChecked
                  ? `${counterparty.displayName} hasn't added a UPI ID, so pay them directly and record it here.`
                  : "Checking for a UPI ID…"}
              </p>
            )}
          </div>
        )}

        {launched && (
          <div className="space-y-1">
            <p className="text-[13px] text-[var(--pos)]">
              Finished paying? Send the request below so {counterparty.displayName} can confirm.
            </p>
            {/* The browser can't report whether the hand-off worked. */}
            <p className="text-[12px] text-[var(--label-tertiary)]">
              Nothing opened? Copy the UPI ID above and pay from your bank app.
            </p>
          </div>
        )}

        <div className="rounded-[var(--radius-md)] bg-[var(--fill-soft)] p-3">
          <p className="text-[13px] text-[var(--label-secondary)]">
            {legCount === 0
              ? `Nothing to settle from your side — ${counterparty.displayName} owes you ${formatCurrency(plan.remainingOwedToMe)}.`
              : `${counterparty.displayName} approves this once and all ${legCount} record${
                  legCount !== 1 ? "s" : ""
                } apply together.`}
          </p>
        </div>

        {error && <p className="text-sm text-[var(--danger)]">{error}</p>}

        <GlassButton disabled={busy || legCount === 0} className="w-full">
          {busy
            ? "Sending…"
            : plan.offsetAmount > 0.01 && plan.cashAmount > 0.01
            ? "Cancel out & request approval"
            : plan.offsetAmount > 0.01
            ? "Request offset approval"
            : "Send settlement request"}
        </GlassButton>
      </form>
    </GlassModal>
  );
}
