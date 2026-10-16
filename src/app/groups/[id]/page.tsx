"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { useAuth } from "@/lib/auth-context";
import { useSingleGroup } from "@/lib/group-data-context";
import {
  updateSettlementStatus,
  deleteExpense,
  deleteGroup,
  removeMember,
  addExpense,
  updateExpense,
  setGroupArchived,
} from "@/lib/firestore";
import { Expense, Settlement } from "@/lib/types";
import {
  activeExpenses as onlyActive,
  canRespondToSettlement,
  computeBalances,
  computeDirectDebts,
  computeSettlementProgress,
  rescaleSplits,
  simplifyDebts,
  splitEqually,
  formatCurrency,
  settlementCreator,
} from "@/lib/balance";
import { isSettled } from "@/lib/money";
import { isArchivedFor } from "@/lib/group-filters";
import { groupItemLink } from "@/lib/statement";
import { uploadMultipleReceipts } from "@/lib/storage";
import { showLocalNotification } from "@/lib/notifications";
import { useToast } from "@/components/ui/Toast";
import { hapticSuccess } from "@/lib/haptics";
import type { NewExpenseInput } from "@/components/AddExpenseModal";
import ActivityTimeline from "@/components/group/ActivityTimeline";
import GroupDetailSkeleton from "@/components/group/GroupDetailSkeleton";
import LoginScreen from "@/components/LoginScreen";
import Screen from "@/components/kit/Screen";
import { BarButton } from "@/components/kit/BarButton";
import { Menu, type MenuItem } from "@/components/kit/Menu";
import { Card, List, RowButton, Section } from "@/components/kit/List";
import { Avatar, AvatarStack } from "@/components/kit/Avatar";
import { GroupAvatar, IconTile } from "@/components/kit/Tile";
import { Button, EmptyState, Meter } from "@/components/kit/Controls";
import { ConfirmSheet } from "@/components/kit/ActionSheet";
import { useNav } from "@/components/kit/nav";

/**
 * Sheets load on demand, not with the screen: each sits behind a boolean and
 * is closed when the screen opens, and this is the heaviest route in the app.
 * `ssr: false` — client-only surfaces with nothing to render on the server.
 */
const AddExpenseModal = dynamic(() => import("@/components/AddExpenseModal"), { ssr: false });
const SettleUpModal = dynamic(() => import("@/components/SettleUpModal"), { ssr: false });
const ForwardModal = dynamic(() => import("@/components/ForwardModal"), { ssr: false });
const AddMemberModal = dynamic(() => import("@/components/group/AddMemberModal"), { ssr: false });
const ActivityDetailModal = dynamic(() => import("@/components/group/ActivityDetailModal"), { ssr: false });
const PersonStatementSheet = dynamic(() => import("@/components/group/PersonStatementSheet"), { ssr: false });
const InviteQrSheet = dynamic(() => import("@/components/group/InviteQrSheet"), { ssr: false });
const MembersSheet = dynamic(() => import("@/components/group/MembersSheet"), { ssr: false });
const EditGroupSheet = dynamic(() => import("@/components/group/EditGroupSheet"), { ssr: false });

