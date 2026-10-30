"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useGroupData } from "@/lib/group-data-context";
import { usePayments } from "@/lib/payments-context";
import { computeCounterpartyBalances } from "@/lib/global-balance";
import { hasUnread } from "@/lib/chat";
import {
  updateSettlementStatus,
} from "@/lib/firestore";
import {
  activeExpenses,
  canRespondToSettlement,
  formatCurrency,
  settlementCreator,
} from "@/lib/balance";
import { groupItemLink } from "@/lib/statement";
import { transferAllocations } from "@/lib/transfer-allocation";
import { Settlement } from "@/lib/types";
import LoginScreen from "@/components/LoginScreen";
import { useToast } from "@/components/ui/Toast";
import Screen from "@/components/ui/Screen";
import { ListSection } from "@/components/ui/List";
import { EmptyState } from "@/components/ui/Controls";
import { Bell, Bubble, CheckCircle, ChevronRight, Receipt, RupeeCircle } from "@/components/ui/Icons";
import { hapticSuccess } from "@/lib/haptics";

type NotificationKind = "request" | "status" | "expense" | "transfer" | "message";

interface NotificationItem {
  key: string;
  ts: number;
  /**
   * Empty for notifications that don't belong to a group — a direct transfer or
   * a chat message. Those carry `href` instead, since there is no group item to
   * deep-link into.
   */
  groupId: string;
  groupName: string;
  kind: NotificationKind;
  title: React.ReactNode;
  subtitle: string;
  settlement?: Settlement;
  /** The expense this notification is about, when it is about one. */
  expenseId?: string;
  /** Explicit navigation target, used when there is no group item to link to. */
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

function KindIcon({ kind }: { kind: NotificationKind }) {
  const map: Record<NotificationKind, { color: string; icon: React.ReactNode }> = {
    request: { color: "var(--orange)", icon: <Bell size={17} /> },
    status: { color: "var(--green)", icon: <CheckCircle size={18} /> },
    transfer: { color: "var(--green)", icon: <RupeeCircle size={18} /> },
    message: { color: "var(--blue)", icon: <Bubble size={17} /> },
    expense: { color: "var(--indigo)", icon: <Receipt size={17} /> },
  };
  const { color, icon } = map[kind];
  return (
    <span className="icon-tile !w-9 !h-9 !rounded-[10px]" style={{ background: color }}>
      {icon}
    </span>
  );
}

export default function NotificationsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const showToast = useToast();
  const { datasets } = useGroupData();
  // Direct transfers and chat live outside any group, so they were invisible
  // here: this page only ever walked group expenses and settlements.
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
        // Either side can raise a settlement: a payment you say you made, or
        // a payment someone recorded against you. Whoever did NOT create it is
        // the one who has to act.
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
                <span className="font-semibold">{name(creator)}</span>
                <span className="text-[var(--text-secondary)]"> wants to cancel out </span>
                <span className="font-semibold">{formatCurrency(s.amount)}</span>
                <span className="text-[var(--text-secondary)]"> in {group.name}</span>
              </>
            ) : s.fromUid === creator ? (
              <>
                <span className="font-semibold">{name(s.fromUid)}</span>
                <span className="text-[var(--text-secondary)]"> says they paid you </span>
                <span className="font-semibold">{formatCurrency(s.amount)}</span>
              </>
            ) : (
              <>
                <span className="font-semibold">{name(creator)}</span>
                <span className="text-[var(--text-secondary)]"> recorded your payment of </span>
                <span className="font-semibold">{formatCurrency(s.amount)}</span>
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
                <span className="text-[var(--text-secondary)]">Your settlement with </span>
                <span className="font-semibold">
                  {name(s.fromUid === uid ? s.toUid : s.fromUid)}
                </span>
                <span className="text-[var(--text-secondary)]"> was </span>
                <span
                  className={
                    s.status === "approved"
                      ? "font-semibold text-[var(--pos)]"
                      : "font-semibold text-[var(--neg)]"
                  }
                >
                  {s.status}
                </span>
              </>
            ),
            subtitle: `${formatCurrency(s.amount)} · ${group.name}`,
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
              <span className="font-semibold">{name(e.createdBy)}</span>
              <span className="text-[var(--text-secondary)]">
                {e.editAction === "edited" ? " updated " : " added "}
              </span>
              <span className="font-semibold">{e.description}</span>
            </>
          ),
          subtitle: `${formatCurrency(e.amount)} · ${group.name}`,
        });
      }
    }

    // ── Direct transfers ──────────────────────────────────────────────
    // Names come from the shared-group profile mirror; someone you only ever
    // paid directly falls back to a generic label rather than a raw uid.
    const nameByUid = new Map(
      computeCounterpartyBalances(uid, datasets, transfers).map((c) => [c.uid, c.displayName])
    );
    const personName = (target: string) => nameByUid.get(target) || "Someone";

    for (const t of transfers) {
      const incoming = t.toUid === uid;
      const other = incoming ? t.fromUid : t.toUid;

      if (incoming && t.status === "pending") {
        // The one genuinely actionable transfer state: money is claimed to have
        // arrived and only this user can say what it was.
        items.push({
          key: `tr-req-${t.id}`,
          ts: t.updatedAt || t.createdAt,
          groupId: "",
          groupName: "",
          kind: "transfer",
          href: `/chat/${other}`,
          title: (
            <>
              <span className="font-semibold">{personName(other)}</span>
              <span className="text-[var(--text-secondary)]"> sent you </span>
              <span className="font-semibold">{formatCurrency(t.amount)}</span>
              <span className="text-[var(--text-secondary)]"> — confirm it</span>
            </>
          ),
          subtitle: t.note ? `Direct payment · ${t.note}` : "Direct payment",
        });
        continue;
      }

      // The sender hearing back about what happened to their payment.
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
              <span className="text-[var(--text-secondary)]">Your </span>
              <span className="font-semibold">{formatCurrency(t.amount)}</span>
              <span className="text-[var(--text-secondary)]"> to </span>
              <span className="font-semibold">{personName(other)}</span>
              <span
                className={
                  t.status === "declined"
                    ? " text-[var(--neg)]"
                    : " text-[var(--text-secondary)]"
                }
              >
                {" "}
                {outcome}
              </span>
            </>
          ),
          subtitle: "Direct payment",
        });
      }
    }

    // ── Chat ──────────────────────────────────────────────────────────
    // One row per conversation, not per message: a thread with nine unread
    // messages is one thing to deal with, and only the thread summary is loaded
    // on this screen anyway.
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
            <span className="font-semibold">{personName(other)}</span>
            <span className="text-[var(--text-secondary)]">
              {hasUnread(thread, uid) ? " messaged you" : " said"}
            </span>
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

  if (loading) return <Screen title="Notifications" backHref="/">{null}</Screen>;
  if (!user) return <LoginScreen />;

  // groupId comes from the notification item, which was built from the group
  // whose subcollection the settlement was actually read out of. `s.groupId` is
  // a denormalized copy on the document, so a stale or wrong value there would
  // send the write to the wrong group's path.
  async function respond(
    s: Settlement,
    groupId: string,
    status: "approved" | "rejected"
  ) {
    setBusyId(s.id);
    try {
      await updateSettlementStatus(groupId, s.id, status);
      hapticSuccess();
      showToast({
        message:
          status === "approved"
            ? "Settlement approved"
            : "Request declined",
      });
    } catch (err) {
      showToast({
        message: err instanceof Error ? `Couldn't update: ${err.message}` : "Couldn't update",
      });
    } finally {
      setBusyId(null);
    }
  }

  const sections: { bucket: string; items: NotificationItem[] }[] = [];
  for (const item of allItems) {
    const bucket = dateBucket(item.ts);
    const last = sections[sections.length - 1];
    if (last && last.bucket === bucket) last.items.push(item);
    else sections.push({ bucket, items: [item] });
  }
  const open = (item: NotificationItem) =>
    router.push(
      item.href ??
        groupItemLink(
          item.groupId,
          item.expenseId
            ? { kind: "expense", id: item.expenseId }
            : item.settlement
            ? { kind: "settlement", id: item.settlement.id }
            : undefined
        )
    );

  return (
    <Screen title="Notifications" backHref="/" large tabBar>
      {allItems.length === 0 ? (
        <EmptyState
          icon={<Bell size={56} weight={1.4} />}
          title="No Notifications"
          message="Payments, messages and new expenses show up here."
        />
      ) : (
        sections.map((section) => (
          <ListSection key={section.bucket} header={section.bucket} className="!mt-5 first:!mt-0">
            {section.items.map((item) => {
              const unread = item.ts > seenAt;
              return (
                <div key={item.key} className="list-row-wrap" style={{ ["--sep-inset" as string]: "64px" }}>
                  <button type="button" onClick={() => open(item)} className="list-row is-tall !items-start">
                    <span className="relative mt-0.5">
                      <KindIcon kind={item.kind} />
                      {unread && (
                        <span className="absolute -left-2.5 top-3 w-[9px] h-[9px] rounded-full bg-[var(--blue)]" aria-label="New" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block t-subhead leading-[20px] text-[var(--text-primary)]">{item.title}</span>
                      <span className="block t-footnote text-[var(--text-secondary)] mt-0.5 truncate">{item.subtitle}</span>
                    </span>
                    <span className="shrink-0 flex items-center gap-1 t-footnote text-[var(--text-secondary)] pt-0.5">
                      {timeLabel(item.ts)}
                      <ChevronRight className="row-chevron" size={12} />
                    </span>
                  </button>
                  {item.kind === "request" && item.settlement && (
                    <div className="flex gap-2 px-4 pb-3 -mt-1 pl-[64px]">
                      <button
                        type="button"
                        disabled={busyId === item.settlement.id}
                        onClick={() => void respond(item.settlement!, item.groupId, "approved")}
                        className="btn-prominent btn-small"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        disabled={busyId === item.settlement.id}
                        onClick={() => void respond(item.settlement!, item.groupId, "rejected")}
                        className="btn-gray btn-small !text-[var(--neg)]"
                      >
                        Decline
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </ListSection>
        ))
      )}
    </Screen>
  );
}
