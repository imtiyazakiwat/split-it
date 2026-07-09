"use client";

import { useEffect } from "react";
import { subscribeToExpenses, subscribeToSettlements } from "@/lib/firestore";
import { formatCurrency } from "@/lib/balance";
import { Group, Expense, Settlement } from "@/lib/types";
import { useState } from "react";

export interface GlobalActivityItem {
  key: string;
  ts: number;
  groupId: string;
  groupName: string;
  kind: "expense" | "settlement";
  title: React.ReactNode;
  subtitle: string;
}

/**
 * Headless component: subscribes to one group's expenses/settlements and
 * reports resolved activity items to the parent. Renders nothing.
 */
export default function GroupActivityFeeder({
  group,
  currentUid,
  onItems,
}: {
  group: Group;
  currentUid: string;
  onItems: (groupId: string, items: GlobalActivityItem[]) => void;
}) {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);

  useEffect(() => {
    const unsubs = [
      subscribeToExpenses(group.id, setExpenses),
      subscribeToSettlements(group.id, setSettlements),
    ];
    return () => unsubs.forEach((u) => u());
  }, [group.id]);

  const name = (uid: string) =>
    uid === currentUid ? "You" : group.members[uid]?.displayName || "Someone";

  useEffect(() => {
    const items: GlobalActivityItem[] = [];

    expenses
      .filter((e) => !e.editAction)
      .forEach((e) => {
        items.push({
          key: `e-${e.id}`,
          ts: e.updatedAt || e.createdAt,
          groupId: group.id,
          groupName: group.name,
          kind: "expense",
          title: (
            <>
              <span className="font-semibold">{name(e.createdBy)}</span>
              <span className="text-slate-400"> added </span>
              <span className="font-semibold text-indigo-600">{e.description}</span>
            </>
          ),
          subtitle: `${formatCurrency(e.amount)} · split ${e.splits.length} ways`,
        });
      });

    settlements.forEach((s) => {
      const title =
        s.status === "approved" ? (
          <>
            <span className="font-semibold">{name(s.fromUid)}</span>
            <span className="text-slate-400"> paid </span>
            <span className="font-semibold text-green-600">{name(s.toUid)}</span>
          </>
        ) : s.status === "pending" ? (
          <>
            <span className="font-semibold">{name(s.fromUid)}</span>
            <span className="text-slate-400"> requested from </span>
            <span className="font-semibold">{name(s.toUid)}</span>
          </>
        ) : (
          <>
            <span className="font-semibold">{name(s.fromUid)}</span>
            <span className="text-slate-400"> — request rejected</span>
          </>
        );
      items.push({
        key: `s-${s.id}`,
        ts: s.createdAt,
        groupId: group.id,
        groupName: group.name,
        kind: "settlement",
        title,
        subtitle: `${formatCurrency(s.amount)}${s.note ? ` · ${s.note}` : ""}`,
      });
    });

    onItems(group.id, items);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expenses, settlements, group.id, group.name]);

  return null;
}
