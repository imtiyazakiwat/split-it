"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useSingleGroup, useGroupData } from "@/lib/group-data-context";
import {
  updateGroupProfile,
  updateSettlementStatus,
  updateCrossGroupSettlementStatus,
  updateExpense,
  deleteExpense,
  deleteGroup,
  removeMember,
  addExpense,
} from "@/lib/firestore";
import { Expense, Settlement, SettlementMode } from "@/lib/types";
import {
  activeExpenses as onlyActive,
  computeBalances,
  computeSettlementProgress,
  rescaleSplits,
  simplifyDebts,
  splitEqually,
  formatCurrency,
} from "@/lib/balance";
import {
  computeCounterpartyBalances,
  findCrossGroupLegs,
} from "@/lib/global-balance";
import { uploadImage, uploadMultipleReceipts } from "@/lib/storage";
import { categoryMeta } from "@/lib/categories";
import { showLocalNotification } from "@/lib/notifications";
import GlassButton from "@/components/ui/GlassButton";
import { GlassField, GlassSelect } from "@/components/ui/GlassField";
import GlassModal from "@/components/ui/GlassModal";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { activateFileInputOnKey } from "@/lib/keyboard";
import AddExpenseModal, { NewExpenseInput } from "@/components/AddExpenseModal";
import SettleUpModal from "@/components/SettleUpModal";
import ForwardModal from "@/components/ForwardModal";
import AddMemberModal from "@/components/group/AddMemberModal";
import ActivityDetailModal from "@/components/group/ActivityDetailModal";
import BottomNav from "@/components/home/BottomNav";
import ActivityTimeline from "@/components/group/ActivityTimeline";
import GroupDetailSkeleton from "@/components/group/GroupDetailSkeleton";
import LoginScreen from "@/components/LoginScreen";
import GlobalSettleModal from "@/components/GlobalSettleModal";

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

