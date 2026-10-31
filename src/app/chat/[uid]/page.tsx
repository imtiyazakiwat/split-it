"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
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
import SendMoneyModal from "@/components/pay/SendMoneyModal";
import { BarButton, useBack } from "@/components/ui/Screen";
import { Avatar } from "@/components/ui/Controls";
import { ArrowUp, ChevronLeft, Rupee } from "@/components/ui/Icons";
import IncludeTransferSheet from "@/components/pay/IncludeTransferSheet";

/**
 * The conversation with one person: every rupee that has moved between the two
 * of you, in order, with chat on top.
 *
 * The point of putting payments and talk on one surface is that the argument and
 * the evidence stop being in different places — "did you send it?" is answered
 * by the bubble above it. Money rows are projections of the ledger (see
 * lib/conversation.ts), never chat state, so nothing here can disagree with the
 * balances on the group screens.
 */

function dayLabel(ts: number): string {
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOfDay(new Date()) - startOfDay(new Date(ts))) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(ts).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function timeLabel(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
}

// ChatSkeleton now lives in components/chat so this screen and the route's
// loading.tsx render the same shape. See app/chat/[uid]/loading.tsx.

/**
 * Rows are hoisted out of the screen component on purpose. Declared inside it,
 * every keystroke in the composer produced new component identities, so React
 * unmounted and remounted every bubble in the conversation — janky scrolling on
 * a long thread for no reason.
 */
