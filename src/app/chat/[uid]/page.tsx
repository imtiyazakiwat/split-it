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
import { buildConversation, ConversationItem } from "@/lib/conversation";
import { ChatMessage, DirectTransfer } from "@/lib/types";
import { getUserProfile } from "@/lib/firestore";
import LoginScreen from "@/components/LoginScreen";
import Skeleton from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import SendMoneyModal from "@/components/pay/SendMoneyModal";
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

function ChatSkeleton() {
  return (
    <div className="flex-1 max-w-md w-full mx-auto px-4 pt-[max(1rem,env(safe-area-inset-top))] space-y-3">
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-20 w-full" />
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className={`h-12 ${i % 2 ? "w-2/3 ml-auto" : "w-3/5"}`} />
      ))}
    </div>
  );
}

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
        className={`max-w-[85%] rounded-[var(--radius-inner)] p-3.5 ${
          mine
            ? "bg-[var(--brand-solid)] text-white"
            : "bg-[var(--surface)] shadow-[var(--shadow-sm)]"
        }`}
      >
        <p className={`text-[12px] ${mine ? "text-white/75" : "text-[var(--text-tertiary)]"}`}>
          {mine ? `You paid ${otherName}` : `${otherName} paid you`}
        </p>
        <p
          className={`text-[24px] font-extrabold leading-tight ${
            mine ? "text-white" : "text-[var(--text-primary)]"
          }`}
        >
          {formatCurrency(t.amount)}
        </p>
        {t.note && (
          <p className={`text-[13px] mt-0.5 ${mine ? "text-white/85" : "text-[var(--text-secondary)]"}`}>
            {t.note}
          </p>
        )}
        <p
          className={`text-[12px] mt-1.5 font-medium ${
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
            className="mt-2.5 w-full rounded-full bg-[var(--brand-solid)] text-white px-4 py-2 text-[13px] font-semibold tap-shrink"
          >
            Confirm &amp; choose a group
          </button>
        )}
        {!mine && broken.length > 0 && (
          <button
            onClick={() => onRepair(t)}
            className="mt-2.5 w-full rounded-full bg-[var(--tint-warning)] text-[var(--warning)] px-4 py-2 text-[13px] font-semibold tap-shrink"
          >
            Finish recording this payment
          </button>
        )}
        {/* Still offered once part of the payment is booked: the remainder can
            go to another group whenever a new balance shows up there. */}
        {!mine && t.status === "accepted" && !isSettled(unassigned) && (
          <button
            onClick={() => onDecide(t)}
            className="mt-2.5 w-full rounded-full bg-[var(--fill)] text-[var(--text-primary)] px-4 py-2 text-[13px] font-semibold tap-shrink"
          >
            {legs.length === 0
              ? "Attach to a group"
              : `Assign remaining ${formatCurrency(unassigned)}`}
          </button>
        )}
        {mine && t.status === "pending" && (
          <button
            onClick={() => onCancel(t)}
            className="mt-2.5 w-full rounded-full bg-white/20 text-white px-4 py-2 text-[13px] font-semibold tap-shrink"
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
              className="mt-2.5 w-full rounded-full bg-white/20 text-white px-4 py-2 text-[13px] font-semibold tap-shrink"
            >
              View {formatCurrency(leg.amount)} in {groupNameOf(leg.groupId)}
            </button>
          ))}
        <p className={`text-[11px] mt-1.5 ${mine ? "text-white/60" : "text-[var(--text-quaternary)]"}`}>
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
        className={`max-w-[85%] text-left rounded-[var(--radius-inner)] p-3.5 tap-shrink ${
          mine ? "bg-[var(--tint-accent-2)]" : "bg-[var(--surface)] shadow-[var(--shadow-sm)]"
        }`}
      >
        <p className="text-[12px] text-[var(--text-tertiary)]">
          {isOffset
            ? `Offset · ${item.groupName}`
            : mine
            ? `You paid ${otherName} · ${item.groupName}`
            : `${otherName} paid you · ${item.groupName}`}
        </p>
        <p className="text-[20px] font-bold text-[var(--text-primary)] leading-tight">
          {formatCurrency(s.amount)}
        </p>
        {s.note && (
          <p className="text-[13px] text-[var(--text-secondary)] mt-0.5">{s.note}</p>
        )}
        <p
          className={`text-[12px] mt-1 font-medium ${
            s.status === "approved"
              ? "text-[var(--pos)]"
              : s.status === "rejected"
              ? "text-[var(--neg)]"
              : "text-[var(--warning)]"
          }`}
        >
          {statusText}
        </p>
        <p className="text-[11px] text-[var(--text-quaternary)] mt-1">{timeLabel(item.ts)}</p>
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
        className="max-w-[92%] text-center rounded-full bg-[var(--fill-soft)] px-3.5 py-1.5 tap-shrink"
      >
        <p className="text-[12px] text-[var(--text-secondary)]">
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
      <div
        className={`max-w-[80%] rounded-[var(--radius-inner)] px-3.5 py-2.5 ${
          mine
            ? "bg-[var(--brand-solid)] text-white"
            : "bg-[var(--surface)] shadow-[var(--shadow-sm)] text-[var(--text-primary)]"
        }`}
      >
        <p className="text-[15px] whitespace-pre-wrap break-words">{item.message!.text}</p>
        <p className={`text-[11px] mt-1 ${mine ? "text-white/60" : "text-[var(--text-quaternary)]"}`}>
          {timeLabel(item.ts)}
        </p>
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
  const { transfers, threadWith } = usePayments();
  const showToast = useToast();

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
      <header className="shrink-0 px-4 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2 glass-strong">
        <div className="max-w-md mx-auto flex items-center gap-3">
          <button
            onClick={() => router.push("/pay")}
            aria-label="Back"
            className="w-10 h-10 -ml-1 rounded-full flex items-center justify-center tap-shrink shrink-0"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
          {otherPhoto ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={otherPhoto} alt="" className="w-9 h-9 rounded-full object-cover shrink-0" />
          ) : (
            <span className="w-9 h-9 rounded-full bg-[var(--fill)] flex items-center justify-center shrink-0 text-[13px] font-semibold text-[var(--text-secondary)]">
              {otherName.charAt(0).toUpperCase()}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-[16px] font-bold text-[var(--text-primary)] truncate">{otherName}</p>
            <p
              className={`text-[12px] font-medium truncate ${
                iOwe
                  ? "text-[var(--neg)]"
                  : theyOwe
                  ? "text-[var(--pos)]"
                  : "text-[var(--text-tertiary)]"
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
        </div>
      </header>

      <main className="flex-1 overflow-y-auto scroll-momentum px-4 py-3">
        <div className="max-w-md mx-auto space-y-2">
          {items.length === 0 ? (
            <div className="rounded-[var(--radius-card)] bg-[var(--tint-accent)] p-5 text-center mt-6">
              <p className="text-[16px] font-bold text-[var(--text-primary)]">
                Nothing between you two yet
              </p>
              <p className="text-[13px] text-[var(--text-tertiary)] mt-1">
                Send {otherName} money, or say hello. Every payment and settled
                balance shows up here.
              </p>
            </div>
          ) : (
            items.map((item, i) => {
              const label = dayLabel(item.ts);
              const showDay = i === 0 || dayLabel(items[i - 1].ts) !== label;
              return (
                <div key={item.key} className="space-y-2">
                  {showDay && (
                    <div className="flex justify-center py-1">
                      <span className="rounded-full bg-[var(--fill)] px-3 py-0.5 text-[11px] font-semibold text-[var(--text-secondary)]">
                        {label}
                      </span>
                    </div>
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
                    />
                  )}
                  {item.kind === "settlement" && (
                    <SettlementBubble item={item} otherName={otherName} onNavigate={navigate} />
                  )}
                  {item.kind === "expense" && (
                    <ExpenseRow
                      item={item}
                      meUid={currentUser.uid}
                      otherName={otherName}
                      onNavigate={navigate}
                    />
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
        className="shrink-0 px-4 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] glass-strong"
      >
        <div className="max-w-md mx-auto flex items-end gap-2">
          <button
            type="button"
            onClick={() => setShowPay(true)}
            aria-label={`Pay ${otherName}`}
            className="w-11 h-11 shrink-0 rounded-full bg-[var(--brand-solid)] text-white flex items-center justify-center tap-shrink font-bold text-[18px]"
          >
            ₹
          </button>
          <label className="flex-1">
            <span className="sr-only">Message {otherName}</span>
            <textarea
              rows={1}
              value={draft}
              maxLength={MAX_MESSAGE_LENGTH}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                // Enter sends, Shift+Enter makes a new line — the convention
                // people already have from every other messaging app.
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void handleSend(e as unknown as React.FormEvent);
                }
              }}
              placeholder="Message"
              className="w-full max-h-28 resize-none rounded-[var(--radius-xl)] border border-[var(--border-subtle)] bg-[var(--surface)] px-4 py-2.5 text-[15px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none focus:border-[var(--accent)]"
            />
          </label>
          <button
            type="submit"
            disabled={!draft.trim() || sending}
            aria-label="Send message"
            className="w-11 h-11 shrink-0 rounded-full bg-[var(--fill)] text-[var(--brand)] flex items-center justify-center tap-shrink disabled:opacity-40"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 2 11 13M22 2l-7 20-4-9-9-4z" />
            </svg>
          </button>
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
