"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useAuth } from "@/lib/auth-context";
import { useGroupData } from "@/lib/group-data-context";
import { usePayments } from "@/lib/payments-context";
import { computeCounterpartyBalances } from "@/lib/global-balance";
import { formatCurrency } from "@/lib/balance";
import { isSettled } from "@/lib/money";
import { DirectTransfer } from "@/lib/types";
import LoginScreen from "@/components/LoginScreen";
import Skeleton from "@/components/ui/Skeleton";
import Screen from "@/components/kit/Screen";
import { BarButton } from "@/components/kit/BarButton";
import { List, RowButton, RowLink, Section, sepInset } from "@/components/kit/List";
import { Avatar } from "@/components/kit/Avatar";
import { IconTile } from "@/components/kit/Tile";
import { EmptyState, SearchField } from "@/components/kit/Controls";
import { Sheet } from "@/components/kit/Sheet";
import { NavLink, useNav } from "@/components/kit/nav";

// Behind a tap, so it loads on demand (it reaches the Firestore SDK).
const IncludeTransferSheet = dynamic(() => import("@/components/pay/IncludeTransferSheet"), { ssr: false });

/**
 * The Pay tab: one row per person, the way a payments app lists contacts
 * rather than the way a splitting app lists groups. It answers "where do I
 * stand with Asha?" — the question people actually have before sending money.
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

function PaySkeleton() {
  return (
    <Screen title="Pay" large tabBar>
      <div className="card list mt-1" aria-hidden>
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="row is-tall" style={sepInset(76)}>
            <Skeleton className="h-12 w-12 rounded-full" />
            <div className="flex-1">
              <Skeleton className="h-4 w-32 rounded-md" />
              <Skeleton className="mt-2 h-3 w-48 rounded-md" />
            </div>
          </div>
        ))}
      </div>
    </Screen>
  );
}

export default function PayPage() {
  const { user, loading } = useAuth();
  const nav = useNav();
  const { datasets, groupsLoaded } = useGroupData();
  const { transfers, pendingIncoming, unattributed, threadWith, unreadFrom } = usePayments();
  const [search, setSearch] = useState("");
  const [decide, setDecide] = useState<DirectTransfer | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");

  const uid = user?.uid;

  const counterparties = useMemo(
    () => (uid ? computeCounterpartyBalances(uid, datasets, transfers) : []),
    [uid, datasets, transfers]
  );

  const byUid = useMemo(() => new Map(counterparties.map((c) => [c.uid, c])), [counterparties]);
  const nameOf = (id: string) => byUid.get(id)?.displayName || "Someone";

  /** Rows carry their own "last thing that happened", for messaging-app order. */
  const rows = useMemo(() => {
    if (!uid) return [];
    return counterparties
      .map((c) => {
        const thread = threadWith(c.uid);
        const theirTransfers = transfers.filter((t) => t.fromUid === c.uid || t.toUid === c.uid);
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

  if (loading || (user && !groupsLoaded)) return <PaySkeleton />;
  if (!user) return <LoginScreen />;

  const currentUser = user;
  const needsDecision = pendingIncoming.length + unattributed.length;

  return (
    <Screen
      title="Pay"
      large
      tabBar
      trailing={<BarButton icon="plus" label="Send money" onClick={() => setShowPicker(true)} />}
    >
      {/* Money waiting on a decision: until it's answered, a balance is wrong. */}
      {needsDecision > 0 && (
        <Section header="Waiting on You" tight>
          <List>
            {pendingIncoming.map((t) => (
              <RowButton
                key={t.id}
                onClick={() => setDecide(t)}
                inset="tile"
                tall
                leading={<IconTile icon="clock" color="var(--orange)" />}
                title={`${nameOf(t.fromUid)} sent you ${formatCurrency(t.amount)}`}
                subtitle={`${t.note ? `“${t.note}” · ` : ""}Confirm it and choose what it settles`}
                chevron
              />
            ))}
            {unattributed.map((t) => (
              <RowButton
                key={t.id}
                onClick={() => setDecide(t)}
                inset="tile"
                tall
                leading={<IconTile icon="info.circle" color="var(--blue)" />}
                title={`${formatCurrency(t.amount)} from ${nameOf(t.fromUid)} isn't in a group`}
                subtitle="Counted as personal. Attach it to settle a group balance."
                chevron
              />
            ))}
          </List>
        </Section>
      )}

      {counterparties.length === 0 ? (
        <div className="card mt-2">
          <EmptyState
            icon="rupee.bubble"
            title="Nobody to Pay Yet"
            message="You can pay anyone you share a group with. Join or create one first."
            action={
              <NavLink href="/" kind="tab" className="btn btn-prominent is-md">
                Go to Groups
              </NavLink>
            }
          />
        </div>
      ) : (
        <Section header={needsDecision > 0 ? "People" : undefined} tight={needsDecision === 0}>
          {counterparties.length > 3 && (
            <SearchField
              value={search}
              onChange={setSearch}
              placeholder="Search people"
              label="Search people"
              className="mb-3"
            />
          )}
          {rows.length === 0 ? (
            <div className="card">
              <EmptyState compact icon="magnifyingglass" title="No Results" message={`Nobody matches “${search}”.`} />
            </div>
          ) : (
            <List>
              {rows.map((r) => {
                const iOwe = !isSettled(r.net) && r.net > 0;
                const theyOwe = !isSettled(r.net) && r.net < 0;
                return (
                  // Link, not router.push: /chat/[uid] is dynamic, so without a
                  // prefetched shell every tap paid a cold server round trip.
                  <RowLink
                    key={r.uid}
                    href={`/chat/${r.uid}`}
                    inset={76}
                    tall
                    chevron={false}
                    leading={
                      <span className="relative">
                        <Avatar name={r.displayName} photoURL={r.photoURL} size={48} />
                        {r.unread && (
                          <span
                            className="absolute -left-[13px] top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-[var(--tint)]"
                            aria-label="Unread messages"
                          />
                        )}
                      </span>
                    }
                    title={r.displayName}
                    titleClassName={r.unread ? "font-semibold" : "font-medium"}
                    subtitle={
                      r.awaitingMe ? (
                        <span className="font-medium text-warn">Waiting for you to confirm a payment</span>
                      ) : (
                        r.preview
                      )
                    }
                    trailing={
                      <span className="flex shrink-0 flex-col items-end gap-0.5">
                        <span className="t-caption text-label-2">
                          {r.lastActivityAt ? timeAgo(r.lastActivityAt) : ""}
                        </span>
                        <span
                          className={`num t-subhead font-semibold ${
                            iOwe ? "text-neg" : theyOwe ? "text-pos" : "text-label-3"
                          }`}
                        >
                          {iOwe || theyOwe ? formatCurrency(Math.abs(r.net)) : "Settled"}
                        </span>
                      </span>
                    }
                  />
                );
              })}
            </List>
          )}
          <p className="section-footer">
            Green: they owe you. Red: you owe them. Netted across every group you share.
          </p>
        </Section>
      )}

      {showPicker && (
        <Sheet
          large
          title="Send Money"
          onClose={() => {
            setShowPicker(false);
            setPickerQuery("");
          }}
        >
          <SearchField
            value={pickerQuery}
            onChange={setPickerQuery}
            autoFocus
            placeholder="Search people"
            label="Search people"
            className="mt-1"
          />
          {pickerRows.length === 0 ? (
            <EmptyState
              compact
              icon="person.2"
              title={counterparties.length === 0 ? "Nobody Yet" : "No Results"}
              message={
                counterparties.length === 0
                  ? "You can pay anyone you share a group with. Join a group first."
                  : "Nobody matches that search."
              }
            />
          ) : (
            <List className="mt-4">
              {pickerRows.map((c) => (
                <RowButton
                  key={c.uid}
                  // The conversation is where paying happens, so the picker
                  // hands off rather than stacking a second sheet on top.
                  onClick={() => nav.push(`/chat/${c.uid}?pay=1`)}
                  inset="avatar"
                  leading={<Avatar name={c.displayName} photoURL={c.photoURL} size={40} />}
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
            </List>
          )}
        </Sheet>
      )}

      {decide && (
        <IncludeTransferSheet
          transfer={decide}
          meUid={currentUser.uid}
          fromName={nameOf(decide.fromUid)}
          fromPhotoURL={byUid.get(decide.fromUid)?.photoURL}
          datasets={datasets}
          onClose={() => setDecide(null)}
        />
      )}
    </Screen>
  );
}