function TransferBubble({
  item,
  otherName,
  groupNameOf,
  settlementIdsByGroup,
  onDecide,
  onCancel,
  onRepair,
  onNavigate,
  canAttach,
}: {
  item: ConversationItem;
  otherName: string;
  groupNameOf: (groupId: string) => string;
  /** Settlement ids present in each loaded group, for spotting missing legs. */
  settlementIdsByGroup: Map<string, Set<string>>;
  onDecide: (t: DirectTransfer) => void;
  onCancel: (t: DirectTransfer) => void;
  onRepair: (t: DirectTransfer) => void;
  onNavigate: (href: string) => void;
  /** The sender still owes the receiver in a shared group, so attaching would settle something. */
  canAttach: boolean;
}) {
  const t = item.transfer!;
  const mine = item.side === "me";
  // A payment can be split across several groups, and can be only partly
  // assigned, so the status line has to describe an allocation rather than a
  // single destination.
  const legs = transferAllocations(t);
  const unassigned = unallocatedAmount(t);
  // Booking a payment takes two writes, so a leg can be recorded on the transfer
  // while its settlement never reached the group. That understates the balance
  // silently, and a fully assigned payment offers no other reason to come back
  // here — so surface it and let the receiver finish the job.
  const broken = missingAllocationLegs(t, settlementIdsByGroup);
  const status = (() => {
    if (t.status === "cancelled") return { text: "Withdrawn", tone: "flat" as const };
    if (t.status === "declined") return { text: "Marked as not received", tone: "bad" as const };
    if (t.status === "accepted" && legs.length > 0) {
      const where =
        legs.length === 1
          ? `Counted in ${groupNameOf(legs[0].groupId)}`
          : `Counted across ${legs.length} groups`;
      if (broken.length > 0) {
        return {
          text: `Not fully recorded — ${formatCurrency(
            broken.reduce((sum, l) => sum + l.amount, 0)
          )} is missing from ${broken.length === 1 ? "a group" : "some groups"}`,
          tone: "warn" as const,
        };
      }
      return {
        text: isSettled(unassigned)
          ? where
          : `${where} · ${formatCurrency(unassigned)} unassigned`,
        tone: "good" as const,
      };
    }
    if (t.status === "accepted")
      return { text: "Confirmed · personal balance (not in a group)", tone: "flat" as const };
    return {
      text: mine ? `Waiting for ${otherName} to confirm` : "Waiting for you to confirm",
      tone: "warn" as const,
    };
  })();

  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div
        className={`w-[78%] max-w-[300px] rounded-[22px] px-4 pt-3 pb-2.5 ${
          mine ? "bg-[var(--brand-solid)] text-white" : "bg-[var(--surface)]"
        }`}
      >
        <p className={`text-[13px] ${mine ? "text-white/80" : "text-[var(--text-secondary)]"}`}>
          {mine ? `You paid ${otherName}` : `${otherName} paid you`}
        </p>
        <p
          className={`text-[34px] leading-[40px] font-bold tracking-[-0.025em] t-numeral ${
            mine ? "text-white" : "text-[var(--text-primary)]"
          }`}
        >
          {formatCurrency(t.amount)}
        </p>
        {t.note && (
          <p className={`text-[15px] mt-0.5 selectable ${mine ? "text-white/90" : "text-[var(--text-primary)]"}`}>
            {t.note}
          </p>
        )}
        <p
          className={`text-[13px] mt-1.5 font-medium ${
            mine
              ? "text-white/85"
              : status.tone === "good"
              ? "text-[var(--pos)]"
              : status.tone === "bad"
              ? "text-[var(--neg)]"
              : status.tone === "warn"
              ? "text-[var(--warning)]"
              : "text-[var(--text-tertiary)]"
          }`}
        >
          {status.text}
        </p>

        {t.receiptUrls.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-1.5">
            {t.receiptUrls.map((url, i) => (
              <a
                key={url}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className={`text-[12px] font-medium underline ${
                  mine ? "text-white/90" : "text-[var(--brand)]"
                }`}
              >
                Screenshot {i + 1}
              </a>
            ))}
          </div>
        )}

        {/* The receiver's decision, and the sender's escape hatch. */}
        {!mine && t.status === "pending" && (
          <button
            onClick={() => onDecide(t)}
            className="btn-prominent btn-small w-full mt-2.5"
          >
            Confirm &amp; Choose a Group
          </button>
        )}
        {!mine && broken.length > 0 && (
          <button
            onClick={() => onRepair(t)}
            className="btn-small w-full mt-2.5 rounded-full bg-[var(--tint-warning)] text-[var(--warning)] font-semibold tap-shrink"
          >
            Finish Recording This Payment
          </button>
        )}
        {/* Still offered once part of the payment is booked: the remainder can
            go to another group whenever a new balance shows up there. */}
        {!mine && t.status === "accepted" && !isSettled(unassigned) && canAttach && (
          <button
            onClick={() => onDecide(t)}
            className="btn-gray btn-small w-full mt-2.5"
          >
            {legs.length === 0
              ? "Attach to a Group"
              : `Assign remaining ${formatCurrency(unassigned)}`}
          </button>
        )}
        {mine && t.status === "pending" && (
          <button
            onClick={() => onCancel(t)}
            className="btn-small w-full mt-2.5 rounded-full bg-white/20 text-white font-semibold tap-shrink"
          >
            Withdraw
          </button>
        )}
        {mine &&
          t.status === "accepted" &&
          legs.map((leg) => (
            <button
              key={leg.settlementId}
              onClick={() =>
                onNavigate(
                  groupItemLink(leg.groupId, { kind: "settlement", id: leg.settlementId })
                )
              }
              className="btn-small w-full mt-2.5 rounded-full bg-white/20 text-white font-semibold tap-shrink"
            >
              View {formatCurrency(leg.amount)} in {groupNameOf(leg.groupId)}
            </button>
          ))}
        <p className={`text-[11px] mt-1.5 text-right ${mine ? "text-white/65" : "text-[var(--text-secondary)]"}`}>
          {timeLabel(item.ts)}
        </p>
      </div>
    </div>
  );
}

