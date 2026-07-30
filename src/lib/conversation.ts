import { activeExpenses } from "./balance";
import { GroupDataset } from "./global-balance";
import { ChatMessage, DirectTransfer, Expense, Settlement } from "./types";

/**
 * The per-person conversation: every money event between two people, in the
 * order it happened, with chat messages woven in.
 *
 * Nothing here is stored. A payment lives in exactly one place — a group's
 * settlements, or the top-level `transfers` collection — and this module
 * projects those records onto a timeline. Copying them into the chat thread
 * instead would give the app two sources of truth for money, which is the one
 * kind of drift it can't tolerate.
 */

export type ConversationSide = "me" | "them" | "system";

export type ConversationKind = "message" | "transfer" | "settlement" | "expense";

export interface ConversationItem {
  /** Stable across re-renders: React reuses rows by this, not by index. */
  key: string;
  ts: number;
  kind: ConversationKind;
  /** Which side of the thread the bubble hangs on. */
  side: ConversationSide;
  message?: ChatMessage;
  transfer?: DirectTransfer;
  settlement?: Settlement;
  expense?: Expense;
  /** The group a settlement or expense belongs to. */
  groupId?: string;
  groupName?: string;
  /** On expense rows: what each of the two owed on it. */
  myShare?: number;
  theirShare?: number;
}

export interface ConversationInput {
  meUid: string;
  otherUid: string;
  /** Groups the current user belongs to, with their expenses and settlements. */
  datasets: GroupDataset[];
  transfers: DirectTransfer[];
  messages: ChatMessage[];
}

const isPair = (a: string, b: string, x: string, y: string) =>
  (a === x && b === y) || (a === y && b === x);

/**
 * Builds the timeline, oldest first — the direction a chat reads in.
 */
export function buildConversation({
  meUid,
  otherUid,
  datasets,
  transfers,
  messages,
}: ConversationInput): ConversationItem[] {
  const items: ConversationItem[] = [];

  for (const m of messages) {
    items.push({
      key: `msg-${m.id}`,
      ts: m.createdAt,
      kind: "message",
      side: m.fromUid === meUid ? "me" : "them",
      message: m,
    });
  }

  for (const t of transfers) {
    if (!isPair(t.fromUid, t.toUid, meUid, otherUid)) continue;
    items.push({
      key: `tr-${t.id}`,
      // Follows the record as its status changes, so a transfer you confirm
      // today doesn't stay buried where it was first sent.
      ts: t.createdAt,
      kind: "transfer",
      side: t.fromUid === meUid ? "me" : "them",
      transfer: t,
    });
  }

  for (const { group, expenses, settlements } of datasets) {
    if (!group.memberIds?.includes(meUid) || !group.memberIds?.includes(otherUid)) continue;

    for (const s of settlements) {
      if (!isPair(s.fromUid, s.toUid, meUid, otherUid)) continue;
      // Transfer-backed settlements are already on the timeline as the transfer
      // they came from; showing the settlement too would read as two payments.
      if (s.kind === "transfer") continue;
      items.push({
        key: `st-${group.id}-${s.id}`,
        ts: s.createdAt,
        kind: "settlement",
        side: s.fromUid === meUid ? "me" : "them",
        settlement: s,
        groupId: group.id,
        groupName: group.name,
      });
    }

    for (const e of activeExpenses(expenses)) {
      // Only expenses that actually put these two on opposite sides of a debt.
      const mine = e.splits.find((s) => s.uid === meUid)?.amount ?? 0;
      const theirs = e.splits.find((s) => s.uid === otherUid)?.amount ?? 0;
      const relevant =
        (e.paidBy === meUid && theirs > 0) || (e.paidBy === otherUid && mine > 0);
      if (!relevant) continue;
      items.push({
        key: `ex-${group.id}-${e.id}`,
        ts: e.createdAt,
        kind: "expense",
        // Expenses are context, not something either person "said".
        side: "system",
        expense: e,
        groupId: group.id,
        groupName: group.name,
        myShare: mine,
        theirShare: theirs,
      });
    }
  }

  return items.sort((a, b) => a.ts - b.ts || a.key.localeCompare(b.key));
}
