"use client";

import { useState } from "react";
import { Group } from "@/lib/types";
import { addExpense } from "@/lib/firestore";
import { uploadMultipleReceipts } from "@/lib/storage";
import { splitEqually, formatCurrency } from "@/lib/balance";
import { EXPENSE_CATEGORIES } from "@/lib/categories";
import { useToast } from "@/components/ui/Toast";
import { activateFileInputOnKey } from "@/lib/keyboard";

function CategoryIcon({ id, active }: { id: string; active: boolean }) {
  const stroke = active ? "var(--brand)" : "var(--text-secondary)";
  const common = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke, strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (id) {
    case "meal":
      return (<svg {...common}><path d="M4 3v7a2 2 0 0 0 2 2h0V3M6 3v18M15 3s-3 1.5-3 5 3 4 3 4v10" /></svg>);
    case "fuel":
      return (<svg {...common}><path d="M3 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M3 12h10" /><path d="M13 8h2a2 2 0 0 1 2 2v6a1.5 1.5 0 0 0 3 0V9l-3-3" /></svg>);
    case "hotel":
      return (<svg {...common}><path d="M4 21V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17M16 8h3a1 1 0 0 1 1 1v12M8 7h1M12 7h1M8 11h1M12 11h1M8 15h1M12 15h1" /></svg>);
    case "transport":
      return (<svg {...common}><path d="M5 17h14M5 17a2 2 0 1 1-4 0M23 17a2 2 0 1 1-4 0M5 17l1.5-6a2 2 0 0 1 2-1.5h7a2 2 0 0 1 2 1.5L19 17" /></svg>);
    case "shopping":
      return (<svg {...common}><path d="M6 2 4 6v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6l-2-4zM4 6h16M16 10a4 4 0 0 1-8 0" /></svg>);
    default:
      return (<svg {...common}><circle cx="5" cy="12" r="1.6" fill={stroke} stroke="none" /><circle cx="12" cy="12" r="1.6" fill={stroke} stroke="none" /><circle cx="19" cy="12" r="1.6" fill={stroke} stroke="none" /></svg>);
  }
}