function SettlementBubble({
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
        onClick={() =>
          item.groupId &&
          onNavigate(groupItemLink(item.groupId, { kind: "settlement", id: s.id }))
        }
        className={`w-[72%] max-w-[280px] text-left rounded-[22px] px-4 py-3 tap-shrink ${
          mine ? "bg-[var(--tint-accent-2)]" : "bg-[var(--surface)]"
        }`}
      >
        <p className="text-[13px] text-[var(--text-secondary)] truncate">
          {isOffset
            ? `Offset · ${item.groupName}`
            : mine
            ? `You paid ${otherName} · ${item.groupName}`
            : `${otherName} paid you · ${item.groupName}`}
        </p>
        <p className="text-[22px] leading-[28px] font-bold t-numeral text-[var(--text-primary)]">
          {formatCurrency(s.amount)}
        </p>
        {s.note && (
          <p className="text-[15px] text-[var(--text-primary)] mt-0.5">{s.note}</p>
        )}
        <p
          className={`text-[13px] mt-1 font-medium ${
            s.status === "approved"
              ? "text-[var(--pos)]"
              : s.status === "rejected"
              ? "text-[var(--neg)]"
              : "text-[var(--warning)]"
          }`}
        >
          {statusText}
        </p>
        <p className="text-[11px] text-[var(--text-secondary)] mt-1 text-right">{timeLabel(item.ts)}</p>
      </button>
    </div>
  );
}

