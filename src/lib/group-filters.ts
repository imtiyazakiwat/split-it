import { Group } from "./types";
import { isSettled } from "./money";

/**
 * Which tab a group belongs under on the home screen.
 *
 * The home list grows without bound: finished trips and squared-up flatshares
 * sit alongside the two groups actually needing attention. Splitting them apart
 * is a *view* concern only — nothing here changes a balance, and the running
 * totals deliberately keep counting every group, archived or not, so tidying up
 * can never hide money someone still owes.
 */
export type GroupTab = "active" | "settled" | "archived";

export const GROUP_TABS: { id: GroupTab; label: string }[] = [
  { id: "active", label: "Active" },
  { id: "settled", label: "Settled" },
  { id: "archived", label: "Archived" },
];

/** True when this member has archived the group out of their own home screen. */
export function isArchivedFor(group: Group, uid: string): boolean {
  return !!group.members?.[uid]?.archivedAt;
}

/** When they archived it, for ordering the Archived tab. */
export function archivedAtFor(group: Group, uid: string): number {
  return group.members?.[uid]?.archivedAt ?? 0;
}

export interface GroupTabInput {
  group: Group;
  /** The viewer's net in this group. */
  net: number;
  /** False while the group's expenses and settlements are still arriving. */
  loaded: boolean;
  /** Settlement requests waiting on the viewer to approve or decline. */
  pendingCount: number;
  /** Whether any expense or settlement exists at all. */
  hasActivity: boolean;
}

/**
 * Sorts a group into a tab.
 *
 * "Settled" means specifically: this group had money moving, the viewer is now
 * square, and nothing is waiting on them. The three exclusions all matter —
 *
 *   - a brand-new group has a zero balance but is not settled, it is empty, and
 *     burying it under "Settled" would be baffling right after creating it;
 *   - a group with a settlement request awaiting the viewer's approval has a
 *     zero-looking balance precisely *because* the request hasn't been applied
 *     yet, so it needs to stay in front of them; and
 *   - a group whose ledger hasn't loaded reads as net 0, which would make every
 *     group flicker through "Settled" on every cold start.
 */
export function classifyGroup(input: GroupTabInput, uid: string): GroupTab {
  if (isArchivedFor(input.group, uid)) return "archived";
  const squared =
    input.loaded && input.hasActivity && input.pendingCount === 0 && isSettled(input.net);
  return squared ? "settled" : "active";
}

/** How many groups sit under each tab, for the badges. */
export function countByTab(
  inputs: GroupTabInput[],
  uid: string
): Record<GroupTab, number> {
  const counts: Record<GroupTab, number> = { active: 0, settled: 0, archived: 0 };
  for (const input of inputs) counts[classifyGroup(input, uid)] += 1;
  return counts;
}
