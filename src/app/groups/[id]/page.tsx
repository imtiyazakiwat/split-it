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
} from "@/lib/firestore";
import { Group, Expense, Settlement } from "@/lib/types";
import { computeBalances, simplifyDebts, formatCurrency } from "@/lib/balance";
import { uploadImage, uploadMultipleReceipts } from "@/lib/storage";
import { showLocalNotification } from "@/lib/notifications";
import TopBar from "@/components/TopBar";
import Card from "@/components/ui/Card";
import GlassButton from "@/components/ui/GlassButton";
import { GlassField, GlassSelect } from "@/components/ui/GlassField";
import GlassModal from "@/components/ui/GlassModal";
import AddExpenseModal from "@/components/AddExpenseModal";
import SettleUpModal from "@/components/SettleUpModal";

export default function GroupPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user, loading } = useAuth();
  const [group, setGroup] = useState<Group | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [settleTarget, setSettleTarget] = useState<{ toUid: string; amount: number } | null>(null);
  const [tab, setTab] = useState<"balances" | "activity">("balances");
  const [showGroupInfo, setShowGroupInfo] = useState(false);
  const [showEditGroup, setShowEditGroup] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
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

  const balances = computeBalances(group.memberIds, expenses.filter((e) => !e.editAction), settlements);
  const myBalance = balances.find((b) => b.uid === currentUser.uid)?.netAmount ?? 0;
  const simplified = simplifyDebts(balances);

  const pendingSettlements = settlements.filter((s) => s.status === "pending");
  const myPendingIncoming = pendingSettlements.filter((s) => s.toUid === currentUser.uid);
  const myPendingOutgoing = pendingSettlements.filter((s) => s.fromUid === currentUser.uid);

  const balanceColor =
    myBalance > 0.01 ? "text-[var(--success)]" : myBalance < -0.01 ? "text-[var(--danger)]" : "text-[var(--label-primary)]";

  function handleOpenSettle(toUid: string, amount: number) {
    setSettleTarget({ toUid, amount });
  }

  function getExpensesOwedTo(toUid: string): Expense[] {
    if (!group) return [];
    return expenses.filter((e) => {
      if (e.editAction) return false;
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

  function handleOpenEditGroup() {
    if (!group) return;
    setEditName(group.name);
    setEditDesc(group.description || "");
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
    await deleteExpense(group.id, expense.id);
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
      });
      setEditingExpense(null);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Failed to update expense");
    } finally {
      setEditBusy(false);
    }
  }

  const activeExpenses = expenses.filter((e) => !e.editAction);
  const deletedExpenses = expenses.filter((e) => e.editAction === "deleted");
  const editedExpenses = expenses.filter((e) => e.editAction === "edited");

  return (
    <div className="flex-1 flex flex-col">
      <TopBar title={group.name} onBack={() => router.push("/")} />
      <main className="flex-1 max-w-md w-full mx-auto p-4 space-y-4 pb-28 scroll-momentum">
        <Card className="p-5 text-center">
          <p className="text-[13px] text-[var(--label-tertiary)] mb-1 uppercase tracking-wide">
            Your balance
          </p>
          <p className={`text-[34px] font-semibold tracking-tight ${balanceColor}`}>
            {myBalance > 0.01 && "+"}
            {formatCurrency(myBalance)}
          </p>
          <p className="text-[13px] text-[var(--label-tertiary)] mt-1">
            {myBalance > 0.01
              ? "you are owed overall"
              : myBalance < -0.01
              ? "you owe overall"
              : "all settled up"}
          </p>
        </Card>

        {myPendingIncoming.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-[var(--label-secondary)]">
              Pending settlement requests
            </p>
            {myPendingIncoming.map((s) => (
              <Card key={s.id} className="p-3.5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[15px] text-[var(--label-primary)]">
                      <span className="font-medium">{memberName(s.fromUid)}</span> sent you{" "}
                      <span className="font-semibold">{formatCurrency(s.amount)}</span>
                    </p>
                    {s.note && <p className="text-[13px] text-[var(--label-tertiary)] mt-0.5">{s.note}</p>}
                    {s.receiptUrls.length > 0 && (
                      <div className="flex gap-2 mt-1">
                        {s.receiptUrls.map((url, i) => (
                          <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="text-[13px] text-[var(--accent)]">Screenshot {i + 1}</a>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex gap-2 mt-2">
                  <GlassButton size="sm" onClick={() => handleApproveSettlement(s)} className="!px-3 !py-1 text-xs">Approve</GlassButton>
                  <GlassButton size="sm" variant="ghost" onClick={() => handleRejectSettlement(s)} className="!px-3 !py-1 text-xs">Reject</GlassButton>
                </div>
              </Card>
            ))}
          </div>
        )}

        {myPendingOutgoing.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-[var(--label-secondary)]">Your pending requests</p>
            {myPendingOutgoing.map((s) => (
              <Card key={s.id} className="p-3.5 opacity-70">
                <p className="text-[15px] text-[var(--label-primary)]">
                  You sent <span className="font-medium">{memberName(s.toUid)}</span>{" "}
                  <span className="font-semibold">{formatCurrency(s.amount)}</span>
                </p>
                <p className="text-[13px] text-[var(--label-tertiary)] mt-0.5">Awaiting approval</p>
              </Card>
            ))}
          </div>
        )}

        <button
          onClick={() => setShowGroupInfo(true)}
          className="w-full text-left glass rounded-[var(--radius-lg)] p-3.5 tap-shrink"
        >
          <div className="flex items-center gap-3">
            {group.photoURL ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={group.photoURL} alt="" className="w-10 h-10 rounded-full object-cover shrink-0" />
            ) : (
              <div className="w-10 h-10 rounded-full bg-[var(--accent)]/10 flex items-center justify-center shrink-0">
                <span className="text-base font-semibold text-[var(--accent)]">{group.name.charAt(0).toUpperCase()}</span>
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="font-medium text-[var(--label-primary)] truncate">{group.name}</p>
              <p className="text-[13px] text-[var(--label-tertiary)]">
                {group.memberIds.length} member{group.memberIds.length !== 1 ? "s" : ""}
                {group.description ? ` · ${group.description}` : ""}
              </p>
            </div>
            <span className="text-[var(--label-tertiary)] text-xl shrink-0 ml-2">›</span>
          </div>
        </button>

        <div className="glass rounded-full p-1 text-sm font-medium flex">
          <button
            onClick={() => setTab("balances")}
            className={`flex-1 rounded-full py-2 transition tap-shrink ${
              tab === "balances" ? "bg-[var(--surface)] shadow-sm text-[var(--label-primary)]" : "text-[var(--label-secondary)]"
            }`}
          >Balances</button>
          <button
            onClick={() => setTab("activity")}
            className={`flex-1 rounded-full py-2 transition tap-shrink ${
              tab === "activity" ? "bg-[var(--surface)] shadow-sm text-[var(--label-primary)]" : "text-[var(--label-secondary)]"
            }`}
          >Activity</button>
        </div>

        {tab === "balances" && (
          <div className="space-y-2.5">
            {simplified.length === 0 && (
              <p className="text-center text-[var(--label-tertiary)] text-sm py-10">Everyone is settled up</p>
            )}
            {simplified.map((t, i) => (
              <Card key={i} className="p-3.5 flex items-center justify-between">
                <p className="text-[15px] text-[var(--label-primary)]">
                  <span className="font-medium">{memberName(t.fromUid)}</span>{" "}
                  <span className="text-[var(--label-tertiary)]">owes</span>{" "}
                  <span className="font-medium">{memberName(t.toUid)}</span>
                </p>
                <div className="flex items-center gap-2 shrink-0 ml-2">
                  <span className="font-semibold text-[var(--label-primary)]">{formatCurrency(t.amount)}</span>
                  {t.fromUid === currentUser.uid && (
                    <GlassButton size="sm" onClick={() => handleOpenSettle(t.toUid, t.amount)} className="!px-3 !py-1 text-xs">Settle</GlassButton>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}

        {tab === "activity" && (
          <div className="space-y-2.5">
            {activeExpenses.length === 0 && settlements.length === 0 && (
              <p className="text-center text-[var(--label-tertiary)] text-sm py-10">No activity yet.</p>
            )}
            {[...activeExpenses.map((e) => ({ type: "expense" as const, data: e, ts: e.updatedAt || e.createdAt })),
              ...editedExpenses.map((e) => ({ type: "expense" as const, data: e, ts: e.updatedAt || e.createdAt })),
              ...deletedExpenses.map((e) => ({ type: "expense" as const, data: e, ts: e.updatedAt || e.createdAt })),
              ...settlements.map((s) => ({ type: "settlement" as const, data: s, ts: s.createdAt }))]
              .sort((a, b) => b.ts - a.ts)
              .map((item, i) => {
                if (item.type === "expense") {
                  const e = item.data;
                  if (e.editAction === "deleted") {
                    return (
                      <div key={i} className="rounded-[var(--radius-lg)] border border-[var(--danger)]/20 bg-[var(--danger)]/5 p-3.5 opacity-60">
                        <p className="text-[14px] text-[var(--label-tertiary)]">
                          <span className="font-medium">{memberName(e.createdBy)}</span> deleted expense <span className="line-through">{e.description}</span>
                        </p>
                      </div>
                    );
                  }
                  if (e.editAction === "edited") {
                    return (
                      <Card key={i} className="p-3.5">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-medium text-[var(--label-primary)] truncate">{e.description}</p>
                          <p className="font-semibold text-[var(--label-primary)] shrink-0">{formatCurrency(e.amount)}</p>
                        </div>
                        <p className="text-[13px] text-[var(--label-tertiary)] mt-0.5">
                          {memberName(e.paidBy)} paid · split {e.splits.length} ways · edited
                        </p>
                        {e.receiptUrls.length > 0 && (
                          <div className="flex gap-2 mt-1">
                            {e.receiptUrls.map((url, ri) => (
                              <a key={ri} href={url} target="_blank" rel="noopener noreferrer" className="text-[13px] text-[var(--accent)]">Receipt {ri + 1}</a>
                            ))}
                          </div>
                        )}
                      </Card>
                    );
                  }
                  return (
                    <Card key={i} className="p-3.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-[var(--label-primary)] truncate">{e.description}</p>
                          <p className="text-[13px] text-[var(--label-tertiary)] mt-0.5">
                            {memberName(e.paidBy)} paid · split {e.splits.length} ways
                          </p>
                          {e.receiptUrls.length > 0 && (
                            <div className="flex gap-2 mt-1">
                              {e.receiptUrls.map((url, ri) => (
                                <a key={ri} href={url} target="_blank" rel="noopener noreferrer" className="text-[13px] text-[var(--accent)]">Receipt {ri + 1}</a>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-1 shrink-0">
                          <span className="font-semibold text-[var(--label-primary)]">{formatCurrency(e.amount)}</span>
                          {isAdmin && (
                            <div className="flex gap-1">
                              <button onClick={() => handleEditExpense(e)} className="text-[11px] text-[var(--accent)] tap-shrink">Edit</button>
                              <button onClick={() => handleDeleteExpense(e)} className="text-[11px] text-[var(--danger)] tap-shrink">Delete</button>
                            </div>
                          )}
                        </div>
                      </div>
                    </Card>
                  );
                }

                const s = item.data;
                return (
                  <div key={i} className={`rounded-[var(--radius-lg)] border p-3.5 ${
                    s.status === "pending" ? "border-[var(--warning)]/25 bg-[var(--warning)]/10"
                    : s.status === "approved" ? "border-[var(--success)]/25 bg-[var(--success)]/10"
                    : "border-[var(--danger)]/25 bg-[var(--danger)]/10"
                  }`}>
                    <p className="text-[15px] text-[var(--label-primary)]">
                      {s.status === "pending" ? (
                        <><span className="font-medium">{memberName(s.fromUid)}</span> requested <span className="font-semibold">{formatCurrency(s.amount)}</span> from <span className="font-medium">{memberName(s.toUid)}</span></>
                      ) : s.status === "rejected" ? (
                        <><span className="font-medium">{memberName(s.fromUid)}</span> requested <span className="font-semibold">{formatCurrency(s.amount)}</span> from <span className="font-medium">{memberName(s.toUid)}</span> (rejected)</>
                      ) : (
                        <><span className="font-medium">{memberName(s.fromUid)}</span> paid <span className="font-medium">{memberName(s.toUid)}</span> <span className="font-semibold">{formatCurrency(s.amount)}</span></>
                      )}
                    </p>
                    {s.note && <p className="text-[13px] text-[var(--label-tertiary)] mt-0.5">{s.note}</p>}
                    {s.receiptUrls.length > 0 && (
                      <div className="flex gap-2 mt-1">
                        {s.receiptUrls.map((url, ri) => (
                          <a key={ri} href={url} target="_blank" rel="noopener noreferrer" className="text-[13px] text-[var(--accent)]">Screenshot {ri + 1}</a>
                        ))}
                      </div>
                    )}
                    {s.status === "pending" && s.toUid === currentUser.uid && (
                      <div className="flex gap-2 mt-2">
                        <GlassButton size="sm" onClick={() => handleApproveSettlement(s)} className="!px-3 !py-1 text-xs">Approve</GlassButton>
                        <GlassButton size="sm" variant="ghost" onClick={() => handleRejectSettlement(s)} className="!px-3 !py-1 text-xs">Reject</GlassButton>
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        )}
      </main>

      <div className="fixed bottom-0 left-0 right-0 max-w-md mx-auto w-full p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <GlassButton variant="primary" size="lg" className="w-full shadow-lg" onClick={() => setShowAddExpense(true)}>
          + Add Expense
        </GlassButton>
      </div>

      {showAddExpense && (
        <AddExpenseModal group={group} currentUid={currentUser.uid} onClose={() => setShowAddExpense(false)} />
      )}

      {settleTarget && (
        <SettleUpModal
          groupId={group.id}
          fromUid={currentUser.uid}
          toUid={settleTarget.toUid}
          toName={memberName(settleTarget.toUid)}
          suggestedAmount={settleTarget.amount}
          expensesOwed={getExpensesOwedTo(settleTarget.toUid)}
          onClose={() => setSettleTarget(null)}
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
              <p className="text-sm font-medium text-[var(--label-secondary)] mb-2">Members</p>
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
                    <div className="min-w-0">
                      <p className="text-[14px] text-[var(--label-primary)] truncate">
                        {memberName(uid)}{uid === group.createdBy && <span className="text-[11px] text-[var(--label-tertiary)] ml-1">(Admin)</span>}
                      </p>
                      <p className="text-[12px] text-[var(--label-tertiary)] truncate">{group.members[uid]?.email || ""}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </GlassModal>
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
            {editError && <p className="text-sm text-[var(--danger)]">{editError}</p>}
            <GlassButton disabled={editBusy} className="w-full">{editBusy ? "Saving…" : "Save"}</GlassButton>
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