function timeAgoShort(ts: number): string {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function createdAgoText(createdAt: number): string {
  const days = Math.max(0, Math.floor((Date.now() - createdAt) / 86400000));
  if (days === 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

type ConfirmState = {
  title: string;
  message?: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
};

function GroupPageInner() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const nav = useNav();
  const { user, loading } = useAuth();
  // Reads from the one shared subscription set instead of opening more
  // listeners every time this screen mounts.
  const { group, expenses, settlements, loading: groupLoading, notFound } = useSingleGroup(id);
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [settleTarget, setSettleTarget] = useState<{ toUid: string; amount: number } | null>(null);
  const [forwardTarget, setForwardTarget] = useState<Settlement | null>(null);
  const [sheet, setSheet] = useState<"members" | "invite" | "addMember" | "edit" | null>(null);
  // Which detail sheet is open lives in the URL, not in state: a notification
  // can point straight at one item, and closing is just a navigation.
  const searchParams = useSearchParams();
  const openExpenseId = searchParams.get("expense");
  const openSettlementId = searchParams.get("settlement");
  const missingDeepLinkRef = useRef<string | null>(null);
  // True when this screen pushed the ?expense= entry itself, so closing can
  // pop it instead of leaving a duplicate history entry behind.
  const detailPushedRef = useRef(false);
  // Which member's pairwise statement is open, by uid, so it follows live data.
  const [statementUid, setStatementUid] = useState<string | null>(null);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  // Expense ids hidden locally during the undo window (deferred-commit delete).
  const [pendingDeleteIds, setPendingDeleteIds] = useState<Set<string>>(new Set());
  const [optimisticExpenses, setOptimisticExpenses] = useState<Expense[]>([]);
  const [busySettlement, setBusySettlement] = useState<string | null>(null);
  const showToast = useToast();

  // A notification can outlive what it points at. Say so once instead of
  // opening an empty sheet or silently ignoring the link.
  useEffect(() => {
    const target = openExpenseId || openSettlementId;
    if (!target || groupLoading) return;
    if (missingDeepLinkRef.current === target) return;
    const found = openExpenseId
      ? expenses.some((e) => e.id === openExpenseId)
      : settlements.some((s) => s.id === openSettlementId);
    if (!found) {
      missingDeepLinkRef.current = target;
      showToast({ message: "That item isn\u2019t here any more.", tone: "info" });
    }
  }, [openExpenseId, openSettlementId, expenses, settlements, groupLoading, showToast]);

  if (loading) return <GroupDetailSkeleton />;
  // Was `null` — a blank screen — whenever auth hadn't resolved.
  if (!user) return <LoginScreen />;

  const currentUser = user;

  if (!group) {
    if (notFound) {
      return (
        <Screen title="" back="/" tabBar>
          <EmptyState
            icon="person.2"
            title="Group Not Available"
            message="It may have been deleted, or you may no longer be a member."
            action={
              <Button size="md" onClick={() => nav.back("/")}>
                Back to Groups
              </Button>
            }
          />
        </Screen>
      );
    }
    return <GroupDetailSkeleton />;
  }

  // Hold the skeleton until the first expense/settlement snapshot lands, so
  // balances never flash ₹0 before the real numbers arrive.
  if (groupLoading && expenses.length === 0 && settlements.length === 0) {
    return <GroupDetailSkeleton />;
  }

  const isAdmin = group.createdBy === currentUser.uid;
  const memberName = (uid: string) =>
    uid === currentUser.uid
      ? "You"
      : group?.members[uid]?.displayName ||
        // Someone removed can still appear in old expenses; "Unknown" made it
        // look like corrupt data.
        (group?.memberIds.includes(uid) ? "Member" : "Former member");

  // Merge optimistic (pending) expenses with live ones; an optimistic entry
  // hides as soon as a matching real one arrives, keyed by content.
  const realExpenseKeys = new Set(
    expenses.map((e) => `${e.createdBy}|${e.amount}|${e.description}|${e.paidBy}`)
  );
  const mergedExpenses = [
    ...optimisticExpenses.filter(
      (o) => !realExpenseKeys.has(`${o.createdBy}|${o.amount}|${o.description}|${o.paidBy}`)
    ),
    ...expenses,
  ];

  const detailExpense = openExpenseId
    ? mergedExpenses.find((e) => e.id === openExpenseId) ?? null
    : null;
  const detailSettlement = openSettlementId
    ? settlements.find((s) => s.id === openSettlementId) ?? null
    : null;
  const closeDetail = () => {
    if (detailPushedRef.current) {
      detailPushedRef.current = false;
      router.back();
    } else {
      router.replace(`/groups/${group.id}`, { scroll: false });
    }
  };
  const openExpense = (e: Expense) => {
    detailPushedRef.current = true;
    router.push(groupItemLink(group.id, { kind: "expense", id: e.id }), { scroll: false });
  };
  const openSettlement = (s: Settlement) => {
    detailPushedRef.current = true;
    router.push(groupItemLink(group.id, { kind: "settlement", id: s.id }), { scroll: false });
  };

  const iArchived = isArchivedFor(group, currentUser.uid);
  // Only deleted expenses leave the ledger; edited ones stay.
  const balanceExpenses = onlyActive(mergedExpenses).filter((e) => !pendingDeleteIds.has(e.id));
  const balances = computeBalances(group.memberIds, balanceExpenses, settlements);
  // Direct pairwise debts by default; simplification is opt-in per group
  // because it can route a debt through someone you never shared a bill with.
  const transactions = group.useSimplifiedDebts
    ? simplifyDebts(balances)
    : computeDirectDebts(group.memberIds, balanceExpenses, settlements);
  // People the current user owes (for the forward-payment flow).
  const myCreditors = transactions
    .filter((t) => t.fromUid === currentUser.uid)
    .map((t) => ({ uid: t.toUid, name: memberName(t.toUid), amount: t.amount }));

  function handleOpenSettle(toUid: string, amount: number) {
    setSettleTarget({ toUid, amount });
  }

  function getExpensesOwedTo(toUid: string): Expense[] {
    // Expenses already covered by a prior settlement to this person shouldn't
    // reappear (pending or approved both count; only rejected stay open).
    const settledExpenseIds = new Set<string>();
    settlements.forEach((s) => {
      if (s.fromUid === currentUser.uid && s.toUid === toUid && s.status !== "rejected") {
        (s.expenseIds || []).forEach((eid) => settledExpenseIds.add(eid));
      }
    });
    return onlyActive(expenses).filter((e) => {
      if (settledExpenseIds.has(e.id)) return false;
      const mySplit = e.splits.find((s) => s.uid === currentUser.uid);
      return e.paidBy === toUid && mySplit && mySplit.amount > 0;
    });
  }

  // These writes used to be fire-and-forget: a rejected write showed success
  // while the balance never changed.
  async function handleApproveSettlement(s: Settlement) {
    if (!group) return;
    setBusySettlement(s.id);
    try {
      await updateSettlementStatus(s.groupId || group.id, s.id, "approved");
      hapticSuccess();
      showToast({ message: `Approved ${formatCurrency(s.amount)} from ${memberName(s.fromUid)}` });
      showLocalNotification(
        "Settlement approved",
        `You approved ${formatCurrency(s.amount)} from ${memberName(s.fromUid)}`,
        `/groups/${group.id}`
      );
    } catch (err) {
      showToast({ message: err instanceof Error ? `Couldn't approve: ${err.message}` : "Couldn't approve" });
    } finally {
      setBusySettlement(null);
    }
  }

  async function handleRejectSettlement(s: Settlement) {
    if (!group) return;
    setBusySettlement(s.id);
    try {
      await updateSettlementStatus(s.groupId || group.id, s.id, "rejected");
      showToast({ message: "Request declined", tone: "info" });
    } catch (err) {
      showToast({ message: err instanceof Error ? `Couldn't decline: ${err.message}` : "Couldn't decline" });
    } finally {
      setBusySettlement(null);
    }
  }

  function handleDeleteGroup() {
    if (!group) return;
    setConfirmState({
      title: `Delete “${group.name}”?`,
      message: "This removes the group and its balances for everyone in it. This can't be undone.",
      confirmLabel: "Delete Group",
      destructive: true,
      onConfirm: async () => {
        await deleteGroup(group.id);
        setSheet(null);
        nav.back("/");
      },
    });
  }

  function handleRemoveMember(uid: string) {
    if (!group) return;
    const name = memberName(uid);
    const net = balances.find((b) => b.uid === uid)?.netAmount ?? 0;
    const warn = !isSettled(net)
      ? `\n\n${name} still has an unsettled balance of ${formatCurrency(
          Math.abs(net)
        )}. Removing them drops it from the group's balances.`
      : "";
    setConfirmState({
      title: `Remove ${name}?`,
      message: `${name} will no longer be part of “${group.name}”.${warn}`,
      confirmLabel: "Remove",
      destructive: true,
      onConfirm: () => removeMember(group.id, uid),
    });
  }

  function handleToggleArchive() {
    if (!group) return;
    const gid = group.id;
    const net = balances.find((b) => b.uid === currentUser.uid)?.netAmount ?? 0;
    const apply = async () => {
      try {
        await setGroupArchived(gid, currentUser.uid, !iArchived);
        showToast({ message: iArchived ? "Group restored" : "Group archived" });
      } catch (err) {
        showToast({
          message: err instanceof Error ? `Couldn't update: ${err.message}` : "Couldn't update the group",
        });
      }
    };
    // Archiving never writes off a debt, but it does move money somewhere the
    // user isn't looking, so say so first.
    if (!iArchived && !isSettled(net)) {
      setConfirmState({
        title: "Archive with an open balance?",
        message: `You still have an unsettled balance of ${formatCurrency(
          Math.abs(net)
        )} here. Archiving only tidies your Groups list — the balance stays and keeps counting in your totals. Only you see this.`,
        confirmLabel: "Archive Anyway",
        onConfirm: apply,
      });
      return;
    }
    void apply();
  }

  function handleLeaveGroup() {
    if (!group) return;
    const net = balances.find((b) => b.uid === currentUser.uid)?.netAmount ?? 0;
    const warn = !isSettled(net)
      ? `\n\nYou still have an unsettled balance of ${formatCurrency(Math.abs(net))} here.`
      : "";
    setConfirmState({
      title: `Leave “${group.name}”?`,
      message: `You'll be removed from this group.${warn}`,
      confirmLabel: "Leave Group",
      destructive: true,
      onConfirm: async () => {
        await removeMember(group.id, currentUser.uid);
        nav.back("/");
      },
    });
  }

  function handleDeleteExpense(expense: Expense) {
    if (!group) return;
    const gid = group.id;
    const eid = expense.id;
    const deletedBy = currentUser.uid;
    // Hide immediately; commit to Firestore only after the undo window.
    setPendingDeleteIds((prev) => new Set(prev).add(eid));
    const timer = setTimeout(() => {
      deleteExpense(gid, eid, deletedBy);
      showLocalNotification("Expense deleted", `${expense.description} was deleted by admin`, `/groups/${gid}`);
      // The id stays in pendingDeleteIds: the incoming editAction:"deleted"
      // keeps it hidden, so removing it here would only risk a flash.
    }, 5000);
    showToast({
      message: `“${expense.description}” deleted`,
      actionLabel: "Undo",
      duration: 5000,
      tone: "info",
      onAction: () => {
        clearTimeout(timer);
        setPendingDeleteIds((prev) => {
          const next = new Set(prev);
          next.delete(eid);
          return next;
        });
      },
    });
  }

  // Optimistic add: show the expense immediately, persist in the background,
  // and let the live listener reconcile (matching entries are de-duped above).
  async function handleAddExpense(input: NewExpenseInput) {
    if (!group) return;
    const gid = group.id;
    const uid = currentUser.uid;
    const tempId = `tmp-${Date.now()}`;
    const optimistic: Expense = {
      id: tempId,
      groupId: gid,
      description: input.description,
      amount: input.amount,
      paidBy: input.paidBy,
      splitType: "equal",
      splits: input.splits,
      receiptUrls: [],
      createdBy: uid,
      createdAt: Date.now(),
      category: input.category,
    };
    setOptimisticExpenses((prev) => [...prev, optimistic]);
    try {
      let receiptUrls: string[] = [];
      if (input.receiptFiles.length > 0) {
        receiptUrls = await uploadMultipleReceipts(gid, input.receiptFiles);
      }
      await addExpense(gid, {
        description: input.description,
        amount: input.amount,
        paidBy: input.paidBy,
        splitType: "equal",
        splits: input.splits,
        createdBy: uid,
        receiptUrls,
        category: input.category,
      });
      showToast({ message: `Expense added · ${formatCurrency(input.amount)}` });
      hapticSuccess();
    } catch {
      showToast({ message: "Couldn't add the expense — tap + to try again." });
    } finally {
      setOptimisticExpenses((prev) => prev.filter((x) => x.id !== tempId));
    }
  }

  async function handleSaveEditedExpense(input: NewExpenseInput) {
    if (!group || !editingExpense) return;
    const original = editingExpense;
    const gid = group.id;
    const sameMembers =
      original.splits.length === input.splitMemberIds.length &&
      original.splits.every((s) => input.splitMemberIds.includes(s.uid));
    // Preserve an uneven split's shape: only fall back to an equal split when
    // the people involved actually changed.
    const keepsUnevenSplit = sameMembers && original.splitType !== "equal";
    const splits = keepsUnevenSplit
      ? rescaleSplits(original.splits, input.amount)
      : splitEqually(input.amount, input.splitMemberIds);
    // The stored splitType has to follow the splits.
    const splitType = keepsUnevenSplit ? original.splitType : "equal";
    setEditingExpense(null);
    try {
      let receiptUrls: string[] | undefined;
      if (input.receiptFiles.length > 0) {
        const uploaded = await uploadMultipleReceipts(gid, input.receiptFiles);
        receiptUrls = [...(original.receiptUrls || []), ...uploaded];
      }
      await updateExpense(
        gid,
        original.id,
        {
          description: input.description,
          amount: input.amount,
          paidBy: input.paidBy,
          category: input.category,
          splitType,
          splits,
          receiptUrls,
        },
        currentUser.uid
      );
      showToast({ message: "Expense updated" });
      hapticSuccess();
    } catch (err) {
      showToast({
        message: err instanceof Error ? `Couldn't save: ${err.message}` : "Couldn't save the changes",
      });
    }
  }

  const visibleExpenses = balanceExpenses;
  const totalSpent = visibleExpenses.reduce((sum, e) => sum + e.amount, 0);
  const expenseCount = visibleExpenses.length;

  // Settlement progress is measured in money, not in tagged expenses.
  const progress = computeSettlementProgress(group.memberIds, visibleExpenses, settlements);

  const lastActivityItem = [
    ...visibleExpenses.map((e) => ({
      ts: e.updatedAt || e.createdAt,
      label: `${e.description} ${e.editAction === "edited" ? "updated" : "added"}`,
    })),
    ...settlements.map((s) => ({
      ts: s.updatedAt || s.createdAt,
      label: s.kind === "offset" ? "balances offset" : "payment logged",
    })),
  ].sort((a, b) => b.ts - a.ts)[0];

  // Largest single debt the current user owes drives the balance card.
  const myDebts = transactions
    .filter((t) => t.fromUid === currentUser.uid)
    .sort((a, b) => b.amount - a.amount);
  const myCredits = transactions
    .filter((t) => t.toUid === currentUser.uid)
    .sort((a, b) => b.amount - a.amount);
  const topDebt = myDebts[0];
  const topCredit = myCredits[0];

  // Current members always show; people who've left only while they still
  // carry a balance, so their share of the ledger stays visible.
  const memberBalances = [...balances]
    .filter((b) => group.memberIds.includes(b.uid) || !isSettled(b.netAmount))
    .sort((a, b) => b.netAmount - a.netAmount);

  // Records only the current user can answer — first, until answered.
  const waitingOnMe = settlements
    .filter((s) => canRespondToSettlement(s, currentUser.uid))
    .sort((a, b) => b.createdAt - a.createdAt);

  const menuItems: MenuItem[] = [
    { label: "Invite People", icon: "qrcode", onSelect: () => setSheet("invite") },
    { label: "Members", icon: "person.2", onSelect: () => setSheet("members") },
    ...(isAdmin ? [{ label: "Edit Group", icon: "pencil", onSelect: () => setSheet("edit") }] : []),
    "separator",
    {
      label: iArchived ? "Restore to Groups" : "Archive",
      subtitle: iArchived ? undefined : "Only hides it for you",
      icon: iArchived ? "archivebox.up" : "archivebox",
      onSelect: handleToggleArchive,
    },
    ...(!isAdmin
      ? [{ label: "Leave Group", icon: "leave", destructive: true, onSelect: handleLeaveGroup }]
      : []),
  ];

  const people = group.memberIds.map((uid) => ({
    id: uid,
    name: group.members[uid]?.displayName || "Member",
    photoURL: group.members[uid]?.photoURL,
  }));

  return (
    <Screen
      title={group.name}
      back="/"
      heroTitle
      tabBar
      trailing={
        <>
          <BarButton icon="plus" label="Add expense" onClick={() => setShowAddExpense(true)} />
          <Menu items={menuItems} title={group.name}>
            {(props) => <BarButton icon="ellipsis" label="Group options" {...props} />}
          </Menu>
        </>
      }
    >
      {/* Header */}
      <div className="flex flex-col items-center px-2 pb-1 pt-1 text-center">
        <GroupAvatar id={group.id} name={group.name} photoURL={group.photoURL} size={84} />
        <h2 data-hero-title className="t-title1 mt-3 max-w-full [overflow-wrap:anywhere]">{group.name}</h2>
        {group.description && <p className="t-subhead mt-0.5 text-label-2">{group.description}</p>}
        <div className="mt-2 flex items-center gap-2">
          <AvatarStack people={people} size={24} max={5} />
          <span className="t-footnote text-label-2">
            {group.memberIds.length} member{group.memberIds.length !== 1 ? "s" : ""} · Created{" "}
            {createdAgoText(group.createdAt)}
            {iArchived ? " · Archived" : ""}
          </span>
        </div>
      </div>

      {/* Balance card: the one money action this screen exists for. */}
      <Card className="mt-5 p-4">
        {topDebt ? (
          <>
            <p className="t-subhead text-label-2">You owe {memberName(topDebt.toUid)}</p>
            <p className="amount-hero mt-1 text-[34px] text-neg">{formatCurrency(topDebt.amount)}</p>
            {myDebts.length > 1 && (
              <p className="t-footnote mt-1 text-label-2">
                and {myDebts.length - 1} other{myDebts.length > 2 ? "s" : ""} — see Balances
              </p>
            )}
            <Button
              block
              className="mt-4"
              icon="banknote"
              onClick={() => handleOpenSettle(topDebt.toUid, topDebt.amount)}
            >
              Settle Up
            </Button>
          </>
        ) : topCredit ? (
          <>
            <p className="t-subhead text-label-2">{memberName(topCredit.fromUid)} owes you</p>
            <p className="amount-hero mt-1 text-[34px] text-pos">{formatCurrency(topCredit.amount)}</p>
            <p className="t-footnote mt-2 text-label-2">
              {myCredits.length > 1
                ? `${myCredits.length} people owe you here. Each one settles up from their phone.`
                : `Waiting for ${memberName(topCredit.fromUid)} to settle up.`}
            </p>
          </>
        ) : (
          <div className="flex items-center gap-3">
            <IconTile icon="checkmark" color="var(--green)" size="lg" />
            <div>
              <p className="t-headline">You&rsquo;re all settled up</p>
              <p className="t-subhead text-label-2">No outstanding balances in this group.</p>
            </div>
          </div>
        )}
      </Card>

      {/* Needs a decision from the current user. */}
      {waitingOnMe.length > 0 && (
        <Section header="Waiting on You">
          <List>
            {waitingOnMe.map((s) => {
              const isOffset = s.kind === "offset";
              const creator = settlementCreator(s);
              const text = isOffset
                ? `${memberName(creator)} wants to cancel out ${formatCurrency(s.amount)} between you`
                : s.fromUid === creator
                ? `${memberName(s.fromUid)} says they paid you ${formatCurrency(s.amount)}`
                : `${memberName(creator)} recorded your payment of ${formatCurrency(s.amount)}`;
              const busy = busySettlement === s.id;
              return (
                <div key={s.id} className="px-4 py-3" style={{ ["--sep-inset" as string]: "58px" }}>
                  <button type="button" onClick={() => openSettlement(s)} className="flex w-full items-start gap-3 text-left">
                    <IconTile icon={isOffset ? "arrow.left.right" : "clock"} color={isOffset ? "var(--indigo)" : "var(--orange)"} />
                    <span className="min-w-0 flex-1">
                      <span className="t-body block">{text}</span>
                      {s.note && <span className="t-subhead block truncate text-label-2">“{s.note}”</span>}
                    </span>
                  </button>
                  <div className="mt-3 flex gap-2 pl-[42px]">
                    <Button size="sm" busy={busy} onClick={() => handleApproveSettlement(s)}>
                      {isOffset ? "Accept" : "Approve"}
                    </Button>
                    {myCreditors.length > 0 && !isOffset && s.toUid === currentUser.uid && (
                      <Button size="sm" variant="gray" disabled={busy} onClick={() => setForwardTarget(s)}>
                        Forward
                      </Button>
                    )}
                    <Button size="sm" variant="gray" disabled={busy} onClick={() => handleRejectSettlement(s)}>
                      Decline
                    </Button>
                  </div>
                </div>
              );
            })}
          </List>
        </Section>
      )}

      {/* Summary */}
      <Section header="Summary">
        <Card className="p-4">
          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="t-footnote text-label-2">Total spent</p>
              <p className="num t-title2 truncate">{formatCurrency(totalSpent)}</p>
            </div>
            <p className="t-subhead shrink-0 text-label-2">
              {expenseCount} expense{expenseCount !== 1 ? "s" : ""}
            </p>
          </div>
          <div className="mt-4">
            <Meter value={progress.pct} label="Settled" />
            <div className="t-footnote mt-1.5 flex justify-between gap-3 text-label-2">
              <span>
                <span className="font-semibold text-label">{progress.pct}%</span> settled
              </span>
              <span className="truncate text-right">
                {progress.isEmpty
                  ? "Nothing to settle"
                  : isSettled(progress.outstanding)
                  ? "Everyone's square"
                  : `${formatCurrency(progress.outstanding)} still to move`}
              </span>
            </div>
          </div>
          <p className="t-footnote mt-3 truncate text-label-2">
            Last activity{" "}
            <span className="text-label">{lastActivityItem ? timeAgoShort(lastActivityItem.ts) : "—"}</span>
            {lastActivityItem ? ` · ${lastActivityItem.label}` : ""}
          </p>
        </Card>
      </Section>

      {/* Balances */}
      <Section header="Balances" footer={group.useSimplifiedDebts ? "Combine Payments is on: who pays whom is reshuffled for fewer transfers." : undefined}>
        <List>
          {memberBalances.map((b) => {
            const isMe = b.uid === currentUser.uid;
            const settled = isSettled(b.netAmount);
            const pos = !settled && b.netAmount > 0;
            const left = !group.memberIds.includes(b.uid);
            const name = isMe ? "You" : memberName(b.uid);
            const status = settled
              ? "Settled"
              : isMe
              ? pos
                ? "You get back"
                : "You owe"
              : pos
              ? "Gets back"
              : "Owes";
            const amount = (
              <span className={`num t-headline shrink-0 ${settled ? "text-label-3" : pos ? "text-pos" : "text-neg"}`}>
                {settled ? formatCurrency(0) : `${pos ? "+" : "−"}${formatCurrency(Math.abs(b.netAmount))}`}
              </span>
            );
            const common = {
              inset: "avatar" as const,
              leading: (
                <Avatar
                  name={isMe ? currentUser.displayName || "You" : group.members[b.uid]?.displayName || name}
                  photoURL={group.members[b.uid]?.photoURL}
                  size={40}
                />
              ),
              title: name,
              subtitle: left ? `${status} · Left the group` : status,
              trailing: amount,
            };
            // Your own row has no pairwise statement to show.
            return isMe ? (
              <div key={b.uid} className="row is-tall" style={{ ["--sep-inset" as string]: "68px" }}>
                {common.leading}
                <span className="row-main">
                  <span className="row-title font-semibold">{name}</span>
                  <span className="row-subtitle">{common.subtitle}</span>
                </span>
                {amount}
              </div>
            ) : (
              <RowButton
                key={b.uid}
                {...common}
                chevron
                onClick={() => setStatementUid(b.uid)}
                ariaLabel={`${name}, ${status} ${formatCurrency(Math.abs(b.netAmount))}. View statement`}
              />
            );
          })}
        </List>
      </Section>

      {group.memberIds.length === 1 && (
        <Section>
          <List>
            <RowButton
              onClick={() => setSheet("invite")}
              leading={<IconTile icon="qrcode" color="var(--blue)" />}
              title="Invite People"
              subtitle="Share a link or QR code to get the group started."
              chevron
            />
          </List>
        </Section>
      )}

      <ActivityTimeline
        expenses={mergedExpenses.filter((e) => !pendingDeleteIds.has(e.id))}
        settlements={settlements}
        memberName={memberName}
        currentUid={currentUser.uid}
        isAdmin={isAdmin}
        onDeleteExpense={handleDeleteExpense}
        onOpenExpense={openExpense}
        onOpenSettlement={openSettlement}
        emptyAction={
          <Button size="md" icon="plus" onClick={() => setShowAddExpense(true)}>
            Add Expense
          </Button>
        }
      />
      {isAdmin && expenseCount > 0 && (
        <p className="section-footer">Swipe left on an expense to delete it.</p>
      )}

      {showAddExpense && (
        <AddExpenseModal
          group={group}
          currentUid={currentUser.uid}
          onSubmit={handleAddExpense}
          onClose={() => setShowAddExpense(false)}
        />
      )}

      {settleTarget && (
        <SettleUpModal
          groupId={group.id}
          fromUid={currentUser.uid}
          toUid={settleTarget.toUid}
          toName={memberName(settleTarget.toUid)}
          toUpiId={group.members[settleTarget.toUid]?.upiId}
          suggestedAmount={settleTarget.amount}
          expensesOwed={getExpensesOwedTo(settleTarget.toUid)}
          onClose={() => setSettleTarget(null)}
        />
      )}

      {sheet === "invite" && (
        <InviteQrSheet groupName={group.name} inviteCode={group.inviteCode} onClose={() => setSheet(null)} />
      )}
      {sheet === "members" && (
        <MembersSheet
          group={group}
          currentUid={currentUser.uid}
          isAdmin={isAdmin}
          memberName={memberName}
          onInvite={() => setSheet("invite")}
          onAddMember={() => setSheet("addMember")}
          onRemove={handleRemoveMember}
          onClose={() => setSheet((s) => (s === "members" ? null : s))}
        />
      )}
      {sheet === "addMember" && (
        <AddMemberModal groupId={group.id} existingUids={group.memberIds} onClose={() => setSheet(null)} />
      )}
      {sheet === "edit" && (
        <EditGroupSheet
          group={group}
          onDelete={handleDeleteGroup}
          onClose={() => setSheet((s) => (s === "edit" ? null : s))}
        />
      )}

      {statementUid && (
        <PersonStatementSheet
          group={group}
          meUid={currentUser.uid}
          otherUid={statementUid}
          expenses={balanceExpenses}
          settlements={settlements}
          onClose={() => setStatementUid(null)}
          onSettle={handleOpenSettle}
        />
      )}
      {forwardTarget && (
        <ForwardModal
          groupId={group.id}
          meUid={currentUser.uid}
          incomingId={forwardTarget.id}
          incomingAmount={forwardTarget.amount}
          fromName={memberName(forwardTarget.fromUid)}
          creditors={myCreditors}
          onClose={() => setForwardTarget(null)}
        />
      )}

      {(detailExpense || detailSettlement) && (
        <ActivityDetailModal
          expense={detailExpense}
          settlement={detailSettlement}
          group={group}
          memberName={memberName}
          currentUid={currentUser.uid}
          isAdmin={isAdmin}
          canForward={myCreditors.length > 0}
          busy={detailSettlement ? busySettlement === detailSettlement.id : false}
          onEditExpense={(e) => setEditingExpense(e)}
          onDeleteExpense={handleDeleteExpense}
          onApprove={handleApproveSettlement}
          onReject={handleRejectSettlement}
          onForward={(s) => setForwardTarget(s)}
          onClose={closeDetail}
        />
      )}

      {editingExpense && (
        <AddExpenseModal
          group={group}
          currentUid={currentUser.uid}
          expense={editingExpense}
          onSubmit={handleSaveEditedExpense}
          onClose={() => setEditingExpense(null)}
        />
      )}
      {confirmState && (
        <ConfirmSheet
          title={confirmState.title}
          message={confirmState.message}
          confirmLabel={confirmState.confirmLabel}
          destructive={confirmState.destructive}
          onConfirm={confirmState.onConfirm}
          onClose={() => setConfirmState(null)}
        />
      )}
    </Screen>
  );
}

/**
 * `useSearchParams` makes everything below it client-rendered, so the tree is
 * wrapped in a Suspense boundary as the Next docs recommend. The fallback is
 * the same skeleton the page shows while its data loads.
 */
export default function GroupPage() {
  return (
    <Suspense fallback={<GroupDetailSkeleton />}>
      <GroupPageInner />
    </Suspense>
  );
}
