"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useGroupData } from "@/lib/group-data-context";
import { usePayments } from "@/lib/payments-context";
import { computeCounterpartyBalances } from "@/lib/global-balance";
import { formatCurrency } from "@/lib/balance";
import { isSettled } from "@/lib/money";
import {
  missingAllocationLegs,
  transferAllocations,
  unallocatedAmount,
} from "@/lib/transfer-allocation";
import { groupItemLink } from "@/lib/statement";
import {
  MAX_MESSAGE_LENGTH,
  markThreadRead,
  sendMessage,
  subscribeToMessages,
  threadIdFor,
} from "@/lib/chat";
import { cancelTransfer, reconcileTransferAllocations } from "@/lib/transfers";
import { hapticTap } from "@/lib/haptics";
import { buildConversation, ConversationItem } from "@/lib/conversation";
import { ChatMessage, DirectTransfer } from "@/lib/types";
import { getUserProfile } from "@/lib/firestore";
import LoginScreen from "@/components/LoginScreen";
import ChatSkeleton from "@/components/chat/ChatSkeleton";
import { useToast } from "@/components/ui/Toast";
import Screen from "@/components/kit/Screen";
import { BarLink } from "@/components/kit/BarButton";
import { Avatar } from "@/components/kit/Avatar";
import { EmptyState } from "@/components/kit/Controls";
import { Icon } from "@/components/kit/Icon";
import { useNav } from "@/components/kit/nav";

// Sheets behind a tap load on demand.
const SendMoneyModal = dynamic(() => import("@/components/pay/SendMoneyModal"), { ssr: false });
const IncludeTransferSheet = dynamic(() => import("@/components/pay/IncludeTransferSheet"), { ssr: false });

/**
 * The conversation with one person: every rupee that has moved between you,
 * in order, with chat woven in — so "did you send it?" is answered by the
 * bubble above it. Money rows are projections of the ledger
 * (lib/conversation.ts), never chat state, so nothing here can disagree with
 * the balances on the group screens.
 */

function dayLabel(ts: number): string {
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOfDay(new Date()) - startOfDay(new Date(ts))) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return new Date(ts).toLocaleDateString("en-IN", { weekday: "long" });
  return new Date(ts).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function timeLabel(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
}

/**
 * Rows are hoisted out of the screen on purpose: declared inside it, every
 * keystroke in the composer gave them new identities, so React remounted
 * every bubble in the conversation.
 */