export default function AddExpenseModal({
  group,
  currentUid,
  onClose,
  prefillReceipt,
}: {
  group: Group;
  currentUid: string;
  onClose: () => void;
  prefillReceipt?: File | null;
}) {
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("meal");
  const [paidBy, setPaidBy] = useState(currentUid);
  const [splitMembers, setSplitMembers] = useState<string[]>(group.memberIds);
  const [note, setNote] = useState("");
  const [receiptFiles, setReceiptFiles] = useState<File[]>(prefillReceipt ? [prefillReceipt] : []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const showToast = useToast();

  const parsedAmount = parseFloat(amount) || 0;
  const eachPays = splitMembers.length > 0 ? parsedAmount / splitMembers.length : 0;
  const memberName = (uid: string) => (uid === currentUid ? "You" : group.members[uid]?.displayName || "User");
  const categoryLabel = EXPENSE_CATEGORIES.find((c) => c.id === category)?.label || "Expense";
  const categoryEmoji = EXPENSE_CATEGORIES.find((c) => c.id === category)?.emoji || "🧾";

  function toggleSplit(uid: string) {
    setSplitMembers((prev) => (prev.includes(uid) ? prev.filter((m) => m !== uid) : [...prev, uid]));
  }

  function handleReceipts(e: React.ChangeEvent<HTMLInputElement>) {
    setReceiptFiles((prev) => [...prev, ...Array.from(e.target.files || [])]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (parsedAmount <= 0 || splitMembers.length === 0) {
      setError("Enter an amount and pick who's splitting.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      let receiptUrls: string[] = [];
      if (receiptFiles.length > 0) {
        receiptUrls = await uploadMultipleReceipts(group.id, receiptFiles);
      }
      const splits = splitEqually(parsedAmount, splitMembers);
      await addExpense(group.id, {
        description: note.trim() || categoryLabel,
        amount: parsedAmount,
        paidBy,
        splitType: "equal",
        splits,
        createdBy: currentUid,
        receiptUrls,
        category,
      });
      showToast({ message: `${categoryEmoji} Expense added · ${formatCurrency(parsedAmount)}` });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add expense");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 bg-[var(--background)] flex flex-col animate-modal-in">
      <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto scroll-momentum max-w-md w-full mx-auto px-5 pt-[max(0.75rem,env(safe-area-inset-top))] pb-36">
          {/* Header */}
          <div className="flex items-center justify-between pt-2">
            <button type="button" onClick={onClose} aria-label="Close" className="w-11 h-11 rounded-2xl bg-[var(--surface)] shadow-[0_2px_10px_-2px_rgba(0,0,0,0.12)] flex items-center justify-center tap-shrink">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
            </button>
            <div className="text-center">
              <p className="text-[18px] font-bold text-[var(--text-primary)]">Add Expense</p>
              <p className="text-[13px] text-[var(--text-tertiary)]">{group.name}</p>
            </div>
            <div className="w-11 h-11" />
          </div>

          {/* Amount hero */}
          <div className="relative mt-5">
            <span className="absolute right-0 top-1/2 -translate-y-1/2 text-[52px] opacity-60 select-none pointer-events-none" aria-hidden>{categoryEmoji}</span>
            <p className="text-[15px] font-semibold text-[var(--brand)]">How much was it?</p>
            <div className="flex items-center mt-1">
              <span className="text-[46px] font-extrabold text-[var(--text-primary)]">₹</span>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                autoFocus
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                className="w-full bg-transparent outline-none text-[46px] font-extrabold text-[var(--text-primary)] placeholder:text-[var(--text-quaternary)]"
              />
            </div>
            <span className="inline-flex items-center gap-1 mt-2 rounded-full bg-[var(--fill)] px-3 py-1 text-[13px] font-semibold text-[var(--text-secondary)]">
              INR
            </span>
          </div>

          {/* Category */}
          <div className="mt-6 bg-[var(--surface)] rounded-[22px] p-4 shadow-[0_2px_8px_rgba(0,0,0,0.03),0_16px_36px_-24px_rgba(0,0,0,0.2)]">
            <p className="text-[15px] font-semibold text-[var(--text-primary)] mb-3">What was this for?</p>
            <div className="grid grid-cols-3 gap-2.5">
              {EXPENSE_CATEGORIES.map((c) => {
                const active = category === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setCategory(c.id)}
                    className={`flex flex-col items-center gap-1.5 rounded-2xl py-3 border tap-shrink ${
                      active ? "bg-[var(--tint-accent)] border-[var(--brand)]" : "bg-[var(--surface)] border-[var(--border-subtle)]"
                    }`}
                  >
                    <CategoryIcon id={c.id} active={active} />
                    <span className={`text-[12px] font-medium ${active ? "text-[var(--brand)]" : "text-[var(--text-secondary)]"}`}>{c.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Who paid */}
          <div className="mt-6">
            <p className="text-[15px] font-semibold text-[var(--text-primary)] mb-3">Who paid?</p>
            <div className="flex gap-4 overflow-x-auto scroll-momentum -mx-5 px-5 pb-1">
              {group.memberIds.map((uid) => {
                const active = paidBy === uid;
                return (
                  <button
                    key={uid}
                    type="button"
                    onClick={() => setPaidBy(uid)}
                    className="flex flex-col items-center gap-1.5 shrink-0 tap-shrink w-16"
                  >
                    <span className="relative">
                      {group.members[uid]?.photoURL ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={group.members[uid].photoURL} alt="" className={`w-14 h-14 rounded-full object-cover ${active ? "ring-2 ring-indigo-500 ring-offset-2 ring-offset-[var(--background)]" : ""}`} />
                      ) : (
                        <span className={`w-14 h-14 rounded-full bg-[var(--fill)] flex items-center justify-center text-[18px] font-semibold text-[var(--text-secondary)] ${active ? "ring-2 ring-indigo-500 ring-offset-2 ring-offset-[var(--background)]" : ""}`}>
                          {memberName(uid).charAt(0).toUpperCase()}
                        </span>
                      )}
                      {active && (
                        <span className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-[var(--brand-solid)] border-2 border-[var(--background)] flex items-center justify-center">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                        </span>
                      )}
                    </span>
                    <span className={`text-[13px] font-medium truncate w-full text-center ${active ? "text-[var(--brand)]" : "text-[var(--text-secondary)]"}`}>
                      {memberName(uid)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Split between */}
          <div className="mt-6">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[15px] font-semibold text-[var(--text-primary)]">Split between</p>
              <span className="text-[14px] font-semibold text-[var(--brand)]">Equal split</span>
            </div>
            <div className="flex gap-2 flex-wrap mb-3">
              {group.memberIds.map((uid) => {
                const inSplit = splitMembers.includes(uid);
                return (
                  <button
                    key={uid}
                    type="button"
                    onClick={() => toggleSplit(uid)}
                    className={`flex items-center gap-1.5 rounded-full border pl-1.5 pr-2.5 py-1 tap-shrink ${
                      inSplit ? "bg-[var(--surface)] border-[var(--border-subtle)]" : "bg-[var(--fill-soft)] border-[var(--border-subtle)] opacity-50"
                    }`}
                  >
                    {group.members[uid]?.photoURL ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={group.members[uid].photoURL} alt="" className="w-6 h-6 rounded-full object-cover" />
                    ) : (
                      <span className="w-6 h-6 rounded-full bg-[var(--fill)] flex items-center justify-center text-[10px] font-medium text-[var(--text-secondary)]">
                        {memberName(uid).charAt(0).toUpperCase()}
                      </span>
                    )}
                    <span className="text-[13px] font-medium text-[var(--text-primary)]">{memberName(uid)}</span>
                    <span className="text-[var(--text-tertiary)] text-[15px] leading-none">{inSplit ? "×" : "+"}</span>
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-3 rounded-[18px] bg-[var(--fill-soft)] p-3.5">
              <span className="w-10 h-10 rounded-full bg-[var(--tint-accent-2)] flex items-center justify-center shrink-0">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /></svg>
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-[15px] font-semibold text-[var(--text-primary)]">Split equally</p>
                <p className="text-[13px] text-[var(--text-tertiary)]">{splitMembers.length} way split</p>
              </div>
              <div className="text-right">
                <p className="text-[12px] text-[var(--text-tertiary)]">Each pays</p>
                <p className="text-[16px] font-bold text-[var(--brand)]">{formatCurrency(eachPays)}</p>
              </div>
            </div>
          </div>

          {/* Add to (group, fixed) */}
          <div className="mt-6">
            <p className="text-[15px] font-semibold text-[var(--text-primary)] mb-3">Add to</p>
            <div className="flex items-center gap-3 rounded-[18px] bg-[var(--surface)] p-3.5 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
              {group.photoURL ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={group.photoURL} alt="" className="w-10 h-10 rounded-full object-cover shrink-0" />
              ) : (
                <span className="w-10 h-10 rounded-full bg-[var(--tint-accent-2)] flex items-center justify-center text-[16px] font-bold text-[var(--brand)] shrink-0">
                  {group.name.charAt(0).toUpperCase()}
                </span>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-[15px] font-semibold text-[var(--text-primary)] truncate">{group.name}</p>
                <p className="text-[13px] text-[var(--text-tertiary)]">{group.memberIds.length} members</p>
              </div>
            </div>
          </div>

          {/* Note */}
          <div className="mt-6">
            <p className="text-[15px] font-semibold text-[var(--text-primary)] mb-2">Note (optional)</p>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add a note (e.g. Lunch at the beach)"
              className="w-full rounded-[16px] border border-[var(--border-subtle)] bg-[var(--surface)] px-4 py-3 text-[15px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none focus:border-[var(--brand)]"
            />
          </div>

          {/* Receipt */}
          <div className="mt-6">
            <p className="text-[15px] font-semibold text-[var(--text-primary)] mb-2">Receipt (optional)</p>
            <label
              role="button"
              tabIndex={0}
              aria-label="Add receipt image"
              onKeyDown={activateFileInputOnKey}
              className="flex items-center gap-3 rounded-[16px] border border-dashed border-[var(--brand)] bg-[var(--tint-accent)] px-4 py-3.5 cursor-pointer tap-shrink"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m21.44 11.05-9.19 9.19a5 5 0 0 1-7.07-7.07l9.19-9.19a3.5 3.5 0 1 1 4.95 4.95L9.9 18.07a1.5 1.5 0 1 1-2.12-2.12l8.49-8.49" /></svg>
              <div className="flex-1">
                <p className="text-[14px] font-semibold text-[var(--brand)]">
                  {receiptFiles.length > 0 ? `${receiptFiles.length} file(s) selected` : "Add receipt"}
                </p>
                <p className="text-[12px] text-[var(--text-tertiary)]">Upload image (Max 10MB)</p>
              </div>
              <span className="w-10 h-10 rounded-xl bg-[var(--tint-accent-2)] flex items-center justify-center shrink-0">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>
              </span>
              <input type="file" accept="image/*" multiple onChange={handleReceipts} className="hidden" />
            </label>
          </div>

          {error && <p className="text-sm text-[var(--danger)] mt-4">{error}</p>}
        </div>

        {/* Sticky save bar */}
        <div className="max-w-md w-full mx-auto px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2">
          <button
            type="submit"
            disabled={busy}
            className="w-full flex items-center justify-center gap-2 rounded-full bg-[var(--brand-solid)] text-white py-4 text-[16px] font-semibold shadow-[0_12px_30px_-8px_rgba(79,70,229,0.6)] tap-shrink disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save Expense"}
          </button>
        </div>
      </form>
    </div>
  );
}
