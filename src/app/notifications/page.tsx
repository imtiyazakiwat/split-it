"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useGroupData } from "@/lib/group-data-context";
import { usePayments } from "@/lib/payments-context";
import { computeCounterpartyBalances } from "@/lib/global-balance";
import { hasUnread } from "@/lib/chat-thread";
import { activeExpenses, canRespondToSettlement, formatCurrency, settlementCreator } from "@/lib/balance";
import { groupItemLink } from "@/lib/statement";
import { transferAllocations } from "@/lib/transfer-allocation";
import { Settlement } from "@/lib/types";
import LoginScreen from "@/components/LoginScreen";
import { useToast } from "@/components/ui/Toast";
import { hapticSuccess } from "@/lib/haptics";
import Screen from "@/components/kit/Screen";
import { List, RowLink, Section, sepInset } from "@/components/kit/List";
import { IconTile } from "@/components/kit/Tile";
import { Button, EmptyState } from "@/components/kit/Controls";
import { NavLink } from "@/components/kit/nav";

type NotificationKind = "request" | "status" | "expense" | "transfer" | "message";

interface NotificationItem {
  key: string;
  ts: number;
  /** Empty for direct transfers and chat, which carry `href` instead. */
  groupId: string;
  groupName: string;
  kind: NotificationKind;
  title: React.ReactNode;
  subtitle: string;
  settlement?: Settlement;
  expenseId?: string;
  href?: string;
}

function dateBucket(ts: number): string {
  const now = new Date();
  const d = new Date(ts);
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return d.toLocaleDateString("en-IN", { weekday: "long" });
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "long" });
}

function timeLabel(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
}

function KindTile({ kind }: { kind: NotificationKind }) {
  if (kind === "request") return <IconTile icon="clock" color="var(--orange)" />;
  if (kind === "status") return <IconTile icon="checkmark" color="var(--green)" />;
  if (kind === "transfer") return <IconTile icon="indianrupee" color="var(--teal)" />;
  if (kind === "message") return <IconTile icon="message" color="var(--blue)" />;
  return <IconTile icon="receipt" color="var(--indigo)" />;
}

const B = ({ children }: { children: React.ReactNode }) => <span className="font-semibold">{children}</span>;
const M = ({ children }: { children: React.ReactNode }) => <span className="text-label-2">{children}</span>;