export default function GroupPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user, loading } = useAuth();
  // Reads from the one shared subscription set instead of opening three more
  // listeners every time this screen mounts.
  const { group, expenses, settlements, loading: groupLoading, notFound } = useSingleGroup(id);
  const { datasets, allLoaded } = useGroupData();
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [settleTarget, setSettleTarget] = useState<{ toUid: string; amount: number } | null>(null);
  const [forwardTarget, setForwardTarget] = useState<Settlement | null>(null);
  const [showGroupInfo, setShowGroupInfo] = useState(false);
  const [showAddMember, setShowAddMember] = useState(false);
  const [detailExpense, setDetailExpense] = useState<Expense | null>(null);
  const [detailSettlement, setDetailSettlement] = useState<Settlement | null>(null);
  const [showEditGroup, setShowEditGroup] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editSettlementMode, setEditSettlementMode] = useState<SettlementMode>("simplified");
  const [editPhotoFile, setEditPhotoFile] = useState<File | null>(null);
  const [editPhotoPreview, setEditPhotoPreview] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState("");
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  // Controlled fields for the edit-expense sheet. It used to read values back
  // out of the DOM with getElementById, which silently fell back to the old
  // values whenever the ids weren't found.
  const [editExpDesc, setEditExpDesc] = useState("");
  const [editExpAmount, setEditExpAmount] = useState("");
  const [editExpPaidBy, setEditExpPaidBy] = useState("");
  const [showCopied, setShowCopied] = useState(false);
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
  // Tracked by uid so the sheet follows live data rather than a snapshot.
  const [globalSettleUid, setGlobalSettleUid] = useState<string | null>(null);
  const showToast = useToast();

  // Cross-group position with each member, so this screen can point out
  // balances that can only be cleared globally.
  const counterparties = useMemo(
    () => (user ? computeCounterpartyBalances(user.uid, datasets) : []),
    [user, datasets]
  );

  if (loading) return <GroupDetailSkeleton />;
  // Previously rendered `null`, i.e. a blank white screen, whenever auth hadn't
  // resolved — the most visible symptom of the Android sign-in problem.
  if (!user) return <LoginScreen />;

  const currentUser = user;

  if (!group) {
    if (notFound) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center gap-3">
          <p className="text-[17px] font-semibold text-[var(--text-primary)]">
            This group isn&rsquo;t available
          </p>
          <p className="text-[14px] text-[var(--text-tertiary)] max-w-xs">
            It may have been deleted, or you may no longer be a member.
          </p>
          <button
            onClick={() => router.push("/")}
            className="mt-1 rounded-full bg-[var(--brand-solid)] text-white px-5 py-2.5 text-[15px] font-semibold tap-shrink"
          >
            Back to groups
          </button>
        </div>
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
  // Cross-group figures are only trustworthy once every group has loaded.
  const globalFor = (uid: string) =>
    allLoaded ? counterparties.find((c) => c.uid === uid) : undefined;
  const globalSettleTarget = globalSettleUid ? globalFor(globalSettleUid) ?? null : null;

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
  const balanceExpenses = onlyActive(mergedExpenses).filter((e) => !pendingDeleteIds.has(e.id));
  const balances = computeBalances(group.memberIds, balanceExpenses, settlements);
  // NOTE: "direct" (per-person) settlement mode is temporarily disabled — the
  // per-expense picker showed gross expense amounts instead of the pairwise
  // net, letting you overpay. Revisit later; for now always use simplified.
  //   const transactions = settlementMode === "direct"
  //     ? computeDirectDebts(group.memberIds, balanceExpenses, settlements)
  //     : simplifyDebts(balances);
  const transactions = simplifyDebts(balances);
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

  // A cross-group settlement is a set of linked records; responding has to
  // cover every leg, or the offset would only be half-applied.
  async function respondToSettlement(s: Settlement, status: "approved" | "rejected") {
    if (!group) return 0;
    const set = findCrossGroupLegs(
      datasets,
      { ...s, groupId: s.groupId || group.id },
      currentUser.uid
    );
    if (!set.complete) {
      throw new Error(
        `only ${set.legs.length} of ${set.expected} linked records are available yet`
      );
    }
    if (set.legs.length > 1) {
      await updateCrossGroupSettlementStatus(
        set.legs.map((l) => ({ groupId: l.groupId, settlementId: l.settlementId })),
        status
      );
    } else {
      await updateSettlementStatus(set.legs[0].groupId, set.legs[0].settlementId, status);
    }
    return set.legs.length;
  }

  // These writes were fire-and-forget: a rejected write (e.g. a rules failure)
  // showed a success toast while the balance silently never changed.
  async function handleApproveSettlement(s: Settlement) {
    if (!group) return;
    try {
      const legCount = (await respondToSettlement(s, "approved")) || 1;
      showToast({
        message:
          legCount > 1
            ? `✓ Offset applied across ${legCount} groups`
            : `✓ Approved ${formatCurrency(s.amount)} from ${memberName(s.fromUid)}`,
      });
      showLocalNotification(
        "Settlement approved",
        `You approved ${formatCurrency(s.amount)} from ${memberName(s.fromUid)}`,
        `/groups/${group.id}`
      );
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
      Math.abs(net) > 0.01
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

  function handleLeaveGroup() {
    if (!group) return;
    const net = balances.find((b) => b.uid === currentUser.uid)?.netAmount ?? 0;
    const warn =
      Math.abs(net) > 0.01
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
    setEditSettlementMode(group.settlementMode || "simplified");
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
        settlementMode: editSettlementMode,
      });
      showToast({ message: "Group updated" });
      setShowEditGroup(false);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Failed to update group");
    } finally {
      setEditBusy(false);
    }
  }

  async function handleCopyInviteLink() {
    if (!group) return;
    const link = `${window.location.origin}/join/${group.inviteCode}`;
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      // fallback
      const ta = document.createElement("textarea");
      ta.value = link;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setShowCopied(true);
    setTimeout(() => setShowCopied(false), 2000);
  }

  function handleEditExpense(expense: Expense) {
    setEditingExpense(expense);
    setEditExpDesc(expense.description);
    setEditExpAmount(String(expense.amount));
    setEditExpPaidBy(expense.paidBy);
    setEditError("");
  }

  function handleDeleteExpense(expense: Expense) {
    if (!group) return;
    const gid = group.id;
    const id = expense.id;
    const deletedBy = currentUser.uid;
    // Hide immediately; commit to Firestore only after the undo window.
    setPendingDeleteIds((prev) => new Set(prev).add(id));
    const timer = setTimeout(() => {
      deleteExpense(gid, id, deletedBy);
      showLocalNotification(
        "Expense deleted",
        `${expense.description} was deleted by admin`,
        `/groups/${gid}`
      );
      // Leave the id in pendingDeleteIds: the incoming editAction:"deleted"
      // will keep it hidden, so removing here would only risk a reappear flash.
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
      showToast({ message: `${categoryMeta(input.category).emoji} Expense added · ${formatCurrency(input.amount)}` });
    } catch {
      showToast({ message: "Couldn't add expense — tap + to retry." });
    } finally {
      setOptimisticExpenses((prev) => prev.filter((x) => x.id !== tempId));
    }
  }

  async function handleSaveEditedExpense(e: React.FormEvent) {
    e.preventDefault();
    if (!group || !editingExpense) return;
    const desc = editExpDesc.trim();
    const amt = parseFloat(editExpAmount);
    const paidBy = editExpPaidBy || editingExpense.paidBy;

    if (!desc) {
      setEditError("Description is required.");
      return;
    }
    if (!Number.isFinite(amt) || amt <= 0) {
      setEditError("Enter an amount greater than zero.");
      return;
    }

    // Keep the splits consistent with the new total, otherwise the ledger stops
    // adding up (the previous version changed the amount only).
    const amountChanged = Math.abs(amt - editingExpense.amount) > 0.005;
    const splitUids = editingExpense.splits.map((s) => s.uid);
    if (amountChanged && splitUids.length === 0) {
      // Guard against a malformed record: re-splitting nothing would credit the
      // payer with the full amount and debit nobody.
      setEditError("This expense has no split information, so its amount can't be changed.");
      return;
    }
    const splits = !amountChanged
      ? undefined
      : editingExpense.splitType === "equal"
      ? splitEqually(amt, splitUids)
      : rescaleSplits(editingExpense.splits, amt);

    setEditBusy(true);
    setEditError("");
    try {
      await updateExpense(
        group.id,
        editingExpense.id,
        { description: desc, amount: amt, paidBy, splits },
        currentUser.uid
      );
      showToast({ message: "Expense updated" });
      setEditingExpense(null);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Failed to update expense");
    } finally {
      setEditBusy(false);
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
    .filter((b) => group.memberIds.includes(b.uid) || Math.abs(b.netAmount) > 0.01)
    .sort((a, b) => b.netAmount - a.netAmount);

  const createdAgo = createdAgoText(group.createdAt);

  return (
    <div className="flex-1 flex flex-col bg-[var(--background)] min-h-full">
      <header className="max-w-md w-full mx-auto px-4 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="flex items-center justify-between pt-2">
          <button
            onClick={() => router.push("/")}
            aria-label="Back"
            className="w-11 h-11 rounded-2xl bg-[var(--surface)] shadow-[var(--shadow-button)] flex items-center justify-center tap-shrink"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
          <button
            onClick={() => setShowGroupInfo(true)}
            aria-label="Group menu"
            className="w-11 h-11 rounded-2xl bg-[var(--surface)] shadow-[var(--shadow-button)] flex items-center justify-center tap-shrink"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="var(--text-secondary)">
              <circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" />
            </svg>
          </button>
        </div>
      </header>
      <main className="flex-1 max-w-md w-full mx-auto px-4 pt-4 pb-40 scroll-momentum space-y-5">
        {/* Group hero */}
        <div className="flex items-start gap-4">
          {group.photoURL ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={group.photoURL} alt="" className="w-[88px] h-[88px] rounded-[var(--radius-card)] object-cover shrink-0 shadow-[var(--shadow-float)]" />
          ) : (
            <div className="w-[88px] h-[88px] rounded-[var(--radius-card)] bg-gradient-to-br from-indigo-400 to-violet-500 flex items-center justify-center shrink-0 shadow-[0_8px_24px_-8px_rgba(79,70,229,0.5)]">
              <span className="text-[34px] font-bold text-white">{group.name.charAt(0).toUpperCase()}</span>
            </div>
          )}
          <div className="min-w-0 flex-1 pt-1">
            <div className="flex items-center gap-2">
              <h1 className="text-[26px] font-extrabold text-[var(--text-primary)] truncate">{group.name}</h1>
              {isAdmin && (
                <button
                  onClick={handleOpenEditGroup}
                  aria-label="Edit group"
                  className="w-7 h-7 rounded-full bg-[var(--surface)] shadow-[var(--shadow-sm)] flex items-center justify-center shrink-0 tap-shrink"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                  </svg>
                </button>
              )}
            </div>
            <p className="text-[14px] text-[var(--text-tertiary)] mt-1">
              {group.memberIds.length} member{group.memberIds.length !== 1 ? "s" : ""} · Created {createdAgo}
            </p>
            <div className="flex items-center mt-2.5">
              <div className="flex -space-x-2">
                {group.memberIds.slice(0, 3).map((uid) =>
                  group.members[uid]?.photoURL ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={uid} src={group.members[uid].photoURL} alt="" className="w-8 h-8 rounded-full border-2 border-[var(--background)] object-cover" />
                  ) : (
                    <span key={uid} className="w-8 h-8 rounded-full border-2 border-[var(--background)] bg-[var(--fill)] flex items-center justify-center text-[12px] font-medium text-[var(--text-secondary)]">
                      {(group.members[uid]?.displayName || "?").charAt(0).toUpperCase()}
                    </span>
                  )
                )}
              </div>
              {group.memberIds.length > 3 && (
                <span className="ml-1 h-8 min-w-8 px-2 rounded-full bg-[var(--tint-accent)] flex items-center justify-center text-[12px] font-semibold text-[var(--brand)]">
                  +{group.memberIds.length - 3}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Stats card — 2×2 grid so each metric has room to breathe */}
        <div className="bg-[var(--surface)] rounded-[var(--radius-card)] p-5 shadow-[var(--shadow-card)] grid grid-cols-2 gap-x-4 gap-y-5">
          <div className="min-w-0">
            <p className="text-[13px] text-[var(--text-tertiary)]">Total spent</p>
            <p className="text-[22px] font-bold text-[var(--brand)] mt-1 truncate">{formatCurrency(totalSpent)}</p>
          </div>
          <div className="min-w-0">
            <p className="text-[13px] text-[var(--text-tertiary)]">Expenses</p>
            <p className="text-[22px] font-bold text-[var(--text-primary)] mt-1">{expenseCount}</p>
          </div>
          <div className="min-w-0">
            <p className="text-[13px] text-[var(--text-tertiary)]">Settled</p>
            <p className="text-[22px] font-bold text-[var(--pos)] mt-1">{progress.pct}%</p>
            <p className="text-[12px] text-[var(--text-tertiary)] mt-0.5 truncate">
              {progress.isEmpty
                ? "nothing to settle"
                : progress.outstanding < 0.01
                ? "everyone's square"
                : `${formatCurrency(progress.outstanding)} still to move`}
            </p>
          </div>
          <div className="min-w-0">
            <p className="text-[13px] text-[var(--text-tertiary)]">Last activity</p>
            <p className="text-[18px] font-bold text-[var(--text-primary)] mt-1 truncate">
              {lastActivityItem ? timeAgoShort(lastActivityItem.ts) : "—"}
            </p>
            <p className="text-[12px] text-[var(--text-tertiary)] mt-0.5 truncate">{lastActivityItem?.label || "no activity"}</p>
          </div>
        </div>

        {/* You owe / you're owed hero */}
        {topDebt ? (
          <div className="relative overflow-hidden rounded-[var(--radius-card)] p-5 bg-[var(--tint-danger-soft)]">
            <span className="absolute right-5 top-1/2 -translate-y-1/2 text-[64px] opacity-70 select-none" aria-hidden>💸</span>
            <div className="relative">
              <p className="text-[12px] font-semibold tracking-wide text-[var(--text-tertiary)]">YOU OWE</p>
              <p className="text-[22px] font-extrabold text-[var(--text-primary)] mt-1">{memberName(topDebt.toUid)}</p>
              <p className="text-[34px] font-extrabold text-[var(--neg)] leading-tight">{formatCurrency(topDebt.amount)}</p>
              <div className="flex flex-wrap items-center gap-2 mt-3">
                <button
                  onClick={() => handleOpenSettle(topDebt.toUid, topDebt.amount)}
                  className="inline-flex items-center gap-2 bg-[var(--neg)] text-white rounded-full pl-5 pr-4 py-2.5 text-[15px] font-semibold shadow-[0_8px_20px_-6px_rgba(239,68,68,0.6)] tap-shrink"
                >
                  Settle up now
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                </button>
                {/* Only offered when this person's balance spans groups, since
                    that's the case a single-group settlement can't resolve. */}
                {(() => {
                  const cross = globalFor(topDebt.toUid);
                  if (!cross || (cross.groups.length < 2 && cross.offsetable < 0.01)) return null;
                  return (
                    <button
                      onClick={() => setGlobalSettleUid(cross.uid)}
                      className="inline-flex items-center gap-1.5 bg-[var(--surface)] text-[var(--brand)] rounded-full px-4 py-2.5 text-[14px] font-semibold shadow-[var(--shadow-sm)] tap-shrink"
                    >
                      {cross.offsetable > 0.01
                        ? `Offset ${formatCurrency(cross.offsetable)} across groups`
                        : "Settle across groups"}
                    </button>
                  );
                })()}
              </div>
            </div>
          </div>
        ) : topCredit ? (
          <div className="relative overflow-hidden rounded-[var(--radius-card)] p-5 bg-[var(--tint-success-soft)]">
            <span className="absolute right-5 top-1/2 -translate-y-1/2 text-[64px] opacity-70 select-none" aria-hidden>💰</span>
            <div className="relative">
              <p className="text-[12px] font-semibold tracking-wide text-[var(--text-tertiary)]">YOU&rsquo;LL RECEIVE</p>
              <p className="text-[22px] font-extrabold text-[var(--text-primary)] mt-1">{memberName(topCredit.fromUid)}</p>
              <p className="text-[34px] font-extrabold text-[var(--pos)] leading-tight">{formatCurrency(topCredit.amount)}</p>
              <p className="mt-2 text-[13px] text-[var(--text-tertiary)]">Waiting for {memberName(topCredit.fromUid)} to settle up.</p>
            </div>
          </div>
        ) : (
          <div className="rounded-[var(--radius-card)] p-6 bg-[var(--tint-accent)] text-center">
            <p className="text-[18px] font-bold text-[var(--text-primary)]">You&rsquo;re all settled up 🎉</p>
            <p className="text-[13px] text-[var(--text-tertiary)] mt-1">No outstanding balances in this group.</p>
          </div>
        )}

        {/* Balances */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[20px] font-bold text-[var(--text-primary)]">Balances</h2>
            <button onClick={() => setShowGroupInfo(true)} className="text-[14px] font-semibold text-[var(--brand)] tap-shrink">View all</button>
          </div>
          <div className="flex gap-3 overflow-x-auto scroll-momentum -mx-4 px-4 pb-1">
            {memberBalances.map((b) => {
              const isMe = b.uid === currentUser.uid;
              const pos = b.netAmount > 0.01;
              const neg = b.netAmount < -0.01;
              return (
                <div
                  key={b.uid}
                  className={`shrink-0 w-[190px] rounded-[var(--radius-inner)] p-3.5 ${
                    isMe ? (neg ? "bg-[var(--tint-danger-soft)]" : "bg-[var(--tint-success-soft)]") : "bg-[var(--surface)] shadow-[var(--shadow-sm)]"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    {isMe ? (
                      <span className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 text-[12px] font-bold ${neg ? "bg-[var(--tint-danger)] text-[var(--neg)]" : "bg-[var(--tint-success)] text-[var(--pos)]"}`}>You</span>
                    ) : group.members[b.uid]?.photoURL ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={group.members[b.uid].photoURL} alt="" className="w-10 h-10 rounded-full object-cover shrink-0" />
                    ) : (
                      <span className="w-10 h-10 rounded-full bg-[var(--fill)] flex items-center justify-center shrink-0 text-[14px] font-medium text-[var(--text-secondary)]">
                        {(group.members[b.uid]?.displayName || "?").charAt(0).toUpperCase()}
                      </span>
                    )}
                    <div className="min-w-0">
                      <p className="text-[15px] font-semibold text-[var(--text-primary)] truncate">{isMe ? "You" : memberName(b.uid)}</p>
                      <p className={`text-[15px] font-bold ${pos ? "text-[var(--pos)]" : neg ? "text-[var(--neg)]" : "text-[var(--text-tertiary)]"}`}>
                        {pos ? "+" : neg ? "-" : ""}{formatCurrency(Math.abs(b.netAmount))}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                    <span className={`inline-block rounded-full px-2.5 py-0.5 text-[12px] font-medium ${
                      pos ? "bg-[var(--tint-success)] text-[var(--pos)]" : neg ? "bg-[var(--tint-danger)] text-[var(--neg)]" : "bg-[var(--fill)] text-[var(--text-secondary)]"
                    }`}>
                      {isMe ? (neg ? "You owe" : pos ? "You get back" : "Settled") : pos ? "Gets back" : neg ? "Owes" : "Settled"}
                    </span>
                    {!isMe && !group.memberIds.includes(b.uid) && (
                      <span className="inline-block rounded-full bg-[var(--fill)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-tertiary)]">
                        left group
                      </span>
                    )}
                    {/* Shortcut into the cross-group flow for people you also
                        share other groups with. */}
                    {!isMe && (() => {
                      const cross = globalFor(b.uid);
                      if (!cross || (cross.groups.length < 2 && cross.offsetable < 0.01)) return null;
                      return (
                        <button
                          onClick={() => setGlobalSettleUid(cross.uid)}
                          className="inline-block rounded-full bg-[var(--tint-accent)] px-2 py-0.5 text-[11px] font-semibold text-[var(--brand)] tap-shrink"
                        >
                          {cross.groups.length} groups
                        </button>
                      );
                    })()}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Activity */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[20px] font-bold text-[var(--text-primary)]">Activity</h2>
          </div>
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
            onOpenExpense={setDetailExpense}
            onOpenSettlement={setDetailSettlement}
          />
        </section>
      </main>

      {/* Floating Add Expense */}
      <div className="fixed z-30 inset-x-0 bottom-[calc(6rem+env(safe-area-inset-bottom))] pointer-events-none">
        <div className="max-w-md mx-auto px-4 flex justify-end">
          <button
            onClick={() => setShowAddExpense(true)}
            className="pointer-events-auto flex flex-col items-center gap-1 tap-shrink"
          >
            <span className="w-14 h-14 rounded-full bg-[var(--brand-solid)] flex items-center justify-center shadow-[0_12px_28px_-6px_rgba(79,70,229,0.6)]">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </span>
            <span className="text-[12px] font-semibold text-[var(--brand)]">Add Expense</span>
          </button>
        </div>
      </div>

      <BottomNav active="groups" />

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

      {globalSettleTarget && (
        <GlobalSettleModal
          meUid={currentUser.uid}
          counterparty={globalSettleTarget}
          onClose={() => setGlobalSettleUid(null)}
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

      {/* Group Info Modal */}
      {showGroupInfo && (
        <GlassModal title="Group Info" onClose={() => setShowGroupInfo(false)}>
          <div className="space-y-4">
            <div className="text-center">
              {group.photoURL ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={group.photoURL} alt="" className="w-20 h-20 rounded-full object-cover mx-auto" />
              ) : (
                <div className="w-20 h-20 rounded-full bg-[var(--accent)]/10 flex items-center justify-center mx-auto">
                  <span className="text-[32px] font-semibold text-[var(--accent)]">{group.name.charAt(0).toUpperCase()}</span>
                </div>
              )}
              <p className="text-[20px] font-semibold text-[var(--label-primary)] mt-3">{group.name}</p>
              {group.description && <p className="text-[14px] text-[var(--label-secondary)] mt-1">{group.description}</p>}
              <p className="text-[13px] text-[var(--label-tertiary)] mt-1">
                {group.memberIds.length} member{group.memberIds.length !== 1 ? "s" : ""}
              </p>
            </div>

            <div className="flex gap-2">
              <GlassButton size="sm" variant="glass" onClick={handleCopyInviteLink} className="flex-1">
                {showCopied ? "Copied!" : "Share Invite Link"}
              </GlassButton>
              {isAdmin && (
                <GlassButton size="sm" variant="glass" onClick={() => { setShowGroupInfo(false); handleOpenEditGroup(); }} className="flex-1">
                  Edit Group
                </GlassButton>
              )}
            </div>

            <div className="border-t border-[var(--border-subtle)] pt-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-[var(--label-secondary)]">Members</p>
                {isAdmin && (
                  <button
                    onClick={() => { setShowGroupInfo(false); setShowAddMember(true); }}
                    className="text-[13px] font-medium text-[var(--brand)] tap-shrink"
                  >
                    + Add member
                  </button>
                )}
              </div>
              <div className="space-y-2">
                {group.memberIds.map((uid) => (
                  <div key={uid} className="flex items-center gap-2.5">
                    {group.members[uid]?.photoURL ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={group.members[uid].photoURL} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-[var(--accent)]/10 flex items-center justify-center shrink-0">
                        <span className="text-[13px] font-medium text-[var(--accent)]">
                          {(group.members[uid]?.displayName || "?").charAt(0).toUpperCase()}
                        </span>
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] text-[var(--label-primary)] truncate">
                        {memberName(uid)}{uid === group.createdBy && <span className="text-[11px] text-[var(--label-tertiary)] ml-1">(Admin)</span>}
                      </p>
                      <p className="text-[12px] text-[var(--label-tertiary)] truncate">{group.members[uid]?.email || ""}</p>
                    </div>
                    {isAdmin && uid !== group.createdBy && (
                      <button
                        onClick={() => handleRemoveMember(uid)}
                        className="text-[12px] font-medium text-[var(--danger)] shrink-0 tap-shrink px-2 py-1"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {!isAdmin && (
              <button
                onClick={handleLeaveGroup}
                className="w-full rounded-[var(--radius-md)] border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3.5 py-2.5 text-sm font-medium text-[var(--danger)] tap-shrink"
              >
                Leave group
              </button>
            )}
          </div>
        </GlassModal>
      )}

      {showAddMember && (
        <AddMemberModal
          groupId={group.id}
          existingUids={group.memberIds}
          onClose={() => setShowAddMember(false)}
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
          onEditExpense={handleEditExpense}
          onDeleteExpense={handleDeleteExpense}
          onClose={() => { setDetailExpense(null); setDetailSettlement(null); }}
        />
      )}

      {/* Edit Group Modal */}
      {showEditGroup && (
        <GlassModal title="Edit Group" onClose={() => setShowEditGroup(false)}>
          <form onSubmit={handleSaveGroupProfile} className="space-y-4">
            <div className="flex justify-center">
              <label
                role="button"
                tabIndex={0}
                aria-label="Change group photo"
                onKeyDown={activateFileInputOnKey}
                className="relative cursor-pointer tap-shrink rounded-full"
              >
                {editPhotoPreview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={editPhotoPreview} alt="" className="w-20 h-20 rounded-full object-cover border-2 border-[var(--border-subtle)]" />
                ) : (
                  <div className="w-20 h-20 rounded-full bg-[var(--accent)]/10 flex items-center justify-center border-2 border-[var(--border-subtle)]">
                    <span className="text-[28px] font-semibold text-[var(--accent)]">{(editName || "G").charAt(0).toUpperCase()}</span>
                  </div>
                )}
                <span className="absolute bottom-0 right-0 bg-[var(--accent)] text-white text-[10px] px-1.5 py-0.5 rounded-full">Edit</span>
                <input type="file" accept="image/*" onChange={handleEditPhotoChange} className="hidden" />
              </label>
            </div>
            <GlassField label="Group name" autoFocus value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Group name" />
            <GlassField label="Description" value={editDesc} onChange={(e) => setEditDesc(e.target.value)} placeholder="Group description (optional)" />

            {/* Settlement style toggle temporarily hidden — "direct" mode is
                buggy (see NOTE in the balance calculation). Re-enable once the
                per-expense picker nets amounts correctly.
            <div>
              <label className="text-sm font-medium text-[var(--label-secondary)] block mb-1.5">
                Settlement style
              </label>
              <div className="glass rounded-full p-1 text-sm font-medium flex">
                <button type="button" onClick={() => setEditSettlementMode("simplified")}
                  className={`flex-1 rounded-full py-2 transition tap-shrink ${editSettlementMode === "simplified" ? "bg-[var(--surface)] shadow-sm text-[var(--label-primary)]" : "text-[var(--label-secondary)]"}`}>
                  Simplified
                </button>
                <button type="button" onClick={() => setEditSettlementMode("direct")}
                  className={`flex-1 rounded-full py-2 transition tap-shrink ${editSettlementMode === "direct" ? "bg-[var(--surface)] shadow-sm text-[var(--label-primary)]" : "text-[var(--label-secondary)]"}`}>
                  Direct
                </button>
              </div>
            </div>
            */}

            {editError && <p className="text-sm text-[var(--danger)]">{editError}</p>}
            <GlassButton disabled={editBusy} className="w-full">{editBusy ? "Saving…" : "Save"}</GlassButton>

            <div className="border-t border-[var(--border-subtle)] pt-3">
              <button
                type="button"
                onClick={handleDeleteGroup}
                disabled={editBusy}
                className="w-full rounded-[var(--radius-md)] border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3.5 py-2.5 text-sm font-medium text-[var(--danger)] tap-shrink disabled:opacity-50"
              >
                Delete Group
              </button>
              <p className="text-[12px] text-[var(--label-tertiary)] mt-1.5 text-center">
                Permanently removes this group for everyone. This can&apos;t be undone.
              </p>
            </div>
          </form>
        </GlassModal>
      )}

      {/* Edit Expense Modal */}
      {editingExpense && (
        <GlassModal title="Edit Expense" onClose={() => setEditingExpense(null)}>
          <form onSubmit={handleSaveEditedExpense} className="space-y-4">
            <GlassField
              label="Description"
              value={editExpDesc}
              onChange={(ev) => setEditExpDesc(ev.target.value)}
              autoFocus
            />
            <GlassField
              label="Amount"
              type="number"
              step="0.01"
              inputMode="decimal"
              value={editExpAmount}
              onChange={(ev) => setEditExpAmount(ev.target.value)}
            />
            <GlassSelect
              label="Paid by"
              value={editExpPaidBy}
              onChange={(ev) => setEditExpPaidBy(ev.target.value)}
            >
              {group.memberIds.map((uid) => (
                <option key={uid} value={uid}>{memberName(uid)}</option>
              ))}
            </GlassSelect>
            <p className="text-[12px] text-[var(--label-tertiary)]">
              Changing the amount re-splits it across the same{" "}
              {editingExpense.splits.length} {editingExpense.splits.length === 1 ? "person" : "people"}.
            </p>
            {editError && <p className="text-sm text-[var(--danger)]">{editError}</p>}
            <div className="flex gap-2">
              <GlassButton type="button" variant="ghost" onClick={() => setEditingExpense(null)} className="flex-1">Cancel</GlassButton>
              <GlassButton disabled={editBusy} className="flex-1">{editBusy ? "Saving…" : "Save Changes"}</GlassButton>
            </div>
          </form>
        </GlassModal>
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
    </div>
  );
}
