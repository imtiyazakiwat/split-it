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
import GlassModal from "@/components/ui/GlassModal";
import Skeleton from "@/components/ui/Skeleton";
import IncludeTransferSheet from "@/components/pay/IncludeTransferSheet";
import Screen, { BarButton } from "@/components/ui/Screen";
import { ButtonRow, IconTile, LinkRow, ListSection } from "@/components/ui/List";
import { Avatar, EmptyState, SearchField } from "@/components/ui/Controls";
import { Plus, RupeeCircle } from "@/components/ui/Icons";

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
    () => (uid ? computeCounterpartyBalances(uid, datasets, transfers) : []),
    [uid, datasets, transfers]
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
            : c.sharedGroupCount === 0
            ? "Direct payment"
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
      <Screen title="Pay" large>
        <div className="list-section">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="list-row is-tall">
              <Skeleton className="w-11 h-11 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-1/2 rounded-md" />
                <Skeleton className="h-3 w-2/3 rounded-md" />
              </div>
            </div>
          ))}
        </div>
      </Screen>
    );
  }
  if (!user) return <LoginScreen />;

  const currentUser = user;
  const needsDecision = pendingIncoming.length + unattributed.length;

  return (
    <Screen
      title="Pay"
      large
      subtitle={unreadCount > 0 ? `${unreadCount} unread` : undefined}
      trailing={
        <BarButton prominent onClick={() => setShowPicker(true)} aria-label="Send money">
          <Plus size={21} />
        </BarButton>
      }
    >
      {/* Money waiting on a decision from the current user comes first: until
          it's answered, somebody's balance is wrong. */}
      {needsDecision > 0 && (
        <ListSection header="Waiting on You" className="!mt-0">
          {pendingIncoming.map((t) => (
            <ButtonRow
              key={t.id}
              onClick={() => setDecide(t)}
              leading={<IconTile color="var(--orange)"><RupeeCircle size={18} /></IconTile>}
              separatorInset={58}
              tall
              title={`${nameOf(t.fromUid)} sent you ${formatCurrency(t.amount)}`}
              subtitle={t.note ? `“${t.note}” · Confirm and choose a group` : "Confirm and choose which balance it settles"}
              chevron
            />
          ))}
          {unattributed.map((t) => (
            <ButtonRow
              key={t.id}
              onClick={() => setDecide(t)}
              leading={<IconTile color="var(--gray)"><RupeeCircle size={18} /></IconTile>}
              separatorInset={58}
              tall
              title={`${formatCurrency(t.amount)} from ${nameOf(t.fromUid)}`}
              subtitle="Not in a group yet · Attach it to settle a group balance"
              chevron
            />
          ))}
        </ListSection>
      )}

      {counterparties.length > 6 && (
        <SearchField value={search} onChange={setSearch} placeholder="Search" label="Search people" className={needsDecision > 0 ? "mt-6" : ""} />
      )}

      {counterparties.length === 0 ? (
        <EmptyState
          icon={<RupeeCircle size={56} weight={1.4} />}
          title="No One to Pay Yet"
          message="You can pay anyone you share a group with. Create or join a group first."
          action={
            <button onClick={() => router.push("/")} className="btn-prominent">
              Go to Groups
            </button>
          }
        />
      ) : rows.length === 0 ? (
        <EmptyState icon={<RupeeCircle size={48} weight={1.4} />} title="No Results" message={`No one matches “${search}”.`} />
      ) : (
        <ListSection header={needsDecision > 0 ? "People" : undefined} className={needsDecision > 0 ? "" : "!mt-3"}>
          {rows.map((r) => {
            const iOwe = !isSettled(r.net) && r.net > 0;
            const theyOwe = !isSettled(r.net) && r.net < 0;
            return (
              <LinkRow
                key={r.uid}
                href={`/chat/${r.uid}`}
                tall
                leading={
                  <span className="relative">
                    <Avatar name={r.displayName} photoURL={r.photoURL} size={44} seed={r.uid} />
                    {r.unread && (
                      <span className="absolute top-0 -left-1 w-[11px] h-[11px] rounded-full bg-[var(--blue)] ring-2 ring-[var(--surface)]" aria-label="Unread" />
                    )}
                  </span>
                }
                separatorInset={72}
                title={<span className={r.unread ? "font-semibold" : ""}>{r.displayName}</span>}
                subtitle={
                  r.awaitingMe ? (
                    <span className="text-[var(--warning)]">Waiting for you to confirm a payment</span>
                  ) : (
                    r.preview
                  )
                }
                detail={
                  <span className="flex flex-col items-end leading-tight">
                    {iOwe || theyOwe ? (
                      <>
                        <span className="t-caption text-[var(--text-secondary)]">{iOwe ? "you owe" : "owes you"}</span>
                        <span className={`t-subhead font-semibold t-numeral ${iOwe ? "text-[var(--neg)]" : "text-[var(--pos)]"}`}>
                          {formatCurrency(Math.abs(r.net))}
                        </span>
                      </>
                    ) : (
                      <span className="t-subhead text-[var(--text-secondary)]">{r.lastActivityAt ? timeAgo(r.lastActivityAt) : "Settled"}</span>
                    )}
                  </span>
                }
              />
            );
          })}
        </ListSection>
      )}

      {showPicker && (
        <GlassModal title="Send Money" large onClose={() => setShowPicker(false)}>
          <SearchField value={pickerQuery} onChange={setPickerQuery} placeholder="Search" label="Search people" autoFocus className="mt-1" />
          {pickerRows.length === 0 ? (
            <p className="list-footer text-center !pt-6">
              {counterparties.length === 0
                ? "You can pay anyone you share a group with. Join a group first."
                : `No one matches “${pickerQuery}”.`}
            </p>
          ) : (
            <ListSection elevated className="!mt-4">
              {pickerRows.map((c) => (
                <ButtonRow
                  key={c.uid}
                  onClick={() => {
                    setShowPicker(false);
                    // The conversation is where paying happens, so the picker
                    // hands off rather than stacking a second sheet on top.
                    router.push(`/chat/${c.uid}?pay=1`);
                  }}
                  leading={<Avatar name={c.displayName} photoURL={c.photoURL} size={36} seed={c.uid} />}
                  separatorInset={64}
                  title={c.displayName}
                  subtitle={
                    !isSettled(c.net) && c.net > 0
                      ? `You owe ${formatCurrency(c.net)}`
                      : !isSettled(c.net) && c.net < 0
                      ? `Owes you ${formatCurrency(-c.net)}`
                      : "Settled up"
                  }
                  chevron
                />
              ))}
            </ListSection>
          )}
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
    </Screen>
  );
}