function TransferCard({
  item,
  otherName,
  groupNameOf,
  settlementIdsByGroup,
  onDecide,
  onCancel,
  onRepair,
  onNavigate,
}: {
  item: ConversationItem;
  otherName: string;
  groupNameOf: (groupId: string) => string;
  settlementIdsByGroup: Map<string, Set<string>>;
  onDecide: (t: DirectTransfer) => void;
  onCancel: (t: DirectTransfer) => void;
  onRepair: (t: DirectTransfer) => void;
  onNavigate: (href: string) => void;
}) {
  const t = item.transfer!;
  const mine = item.side === "me";
  // A payment can be split across groups and only partly assigned, so the
  // status describes an allocation rather than a single destination.
  const legs = transferAllocations(t);
  const unassigned = unallocatedAmount(t);
  // Booking takes two writes, so a leg can be on the transfer while its
  // settlement never reached the group. Surface it so the receiver can finish.
  const broken = missingAllocationLegs(t, settlementIdsByGroup);
  const status = (() => {
    if (t.status === "cancelled") return { text: "Withdrawn", tone: "flat" as const };
    if (t.status === "declined") return { text: "Marked as not received", tone: "bad" as const };
    if (t.status === "accepted" && legs.length > 0) {
      const where =
        legs.length === 1 ? `Counted in ${groupNameOf(legs[0].groupId)}` : `Counted across ${legs.length} groups`;
      if (broken.length > 0) {
        return {
          text: `Not fully recorded — ${formatCurrency(
            broken.reduce((sum, l) => sum + l.amount, 0)
          )} is missing from ${broken.length === 1 ? "a group" : "some groups"}`,
          tone: "warn" as const,
        };
      }
      return {
        text: isSettled(unassigned) ? where : `${where} · ${formatCurrency(unassigned)} unassigned`,
        tone: "good" as const,
      };
    }
    if (t.status === "accepted") return { text: "Confirmed · personal balance", tone: "flat" as const };
    return {
      text: mine ? `Waiting for ${otherName} to confirm` : "Waiting for you to confirm",
      tone: "warn" as const,
    };
  })();

  const statusColor = mine
    ? "text-white/85"
    : status.tone === "good"
    ? "text-pos"
    : status.tone === "bad"
    ? "text-neg"
    : status.tone === "warn"
    ? "text-warn"
    : "text-label-2";

  const actionCls = mine
    ? "mt-2.5 w-full rounded-full bg-white/20 px-4 py-2 text-[15px] font-semibold text-white transition-transform active:scale-[0.97]"
    : "mt-2.5 w-full rounded-full px-4 py-2 text-[15px] font-semibold transition-transform active:scale-[0.97]";

  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div
        className={`w-[78%] max-w-[300px] rounded-[24px] p-4 ${
          mine
            ? "bg-[linear-gradient(160deg,color-mix(in_srgb,var(--tint)_82%,white)_0%,var(--tint)_100%)] text-white"
            : "bg-[var(--cell)]"
        }`}
      >
        <p className={`t-footnote flex items-center gap-1.5 ${mine ? "text-white/80" : "text-label-2"}`}>
          <Icon name="indianrupee" size={14} strokeWidth={2.2} />
          {mine ? `You paid ${otherName}` : `${otherName} paid you`}
        </p>
        <p className="amount-hero mt-1 text-[32px]">{formatCurrency(t.amount)}</p>
        {t.note && <p className={`t-subhead mt-0.5 ${mine ? "text-white/90" : "text-label-2"}`}>{t.note}</p>}
        <p className={`t-footnote mt-2 font-medium ${statusColor}`}>{status.text}</p>

        {t.receiptUrls.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
            {t.receiptUrls.map((url, i) => (
              <a
                key={url}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className={`t-footnote font-medium underline ${mine ? "text-white/90" : "text-tint"}`}
              >
                Screenshot {i + 1}
              </a>
            ))}
          </div>
        )}

        {/* The receiver's decision, and the sender's escape hatch. */}
        {!mine && t.status === "pending" && (
          <button type="button" onClick={() => onDecide(t)} className={`${actionCls} bg-[var(--tint)] text-white`}>
            Confirm &amp; Choose a Group
          </button>
        )}
        {!mine && broken.length > 0 && (
          <button type="button" onClick={() => onRepair(t)} className={`${actionCls} bg-[color-mix(in_srgb,var(--orange)_18%,transparent)] text-warn`}>
            Finish Recording This Payment
          </button>
        )}
        {/* Still offered once part is booked: the rest can go to another group. */}
        {!mine && t.status === "accepted" && !isSettled(unassigned) && (
          <button type="button" onClick={() => onDecide(t)} className={`${actionCls} bg-[var(--fill-3)] text-label`}>
            {legs.length === 0 ? "Attach to a Group" : `Assign Remaining ${formatCurrency(unassigned)}`}
          </button>
        )}
        {mine && t.status === "pending" && (
          <button type="button" onClick={() => onCancel(t)} className={actionCls}>
            Withdraw
          </button>
        )}
        {mine &&
          t.status === "accepted" &&
          legs.map((leg) => (
            <button
              key={leg.settlementId}
              type="button"
              onClick={() => onNavigate(groupItemLink(leg.groupId, { kind: "settlement", id: leg.settlementId }))}
              className={actionCls}
            >
              View {formatCurrency(leg.amount)} in {groupNameOf(leg.groupId)}
            </button>
          ))}
        <p className={`t-caption mt-2 text-right ${mine ? "text-white/70" : "text-label-3"}`}>{timeLabel(item.ts)}</p>
      </div>
    </div>
  );
}

function SettlementCard({
  item,
  otherName,
  onNavigate,
}: {
  item: ConversationItem;
  otherName: string;
  onNavigate: (href: string) => void;
}) {
  const s = item.settlement!;
  const mine = item.side === "me";
  const isOffset = s.kind === "offset";
  const statusText = isOffset
    ? "Balances cancelled out · no money moved"
    : s.status === "approved"
    ? `Settled in ${item.groupName}`
    : s.status === "rejected"
    ? "Declined"
    : "Waiting for approval";
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <button
        type="button"
        onClick={() => item.groupId && onNavigate(groupItemLink(item.groupId, { kind: "settlement", id: s.id }))}
        className="w-[78%] max-w-[300px] rounded-[24px] bg-[var(--cell)] p-4 text-left transition-transform duration-150 active:scale-[0.98]"
      >
        <p className="t-footnote truncate text-label-2">
          {isOffset
            ? `Offset · ${item.groupName}`
            : mine
            ? `You paid ${otherName} · ${item.groupName}`
            : `${otherName} paid you · ${item.groupName}`}
        </p>
        <p className="amount-hero mt-1 text-[26px]">{formatCurrency(s.amount)}</p>
        {s.note && <p className="t-subhead mt-0.5 text-label-2">{s.note}</p>}
        <p
          className={`t-footnote mt-1.5 font-medium ${
            s.status === "approved" ? "text-pos" : s.status === "rejected" ? "text-neg" : "text-warn"
          }`}
        >
          {statusText}
        </p>
        <p className="t-caption mt-1 text-right text-label-3">{timeLabel(item.ts)}</p>
      </button>
    </div>
  );
}

