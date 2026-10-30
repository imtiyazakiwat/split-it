"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useSingleGroup } from "@/lib/group-data-context";
import {
  updateGroupProfile,
  updateSettlementStatus,
  updateExpense,
  deleteExpense,
  deleteGroup,
  removeMember,
  addExpense,
  setGroupArchived,
} from "@/lib/firestore";
import { Expense, Settlement } from "@/lib/types";
import {
  activeExpenses as onlyActive,
  computeBalances,
  computeDirectDebts,
  computeSettlementProgress,
  rescaleSplits,
  simplifyDebts,
  splitEqually,
  formatCurrency,
} from "@/lib/balance";
import { isSettled } from "@/lib/money";
import { isArchivedFor } from "@/lib/group-filters";
import { groupItemLink } from "@/lib/statement";
import { uploadImage, uploadMultipleReceipts } from "@/lib/storage";
import GlassModal from "@/components/ui/GlassModal";
import Screen, { BarButton } from "@/components/ui/Screen";
import Menu from "@/components/ui/Menu";
import { ButtonRow, FieldRow, IconTile, ListSection, Row } from "@/components/ui/List";
import { Avatar, AvatarStack, EmptyState, Switch } from "@/components/ui/Controls";
import { Archive, Camera, Ellipsis, Leave, Pencil, People, PersonAdd, Plus, Qr, Trash } from "@/components/ui/Icons";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { hapticSuccess } from "@/lib/haptics";
import { activateFileInputOnKey } from "@/lib/keyboard";
import dynamic from "next/dynamic";
import type { NewExpenseInput } from "@/components/AddExpenseModal";

/**
 * Sheets are loaded on demand, not with the screen.
 *
 * Every one of these sits behind a boolean or a null check and is closed when
 * the screen opens, yet all seven were statically imported — so opening a group
 * downloaded and parsed the code for all of them, plus `qrcode` (pulled in by
 * InviteQrSheet), before anything could paint. This is the heaviest route in the
 * app, so it is the one where that mattered most.
 *
 * `ssr: false` because these are client-only surfaces; there is nothing useful
 * to render for them on the server, and it keeps them out of the SSR pass.
 */
const AddExpenseModal = dynamic(() => import("@/components/AddExpenseModal"), { ssr: false });
const SettleUpModal = dynamic(() => import("@/components/SettleUpModal"), { ssr: false });
const ForwardModal = dynamic(() => import("@/components/ForwardModal"), { ssr: false });
const AddMemberModal = dynamic(() => import("@/components/group/AddMemberModal"), { ssr: false });
const ActivityDetailModal = dynamic(() => import("@/components/group/ActivityDetailModal"), { ssr: false });
const PersonStatementSheet = dynamic(() => import("@/components/group/PersonStatementSheet"), { ssr: false });
const InviteQrSheet = dynamic(() => import("@/components/group/InviteQrSheet"), { ssr: false });
import ActivityTimeline from "@/components/group/ActivityTimeline";
import GroupDetailSkeleton from "@/components/group/GroupDetailSkeleton";
import LoginScreen from "@/components/LoginScreen";

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