export default function NotificationsPage() {
  const { user, loading } = useAuth();
  const showToast = useToast();
  const { datasets } = useGroupData();
  // Direct transfers and chat live outside any group.
  const { transfers, threads } = usePayments();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [seenAt] = useState<number>(() => {
    if (typeof window === "undefined") return 0;
    return Number(localStorage.getItem("splitit-notif-seen") || 0);
  });
  const uid = user?.uid;

  const allItems = useMemo<NotificationItem[]>(() => {
    if (!uid) return [];
    const items: NotificationItem[] = [];

    for (const { group, expenses, settlements } of datasets) {
      const name = (target: string) =>
        target === uid ? "You" : group.members?.[target]?.displayName || "Someone";

      for (const s of settlements) {
        // Whoever did NOT create a settlement is the one who has to act.
        if (canRespondToSettlement(s, uid)) {
          const creator = settlementCreator(s);
          const isOffset = s.kind === "offset";
          items.push({
            key: `req-${group.id}-${s.id}`,
            ts: s.updatedAt || s.createdAt,
            groupId: group.id,
            groupName: group.name,
            kind: "request",
            title: isOffset ? (
              <>
                <B>{name(creator)}</B> <M>wants to cancel out</M> <B>{formatCurrency(s.amount)}</B>{" "}
                <M>in {group.name}</M>
              </>
            ) : s.fromUid === creator ? (
              <>
                <B>{name(s.fromUid)}</B> <M>says they paid you</M> <B>{formatCurrency(s.amount)}</B>
              </>
            ) : (
              <>
                <B>{name(creator)}</B> <M>recorded your payment of</M> <B>{formatCurrency(s.amount)}</B>
              </>
            ),
            subtitle: `${group.name}${s.note ? ` · ${s.note}` : ""}`,
            settlement: s,
          });
        } else if (settlementCreator(s) === uid && s.status !== "pending") {
          items.push({
            key: `st-${group.id}-${s.id}`,
            ts: s.updatedAt || s.createdAt,
            groupId: group.id,
            groupName: group.name,
            kind: "status",
            title: (
              <>
                <M>Your settlement with</M> <B>{name(s.fromUid === uid ? s.toUid : s.fromUid)}</B> <M>was</M>{" "}
                <span className={s.status === "approved" ? "font-semibold text-pos" : "font-semibold text-neg"}>
                  {s.status}
                </span>
              </>
            ),
            subtitle: `${formatCurrency(s.amount)} · ${group.name}`,
            settlement: s,
          });
        }
      }

      for (const e of activeExpenses(expenses)) {
        if (e.createdBy === uid) continue;
        items.push({
          key: `exp-${group.id}-${e.id}`,
          ts: e.updatedAt || e.createdAt,
          groupId: group.id,
          groupName: group.name,
          kind: "expense",
          expenseId: e.id,
          title: (
            <>
              <B>{name(e.createdBy)}</B> <M>{e.editAction === "edited" ? "updated" : "added"}</M> <B>{e.description}</B>
            </>
          ),
          subtitle: `${formatCurrency(e.amount)} · ${group.name}`,
        });
      }
    }

    // ── Direct transfers ──
    const nameByUid = new Map(
      computeCounterpartyBalances(uid, datasets, transfers).map((c) => [c.uid, c.displayName])
    );
    const personName = (target: string) => nameByUid.get(target) || "Someone";

    for (const t of transfers) {
      const incoming = t.toUid === uid;
      const other = incoming ? t.fromUid : t.toUid;

      if (incoming && t.status === "pending") {
        // The one actionable transfer state: only this user can say what it was.
        items.push({
          key: `tr-req-${t.id}`,
          ts: t.updatedAt || t.createdAt,
          groupId: "",
          groupName: "",
          kind: "transfer",
          href: `/chat/${other}`,
          title: (
            <>
              <B>{personName(other)}</B> <M>sent you</M> <B>{formatCurrency(t.amount)}</B> <M>— confirm it</M>
            </>
          ),
          subtitle: t.note ? `Direct payment · ${t.note}` : "Direct payment",
        });
        continue;
      }

      // The sender hearing back about their payment.
      if (!incoming && t.status !== "pending") {
        const legs = transferAllocations(t);
        const groupNameOf = (groupId: string) =>
          datasets.find((d) => d.group.id === groupId)?.group.name || "a group";
        const outcome =
          t.status === "declined"
            ? "was marked as not received"
            : legs.length === 1
            ? `was counted in ${groupNameOf(legs[0].groupId)}`
            : legs.length > 1
            ? `was split across ${legs.length} groups: ${legs
                .map((l) => `${formatCurrency(l.amount)} in ${groupNameOf(l.groupId)}`)
                .join(", ")}`
            : "was confirmed";
        items.push({
          key: `tr-st-${t.id}`,
          ts: t.updatedAt || t.createdAt,
          groupId: "",
          groupName: "",
          kind: t.status === "declined" ? "status" : "transfer",
          href: `/chat/${other}`,
          title: (
            <>
              <M>Your</M> <B>{formatCurrency(t.amount)}</B> <M>to</M> <B>{personName(other)}</B>{" "}
              <span className={t.status === "declined" ? "text-neg" : "text-label-2"}>{outcome}</span>
            </>
          ),
          subtitle: "Direct payment",
        });
      }
    }

    // ── Chat: one row per conversation, not per message ──
    for (const thread of threads) {
      if (!thread.lastMessageAt || !thread.lastMessage) continue;
      if (thread.lastMessageFrom === uid) continue;
      const other = thread.participants.find((p) => p !== uid);
      if (!other) continue;
      items.push({
        key: `msg-${thread.id}-${thread.lastMessageAt}`,
        ts: thread.lastMessageAt,
        groupId: "",
        groupName: "",
        kind: "message",
        href: `/chat/${other}`,
        title: (
          <>
            <B>{personName(other)}</B> <M>{hasUnread(thread, uid) ? "messaged you" : "said"}</M>
          </>
        ),
        subtitle: thread.lastMessage,
      });
    }

    return items.sort((a, b) => b.ts - a.ts);
  }, [datasets, transfers, threads, uid]);

  useEffect(() => {
    if (allItems.length === 0 || typeof window === "undefined") return;
    const maxTs = allItems.reduce((m, i) => Math.max(m, i.ts), 0);
    localStorage.setItem("splitit-notif-seen", String(maxTs));
  }, [allItems]);

  if (loading) {
    return (
      <Screen title="Notifications" back="/" tabBar>
        <div />
      </Screen>
    );
  }
  if (!user) return <LoginScreen />;

  // groupId comes from the item, built from the group whose subcollection the
  // settlement was read out of — `s.groupId` is a denormalised copy that could
  // send the write to the wrong path.
  async function respond(s: Settlement, groupId: string, status: "approved" | "rejected") {
    setBusyId(s.id);
    try {
      const { updateSettlementStatus } = await import("@/lib/firestore");
      await updateSettlementStatus(groupId, s.id, status);
      hapticSuccess();
      showToast({ message: status === "approved" ? "Settlement approved" : "Request declined" });
    } catch (err) {
      showToast({ message: err instanceof Error ? `Couldn't update: ${err.message}` : "Couldn't update" });
    } finally {
      setBusyId(null);
    }
  }

  const hrefOf = (item: NotificationItem) =>
    item.href ??
    groupItemLink(
      item.groupId,
      item.expenseId
        ? { kind: "expense", id: item.expenseId }
        : item.settlement
        ? { kind: "settlement", id: item.settlement.id }
        : undefined
    );

  const requests = allItems.filter((i) => i.kind === "request" && i.settlement);
  const rest = allItems.filter((i) => !(i.kind === "request" && i.settlement));
  const buckets: { label: string; items: NotificationItem[] }[] = [];
  for (const item of rest) {
    const label = dateBucket(item.ts);
    const last = buckets[buckets.length - 1];
    if (last && last.label === label) last.items.push(item);
    else buckets.push({ label, items: [item] });
  }

  return (
    <Screen title="Notifications" back="/" tabBar>
      {allItems.length === 0 ? (
        <EmptyState
          icon="bell"
          title="You're All Caught Up"
          message="Payments, messages and new expenses will show up here."
        />
      ) : (
        <>
          {requests.length > 0 && (
            <Section header="Needs your response" tight>
              <List>
                {requests.map((item) => {
                  const s = item.settlement!;
                  const busy = busyId === s.id;
                  return (
                    <div key={item.key} className="px-4 py-3" style={sepInset(58)}>
                      <NavLink href={hrefOf(item)} className="flex items-start gap-3">
                        <KindTile kind={item.kind} />
                        <span className="min-w-0 flex-1">
                          <span className="t-body block">{item.title}</span>
                          <span className="t-subhead block truncate text-label-2">
                            {item.subtitle} · {timeLabel(item.ts)}
                          </span>
                        </span>
                        {item.ts > seenAt && <span className="dot mt-2 bg-[var(--tint)]" aria-label="New" />}
                      </NavLink>
                      <div className="mt-3 flex gap-2 pl-[42px]">
                        <Button size="sm" busy={busy} onClick={() => void respond(s, item.groupId, "approved")}>
                          Approve
                        </Button>
                        <Button size="sm" variant="gray" disabled={busy} onClick={() => void respond(s, item.groupId, "rejected")}>
                          Decline
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </List>
            </Section>
          )}

          {buckets.map((bucket, i) => (
            <Section key={bucket.label} header={bucket.label} tight={i === 0 && requests.length === 0}>
              <List>
                {bucket.items.map((item) => (
                  <RowLink
                    key={item.key}
                    href={hrefOf(item)}
                    inset="tile"
                    tall
                    chevron={false}
                    leading={<KindTile kind={item.kind} />}
                    title={item.title}
                    wrap
                    subtitle={item.subtitle}
                    trailing={
                      <span className="flex shrink-0 flex-col items-end gap-1.5 self-start pt-0.5">
                        <span className="t-caption text-label-2">{timeLabel(item.ts)}</span>
                        {item.ts > seenAt && <span className="dot bg-[var(--tint)]" aria-label="New" />}
                      </span>
                    }
                  />
                ))}
              </List>
            </Section>
          ))}
        </>
      )}
    </Screen>
  );
}
