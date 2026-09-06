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
  if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function timeLabel(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
}

function KindIcon({ kind }: { kind: NotificationKind }) {
  if (kind === "request")
    return (
      <span className="w-10 h-10 rounded-full bg-[var(--tint-warning)] flex items-center justify-center shrink-0">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--warning)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
      </span>
    );
  if (kind === "status")
    return (
      <span className="w-10 h-10 rounded-full bg-[var(--tint-success)] flex items-center justify-center shrink-0">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--pos)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" /><path d="m8.5 12 2.5 2.5 4.5-5" />
        </svg>
      </span>
    );
  if (kind === "transfer")
    return (
      <span className="w-10 h-10 rounded-full bg-[var(--tint-success)] flex items-center justify-center shrink-0">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--pos)" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3v18M8 7h5.5a2.5 2.5 0 0 1 0 5H8M8 12h8M8 16.5h8" />
        </svg>
      </span>
    );
  if (kind === "message")
    return (
      <span className="w-10 h-10 rounded-full bg-[var(--tint-accent-2)] flex items-center justify-center shrink-0">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 11.5a8 8 0 0 1-8 8H8l-4 3v-4.6A8 8 0 0 1 13 3.5a8 8 0 0 1 8 8Z" />
        </svg>
      </span>
    );
  return (
    <span className="w-10 h-10 rounded-full bg-[var(--tint-accent-2)] flex items-center justify-center shrink-0">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z" /><path d="M9 8h6M9 12h6" />
      </svg>
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
                <span className="text-[var(--text-tertiary)]"> wants to cancel out </span>
                <span className="font-semibold">{formatCurrency(s.amount)}</span>
                <span className="text-[var(--text-tertiary)]"> in {group.name}</span>
              </>
            ) : s.fromUid === creator ? (
              <>
                <span className="font-semibold">{name(s.fromUid)}</span>
                <span className="text-[var(--text-tertiary)]"> says they paid you </span>
                <span className="font-semibold">{formatCurrency(s.amount)}</span>
              </>
            ) : (
              <>
                <span className="font-semibold">{name(creator)}</span>
                <span className="text-[var(--text-tertiary)]"> recorded your payment of </span>
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
                <span className="text-[var(--text-tertiary)]">Your settlement with </span>
                <span className="font-semibold">
                  {name(s.fromUid === uid ? s.toUid : s.fromUid)}
                </span>
                <span className="text-[var(--text-tertiary)]"> was </span>
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
              <span className="text-[var(--text-tertiary)]">
                {e.editAction === "edited" ? " updated " : " added "}
              </span>
              <span className="font-semibold text-[var(--brand)]">{e.description}</span>
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
              <span className="text-[var(--text-tertiary)]"> sent you </span>
              <span className="font-semibold">{formatCurrency(t.amount)}</span>
              <span className="text-[var(--text-tertiary)]"> — confirm it</span>
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
              <span className="text-[var(--text-tertiary)]">Your </span>
              <span className="font-semibold">{formatCurrency(t.amount)}</span>
              <span className="text-[var(--text-tertiary)]"> to </span>
              <span className="font-semibold">{personName(other)}</span>
              <span
                className={
                  t.status === "declined"
                    ? " text-[var(--neg)]"
                    : " text-[var(--text-tertiary)]"
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
            <span className="text-[var(--text-tertiary)]">
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

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-[var(--label-tertiary)]">Loading…</p>
      </div>
    );
  }
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

  const rows = allItems.map((item, i) => {
    const bucket = dateBucket(item.ts);
    const prevBucket = i > 0 ? dateBucket(allItems[i - 1].ts) : null;
    return { item, bucket, showBucket: bucket !== prevBucket, unread: item.ts > seenAt };
  });

  return (
    <div className="flex-1 flex flex-col bg-[var(--background)] min-h-full">
      <header className="max-w-md w-full mx-auto px-4 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={() => router.push("/")}
            aria-label="Back"
            className="w-11 h-11 rounded-2xl bg-[var(--surface)] shadow-[var(--shadow-button)] flex items-center justify-center tap-shrink"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
          </button>
          <h1 className="text-[24px] font-extrabold text-[var(--text-primary)]">Notifications</h1>
        </div>
      </header>

      <main className="flex-1 max-w-md w-full mx-auto px-4 pt-4 pb-10 scroll-momentum">
        {allItems.length === 0 ? (
          <div className="text-center py-24">
            <div className="w-16 h-16 rounded-full bg-[var(--tint-accent)] flex items-center justify-center mx-auto mb-3">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" />
              </svg>
            </div>
            <p className="text-[16px] font-semibold text-[var(--text-primary)]">You&rsquo;re all caught up</p>
            <p className="text-[13px] text-[var(--text-tertiary)] mt-1">Payments, messages and new expenses will show up here.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {rows.map(({ item, bucket, showBucket, unread }) => (
              <div key={item.key}>
                {showBucket && (
                  <p className="text-[12px] font-semibold text-[var(--text-tertiary)] mb-2 mt-2">{bucket}</p>
                )}
                <div
                  onClick={() =>
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
                    )
                  }
                  className={`flex items-start gap-3 rounded-[var(--radius-inner)] p-3.5 cursor-pointer tap-shrink ${
                    unread ? "bg-[var(--tint-accent)]" : "bg-[var(--surface)] shadow-[var(--shadow-sm)]"
                  }`}
                >
                  <KindIcon kind={item.kind} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[15px] text-[var(--text-primary)] leading-snug">{item.title}</p>
                    <p className="text-[13px] text-[var(--text-tertiary)] mt-0.5 truncate">{item.subtitle}</p>
                    {item.kind === "request" && item.settlement && (
                      <div className="flex gap-2 mt-2">
                        <button
                          disabled={busyId === item.settlement.id}
                          onClick={(ev) => { ev.stopPropagation(); void respond(item.settlement!, item.groupId, "approved"); }}
                          className="rounded-full bg-[var(--brand-solid)] text-white px-3.5 py-1.5 text-[13px] font-medium tap-shrink disabled:opacity-50"
                        >
                          Approve
                        </button>
                        <button
                          disabled={busyId === item.settlement.id}
                          onClick={(ev) => { ev.stopPropagation(); void respond(item.settlement!, item.groupId, "rejected"); }}
                          className="rounded-full bg-[var(--fill)] text-[var(--text-secondary)] px-3.5 py-1.5 text-[13px] font-medium tap-shrink disabled:opacity-50"
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className="text-[12px] text-[var(--text-tertiary)]">{timeLabel(item.ts)}</span>
                    {unread && <span className="w-2 h-2 rounded-full bg-[var(--brand-solid)]" />}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
