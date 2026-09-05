"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useGroupData } from "@/lib/group-data-context";
import { usePayments } from "@/lib/payments-context";
import { computeCounterpartyBalances } from "@/lib/global-balance";
import { formatCurrency } from "@/lib/balance";
import { isSettled } from "@/lib/money";
import { DirectTransfer } from "@/lib/types";
import LoginScreen from "@/components/LoginScreen";
import BottomNav from "@/components/home/BottomNav";
import CollapsibleFab from "@/components/ui/CollapsibleFab";
import GlassModal from "@/components/ui/GlassModal";
import Skeleton from "@/components/ui/Skeleton";
import IncludeTransferSheet from "@/components/pay/IncludeTransferSheet";

/**
 * The Pay tab: one row per person, the way a payments app lists contacts rather
 * than the way a splitting app lists groups.
 *
 * The group screens answer "what does this trip cost us?". This one answers
 * "where do I stand with Asha?" — which is the question people actually have
 * when they're about to send money, and the reason a direct payment needed a
 * home that isn't inside a group.
 */

function timeAgo(ts: number): string {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(ts).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function Avatar({
  name,
  photoURL,
  size = 44,
}: {
  name: string;
  photoURL?: string;
  size?: number;
}) {
  if (photoURL) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={photoURL}
        alt=""
        className="rounded-full object-cover shrink-0"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className="rounded-full bg-[var(--fill)] flex items-center justify-center shrink-0 font-semibold text-[var(--text-secondary)]"
      style={{ width: size, height: size, fontSize: size * 0.36 }}
      aria-hidden
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

export default function PayPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const { datasets, groupsLoaded } = useGroupData();
  const { transfers, pendingIncoming, unattributed, threadWith, unreadFrom, unreadCount } =
    usePayments();
  const [search, setSearch] = useState("");
  const [decide, setDecide] = useState<DirectTransfer | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");

  const uid = user?.uid;

  const counterparties = useMemo(
    () => (uid ? computeCounterpartyBalances(uid, datasets) : []),
    [uid, datasets]
  );

  const nameOf = useMemo(() => {
    const map = new Map(counterparties.map((c) => [c.uid, c.displayName]));
    return (id: string) => map.get(id) || "Someone";
  }, [counterparties]);

  /**
   * Rows carry their own "last thing that happened" so the list can be ordered
   * by recency like a messaging app, not alphabetically.
   */
  const rows = useMemo(() => {
    if (!uid) return [];
    return counterparties
      .map((c) => {
        const thread = threadWith(c.uid);
        const theirTransfers = transfers.filter(
          (t) => t.fromUid === c.uid || t.toUid === c.uid
        );
        const lastTransfer = theirTransfers[0]; // already newest-first
        const lastMessageAt = thread?.lastMessageAt ?? 0;
        const lastTransferAt = lastTransfer?.createdAt ?? 0;
        const preview =
          lastMessageAt >= lastTransferAt && thread?.lastMessage
            ? `${thread.lastMessageFrom === uid ? "You: " : ""}${thread.lastMessage}`
            : lastTransfer
            ? lastTransfer.fromUid === uid
              ? `You sent ${formatCurrency(lastTransfer.amount)}`
              : `Sent you ${formatCurrency(lastTransfer.amount)}`
            : c.sharedGroupCount === 1
            ? "1 shared group"
            : `${c.sharedGroupCount} shared groups`;
        return {
          ...c,
          unread: unreadFrom(c.uid),
          awaitingMe: theirTransfers.some((t) => t.toUid === uid && t.status === "pending"),
          lastActivityAt: Math.max(lastMessageAt, lastTransferAt),
          preview,
        };
      })
      .filter((r) => r.displayName.toLowerCase().includes(search.trim().toLowerCase()))
      .sort(
        (a, b) =>
          Number(b.awaitingMe) - Number(a.awaitingMe) ||
          Number(b.unread) - Number(a.unread) ||
          b.lastActivityAt - a.lastActivityAt ||
          Math.abs(b.net) - Math.abs(a.net) ||
          a.displayName.localeCompare(b.displayName)
      );
  }, [uid, counterparties, transfers, threadWith, unreadFrom, search]);

  const pickerRows = useMemo(
    () =>
      counterparties.filter((c) =>
        c.displayName.toLowerCase().includes(pickerQuery.trim().toLowerCase())
      ),
    [counterparties, pickerQuery]
  );

  if (loading || (user && !groupsLoaded)) {
    return (
      <div className="flex-1 max-w-md w-full mx-auto px-4 pt-[max(1rem,env(safe-area-inset-top))] space-y-3">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-11 w-full" />
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }
  if (!user) return <LoginScreen />;

  const currentUser = user;
  const needsDecision = pendingIncoming.length + unattributed.length;

  return (
    <div className="flex-1 flex flex-col bg-[var(--background)] min-h-full">
      <main className="flex-1 max-w-md w-full mx-auto px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[calc(var(--nav-h)+env(safe-area-inset-bottom)+6rem)] scroll-momentum">
        <div className="flex items-center justify-between pt-2">
          <h1 className="text-[28px] font-extrabold text-[var(--text-primary)]">Pay</h1>
          {unreadCount > 0 && (
            <span className="rounded-full bg-[var(--tint-accent)] px-3 py-1 text-[12px] font-semibold text-[var(--brand)]">
              {unreadCount} unread
            </span>
          )}
        </div>
        <p className="text-[15px] text-[var(--text-tertiary)] mt-1 mb-4">
          Send money straight to someone, and see everything you&rsquo;ve settled.
        </p>

        {/* Money waiting on a decision from the current user. Deliberately the
            first thing on the screen: until it's answered, somebody's balance is
            wrong. */}
        {needsDecision > 0 && (
          <section className="mb-5">
            <h2 className="text-[13px] font-semibold tracking-wide text-[var(--text-tertiary)] mb-2">
              WAITING ON YOU
            </h2>
            <div className="space-y-2">
              {pendingIncoming.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setDecide(t)}
                  className="w-full text-left rounded-[var(--radius-inner)] bg-[var(--tint-warning)] p-3.5 tap-shrink"
                >
                  <p className="text-[15px] font-semibold text-[var(--text-primary)]">
                    {nameOf(t.fromUid)} sent you {formatCurrency(t.amount)}
                  </p>
                  <p className="text-[13px] text-[var(--text-secondary)] mt-0.5">
                    {t.note ? `“${t.note}” · ` : ""}Confirm it and choose which balance it
                    settles
                  </p>
                </button>
              ))}
              {unattributed.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setDecide(t)}
                  className="w-full text-left rounded-[var(--radius-inner)] bg-[var(--surface)] shadow-[var(--shadow-sm)] p-3.5 tap-shrink"
                >
                  <p className="text-[15px] font-semibold text-[var(--text-primary)]">
                    {formatCurrency(t.amount)} from {nameOf(t.fromUid)} isn&rsquo;t counted
                    anywhere
                  </p>
                  <p className="text-[13px] text-[var(--text-tertiary)] mt-0.5">
                    You confirmed it. Attach it to a group to settle a balance.
                  </p>
                </button>
              ))}
            </div>
          </section>
        )}

        {counterparties.length > 3 && (
          <label className="block mb-3">
            <span className="sr-only">Search people</span>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search people"
              className="w-full rounded-full border border-[var(--border-subtle)] bg-[var(--surface)] px-4 py-2.5 text-[15px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none focus:border-[var(--accent)]"
            />
          </label>
        )}

        {counterparties.length === 0 ? (
          <div className="rounded-[var(--radius-card)] bg-[var(--tint-accent)] p-6 text-center">
            <p className="text-[17px] font-bold text-[var(--text-primary)]">
              Nobody to pay yet
            </p>
            <p className="text-[13px] text-[var(--text-tertiary)] mt-1">
              Join or create a group first — you can pay anyone you share one with.
            </p>
            <button
              onClick={() => router.push("/")}
              className="mt-3 rounded-full bg-[var(--brand-solid)] text-white px-5 py-2.5 text-[15px] font-semibold tap-shrink"
            >
              Go to groups
            </button>
          </div>
        ) : rows.length === 0 ? (
          <p className="text-center text-[14px] text-[var(--text-tertiary)] py-10">
            Nobody matches that search.
          </p>
        ) : (
          <div className="space-y-1.5">
            {rows.map((r) => {
              const iOwe = !isSettled(r.net) && r.net > 0;
              const theyOwe = !isSettled(r.net) && r.net < 0;
              return (
                <button
                  key={r.uid}
                  onClick={() => router.push(`/chat/${r.uid}`)}
                  className="w-full text-left flex items-center gap-3 rounded-[var(--radius-inner)] bg-[var(--surface)] shadow-[var(--shadow-sm)] px-3.5 py-3 tap-shrink"
                >
                  <Avatar name={r.displayName} photoURL={r.photoURL} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="text-[15px] font-semibold text-[var(--text-primary)] truncate">
                        {r.displayName}
                      </p>
                      {r.unread && (
                        <span
                          className="h-2 w-2 rounded-full bg-[var(--brand)] shrink-0"
                          aria-label="Unread messages"
                        />
                      )}
                    </div>
                    <p
                      className={`text-[13px] truncate ${
                        r.awaitingMe
                          ? "text-[var(--warning)] font-medium"
                          : "text-[var(--text-tertiary)]"
                      }`}
                    >
                      {r.awaitingMe ? "Waiting for you to confirm a payment" : r.preview}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p
                      className={`text-[15px] font-bold ${
                        iOwe
                          ? "text-[var(--neg)]"
                          : theyOwe
                          ? "text-[var(--pos)]"
                          : "text-[var(--text-tertiary)]"
                      }`}
                    >
                      {iOwe || theyOwe ? formatCurrency(Math.abs(r.net)) : "settled"}
                    </p>
                    <p className="text-[11px] text-[var(--text-tertiary)]">
                      {iOwe
                        ? "you owe"
                        : theyOwe
                        ? "owes you"
                        : r.lastActivityAt
                        ? timeAgo(r.lastActivityAt)
                        : ""}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </main>

      <div className="fab-layer fixed z-40 inset-x-0 bottom-[calc(var(--nav-h)+env(safe-area-inset-bottom)+0.75rem)] pointer-events-none">
        <div className="max-w-md mx-auto px-4 flex justify-end">
          <CollapsibleFab label="Send money" onClick={() => setShowPicker(true)} />
        </div>
      </div>

      <BottomNav active="pay" payBadge={unreadCount > 0 || needsDecision > 0} />

      {showPicker && (
        <GlassModal title="Send money to" onClose={() => setShowPicker(false)}>
          <div className="space-y-3">
            <input
              type="search"
              autoFocus
              value={pickerQuery}
              onChange={(e) => setPickerQuery(e.target.value)}
              placeholder="Search people"
              className="w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--surface)] px-3.5 py-2.5 text-[15px] text-[var(--label-primary)] outline-none focus:border-[var(--accent)]"
            />
            {pickerRows.length === 0 ? (
              <p className="text-[13px] text-[var(--label-tertiary)] py-4 text-center">
                {counterparties.length === 0
                  ? "You can pay anyone you share a group with. Join a group first."
                  : "Nobody matches that search."}
              </p>
            ) : (
              <div className="space-y-1 max-h-72 overflow-y-auto scroll-momentum">
                {pickerRows.map((c) => (
                  <button
                    key={c.uid}
                    onClick={() => {
                      setShowPicker(false);
                      // The conversation is where paying happens, so the picker
                      // hands off rather than stacking a second sheet on top.
                      router.push(`/chat/${c.uid}?pay=1`);
                    }}
                    className="w-full text-left flex items-center gap-3 rounded-[var(--radius-md)] px-2 py-2 tap-shrink hover:bg-[var(--fill-soft)]"
                  >
                    <Avatar name={c.displayName} photoURL={c.photoURL} size={36} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[15px] font-medium text-[var(--label-primary)] truncate">
                        {c.displayName}
                      </p>
                      <p className="text-[12px] text-[var(--label-tertiary)]">
                        {!isSettled(c.net) && c.net > 0
                          ? `You owe ${formatCurrency(c.net)}`
                          : !isSettled(c.net) && c.net < 0
                          ? `Owes you ${formatCurrency(-c.net)}`
                          : "Settled up"}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </GlassModal>
      )}

      {decide && (
        <IncludeTransferSheet
          transfer={decide}
          meUid={currentUser.uid}
          fromName={nameOf(decide.fromUid)}
          datasets={datasets}
          onClose={() => setDecide(null)}
        />
      )}
    </div>
  );
}
