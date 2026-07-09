"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import {
  subscribeToGroup,
  subscribeToExpenses,
  subscribeToSettlements,
} from "@/lib/firestore";
import { Group, Expense, Settlement } from "@/lib/types";
import { computeBalances, simplifyDebts, formatCurrency } from "@/lib/balance";
import TopBar from "@/components/TopBar";
import Card from "@/components/ui/Card";
import GlassButton from "@/components/ui/GlassButton";
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

  const balances = computeBalances(group.memberIds, expenses, settlements);
  const myBalance = balances.find((b) => b.uid === currentUser.uid)?.netAmount ?? 0;
  const simplified = simplifyDebts(balances);

  function memberName(uid: string) {
    if (uid === currentUser.uid) return "You";
    return group?.members[uid]?.displayName || "Unknown";
  }

  const balanceColor =
    myBalance > 0.01 ? "text-[var(--success)]" : myBalance < -0.01 ? "text-[var(--danger)]" : "text-[var(--label-primary)]";

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

        <div className="glass rounded-full p-1 text-sm font-medium flex">
          <button
            onClick={() => setTab("balances")}
            className={`flex-1 rounded-full py-2 transition tap-shrink ${
              tab === "balances"
                ? "bg-[var(--surface)] shadow-sm text-[var(--label-primary)]"
                : "text-[var(--label-secondary)]"
            }`}
          >
            Balances
          </button>
          <button
            onClick={() => setTab("activity")}
            className={`flex-1 rounded-full py-2 transition tap-shrink ${
              tab === "activity"
                ? "bg-[var(--surface)] shadow-sm text-[var(--label-primary)]"
                : "text-[var(--label-secondary)]"
            }`}
          >
            Activity
          </button>
        </div>

        {tab === "balances" && (
          <div className="space-y-2.5">
            {simplified.length === 0 && (
              <p className="text-center text-[var(--label-tertiary)] text-sm py-10">
                Everyone is settled up 🎉
              </p>
            )}
            {simplified.map((t, i) => (
              <Card key={i} className="p-3.5 flex items-center justify-between">
                <p className="text-[15px] text-[var(--label-primary)]">
                  <span className="font-medium">{memberName(t.fromUid)}</span>{" "}
                  <span className="text-[var(--label-tertiary)]">owes</span>{" "}
                  <span className="font-medium">{memberName(t.toUid)}</span>
                </p>
                <div className="flex items-center gap-2 shrink-0 ml-2">
                  <span className="font-semibold text-[var(--label-primary)]">
                    {formatCurrency(t.amount)}
                  </span>
                  {t.fromUid === currentUser.uid && (
                    <GlassButton
                      size="sm"
                      onClick={() => setSettleTarget({ toUid: t.toUid, amount: t.amount })}
                      className="!px-3 !py-1 text-xs"
                    >
                      Settle
                    </GlassButton>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}

        {tab === "activity" && (
          <div className="space-y-2.5">
            {expenses.length === 0 && settlements.length === 0 && (
              <p className="text-center text-[var(--label-tertiary)] text-sm py-10">
                No activity yet.
              </p>
            )}
            {[...expenses.map((e) => ({ type: "expense" as const, data: e, createdAt: e.createdAt })),
              ...settlements.map((s) => ({ type: "settlement" as const, data: s, createdAt: s.createdAt }))]
              .sort((a, b) => b.createdAt - a.createdAt)
              .map((item, i) =>
                item.type === "expense" ? (
                  <Card key={i} className="p-3.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium text-[var(--label-primary)] truncate">
                        {item.data.description}
                      </p>
                      <p className="font-semibold text-[var(--label-primary)] shrink-0">
                        {formatCurrency(item.data.amount)}
                      </p>
                    </div>
                    <p className="text-[13px] text-[var(--label-tertiary)] mt-0.5">
                      {memberName(item.data.paidBy)} paid · split {item.data.splits.length} ways
                    </p>
                    {item.data.receiptUrl && (
                      <a
                        href={item.data.receiptUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[13px] text-[var(--accent)] mt-1 inline-block"
                      >
                        View receipt
                      </a>
                    )}
                  </Card>
                ) : (
                  <div
                    key={i}
                    className="rounded-[var(--radius-lg)] border border-[var(--success)]/25 bg-[var(--success)]/10 p-3.5"
                  >
                    <p className="text-[15px] text-[var(--label-primary)]">
                      <span className="font-medium">{memberName(item.data.fromUid)}</span> paid{" "}
                      <span className="font-medium">{memberName(item.data.toUid)}</span>{" "}
                      <span className="font-semibold">{formatCurrency(item.data.amount)}</span>
                    </p>
                    {item.data.receiptUrl && (
                      <a
                        href={item.data.receiptUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[13px] text-[var(--accent)] mt-1 inline-block"
                      >
                        View screenshot
                      </a>
                    )}
                  </div>
                )
              )}
          </div>
        )}
      </main>

      <div className="fixed bottom-0 left-0 right-0 max-w-md mx-auto w-full p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <GlassButton
          variant="primary"
          size="lg"
          className="w-full shadow-lg"
          onClick={() => setShowAddExpense(true)}
        >
          + Add Expense
        </GlassButton>
      </div>

      {showAddExpense && (
        <AddExpenseModal
          group={group}
          currentUid={currentUser.uid}
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
          onClose={() => setSettleTarget(null)}
        />
      )}
    </div>
  );
}