function ExpenseRow({
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
  const yourShare = item.myShare ?? 0;
  const theirShare = item.theirShare ?? 0;
  return (
    <div className="flex justify-center">
      <button
        onClick={() =>
          item.groupId && onNavigate(groupItemLink(item.groupId, { kind: "expense", id: e.id }))
        }
        className="max-w-[88%] text-center px-3 py-1 tap-shrink"
      >
        <p className="text-[12px] leading-[16px] text-[var(--text-secondary)]">
          <span className="font-semibold">{payerIsMe ? "You" : otherName}</span> paid{" "}
          {formatCurrency(e.amount)} for{" "}
          <span className="font-semibold">{e.description}</span> · {item.groupName} ·{" "}
          {payerIsMe
            ? `their share ${formatCurrency(theirShare)}`
            : `your share ${formatCurrency(yourShare)}`}
        </p>
      </button>
    </div>
  );
}

function MessageBubble({ item }: { item: ConversationItem }) {
  const mine = item.side === "me";
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[75%] flex flex-col ${mine ? "items-end" : "items-start"}`}>
        <div
          className={`rounded-[19px] px-3.5 py-[7px] ${
            mine ? "bg-[var(--brand-solid)] text-white" : "bg-[var(--surface)] text-[var(--text-primary)]"
          }`}
        >
          <p className="text-[17px] leading-[22px] tracking-[-0.01em] whitespace-pre-wrap break-words selectable">{item.message!.text}</p>
        </div>
        <time dateTime={new Date(item.ts).toISOString()} className="text-[11px] leading-[14px] text-[var(--text-secondary)] mt-0.5 px-1.5">
          {timeLabel(item.ts)}
        </time>
      </div>
    </div>
  );
}

export default function ChatPage() {
  // useSearchParams needs a Suspense boundary above it, same as the group screen.
  return (
    <Suspense fallback={<ChatSkeleton />}>
      <ChatPageInner />
    </Suspense>
  );
}

function ChatPageInner() {
  const { uid: otherUid } = useParams<{ uid: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading } = useAuth();
  const { datasets, groupsLoaded } = useGroupData();
  const { transfers, threadWith, unattributed } = usePayments();
  const showToast = useToast();
  const goBack = useBack("/pay");

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [showPay, setShowPay] = useState(searchParams.get("pay") === "1");
  const [decide, setDecide] = useState<DirectTransfer | null>(null);
  // Someone with no shared group (they left every group you share) still has a
  // history worth reading, so the name falls back to their user document.
  const [fallbackProfile, setFallbackProfile] = useState<{
    displayName: string;
    photoURL?: string;
    upiId?: string;
  } | null>(null);

  const meUid = user?.uid;
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!meUid || !otherUid) return;
    return subscribeToMessages(threadIdFor(meUid, otherUid), setMessages);
  }, [meUid, otherUid]);

  const counterparty = useMemo(() => {
    if (!meUid) return undefined;
    return computeCounterpartyBalances(meUid, datasets, transfers).find((c) => c.uid === otherUid);
  }, [meUid, datasets, transfers, otherUid]);

  // Transfer-only counterparties carry no profile (displayName "Member"), so
  // still resolve the real name from their user document.
  const needsProfile =
    !counterparty || !counterparty.displayName || counterparty.displayName === "Member";

  useEffect(() => {
    if (!otherUid || !needsProfile || !groupsLoaded) return;
    let cancelled = false;
    getUserProfile(otherUid).then((p) => {
      if (cancelled || !p) return;
      setFallbackProfile({
        displayName: p.displayName || "Someone",
        photoURL: p.photoURL,
        upiId: p.upiId,
      });
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

  // Mark read whenever the newest message the other person sent changes, rather
  // than on every render — this is a Firestore write.
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
    () =>
      new Map(
        datasets.map((d) => [d.group.id, new Set(d.settlements.map((s) => s.id))] as const)
      ),
    [datasets]
  );

  const attachableIds = new Set(unattributed.map((t) => t.id));

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
          repaired > 0
            ? `Recorded ${repaired} missing ${repaired === 1 ? "entry" : "entries"}`
            : "Already up to date",
      });
    } catch (err) {
      showToast({
        message: err instanceof Error ? `Couldn't finish recording: ${err.message}` : "Couldn't finish recording",
      });
    }
  }
  const navigate = (href: string) => router.push(href);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
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
      showToast({
        message: err instanceof Error ? `Couldn't send: ${err.message}` : "Couldn't send",
      });
    } finally {
      setSending(false);
    }
  }

  async function handleCancelTransfer(t: DirectTransfer) {
    try {
      await cancelTransfer(t);
      showToast({ message: "Payment withdrawn" });
    } catch (err) {
      showToast({
        message: err instanceof Error ? `Couldn't withdraw: ${err.message}` : "Couldn't withdraw",
      });
    }
  }

  return (
    <div className="fixed inset-0 flex flex-col bg-[var(--background)]">
      {/* Messages-style header: glass back button, centred avatar + name,
          balance as the subtitle. */}
      <header className="relative z-10 shrink-0 pt-[env(safe-area-inset-top)] pb-1.5">
        <div className="absolute inset-0 glass-strong !shadow-none border-b-[0.5px] border-[var(--separator)]" aria-hidden />
        <div className="relative max-w-md mx-auto px-4 h-[64px] grid grid-cols-[44px_1fr_44px] items-center gap-2">
          <BarButton onClick={goBack} aria-label="Back">
            <ChevronLeft size={22} />
          </BarButton>
          <div className="flex flex-col items-center min-w-0">
            <Avatar name={otherName} photoURL={otherPhoto} size={36} seed={otherUid} />
            <p className="text-[12px] leading-[15px] font-medium text-[var(--text-primary)] truncate max-w-full mt-0.5">{otherName}</p>
            <p
              className={`text-[11px] leading-[13px] truncate max-w-full ${
                iOwe ? "text-[var(--neg)]" : theyOwe ? "text-[var(--pos)]" : "text-[var(--text-secondary)]"
              }`}
            >
              {iOwe
                ? `You owe ${formatCurrency(net)}`
                : theyOwe
                ? `Owes you ${formatCurrency(-net)}`
                : counterparty
                ? "All settled up"
                : "No shared groups"}
            </p>
          </div>
          <span />
        </div>
      </header>

      <main className="flex-1 overflow-y-auto overscroll-contain scroll-momentum px-3 py-3">
        <div className="max-w-md mx-auto space-y-1.5">
          {items.length === 0 ? (
            <div className="flex flex-col items-center text-center px-8 pt-16">
              <Avatar name={otherName} photoURL={otherPhoto} size={72} seed={otherUid} />
              <p className="t-title3 text-[var(--text-primary)] mt-3">{otherName}</p>
              <p className="t-subhead text-[var(--text-secondary)] mt-1.5 max-w-[280px]">
                Send money or say hello. Every payment and settled balance between you shows up here.
              </p>
            </div>
          ) : (
            items.map((item, i) => {
              const label = dayLabel(item.ts);
              const showDay = i === 0 || dayLabel(items[i - 1].ts) !== label;
              return (
                <div key={item.key} className="space-y-1.5">
                  {showDay && (
                    <p className="text-center text-[12px] leading-[16px] text-[var(--text-secondary)] pt-3 pb-1">
                      <span className="font-semibold">{label}</span> {timeLabel(item.ts)}
                    </p>
                  )}
                  {item.kind === "message" && <MessageBubble item={item} />}
                  {item.kind === "transfer" && (
                    <TransferBubble
                      item={item}
                      otherName={otherName}
                      groupNameOf={groupNameOf}
                      settlementIdsByGroup={settlementIdsByGroup}
                      onDecide={setDecide}
                      onCancel={handleCancelTransfer}
                      onRepair={handleRepairTransfer}
                      onNavigate={navigate}
                      canAttach={attachableIds.has(item.transfer!.id)}
                    />
                  )}
                  {item.kind === "settlement" && (
                    <SettlementBubble item={item} otherName={otherName} onNavigate={navigate} />
                  )}
                  {item.kind === "expense" && (
                    <ExpenseRow item={item} meUid={currentUser.uid} otherName={otherName} onNavigate={navigate} />
                  )}
                </div>
              );
            })
          )}
          <div ref={bottomRef} />
        </div>
      </main>

      <form
        onSubmit={handleSend}
        className="relative shrink-0 px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
      >
        <div className="absolute inset-0 glass-strong !shadow-none border-t-[0.5px] border-[var(--separator)]" aria-hidden />
        <div className="relative max-w-md mx-auto flex items-end gap-2">
          <button
            type="button"
            onClick={() => setShowPay(true)}
            aria-label={`Pay ${otherName}`}
            className="w-9 h-9 mb-[2px] shrink-0 rounded-full bg-[var(--fill)] text-[var(--text-primary)] grid place-items-center tap-shrink"
          >
            <Rupee size={19} weight={2.1} />
          </button>
          <label className="flex-1 min-w-0 flex items-end rounded-[20px] bg-[var(--surface)] shadow-[0_0_0_0.5px_var(--separator)] pl-3.5 pr-1 py-1">
            <span className="sr-only">Message {otherName}</span>
            <textarea
              rows={1}
              value={draft}
              maxLength={MAX_MESSAGE_LENGTH}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                // Enter sends, Shift+Enter makes a new line.
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void handleSend(e as unknown as React.FormEvent);
                }
              }}
              placeholder="Message"
              className="flex-1 min-w-0 max-h-28 resize-none bg-transparent py-[5px] text-[17px] leading-[22px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none"
            />
            <button
              type="submit"
              disabled={!draft.trim() || sending}
              aria-label="Send message"
              className="w-[30px] h-[30px] shrink-0 rounded-full bg-[var(--brand-solid)] text-white grid place-items-center transition-opacity disabled:opacity-0"
            >
              <ArrowUp size={17} weight={2.8} />
            </button>
          </label>
        </div>
      </form>

      {showPay && (
        <SendMoneyModal
          fromUid={currentUser.uid}
          toUid={otherUid}
          toName={otherName}
          toUpiId={otherUpiId}
          suggestedAmount={iOwe ? net : 0}
          contextLine={
            iOwe
              ? `You owe ${otherName} ${formatCurrency(net)} across ${
                  counterparty?.groups.length ?? 0
                } group${(counterparty?.groups.length ?? 0) === 1 ? "" : "s"}`
              : theyOwe
              ? `${otherName} owes you ${formatCurrency(-net)} — you don't need to pay them`
              : undefined
          }
          onClose={() => {
            setShowPay(false);
            // Drop ?pay=1 so going back and forward doesn't reopen the sheet.
            if (searchParams.get("pay")) {
              router.replace(`/chat/${otherUid}`, { scroll: false });
            }
          }}
        />
      )}

      {decide && (
        <IncludeTransferSheet
          transfer={decide}
          meUid={currentUser.uid}
          fromName={otherName}
          datasets={datasets}
          onClose={() => setDecide(null)}
        />
      )}
    </div>
  );
}
