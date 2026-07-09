"use client";

import { useEffect, useState } from "react";
import { subscribeToExpenses, subscribeToSettlements } from "@/lib/firestore";
import { formatCurrency } from "@/lib/balance";
import { Group, Expense, Settlement } from "@/lib/types";

export type NotificationKind = "request" | "status" | "expense";

export interface NotificationItem {
  key: string;
  ts: number;
  groupId: string;
  groupName: string;
  kind: NotificationKind;
  title: React.ReactNode;
  subtitle: string;
  settlement?: Settlement; // present for actionable "request" items
}

/**
 * Headless: subscribes to a group's data and reports items that are relevant
 * to the current user as notifications (incoming payment requests, status
 * changes on their own requests, and expenses added by others).
 */
export default function NotificationFeeder({
  group,
  currentUid,
  onItems,
}: {
  group: Group;
  currentUid: string;
  onItems: (groupId: string, items: NotificationItem[]) => void;
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
    const items: NotificationItem[] = [];

    settlements.forEach((s) => {
      if (s.toUid === currentUid && s.status === "pending") {
        items.push({
          key: `req-${s.id}`,
          ts: s.updatedAt || s.createdAt,
          groupId: group.id,
          groupName: group.name,
          kind: "request",
          title: (
            <>
              <span className="font-semibold">{name(s.fromUid)}</span>
              <span className="text-slate-400"> says they paid you </span>
              <span className="font-semibold">{formatCurrency(s.amount)}</span>
            </>
          ),
          subtitle: `${group.name}${s.note ? ` · ${s.note}` : ""}`,
          settlement: s,
        });
      } else if (s.fromUid === currentUid && s.status !== "pending") {
        items.push({
          key: `st-${s.id}`,
          ts: s.updatedAt || s.createdAt,
          groupId: group.id,
          groupName: group.name,
          kind: "status",
          title: (
            <>
              <span className="text-slate-400">Your payment to </span>
              <span className="font-semibold">{name(s.toUid)}</span>
              <span className="text-slate-400"> was </span>
              <span className={s.status === "approved" ? "font-semibold text-green-600" : "font-semibold text-red-500"}>
                {s.status}
              </span>
            </>
          ),
          subtitle: `${formatCurrency(s.amount)} · ${group.name}`,
        });
      }
    });

    expenses
      .filter((e) => !e.editAction && e.createdBy !== currentUid)
      .forEach((e) => {
        items.push({
          key: `exp-${e.id}`,
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
          subtitle: `${formatCurrency(e.amount)} · ${group.name}`,
        });
      });

    onItems(group.id, items);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expenses, settlements, group.id, group.name]);

  return null;
}