function GroupPageInner() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user, loading } = useAuth();
  // Reads from the one shared subscription set instead of opening three more
  // listeners every time this screen mounts.
  const { group, expenses, settlements, loading: groupLoading, notFound } = useSingleGroup(id);
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [settleTarget, setSettleTarget] = useState<{ toUid: string; amount: number } | null>(null);
  const [forwardTarget, setForwardTarget] = useState<Settlement | null>(null);
  const [showGroupInfo, setShowGroupInfo] = useState(false);
  const [showAddMember, setShowAddMember] = useState(false);
  // Which detail sheet is open lives in the URL, not in state: a
  // notification can then point straight at one item, and closing the sheet
  // is just a navigation. `?expense=` / `?settlement=` carry the id.
  const searchParams = useSearchParams();
  const openExpenseId = searchParams.get("expense");
  const openSettlementId = searchParams.get("settlement");
  const missingDeepLinkRef = useRef<string | null>(null);
  // Which member's pairwise statement is open. Held by uid so the sheet
  // follows live data instead of a snapshot taken at tap time.
  const [statementUid, setStatementUid] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [showEditGroup, setShowEditGroup] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editUseSimplified, setEditUseSimplified] = useState(false);
  const [editPhotoFile, setEditPhotoFile] = useState<File | null>(null);
  const [editPhotoPreview, setEditPhotoPreview] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState("");
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [confirmState, setConfirmState] = useState<{
    title: string;
    message?: string;
    confirmLabel: string;
    destructive?: boolean;
    onConfirm: () => void | Promise<void>;
  } | null>(null);
  // Expense ids hidden locally during the undo window (deferred-commit delete).
  const [pendingDeleteIds, setPendingDeleteIds] = useState<Set<string>>(new Set());
  const [optimisticExpenses, setOptimisticExpenses] = useState<Expense[]>([]);
  const showToast = useToast();

  // A notification can outlive the thing it points at — the expense gets
  // deleted, or the settlement belongs to a group you have since left. Say so
  // once instead of opening an empty sheet or silently ignoring the link.
  useEffect(() => {
    const target = openExpenseId || openSettlementId;
    if (!target || groupLoading) return;
    if (missingDeepLinkRef.current === target) return;
    const found = openExpenseId
      ? expenses.some((e) => e.id === openExpenseId)
      : settlements.some((s) => s.id === openSettlementId);
    if (!found) {
      missingDeepLinkRef.current = target;
      showToast({ message: "That item isn\u2019t here any more." });
    }
  }, [openExpenseId, openSettlementId, expenses, settlements, groupLoading, showToast]);


  if (loading) return <GroupDetailSkeleton />;
  // Previously rendered `null`, i.e. a blank white screen, whenever auth hadn't
  // resolved — the most visible symptom of the Android sign-in problem.
  if (!user) return <LoginScreen />;

  const currentUser = user;

  if (!group) {
    if (notFound) {
      return (
        <Screen title="Group" backHref="/">
          <EmptyState
            icon={<People size={56} weight={1.4} />}
            title="Group Unavailable"
            message="It may have been deleted, or you may no longer be a member."
            action={
              <button onClick={() => router.push("/")} className="btn-prominent">
                Back to Groups
              </button>
            }
          />
        </Screen>
      );
    }
    return <GroupDetailSkeleton />;
  }

  // Hold the skeleton until the first expense/settlement snapshot lands, so the
  // stats and balances never flash ₹0 before the real numbers arrive.
  if (groupLoading && expenses.length === 0 && settlements.length === 0) {
    return <GroupDetailSkeleton />;
  }

  const isAdmin = group.createdBy === currentUser.uid;
  const memberName = (uid: string) =>
    uid === currentUser.uid
      ? "You"
      : group?.members[uid]?.displayName ||
        // Someone who was removed can still appear in old expenses; naming them
        // "Unknown" made it look like corrupt data.
        (group?.memberIds.includes(uid) ? "Member" : "Former member");

  // Merge optimistic (pending) expenses with the live ones. An optimistic entry
  // is hidden as soon as a matching real expense arrives (Firestore delivers our
  // own write near-instantly via latency compensation), keyed by content — this
  // avoids both a duplicate flash and a gap during reconciliation.
  const realExpenseKeys = new Set(
    expenses.map((e) => `${e.createdBy}|${e.amount}|${e.description}|${e.paidBy}`)
  );
  const mergedExpenses = [
    ...optimisticExpenses.filter(
      (o) => !realExpenseKeys.has(`${o.createdBy}|${o.amount}|${o.description}|${o.paidBy}`)
    ),
    ...expenses,
  ];

  // Only deleted expenses leave the ledger. Filtering on any `editAction` (as
  // before) dropped every *edited* expense from the balances, so amounts drifted
  // apart from reality the moment anyone corrected an entry.
  const detailExpense = openExpenseId
    ? mergedExpenses.find((e) => e.id === openExpenseId) ?? null
    : null;
  const detailSettlement = openSettlementId
    ? settlements.find((s) => s.id === openSettlementId) ?? null
    : null;
  const closeDetail = () => router.replace(`/groups/${group.id}`, { scroll: false });
  const openExpense = (e: Expense) =>
    router.push(groupItemLink(group.id, { kind: "expense", id: e.id }), { scroll: false });
  const openSettlement = (s: Settlement) =>
    router.push(groupItemLink(group.id, { kind: "settlement", id: s.id }), { scroll: false });

  const iArchived = isArchivedFor(group, currentUser.uid);
  const balanceExpenses = onlyActive(mergedExpenses).filter((e) => !pendingDeleteIds.has(e.id));
  const balances = computeBalances(group.memberIds, balanceExpenses, settlements);
  // Direct pairwise debts by default: you only ever owe the people you
  // actually shared expenses with, which is the figure people can check
  // against their own memory. Simplification is opt-in per group because it
  // routes debts through third parties — fewer transfers, but it can tell you
  // to pay someone you never shared a bill with.
  const transactions = group.useSimplifiedDebts
    ? simplifyDebts(balances)
    : computeDirectDebts(group.memberIds, balanceExpenses, settlements);
  // People the current user owes (used for the "forward payment" flow).
  const myCreditors = transactions
    .filter((t) => t.fromUid === currentUser.uid)
    .map((t) => ({ uid: t.toUid, name: memberName(t.toUid), amount: t.amount }));

  function handleOpenSettle(toUid: string, amount: number) {
    setSettleTarget({ toUid, amount });
  }

  function getExpensesOwedTo(toUid: string): Expense[] {
    if (!group) return [];
    // Expenses already covered by a prior settlement to this person shouldn't
    // reappear in the picker (pending or approved requests both count; only
    // rejected ones are still outstanding).
    const settledExpenseIds = new Set<string>();
    settlements.forEach((s) => {
      if (
        s.fromUid === currentUser.uid &&
        s.toUid === toUid &&
        s.status !== "rejected"
      ) {
        (s.expenseIds || []).forEach((id) => settledExpenseIds.add(id));
      }
    });
    return onlyActive(expenses).filter((e) => {
      if (settledExpenseIds.has(e.id)) return false;
      const mySplit = e.splits.find((s) => s.uid === currentUser.uid);
      return e.paidBy === toUid && mySplit && mySplit.amount > 0;
    });
  }

  async function respondToSettlement(s: Settlement, status: "approved" | "rejected") {
    if (!group) return;
    await updateSettlementStatus(s.groupId || group.id, s.id, status);
  }

  // These writes were fire-and-forget: a rejected write (e.g. a rules failure)
  // showed a success toast while the balance silently never changed.
  async function handleApproveSettlement(s: Settlement) {
    if (!group) return;
    try {
      await respondToSettlement(s, "approved");
      // The toast is the confirmation. This used to also raise a system
      // notification telling the user about the tap they had just made — noise
      // on desktop, and on Android `new Notification()` throws outright.
      showToast({
        message: `Approved ${formatCurrency(s.amount)} from ${memberName(s.fromUid)}`,
      });
    } catch (err) {
      showToast({
        message: err instanceof Error ? `Couldn't approve: ${err.message}` : "Couldn't approve",
      });
    }
  }

  async function handleRejectSettlement(s: Settlement) {
    if (!group) return;
    try {
      await respondToSettlement(s, "rejected");
      showToast({ message: "Request declined" });
    } catch (err) {
      showToast({
        message: err instanceof Error ? `Couldn't decline: ${err.message}` : "Couldn't decline",
      });
    }
  }

  function handleDeleteGroup() {
    if (!group) return;
    setConfirmState({
      title: "Delete group?",
      message: `This removes “${group.name}” and its balances for everyone in it. This can't be undone.`,
      confirmLabel: "Delete",
      destructive: true,
      onConfirm: async () => {
        await deleteGroup(group.id);
        router.push("/");
      },
    });
  }

  function handleRemoveMember(uid: string) {
    if (!group) return;
    const name = memberName(uid);
    const net = balances.find((b) => b.uid === uid)?.netAmount ?? 0;
    const warn =
      !isSettled(net)
        ? `\n\nHeads up: ${name} still has an unsettled balance of ${formatCurrency(
            Math.abs(net)
          )}. Removing them drops it from the group's balances.`
        : "";
    setConfirmState({
      title: `Remove ${name}?`,
      message: `Remove ${name} from “${group.name}”?${warn}`,
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
        setShowGroupInfo(false);
        showToast({ message: iArchived ? "Group restored" : "Group archived" });
      } catch (err) {
        showToast({
          message: err instanceof Error ? `Couldn't update: ${err.message}` : "Couldn't update the group",
        });
      }
    };

    // Archiving never writes off a debt, but it does move the group somewhere
    // the user isn't looking, so say so plainly before hiding money.
    if (!iArchived && !isSettled(net)) {
      setConfirmState({
        title: "Archive with an open balance?",
        message: `You still have an unsettled balance of ${formatCurrency(
          Math.abs(net)
        )} here. Archiving only tidies your home screen — the balance stays, and it keeps counting towards your totals.`,
        confirmLabel: "Archive anyway",
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
      confirmLabel: "Leave",
      destructive: true,
      onConfirm: async () => {
        await removeMember(group.id, currentUser.uid);
        router.push("/");
      },
    });
  }

  function handleOpenEditGroup() {
    if (!group) return;
    setEditName(group.name);
    setEditDesc(group.description || "");
    setEditUseSimplified(group.useSimplifiedDebts === true);
    setEditPhotoPreview(group.photoURL || "");
    setEditPhotoFile(null);
    setShowEditGroup(true);
    setEditError("");
  }

  function handleEditPhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setEditPhotoFile(file);
    const reader = new FileReader();
    reader.onload = () => setEditPhotoPreview(reader.result as string);
    reader.readAsDataURL(file);
  }

  async function handleSaveGroupProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!group || !editName.trim()) {
      setEditError("Group name is required.");
      return;
    }
    setEditBusy(true);
    setEditError("");
    try {
      let photoURL = editPhotoPreview || undefined;
      if (editPhotoFile) {
        photoURL = await uploadImage(editPhotoFile, "group-avatar");
      }
      await updateGroupProfile(group.id, {
        name: editName.trim(),
        description: editDesc.trim() || undefined,
        photoURL,
        useSimplifiedDebts: editUseSimplified,
      });
      showToast({ message: "Group updated" });
      setShowEditGroup(false);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Failed to update group");
    } finally {
      setEditBusy(false);
    }
  }


  function handleEditExpense(expense: Expense) {
    setEditingExpense(expense);
  }

  function handleDeleteExpense(expense: Expense) {
    if (!group) return;
    const gid = group.id;
    const id = expense.id;
    const deletedBy = currentUser.uid;
    // Hide immediately; commit to Firestore only after the undo window.
    setPendingDeleteIds((prev) => new Set(prev).add(id));
    const timer = setTimeout(() => {
      // Leave the id in pendingDeleteIds on success: the incoming
      // editAction:"deleted" keeps it hidden, and removing it here would only
      // risk a reappear flash. On failure it must come back, or the expense
      // looks deleted while still counting towards every balance.
      deleteExpense(gid, id, deletedBy).catch(() => {
        setPendingDeleteIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        showToast({ message: `Couldn't delete “${expense.description}” — it's back.` });
      });
    }, 5000);
    showToast({
      message: `“${expense.description}” deleted`,
      actionLabel: "Undo",
      duration: 5000,
      onAction: () => {
        clearTimeout(timer);
        setPendingDeleteIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      },
    });
  }

  // Optimistic add: show the expense immediately, persist in the background,
  // and let the live listener reconcile (matching entries are de-duped below).
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
      showToast({ message: "Couldn't add expense — tap + to retry." });
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
    // the people involved actually changed. Rescaling keeps each person's
    // proportion of a legacy exact/percentage expense intact.
    const keepsUnevenSplit = sameMembers && original.splitType !== "equal";
    const splits = keepsUnevenSplit
      ? rescaleSplits(original.splits, input.amount)
      : splitEqually(input.amount, input.splitMemberIds);
    // The stored splitType has to follow the splits. Leaving it alone meant an
    // expense that fell back to an equal split still read as "exact", so the
    // next edit would try to rescale amounts that were no longer uneven.
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

  // ── Derived stats for the header/summary cards ──
  const totalSpent = visibleExpenses.reduce((sum, e) => sum + e.amount, 0);
  const expenseCount = visibleExpenses.length;

  // Settlement progress is measured in money, not in "expenses that happen to
  // be tagged on a settlement". The old count relied on `expenseIds`, which is
  // only written when the payer manually ticks items, so a fully paid-up group
  // reported 0% settled while an empty group reported 100%.
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

  // Largest single debt the current user owes (drives the "You owe" hero).
  const myDebts = transactions
    .filter((t) => t.fromUid === currentUser.uid)
    .sort((a, b) => b.amount - a.amount);
  const myCredits = transactions
    .filter((t) => t.toUid === currentUser.uid)
    .sort((a, b) => b.amount - a.amount);
  const topDebt = myDebts[0];
  const topCredit = myCredits[0];

  // Per-member net balances for the balance chips (creditors first). Current
  // members always show; people who have left only appear while they still
  // carry a balance, so their share of the ledger stays visible.
  const memberBalances = [...balances]
    .filter((b) => group.memberIds.includes(b.uid) || !isSettled(b.netAmount))
    .sort((a, b) => b.netAmount - a.netAmount);

  const createdAgo = createdAgoText(group.createdAt);
  const memberPeople = group.memberIds.map((uid) => ({
    id: uid,
    name: group.members[uid]?.displayName || "Member",
    photoURL: group.members[uid]?.photoURL,
  }));
  const groupMenu = [
    { label: "Invite People", icon: <Qr size={20} />, onSelect: () => setShowInvite(true) },
    { label: "Group Info", icon: <People size={20} />, onSelect: () => setShowGroupInfo(true) },
    ...(isAdmin ? [{ label: "Edit Group", icon: <Pencil size={20} />, onSelect: handleOpenEditGroup }] : []),
    { divider: true as const },
    { label: iArchived ? "Restore Group" : "Archive Group", icon: <Archive size={20} />, onSelect: handleToggleArchive },
    ...(!isAdmin ? [{ label: "Leave Group", icon: <Leave size={20} />, destructive: true, onSelect: handleLeaveGroup }] : []),
  ];

  return (
    <Screen
      title={group.name}
      backHref="/"
      inlineTitleAfter={120}
      trailing={
        <>
          <Menu
            label="Group actions"
            items={groupMenu}
            trigger={(t) => (
              <BarButton {...t} aria-label="More">
                <Ellipsis size={21} />
              </BarButton>
            )}
          />
          <BarButton prominent onClick={() => setShowAddExpense(true)} aria-label="Add expense">
            <Plus size={21} />
          </BarButton>
        </>
      }
    >
      {/* Header (Contacts-style): photo, name, members. Tapping opens info. */}
      <button
        type="button"
        onClick={() => setShowGroupInfo(true)}
        className="w-full flex flex-col items-center text-center pt-1 pb-5"
        aria-label={`${group.name}, group info`}
      >
        <Avatar name={group.name} photoURL={group.photoURL} size={88} seed={group.id} />
        <h1 className="t-title1 text-[var(--text-primary)] mt-3 max-w-full truncate px-4">{group.name}</h1>
        <span className="mt-1.5 flex items-center gap-2 t-subhead text-[var(--text-secondary)]">
          <AvatarStack people={memberPeople} size={20} />
          {group.memberIds.length} {group.memberIds.length === 1 ? "member" : "members"} · Created {createdAgo}
        </span>
      </button>

      {/* Where you stand, and the one action that changes it. */}
      <div className="list-section px-4 pt-3.5 pb-4">
        {topDebt ? (
          <>
            <p className="t-subhead text-[var(--text-secondary)]">You owe {memberName(topDebt.toUid)}</p>
            <p className="t-large-title t-numeral text-[var(--neg)] truncate">{formatCurrency(topDebt.amount)}</p>
            {myDebts.length > 1 && (
              <p className="t-footnote text-[var(--text-secondary)]">
                and {myDebts.length - 1} other{myDebts.length > 2 ? "s" : ""} in this group
              </p>
            )}
            <button
              type="button"
              onClick={() => handleOpenSettle(topDebt.toUid, topDebt.amount)}
              className="btn-prominent w-full mt-3.5"
            >
              Settle Up
            </button>
          </>
        ) : topCredit ? (
          <>
            <p className="t-subhead text-[var(--text-secondary)]">{memberName(topCredit.fromUid)} owes you</p>
            <p className="t-large-title t-numeral text-[var(--pos)] truncate">{formatCurrency(topCredit.amount)}</p>
            <p className="t-footnote text-[var(--text-secondary)] mt-0.5">
              {myCredits.length > 1
                ? `${myCredits.length - 1} more ${myCredits.length > 2 ? "people owe" : "person owes"} you here.`
                : `Waiting for ${memberName(topCredit.fromUid)} to settle up.`}
            </p>
          </>
        ) : (
          <>
            <p className="t-subhead text-[var(--text-secondary)]">Your balance</p>
            <p className="t-title1 text-[var(--text-primary)]">All settled up</p>
          </>
        )}

        <div className="mt-4 pt-3.5 grid grid-cols-3 gap-2 relative before:absolute before:inset-x-0 before:top-0 before:h-[0.5px] before:bg-[var(--separator)]">
          <div className="min-w-0">
            <p className="t-caption text-[var(--text-secondary)]">Total spent</p>
            <p className="t-headline t-numeral text-[var(--text-primary)] truncate">{formatCurrency(totalSpent)}</p>
          </div>
          <div className="min-w-0">
            <p className="t-caption text-[var(--text-secondary)]">Expenses</p>
            <p className="t-headline t-numeral text-[var(--text-primary)]">{expenseCount}</p>
          </div>
          <div className="min-w-0">
            <p className="t-caption text-[var(--text-secondary)]">Last activity</p>
            <p className="t-headline text-[var(--text-primary)] truncate">
              {lastActivityItem ? timeAgoShort(lastActivityItem.ts) : "—"}
            </p>
          </div>
        </div>
        {!progress.isEmpty && (
          <div className="mt-3">
            <div className="flex items-baseline justify-between t-caption text-[var(--text-secondary)]">
              <span>
                {isSettled(progress.outstanding)
                  ? "Everyone is square"
                  : `${formatCurrency(progress.outstanding)} still to settle`}
              </span>
              <span className="font-semibold text-[var(--text-primary)]">{progress.pct}%</span>
            </div>
            <div className="meter mt-1.5" role="meter" aria-valuenow={progress.pct} aria-valuemin={0} aria-valuemax={100} aria-label="Settled">
              <span style={{ width: `${progress.pct}%` }} />
            </div>
          </div>
        )}
      </div>

      {/* Balances: one row per person. Tap for your statement with them. */}
      <ListSection
        header="Balances"
        footer={group.useSimplifiedDebts ? "Combine payments is on: the plan routes payments through fewer people." : undefined}
      >
        {memberBalances.map((b) => {
          const isMe = b.uid === currentUser.uid;
          const settled = isSettled(b.netAmount);
          const pos = !settled && b.netAmount > 0;
          const left = !group.memberIds.includes(b.uid);
          const name = isMe ? "You" : memberName(b.uid);
          const detail = (
            <span className="flex flex-col items-end leading-tight">
              <span className="t-caption text-[var(--text-secondary)]">
                {settled ? "settled" : pos ? "gets back" : "owes"}
              </span>
              <span
                className={`t-subhead font-semibold t-numeral ${
                  settled ? "text-[var(--text-secondary)]" : pos ? "text-[var(--pos)]" : "text-[var(--neg)]"
                }`}
              >
                {formatCurrency(settled ? 0 : Math.abs(b.netAmount))}
              </span>
            </span>
          );
          const leading = (
            <Avatar name={group.members[b.uid]?.displayName || name} photoURL={group.members[b.uid]?.photoURL} size={36} seed={b.uid} />
          );
          return isMe ? (
            <Row key={b.uid} leading={leading} separatorInset={64} title={name} subtitle="Your balance in this group" detail={detail} />
          ) : (
            <ButtonRow
              key={b.uid}
              onClick={() => setStatementUid(b.uid)}
              aria-label={`Your statement with ${name}`}
              leading={leading}
              separatorInset={64}
              title={name}
              subtitle={left ? "Left the group" : undefined}
              detail={detail}
              chevron
            />
          );
        })}
      </ListSection>

      <div className="mt-7">
        <div className="list-header-prominent">Activity</div>
        <ActivityTimeline
          expenses={mergedExpenses.filter((e) => !pendingDeleteIds.has(e.id))}
          settlements={settlements}
          memberName={memberName}
          currentUid={currentUser.uid}
          isAdmin={isAdmin}
          onEditExpense={handleEditExpense}
          onDeleteExpense={handleDeleteExpense}
          onApprove={handleApproveSettlement}
          onReject={handleRejectSettlement}
          onForward={(s) => setForwardTarget(s)}
          canForward={myCreditors.length > 0}
          onOpenExpense={openExpense}
          onOpenSettlement={openSettlement}
        />
      </div>

      {showAddExpense && (
        <AddExpenseModal group={group} currentUid={currentUser.uid} onSubmit={handleAddExpense} onClose={() => setShowAddExpense(false)} />
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

      {showInvite && (
        <InviteQrSheet groupName={group.name} inviteCode={group.inviteCode} onClose={() => setShowInvite(false)} />
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

      {/* Group Info */}
      {showGroupInfo && (
        <GlassModal title="Group Info" onClose={() => setShowGroupInfo(false)}>
          <div className="flex flex-col items-center text-center pt-2 pb-1">
            <Avatar name={group.name} photoURL={group.photoURL} size={72} seed={group.id} />
            <p className="t-title2 text-[var(--text-primary)] mt-2.5 max-w-full truncate">{group.name}</p>
            {group.description && (
              <p className="t-subhead text-[var(--text-secondary)] mt-0.5 selectable">{group.description}</p>
            )}
          </div>

          <ListSection elevated>
            <ButtonRow
              onClick={() => {
                setShowGroupInfo(false);
                setShowInvite(true);
              }}
              leading={<IconTile color="var(--blue)"><Qr size={17} /></IconTile>}
              separatorInset={58}
              title="Invite People"
              chevron
            />
            {isAdmin && (
              <ButtonRow
                onClick={() => {
                  setShowGroupInfo(false);
                  setShowAddMember(true);
                }}
                leading={<IconTile color="var(--green)"><PersonAdd size={17} /></IconTile>}
                separatorInset={58}
                title="Add Member"
                chevron
              />
            )}
            {isAdmin && (
              <ButtonRow
                onClick={() => {
                  setShowGroupInfo(false);
                  handleOpenEditGroup();
                }}
                leading={<IconTile color="var(--gray)"><Pencil size={17} /></IconTile>}
                separatorInset={58}
                title="Edit Group"
                chevron
              />
            )}
          </ListSection>

          <ListSection
            elevated
            header={`${group.memberIds.length} ${group.memberIds.length === 1 ? "Member" : "Members"}`}
            footer={isAdmin ? "Tap a member to remove them." : undefined}
          >
            {group.memberIds.map((uid) => {
              const leading = (
                <Avatar name={group.members[uid]?.displayName || "Member"} photoURL={group.members[uid]?.photoURL} size={36} seed={uid} />
              );
              const props = {
                leading,
                separatorInset: 64,
                title: memberName(uid),
                subtitle: group.members[uid]?.email || undefined,
                detail: uid === group.createdBy ? "Admin" : undefined,
              };
              return isAdmin && uid !== group.createdBy ? (
                <ButtonRow key={uid} onClick={() => handleRemoveMember(uid)} {...props} />
              ) : (
                <Row key={uid} {...props} />
              );
            })}
          </ListSection>

          <ListSection
            elevated
            footer={
              iArchived
                ? "Archived groups stay out of your list. Restoring brings it back."
                : "Archiving hides it from your Groups list without changing any balance. Only you see this."
            }
          >
            <ButtonRow onClick={handleToggleArchive} title={iArchived ? "Restore Group" : "Archive Group"} action />
            {!isAdmin && <ButtonRow onClick={handleLeaveGroup} title="Leave Group" destructive />}
          </ListSection>
        </GlassModal>
      )}

      {showAddMember && (
        <AddMemberModal groupId={group.id} existingUids={group.memberIds} onClose={() => setShowAddMember(false)} />
      )}

      {(detailExpense || detailSettlement) && (
        <ActivityDetailModal
          expense={detailExpense}
          settlement={detailSettlement}
          group={group}
          memberName={memberName}
          currentUid={currentUser.uid}
          isAdmin={isAdmin}
          onEditExpense={handleEditExpense}
          onDeleteExpense={handleDeleteExpense}
          onClose={closeDetail}
        />
      )}

      {/* Edit Group: delete lives here, at the bottom, behind confirmation. */}
      {showEditGroup && (
        <GlassModal
          title="Edit Group"
          large
          onClose={() => setShowEditGroup(false)}
          dirty={
            !editBusy &&
            (editName !== group.name ||
              editDesc !== (group.description || "") ||
              editUseSimplified !== (group.useSimplifiedDebts === true) ||
              !!editPhotoFile)
          }
          confirm={{ label: "Save", formId: "edit-group", disabled: !editName.trim(), busy: editBusy, onConfirm: () => {} }}
        >
          <form id="edit-group" onSubmit={handleSaveGroupProfile}>
            <div className="flex flex-col items-center pt-2">
              <label
                role="button"
                tabIndex={0}
                aria-label="Change group photo"
                onKeyDown={activateFileInputOnKey}
                className="relative cursor-pointer rounded-full flex flex-col items-center"
              >
                <Avatar name={editName || group.name} photoURL={editPhotoPreview} size={88} seed={group.id} />
                <span className="mt-2 t-subhead font-semibold text-[var(--brand)] flex items-center gap-1">
                  <Camera size={16} /> {editPhotoPreview ? "Change Photo" : "Add Photo"}
                </span>
                <input type="file" accept="image/*" onChange={handleEditPhotoChange} className="hidden" />
              </label>
            </div>

            <ListSection elevated>
              <FieldRow label="Name">
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="Required"
                  aria-label="Group name"
                  className="row-input py-[13px]"
                />
              </FieldRow>
              <FieldRow label="Description">
                <input
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  placeholder="Optional"
                  aria-label="Description"
                  className="row-input py-[13px]"
                />
              </FieldRow>
            </ListSection>

            <ListSection
              elevated
              footer="Off: you settle directly with each person you shared expenses with. On: the app reshuffles who pays whom so there are fewer payments, which can ask you to pay someone you never shared a bill with."
            >
              <Row title="Combine Payments">
                <Switch checked={editUseSimplified} onChange={setEditUseSimplified} label="Combine payments" />
              </Row>
            </ListSection>

            {editError && <p className="list-footer !text-[var(--neg)]">{editError}</p>}

            <ListSection elevated footer="Deletes the group and its balances for everyone. This can’t be undone.">
              <ButtonRow
                onClick={handleDeleteGroup}
                disabled={editBusy}
                leading={<span className="text-[var(--red)]"><Trash size={20} /></span>}
                title="Delete Group"
                destructive
              />
            </ListSection>
          </form>
        </GlassModal>
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
        <ConfirmDialog
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
 * wrapped in a Suspense boundary as the Next docs recommend. The fallback is the
 * same skeleton the page shows while its data loads, so a deep link doesn't
 * flash something different on the way in.
 */
export default function GroupPage() {
  return (
    <Suspense fallback={<GroupDetailSkeleton />}>
      <GroupPageInner />
    </Suspense>
  );
}
