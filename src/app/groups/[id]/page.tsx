"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import {
  subscribeToGroup,
  subscribeToExpenses,
  subscribeToSettlements,
  updateGroupProfile,
  updateSettlementStatus,
  updateExpense,
  deleteExpense,
  deleteGroup,
  removeMember,
} from "@/lib/firestore";
import { Group, Expense, Settlement, SettlementMode } from "@/lib/types";
import { computeBalances, simplifyDebts, formatCurrency } from "@/lib/balance";
import { uploadImage } from "@/lib/storage";
import { showLocalNotification } from "@/lib/notifications";
import GlassButton from "@/components/ui/GlassButton";
import { GlassField, GlassSelect } from "@/components/ui/GlassField";
import GlassModal from "@/components/ui/GlassModal";
import AddExpenseModal from "@/components/AddExpenseModal";
import SettleUpModal from "@/components/SettleUpModal";
import ForwardModal from "@/components/ForwardModal";
import AddMemberModal from "@/components/group/AddMemberModal";
import BottomNav from "@/components/home/BottomNav";
import ActivityTimeline from "@/components/group/ActivityTimeline";

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
  const [group, setGroup] = useState<Group | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [settleTarget, setSettleTarget] = useState<{ toUid: string; amount: number } | null>(null);
  const [forwardTarget, setForwardTarget] = useState<Settlement | null>(null);
  const [showGroupInfo, setShowGroupInfo] = useState(false);
  const [showAddMember, setShowAddMember] = useState(false);
  const [showEditGroup, setShowEditGroup] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editSettlementMode, setEditSettlementMode] = useState<SettlementMode>("simplified");
  const [editPhotoFile, setEditPhotoFile] = useState<File | null>(null);
  const [editPhotoPreview, setEditPhotoPreview] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState("");
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [showCopied, setShowCopied] = useState(false);

  useEffect(() => {
    if (!id) return;
    const unsubs = [
      subscribeToGroup(id, setGroup),
      subscribeToExpenses(id, setExpenses),
      subscribeToSettlements(id, setSettlements),
    ];
    return () => unsubs.forEach((u) => u());
  }, [id]);

  if (loading || !user) return null;

  const currentUser = user;

  if (!group) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-[var(--label-tertiary)] text-sm">Loading group…</p>
      </div>
    );
  }

  const isAdmin = group.createdBy === currentUser.uid;
  const memberName = (uid: string) =>
    uid === currentUser.uid ? "You" : group?.members[uid]?.displayName || "Unknown";

  const balanceExpenses = expenses.filter((e) => !e.editAction);
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
    return expenses.filter((e) => {
      if (e.editAction) return false;
      if (settledExpenseIds.has(e.id)) return false;
      const mySplit = e.splits.find((s) => s.uid === currentUser.uid);
      return e.paidBy === toUid && mySplit && mySplit.amount > 0;
    });
  }

  function handleApproveSettlement(s: Settlement) {
    if (!group) return;
    updateSettlementStatus(group.id, s.id, "approved");
    showLocalNotification(
      "Settlement approved",
      `You approved ${formatCurrency(s.amount)} from ${memberName(s.fromUid)}`,
      `/groups/${group.id}`
    );
  }

  function handleRejectSettlement(s: Settlement) {
    if (!group) return;
    updateSettlementStatus(group.id, s.id, "rejected");
  }

  async function handleDeleteGroup() {
    if (!group) return;
    if (
      !confirm(
        `Delete "${group.name}"? This removes the group and its balances for everyone in it. This can't be undone.`
      )
    )
      return;
    setEditBusy(true);
    setEditError("");
    try {
      await deleteGroup(group.id);
      router.push("/");
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Failed to delete group");
      setEditBusy(false);
    }
  }

  async function handleRemoveMember(uid: string) {
    if (!group) return;
    const name = memberName(uid);
    const net = balances.find((b) => b.uid === uid)?.netAmount ?? 0;
    const warn =
      Math.abs(net) > 0.01
        ? `\n\nHeads up: ${name} still has an unsettled balance of ${formatCurrency(
            Math.abs(net)
          )}. Removing them drops it from the group's balances.`
        : "";
    if (!confirm(`Remove ${name} from "${group.name}"?${warn}`)) return;
    try {
      await removeMember(group.id, uid);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to remove member");
    }
  }

  async function handleLeaveGroup() {
    if (!group) return;
    const net = balances.find((b) => b.uid === currentUser.uid)?.netAmount ?? 0;
    const warn =
      Math.abs(net) > 0.01
        ? `\n\nYou still have an unsettled balance of ${formatCurrency(Math.abs(net))} here.`
        : "";
    if (!confirm(`Leave "${group.name}"?${warn}`)) return;
    try {
      await removeMember(group.id, currentUser.uid);
      router.push("/");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to leave group");
    }
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
  }

  async function handleDeleteExpense(expense: Expense) {
    if (!group || !confirm(`Delete "${expense.description}"? This will hide it from the group.`)) return;
    await deleteExpense(group.id, expense.id, currentUser.uid);
    showLocalNotification(
      "Expense deleted",
      `${expense.description} was deleted by admin`,
      `/groups/${group.id}`
    );
  }

  async function handleSaveEditedExpense(e: React.FormEvent) {
    e.preventDefault();
    if (!group || !editingExpense) return;
    const desc = (document.getElementById("edit-desc") as HTMLInputElement)?.value || editingExpense.description;
    const amt = parseFloat((document.getElementById("edit-amount") as HTMLInputElement)?.value || String(editingExpense.amount));
    const paidBy = (document.getElementById("edit-paidby") as HTMLSelectElement)?.value || editingExpense.paidBy;

    setEditBusy(true);
    setEditError("");
    try {
      await updateExpense(group.id, editingExpense.id, {
        description: desc.trim(),
        amount: amt,
        paidBy,
      }, currentUser.uid);
      setEditingExpense(null);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Failed to update expense");
    } finally {
      setEditBusy(false);
    }
  }

  const activeExpenses = expenses.filter((e) => !e.editAction);

  // ── Derived stats for the header/summary cards ──
  const totalSpent = activeExpenses.reduce((sum, e) => sum + e.amount, 0);
  const expenseCount = activeExpenses.length;

  const settledExpenseIds = new Set<string>();
  settlements
    .filter((s) => s.status === "approved")
    .forEach((s) => (s.expenseIds || []).forEach((eid) => settledExpenseIds.add(eid)));
  const settledCount = activeExpenses.filter((e) => settledExpenseIds.has(e.id)).length;
  const settledPct = expenseCount > 0 ? Math.round((settledCount / expenseCount) * 100) : 100;

  const lastActivityItem = [
    ...activeExpenses.map((e) => ({ ts: e.updatedAt || e.createdAt, label: `${e.description} added` })),
    ...settlements.map((s) => ({ ts: s.createdAt, label: "payment logged" })),
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

  // Per-member net balances for the balance chips (creditors first).
  const memberBalances = [...balances].sort((a, b) => b.netAmount - a.netAmount);

  const createdAgo = createdAgoText(group.createdAt);

  return (
    <div className="flex-1 flex flex-col bg-[var(--background)] min-h-full">
      <header className="max-w-md w-full mx-auto px-4 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="flex items-center justify-between pt-2">
          <button
            onClick={() => router.push("/")}
            aria-label="Back"
            className="w-11 h-11 rounded-2xl bg-white shadow-[0_2px_10px_-2px_rgba(0,0,0,0.12)] flex items-center justify-center tap-shrink"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
          <button
            onClick={() => setShowGroupInfo(true)}
            aria-label="Group menu"
            className="w-11 h-11 rounded-2xl bg-white shadow-[0_2px_10px_-2px_rgba(0,0,0,0.12)] flex items-center justify-center tap-shrink"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="#475569">
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
            <img src={group.photoURL} alt="" className="w-[88px] h-[88px] rounded-[22px] object-cover shrink-0 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.3)]" />
          ) : (
            <div className="w-[88px] h-[88px] rounded-[22px] bg-gradient-to-br from-indigo-400 to-violet-500 flex items-center justify-center shrink-0 shadow-[0_8px_24px_-8px_rgba(79,70,229,0.5)]">
              <span className="text-[34px] font-bold text-white">{group.name.charAt(0).toUpperCase()}</span>
            </div>
          )}
          <div className="min-w-0 flex-1 pt-1">
            <div className="flex items-center gap-2">
              <h1 className="text-[26px] font-extrabold text-slate-800 truncate">{group.name}</h1>
              {isAdmin && (
                <button
                  onClick={handleOpenEditGroup}
                  aria-label="Edit group"
                  className="w-7 h-7 rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,0.12)] flex items-center justify-center shrink-0 tap-shrink"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                  </svg>
                </button>
              )}
            </div>
            <p className="text-[14px] text-slate-400 mt-1">
              {group.memberIds.length} member{group.memberIds.length !== 1 ? "s" : ""} · Created {createdAgo}
            </p>
            <div className="flex items-center mt-2.5">
              <div className="flex -space-x-2">
                {group.memberIds.slice(0, 3).map((uid) =>
                  group.members[uid]?.photoURL ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={uid} src={group.members[uid].photoURL} alt="" className="w-8 h-8 rounded-full border-2 border-[var(--background)] object-cover" />
                  ) : (
                    <span key={uid} className="w-8 h-8 rounded-full border-2 border-[var(--background)] bg-slate-200 flex items-center justify-center text-[12px] font-medium text-slate-500">
                      {(group.members[uid]?.displayName || "?").charAt(0).toUpperCase()}
                    </span>
                  )
                )}
              </div>
              {group.memberIds.length > 3 && (
                <span className="ml-1 h-8 min-w-8 px-2 rounded-full bg-indigo-50 flex items-center justify-center text-[12px] font-semibold text-indigo-600">
                  +{group.memberIds.length - 3}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Stats card */}
        <div className="bg-white rounded-[22px] px-2 py-4 shadow-[0_2px_8px_rgba(0,0,0,0.03),0_16px_36px_-24px_rgba(0,0,0,0.22)] flex divide-x divide-slate-100">
          <div className="flex-1 px-3 min-w-0">
            <p className="text-[12px] text-slate-400">Total spent</p>
            <p className="text-[17px] font-bold text-indigo-600 mt-0.5 truncate">{formatCurrency(totalSpent)}</p>
          </div>
          <div className="flex-1 px-3 min-w-0">
            <p className="text-[12px] text-slate-400">Expenses</p>
            <p className="text-[17px] font-bold text-slate-800 mt-0.5">{expenseCount}</p>
            <p className="text-[11px] text-slate-400">Total</p>
          </div>
          <div className="flex-1 px-3 min-w-0">
            <p className="text-[12px] text-slate-400">Settled</p>
            <p className="text-[17px] font-bold text-green-600 mt-0.5">{settledPct}%</p>
            <p className="text-[11px] text-slate-400">{settledCount} of {expenseCount}</p>
          </div>
          <div className="flex-1 px-3 min-w-0">
            <p className="text-[12px] text-slate-400">Last activity</p>
            <p className="text-[15px] font-bold text-slate-800 mt-0.5 truncate">
              {lastActivityItem ? timeAgoShort(lastActivityItem.ts) : "—"}
            </p>
            <p className="text-[11px] text-slate-400 truncate">{lastActivityItem?.label || "no activity"}</p>
          </div>
        </div>

        {/* You owe / you're owed hero */}
        {topDebt ? (
          <div className="relative overflow-hidden rounded-[24px] p-5 bg-gradient-to-br from-rose-50 to-orange-50">
            <span className="absolute right-5 top-1/2 -translate-y-1/2 text-[64px] opacity-70 select-none" aria-hidden>🏝️</span>
            <div className="relative">
              <p className="text-[12px] font-semibold tracking-wide text-slate-400">YOU OWE</p>
              <p className="text-[22px] font-extrabold text-slate-800 mt-1">{memberName(topDebt.toUid)}</p>
              <p className="text-[34px] font-extrabold text-red-500 leading-tight">{formatCurrency(topDebt.amount)}</p>
              <button
                onClick={() => handleOpenSettle(topDebt.toUid, topDebt.amount)}
                className="mt-3 inline-flex items-center gap-2 bg-red-500 text-white rounded-full pl-5 pr-4 py-2.5 text-[15px] font-semibold shadow-[0_8px_20px_-6px_rgba(239,68,68,0.6)] tap-shrink"
              >
                Settle up now
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </button>
            </div>
          </div>
        ) : topCredit ? (
          <div className="relative overflow-hidden rounded-[24px] p-5 bg-gradient-to-br from-emerald-50 to-teal-50">
            <span className="absolute right-5 top-1/2 -translate-y-1/2 text-[64px] opacity-70 select-none" aria-hidden>💰</span>
            <div className="relative">
              <p className="text-[12px] font-semibold tracking-wide text-slate-400">YOU&rsquo;LL RECEIVE</p>
              <p className="text-[22px] font-extrabold text-slate-800 mt-1">{memberName(topCredit.fromUid)}</p>
              <p className="text-[34px] font-extrabold text-green-600 leading-tight">{formatCurrency(topCredit.amount)}</p>
              <p className="mt-2 text-[13px] text-slate-400">Waiting for {memberName(topCredit.fromUid)} to settle up.</p>
            </div>
          </div>
        ) : (
          <div className="rounded-[24px] p-6 bg-indigo-50/70 text-center">
            <p className="text-[18px] font-bold text-slate-800">You&rsquo;re all settled up 🎉</p>
            <p className="text-[13px] text-slate-400 mt-1">No outstanding balances in this group.</p>
          </div>
        )}

        {/* Balances */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[20px] font-bold text-slate-800">Balances</h2>
            <button onClick={() => setShowGroupInfo(true)} className="text-[14px] font-semibold text-indigo-600 tap-shrink">View all</button>
          </div>
          <div className="flex gap-3 overflow-x-auto scroll-momentum -mx-4 px-4 pb-1">
            {memberBalances.map((b) => {
              const isMe = b.uid === currentUser.uid;
              const pos = b.netAmount > 0.01;
              const neg = b.netAmount < -0.01;
              return (
                <div
                  key={b.uid}
                  className={`shrink-0 w-[190px] rounded-[18px] p-3.5 ${
                    isMe ? (neg ? "bg-rose-50" : "bg-emerald-50") : "bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)]"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    {isMe ? (
                      <span className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 text-[12px] font-bold ${neg ? "bg-red-100 text-red-500" : "bg-green-100 text-green-600"}`}>You</span>
                    ) : group.members[b.uid]?.photoURL ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={group.members[b.uid].photoURL} alt="" className="w-10 h-10 rounded-full object-cover shrink-0" />
                    ) : (
                      <span className="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center shrink-0 text-[14px] font-medium text-slate-500">
                        {(group.members[b.uid]?.displayName || "?").charAt(0).toUpperCase()}
                      </span>
                    )}
                    <div className="min-w-0">
                      <p className="text-[15px] font-semibold text-slate-800 truncate">{isMe ? "You" : memberName(b.uid)}</p>
                      <p className={`text-[15px] font-bold ${pos ? "text-green-600" : neg ? "text-red-500" : "text-slate-400"}`}>
                        {pos ? "+" : neg ? "-" : ""}{formatCurrency(Math.abs(b.netAmount))}
                      </p>
                    </div>
                  </div>
                  <span className={`inline-block mt-2 rounded-full px-2.5 py-0.5 text-[12px] font-medium ${
                    pos ? "bg-green-100 text-green-700" : neg ? "bg-red-100 text-red-600" : "bg-slate-100 text-slate-500"
                  }`}>
                    {isMe ? (neg ? "You owe" : pos ? "You get back" : "Settled") : pos ? "Gets back" : neg ? "Owes" : "Settled"}
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        {/* Activity */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[20px] font-bold text-slate-800">Activity</h2>
          </div>
          <ActivityTimeline
            expenses={expenses}
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
            <span className="w-14 h-14 rounded-full bg-indigo-600 flex items-center justify-center shadow-[0_12px_28px_-6px_rgba(79,70,229,0.6)]">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </span>
            <span className="text-[12px] font-semibold text-indigo-600">Add Expense</span>
          </button>
        </div>
      </div>

      <BottomNav active="groups" />

      {showAddExpense && (
        <AddExpenseModal group={group} currentUid={currentUser.uid} onClose={() => setShowAddExpense(false)} />
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
                    className="text-[13px] font-medium text-indigo-600 tap-shrink"
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

      {/* Edit Group Modal */}
      {showEditGroup && (
        <GlassModal title="Edit Group" onClose={() => setShowEditGroup(false)}>
          <form onSubmit={handleSaveGroupProfile} className="space-y-4">
            <div className="flex justify-center">
              <label className="relative cursor-pointer tap-shrink">
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
            <GlassField label="Description" id="edit-desc" defaultValue={editingExpense.description} autoFocus />
            <GlassField label="Amount" id="edit-amount" type="number" step="0.01" defaultValue={String(editingExpense.amount)} />
            <GlassSelect label="Paid by" id="edit-paidby" defaultValue={editingExpense.paidBy}>
              {group.memberIds.map((uid) => (
                <option key={uid} value={uid}>{memberName(uid)}</option>
              ))}
            </GlassSelect>
            {editError && <p className="text-sm text-[var(--danger)]">{editError}</p>}
            <div className="flex gap-2">
              <GlassButton type="button" variant="ghost" onClick={() => setEditingExpense(null)} className="flex-1">Cancel</GlassButton>
              <GlassButton disabled={editBusy} className="flex-1">{editBusy ? "Saving…" : "Save Changes"}</GlassButton>
            </div>
          </form>
        </GlassModal>
      )}
    </div>
  );
}