function ExpenseLine({
  item,
  meUid,
  otherName,
  onNavigate,
}: {
  item: ConversationItem;
  meUid: string;
  otherName: string;
  onNavigate: (href: string) => void;
}) {
  const e = item.expense!;
  const payerIsMe = e.paidBy === meUid;
  return (
    <div className="flex justify-center px-4">
      <button
        type="button"
        onClick={() => item.groupId && onNavigate(groupItemLink(item.groupId, { kind: "expense", id: e.id }))}
        className="t-footnote max-w-[92%] rounded-full px-3 py-1 text-center text-label-2 transition-colors active:bg-[var(--fill-3)]"
      >
        <span className="font-semibold text-label">{payerIsMe ? "You" : otherName}</span> paid{" "}
        {formatCurrency(e.amount)} for <span className="font-semibold text-label">{e.description}</span> ·{" "}
        {item.groupName} ·{" "}
        {payerIsMe
          ? `their share ${formatCurrency(item.theirShare ?? 0)}`
          : `your share ${formatCurrency(item.myShare ?? 0)}`}
      </button>
    </div>
  );
}

function MessageBubble({ item, tail }: { item: ConversationItem; tail: boolean }) {
  const mine = item.side === "me";
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[78%] px-3.5 py-2 ${
          mine ? "bg-[var(--tint)] text-white" : "bg-[var(--cell)] text-label"
        }`}
        style={{
          borderRadius: 20,
          borderBottomRightRadius: mine && tail ? 6 : 20,
          borderBottomLeftRadius: !mine && tail ? 6 : 20,
        }}
      >
        <p className="t-body whitespace-pre-wrap break-words">{item.message!.text}</p>
        <p className={`t-caption mt-0.5 text-right ${mine ? "text-white/70" : "text-label-3"}`}>
          {timeLabel(item.ts)}
        </p>
      </div>
    </div>
  );
}

export default function ChatPage() {
  // useSearchParams needs a Suspense boundary above it.
  return (
    <Suspense fallback={<ChatSkeleton />}>
      <ChatPageInner />
    </Suspense>
  );
}

function ChatPageInner() {
  const { uid: otherUid } = useParams<{ uid: string }>();
  const router = useRouter();
  const nav = useNav();
  const searchParams = useSearchParams();
  const { user, loading } = useAuth();
  const { datasets, groupsLoaded } = useGroupData();
  const { transfers, threadWith } = usePayments();
  const showToast = useToast();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [showPay, setShowPay] = useState(searchParams.get("pay") === "1");
  const [decide, setDecide] = useState<DirectTransfer | null>(null);
  // Someone with no shared group still has history worth reading, so the name
  // falls back to their user document.
  const [fallbackProfile, setFallbackProfile] = useState<{
    displayName: string;
    photoURL?: string;
    upiId?: string;
  } | null>(null);

  const meUid = user?.uid;
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!meUid || !otherUid) return;
    return subscribeToMessages(threadIdFor(meUid, otherUid), setMessages);
  }, [meUid, otherUid]);

  const counterparty = useMemo(() => {
    if (!meUid) return undefined;
    return computeCounterpartyBalances(meUid, datasets, transfers).find((c) => c.uid === otherUid);
  }, [meUid, datasets, transfers, otherUid]);

  // Transfer-only counterparties carry no profile ("Member").
  const needsProfile = !counterparty || !counterparty.displayName || counterparty.displayName === "Member";

  useEffect(() => {
    if (!otherUid || !needsProfile || !groupsLoaded) return;
    let cancelled = false;
    getUserProfile(otherUid).then((p) => {
      if (cancelled || !p) return;
      setFallbackProfile({ displayName: p.displayName || "Someone", photoURL: p.photoURL, upiId: p.upiId });
    });
    return () => {
      cancelled = true;
    };
  }, [otherUid, needsProfile, groupsLoaded]);

  const otherName = needsProfile
    ? fallbackProfile?.displayName || counterparty?.displayName || "Someone"
    : counterparty?.displayName || "Someone";
  const otherPhoto = counterparty?.photoURL || fallbackProfile?.photoURL;
  const otherUpiId = counterparty?.upiId || fallbackProfile?.upiId;

  const items = useMemo(() => {
    if (!meUid || !otherUid) return [];
    return buildConversation({ meUid, otherUid, datasets, transfers, messages });
  }, [meUid, otherUid, datasets, transfers, messages]);

  const thread = otherUid ? threadWith(otherUid) : undefined;

  // Mark read whenever the newest message from them changes — it's a write.
  useEffect(() => {
    if (!meUid || !otherUid) return;
    const newest = thread?.lastMessageAt;
    if (!newest || thread?.lastMessageFrom === meUid) return;
    if ((thread?.lastRead?.[meUid] ?? 0) >= newest) return;
    void markThreadRead(meUid, otherUid, newest);
  }, [meUid, otherUid, thread?.lastMessageAt, thread?.lastMessageFrom, thread?.lastRead]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [items.length]);

  const settlementIdsByGroup = useMemo(
    () => new Map(datasets.map((d) => [d.group.id, new Set(d.settlements.map((s) => s.id))] as const)),
    [datasets]
  );

  if (loading || (user && !groupsLoaded)) return <ChatSkeleton />;
  if (!user) return <LoginScreen />;

  const currentUser = user;
  const net = counterparty?.net ?? 0;
  const iOwe = !isSettled(net) && net > 0;
  const theyOwe = !isSettled(net) && net < 0;
  const groupNameOf = (groupId: string) =>
    datasets.find((d) => d.group.id === groupId)?.group.name || "a group";

  async function handleRepairTransfer(t: DirectTransfer) {
    try {
      const repaired = await reconcileTransferAllocations(t);
      showToast({
        message:
          repaired > 0 ? `Recorded ${repaired} missing ${repaired === 1 ? "entry" : "entries"}` : "Already up to date",
      });
    } catch (err) {
      showToast({
        message: err instanceof Error ? `Couldn't finish recording: ${err.message}` : "Couldn't finish recording",
      });
    }
  }
  const navigate = (href: string) => nav.push(href);

  async function handleSend(e?: React.FormEvent) {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    // Cleared up front so the field feels instant; restored if the write fails.
    setDraft("");
    try {
      await sendMessage(currentUser.uid, otherUid, text);
      hapticTap();
    } catch (err) {
      setDraft(text);
      showToast({ message: err instanceof Error ? `Couldn't send: ${err.message}` : "Couldn't send" });
    } finally {
      setSending(false);
      inputRef.current?.focus({ preventScroll: true });
    }
  }

  async function handleCancelTransfer(t: DirectTransfer) {
    try {
      await cancelTransfer(t);
      showToast({ message: "Payment withdrawn", tone: "info" });
    } catch (err) {
      showToast({ message: err instanceof Error ? `Couldn't withdraw: ${err.message}` : "Couldn't withdraw" });
    }
  }

  const balanceLine = iOwe
    ? `You owe ${formatCurrency(net)}`
    : theyOwe
    ? `Owes you ${formatCurrency(-net)}`
    : counterparty
    ? "All settled up"
    : "No shared groups";

  return (
    <Screen
      title={otherName}
      back="/pay"
      fixed
      fixedClassName="is-viewport"
      inlineTitle={
        <span className="flex flex-col items-center leading-tight">
          <span className="flex items-center gap-2">
            <Avatar name={otherName} photoURL={otherPhoto} size={26} />
            <span className="max-w-[42vw] truncate">{otherName}</span>
          </span>
          <span
            className={`t-caption mt-0.5 font-medium ${iOwe ? "text-neg" : theyOwe ? "text-pos" : "text-label-2"}`}
          >
            {balanceLine}
          </span>
        </span>
      }
      trailing={<BarLink href={`/reports?person=${otherUid}`} icon="doc.text" label={`Statement with ${otherName}`} />}
    >
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-[calc(12px+var(--sal))] pb-4 pt-[calc(var(--nav-total)+14px)]">
        <div className="mx-auto max-w-[var(--content-max)] space-y-1.5">
          {items.length === 0 ? (
            <EmptyState
              icon="message"
              title="No Messages Yet"
              message={`Send ${otherName} money, or say hello. Every payment and settled balance between you shows up here.`}
            />
          ) : (
            items.map((item, i) => {
              const label = dayLabel(item.ts);
              const showDay = i === 0 || dayLabel(items[i - 1].ts) !== label;
              const next = items[i + 1];
              const tail = !next || next.side !== item.side || next.kind !== "message" || dayLabel(next.ts) !== label;
              return (
                <div key={item.key} className={showDay ? "pt-3" : undefined}>
                  {showDay && <p className="t-caption pb-2 text-center font-medium text-label-2">{label}</p>}
                  {item.kind === "message" && <MessageBubble item={item} tail={tail} />}
                  {item.kind === "transfer" && (
                    <div className="py-1">
                      <TransferCard
                        item={item}
                        otherName={otherName}
                        groupNameOf={groupNameOf}
                        settlementIdsByGroup={settlementIdsByGroup}
                        onDecide={setDecide}
                        onCancel={handleCancelTransfer}
                        onRepair={handleRepairTransfer}
                        onNavigate={navigate}
                      />
                    </div>
                  )}
                  {item.kind === "settlement" && (
                    <div className="py-1">
                      <SettlementCard item={item} otherName={otherName} onNavigate={navigate} />
                    </div>
                  )}
                  {item.kind === "expense" && (
                    <div className="py-1">
                      <ExpenseLine item={item} meUid={currentUser.uid} otherName={otherName} onNavigate={navigate} />
                    </div>
                  )}
                </div>
              );
            })
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Composer */}
      <form
        onSubmit={handleSend}
        className="shrink-0 px-[calc(12px+var(--sal))] pb-[max(10px,var(--sab))] pt-2"
        style={{ background: "linear-gradient(to bottom, color-mix(in srgb, var(--bg) 0%, transparent), var(--bg) 40%)" }}
      >
        <div className="mx-auto flex max-w-[var(--content-max)] items-end gap-2">
          <button
            type="button"
            onClick={() => setShowPay(true)}
            aria-label={`Pay ${otherName}`}
            className="bar-btn glass shrink-0 text-tint"
          >
            <Icon name="indianrupee" size={21} strokeWidth={2.1} />
          </button>
          <label className="glass flex min-h-[44px] flex-1 items-end rounded-[22px] pl-4 pr-1.5">
            <span className="sr-only">Message {otherName}</span>
            <textarea
              ref={inputRef}
              rows={1}
              value={draft}
              maxLength={MAX_MESSAGE_LENGTH}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                // Enter sends, Shift+Enter makes a new line.
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
              placeholder="Message"
              className="field max-h-28 flex-1 self-center py-[10px] [field-sizing:content]"
            />
            <button
              type="submit"
              disabled={!draft.trim() || sending}
              aria-label="Send message"
              className={`mb-1.5 ml-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--tint)] text-white transition-[transform,opacity] duration-200 ${
                draft.trim() ? "scale-100 opacity-100" : "pointer-events-none scale-50 opacity-0"
              }`}
            >
              <Icon name="arrow.up" size={18} strokeWidth={2.6} />
            </button>
          </label>
        </div>
      </form>

      {showPay && (
        <SendMoneyModal
          fromUid={currentUser.uid}
          toUid={otherUid}
          toName={otherName}
          toPhotoURL={otherPhoto}
          toUpiId={otherUpiId}
          suggestedAmount={iOwe ? net : 0}
          contextLine={
            iOwe
              ? `You owe ${otherName} ${formatCurrency(net)} across ${counterparty?.groups.length ?? 0} group${
                  (counterparty?.groups.length ?? 0) === 1 ? "" : "s"
                }`
              : theyOwe
              ? `${otherName} owes you ${formatCurrency(-net)} — you don't need to pay them`
              : undefined
          }
          onClose={() => {
            setShowPay(false);
            // Drop ?pay=1 so back/forward doesn't reopen the sheet.
            if (searchParams.get("pay")) router.replace(`/chat/${otherUid}`, { scroll: false });
          }}
        />
      )}

      {decide && (
        <IncludeTransferSheet
          transfer={decide}
          meUid={currentUser.uid}
          fromName={otherName}
          fromPhotoURL={otherPhoto}
          datasets={datasets}
          onClose={() => setDecide(null)}
        />
      )}
    </Screen>
  );
}
