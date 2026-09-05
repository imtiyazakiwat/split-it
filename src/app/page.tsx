"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useGroupData } from "@/lib/group-data-context";
import { createGroup, joinGroupByCode, setGroupArchived } from "@/lib/firestore";
import {
  canRespondToSettlement,
  computeBalances,
  formatCurrency,
} from "@/lib/balance";
import { isSettled } from "@/lib/money";
import { computeCounterpartyBalances } from "@/lib/global-balance";
import {
  archivedAtFor,
  classifyGroup,
  countByTab,
  GROUP_TABS,
  GroupTab,
  isArchivedFor,
} from "@/lib/group-filters";
import LoginScreen from "@/components/LoginScreen";
import GlassModal from "@/components/ui/GlassModal";
import GlassButton from "@/components/ui/GlassButton";
import { GlassField } from "@/components/ui/GlassField";
import BottomNav from "@/components/home/BottomNav";
import GroupRow from "@/components/home/GroupRow";
import HomeSkeleton from "@/components/home/HomeSkeleton";
import Skeleton from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import Logo from "@/components/Logo";

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good Morning,";
  if (h < 17) return "Good Afternoon,";
  return "Good Evening,";
}

export default function Home() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const { groups, groupsLoaded, byGroup, datasets, allLoaded, error } = useGroupData();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"recent" | "name">("recent");
  const [tab, setTab] = useState<GroupTab>("active");
  const [showAdd, setShowAdd] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const showToast = useToast();
  const uid = user?.uid;

  /**
   * Per-group figures, derived once from the shared cache. Each row used to
   * open its own listeners and report balances back up via a callback, which
   * meant the summary could sit on stale or partial numbers.
   */
  const rows = useMemo(() => {
    if (!uid) return [];
    return groups.map((group) => {
      const data = byGroup[group.id];
      const expenses = data?.expenses || [];
      const settlements = data?.settlements || [];
      const balances = computeBalances(group.memberIds, expenses, settlements);
      const net = balances.find((b) => b.uid === uid)?.netAmount ?? 0;
      const lastActivityTs = Math.max(
        group.createdAt || 0,
        ...expenses.map((e) => e.updatedAt || e.createdAt),
        ...settlements.map((s) => s.updatedAt || s.createdAt)
      );
      return {
        group,
        net,
        loaded: !!data?.loaded,
        lastActivityTs,
        pendingCount: settlements.filter((s) => canRespondToSettlement(s, uid)).length,
        hasActivity: expenses.length > 0 || settlements.length > 0,
      };
    });
  }, [groups, byGroup, uid]);

  const tabCounts = useMemo(() => (uid ? countByTab(rows, uid) : { active: 0, settled: 0, archived: 0 }), [rows, uid]);

  const counterparties = useMemo(
    () => (uid ? computeCounterpartyBalances(uid, datasets) : []),
    [uid, datasets]
  );

  if (loading || (!groupsLoaded && user)) {
    return <HomeSkeleton />;
  }

  if (!user) return <LoginScreen />;

  const currentUser = user;

  async function handleCreateGroup(e: React.FormEvent) {
    e.preventDefault();
    if (!groupName.trim()) return;
    setBusy(true);
    setFormError("");
    try {
      const id = await createGroup(groupName.trim(), currentUser.uid, {
        displayName: currentUser.displayName || currentUser.email || "User",
        email: (currentUser.email || "").toLowerCase(),
        photoURL: currentUser.photoURL || "",
      });
      setShowCreate(false);
      setGroupName("");
      showToast({ message: "Group created" });
      router.push(`/groups/${id}`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to create group");
    } finally {
      setBusy(false);
    }
  }

  async function handleJoinGroup(e: React.FormEvent) {
    e.preventDefault();
    if (!joinCode.trim()) return;
    setBusy(true);
    setFormError("");
    try {
      const id = await joinGroupByCode(joinCode.trim(), currentUser.uid, {
        displayName: currentUser.displayName || currentUser.email || "User",
        email: (currentUser.email || "").toLowerCase(),
        photoURL: currentUser.photoURL || "",
      });
      if (!id) {
        setFormError("No group found with that invite code.");
        return;
      }
      setShowJoin(false);
      setJoinCode("");
      showToast({ message: "Joined group" });
      router.push(`/groups/${id}`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to join group");
    } finally {
      setBusy(false);
    }
  }

  const firstName = (currentUser.displayName || "there").split(" ")[0];

  const totalReceive = rows.reduce((s, r) => s + (r.net > 0 ? r.net : 0), 0);
  const totalOwe = rows.reduce((s, r) => s + (r.net < 0 ? -r.net : 0), 0);
  const actionableCount = rows.reduce((s, r) => s + r.pendingCount, 0);

  // Show skeletons rather than a misleading ₹0 while data is still arriving.
  const balancesPending = groups.length > 0 && !allLoaded;

  const peopleToShow = counterparties.filter((c) => !isSettled(c.net));

  const needle = query.trim().toLowerCase();
  const sortedRows = rows
    .filter((r) => classifyGroup(r, currentUser.uid) === tab)
    .filter((r) => r.group.name.toLowerCase().includes(needle))
    .sort((a, b) =>
      sort === "name"
        ? a.group.name.localeCompare(b.group.name)
        : tab === "archived"
        ? // Most recently tidied away first, which is where a mistake will be.
          archivedAtFor(b.group, currentUser.uid) - archivedAtFor(a.group, currentUser.uid)
        : (b.lastActivityTs || b.group.createdAt) - (a.lastActivityTs || a.group.createdAt)
    );

  // Archiving is a view preference, never a write-off, so the totals above keep
  // counting archived groups. This surfaces the money that is sitting in a tab
  // the user isn't looking at, rather than letting it quietly disappear.
  const archivedOutstanding = rows
    .filter((r) => isArchivedFor(r.group, currentUser.uid) && !isSettled(r.net))
    .length;

  async function handleToggleArchive(groupId: string, archived: boolean) {
    try {
      await setGroupArchived(groupId, currentUser.uid, archived);
      showToast({ message: archived ? "Group archived" : "Group restored" });
    } catch (err) {
      showToast({
        message: err instanceof Error ? `Couldn't update: ${err.message}` : "Couldn't update the group",
      });
    }
  }

  const emptyMessage = query
    ? "No groups match your search."
    : tab === "archived"
    ? "Nothing archived. Groups you archive are tucked away here."
    : tab === "settled"
    ? "No settled groups yet. Groups where everyone is square land here."
    : groups.length === 0
    ? "No groups yet. Tap Add to create or join one."
    : "Nothing needs attention. Check the Settled tab.";

  return (
    <div className="flex-1 flex flex-col bg-[var(--background)] min-h-full">
      <main className="flex-1 max-w-md w-full mx-auto px-4 pt-[max(0.5rem,env(safe-area-inset-top))] pb-40 scroll-momentum">
        {/* Header */}
        <div className="flex items-start justify-between pt-3">
          <Logo className="h-9 w-auto" />
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => router.push("/notifications")}
              aria-label={
                actionableCount > 0
                  ? `Notifications, ${actionableCount} needing action`
                  : "Notifications"
              }
              className="relative w-11 h-11 rounded-2xl bg-[var(--surface)] text-[var(--text-secondary)] shadow-[var(--shadow-button)] flex items-center justify-center tap-shrink"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.7 21a2 2 0 0 1-3.4 0" />
              </svg>
              {actionableCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-5 h-5 px-1 rounded-full bg-[var(--neg)] text-white text-[11px] font-bold flex items-center justify-center">
                  {actionableCount}
                </span>
              )}
            </button>
            <button
              onClick={() => router.push("/settings")}
              aria-label="Settings"
              className="w-11 h-11 rounded-2xl bg-[var(--surface)] text-[var(--text-secondary)] shadow-[var(--shadow-button)] flex items-center justify-center tap-shrink"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M12 15a3 3 0 100-6 3 3 0 000 6z" />
                <path d="M19.4 13a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V19a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H4a2 2 0 110-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33h0a1.65 1.65 0 001-1.51V4a2 2 0 114 0v.09a1.65 1.65 0 001 1.51h0a1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82v0a1.65 1.65 0 001.51 1H20a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" />
              </svg>
            </button>
          </div>
        </div>

        {/* Greeting */}
        <p className="text-[17px] text-[var(--text-tertiary)] mt-4">{greeting()}</p>
        <h1 className="text-[32px] font-extrabold text-[var(--text-primary)] leading-tight">
          {firstName} <span className="align-middle">👋</span>
        </h1>

        {error && (
          <div className="mt-3 rounded-[var(--radius-inner)] bg-[var(--tint-danger-soft)] p-3">
            <p className="text-[13px] text-[var(--neg)]">
              Couldn&rsquo;t load the latest data ({error}). Showing what&rsquo;s cached on this
              device.
            </p>
          </div>
        )}

        {/* Summary chip */}
        <div className="mt-3 inline-flex items-center gap-2 bg-[var(--surface)] rounded-full pl-3 pr-4 py-2 shadow-[var(--shadow-sm)] border border-[var(--border-subtle)]">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="text-[var(--brand)]">
            <path d="M12 2l1.9 5.8L20 9.7l-5 3.6 1.9 6L12 15.8 6.1 19.3 8 13.3l-5-3.6 6.1-1.9z" />
          </svg>
          <span className="text-[14px] text-[var(--text-secondary)]">Here&rsquo;s your summary across all groups</span>
        </div>

        {/* Summary card — leads with the actionable balance (owe first) */}
        <div className="mt-4 bg-[var(--surface)] rounded-[var(--radius-xl)] p-5 shadow-[var(--shadow-card)]">
          {balancesPending ? (
            <div>
              <Skeleton className="h-4 w-24 rounded-md" />
              <Skeleton className="h-10 w-40 mt-2 rounded-lg" />
            </div>
          ) : !isSettled(totalOwe) ? (
            <div>
              <p className="text-[15px] text-[var(--text-tertiary)]">You owe</p>
              <p className="text-[36px] font-extrabold text-[var(--neg)] leading-tight mt-0.5 truncate">
                {formatCurrency(totalOwe)}
              </p>
              {!isSettled(totalReceive) && (
                <p className="text-[14px] text-[var(--text-secondary)] mt-1">
                  You&rsquo;ll also receive{" "}
                  <span className="font-semibold text-[var(--pos)]">{formatCurrency(totalReceive)}</span>
                </p>
              )}
            </div>
          ) : !isSettled(totalReceive) ? (
            <div>
              <p className="text-[15px] text-[var(--text-tertiary)]">You will receive</p>
              <p className="text-[36px] font-extrabold text-[var(--pos)] leading-tight mt-0.5 truncate">
                {formatCurrency(totalReceive)}
              </p>
              <p className="text-[14px] text-[var(--text-tertiary)] mt-1">Across all groups</p>
            </div>
          ) : (
            <div>
              <p className="text-[22px] font-bold text-[var(--text-primary)]">You&rsquo;re all settled 🎉</p>
              <p className="text-[14px] text-[var(--text-tertiary)] mt-0.5">No outstanding balances</p>
            </div>
          )}

          <div className="h-px bg-[var(--border-subtle)] my-4" />

          <button
            onClick={() => document.getElementById("your-groups")?.scrollIntoView({ behavior: "smooth" })}
            className="w-full flex items-center gap-2.5 tap-shrink"
          >
            <span className="w-10 h-10 rounded-full bg-[var(--tint-accent)] text-[var(--brand)] flex items-center justify-center shrink-0">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </span>
            <div className="text-left flex-1">
              <p className="text-[17px] font-bold text-[var(--text-primary)] leading-none">{groups.length}</p>
              <p className="text-[13px] text-[var(--text-tertiary)] mt-0.5">
                Group{groups.length !== 1 ? "s" : ""}
                {tabCounts.archived > 0 ? ` · ${tabCounts.archived} archived` : ""}
              </p>
            </div>
            <span className="text-[var(--text-quaternary)] text-lg">›</span>
          </button>
        </div>

        {/* Balances by person, netted across groups. Read-only: settling always
            happens inside a group. */}
        {peopleToShow.length > 0 && (
          <section className="mt-6">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-[20px] font-bold text-[var(--text-primary)]">By person</h2>
            </div>
            <p className="text-[13px] text-[var(--text-tertiary)] mb-3">
              Balances netted across every group you share. Tap for the full statement.
            </p>
            <div className="space-y-2.5">
              {peopleToShow.map((person) => {
                const iOweNet = !isSettled(person.net) && person.net > 0;
                return (
                  <button
                    key={person.uid}
                    onClick={() => router.push(`/reports?person=${person.uid}`)}
                    // Cross-group figures are only meaningful once every group
                    // has loaded, so don't invite a tap into a partial ledger.
                    disabled={!allLoaded}
                    className="w-full text-left bg-[var(--surface)] rounded-[var(--radius-card)] p-3.5 flex items-center gap-3 shadow-[var(--shadow-card)] tap-shrink disabled:opacity-60"
                  >
                    {person.photoURL ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={person.photoURL} alt="" className="w-11 h-11 rounded-full object-cover shrink-0" />
                    ) : (
                      <span className="w-11 h-11 rounded-full bg-[var(--fill)] flex items-center justify-center text-[16px] font-semibold text-[var(--text-secondary)] shrink-0">
                        {person.displayName.charAt(0).toUpperCase()}
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-[15px] font-semibold text-[var(--text-primary)] truncate">
                        {person.displayName}
                      </p>
                      <p className="text-[12px] text-[var(--text-tertiary)] mt-0.5 truncate">
                        {person.groups.length > 0
                          ? person.groups.map((g) => g.groupName).join(" · ")
                          : `${person.sharedGroupCount} shared group${person.sharedGroupCount !== 1 ? "s" : ""}`}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[11px] text-[var(--text-tertiary)]">
                        {isSettled(person.net) ? "net" : iOweNet ? "you owe" : "owes you"}
                      </p>
                      <p
                        className={`text-[16px] font-bold ${
                          isSettled(person.net)
                            ? "text-[var(--text-tertiary)]"
                            : iOweNet
                            ? "text-[var(--neg)]"
                            : "text-[var(--pos)]"
                        }`}
                      >
                        {isSettled(person.net) ? "₹0" : formatCurrency(Math.abs(person.net))}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* Search */}
        <div className="mt-5">
          <div className="flex items-center gap-2.5 bg-[var(--fill)] rounded-full px-4 h-12">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-[var(--text-tertiary)]" strokeWidth="2" strokeLinecap="round">
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search groups..."
              className="flex-1 bg-transparent outline-none text-[15px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]"
            />
          </div>
        </div>

        {/* Your Groups header */}
        <div id="your-groups" className="mt-6 flex items-center justify-between scroll-mt-4">
          <h2 className="text-[20px] font-bold text-[var(--text-primary)]">Your Groups</h2>
          <button
            onClick={() => setSort((s) => (s === "recent" ? "name" : "recent"))}
            aria-label={`Sorted by ${sort === "recent" ? "most recent" : "name"}. Tap to switch.`}
            className="flex items-center gap-1.5 bg-[var(--surface)] rounded-full px-3.5 py-2 text-[14px] font-medium text-[var(--text-secondary)] shadow-[var(--shadow-sm)] tap-shrink"
          >
            {sort === "recent" ? "Recent" : "Name"}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 4v16M4 7l3-3 3 3M17 20V4M14 17l3 3 3-3" />
            </svg>
          </button>
        </div>

        {/* Tabs. Keeps finished trips and squared-up flatshares out of the way
            without hiding them, and without touching any balance. */}
        <div
          role="tablist"
          aria-label="Filter groups"
          className="mt-3 flex gap-1 bg-[var(--fill)] rounded-full p-1"
        >
          {GROUP_TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t.id)}
                className={`flex-1 rounded-full py-2 text-[13px] font-semibold tap-shrink ${
                  active
                    ? "bg-[var(--surface)] text-[var(--text-primary)] shadow-[var(--shadow-sm)]"
                    : "text-[var(--text-secondary)]"
                }`}
              >
                {t.label}
                {tabCounts[t.id] > 0 && (
                  <span className={active ? "text-[var(--brand)]" : "text-[var(--text-tertiary)]"}>
                    {" "}
                    {tabCounts[t.id]}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {tab === "archived" && archivedOutstanding > 0 && (
          <p className="mt-2.5 text-[12px] text-[var(--warning)]">
            {archivedOutstanding} archived group{archivedOutstanding !== 1 ? "s" : ""} still
            {archivedOutstanding !== 1 ? " have" : " has"} an unsettled balance. Archiving only
            tidies the list — these are still counted in your totals above.
          </p>
        )}

        {/* Group list */}
        <div className="mt-3 space-y-3">
          {sortedRows.length === 0 && (
            <p className="text-center text-[var(--text-tertiary)] text-sm py-14">{emptyMessage}</p>
          )}
          {sortedRows.map((row, i) => (
            <GroupRow
              key={row.group.id}
              group={row.group}
              index={i}
              net={row.net}
              loaded={row.loaded}
              lastActivityTs={row.lastActivityTs}
              pendingCount={row.pendingCount}
              onOpen={() => router.push(`/groups/${row.group.id}`)}
              action={
                tab === "archived"
                  ? {
                      label: "Restore",
                      ariaLabel: `Restore ${row.group.name} to your active groups`,
                      onClick: () => handleToggleArchive(row.group.id, false),
                    }
                  : {
                      label: "Archive",
                      ariaLabel: `Archive ${row.group.name}`,
                      onClick: () => handleToggleArchive(row.group.id, true),
                    }
              }
            />
          ))}
        </div>

        {/* Only on the Active tab, and now a way through to the settled ones
            rather than a second copy of the count already on the tab. */}
        {tab === "active" && tabCounts.settled > 0 && (
          <button
            onClick={() => setTab("settled")}
            className="mt-4 w-full text-left flex items-center gap-3 bg-[var(--tint-accent)] rounded-[var(--radius-card)] p-4 tap-shrink"
          >
            <span className="w-10 h-10 rounded-full bg-[var(--surface)] text-[var(--brand)] flex items-center justify-center shrink-0 shadow-sm">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2l1.9 5.8L20 9.7l-5 3.6 1.9 6L12 15.8 6.1 19.3 8 13.3l-5-3.6 6.1-1.9z" />
              </svg>
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-[15px] font-semibold text-[var(--text-primary)]">
                You&rsquo;re all settled in {tabCounts.settled} group
                {tabCounts.settled !== 1 ? "s" : ""}.
              </p>
              <p className="text-[13px] text-[var(--text-tertiary)]">
                Tap to review or archive them 🎉
              </p>
            </div>
            <span className="text-[var(--text-quaternary)] text-lg shrink-0">›</span>
          </button>
        )}
      </main>

      {/* Click-away layer to dismiss the Add popover on outside tap */}
      {showAdd && (
        <div className="fixed inset-0 z-30" onClick={() => setShowAdd(false)} aria-hidden />
      )}

      {/* Floating Add — pinned bottom-right, clearing the tab bar */}
      <div className="fab-layer fixed z-40 inset-x-0 bottom-[calc(var(--nav-h)+env(safe-area-inset-bottom)+0.75rem)] pointer-events-none">
        <div className="max-w-md mx-auto px-4 flex justify-end">
          <div className="relative pointer-events-auto">
            {showAdd && (
              <div className="absolute right-0 bottom-full mb-3 w-44 bg-[var(--surface)] rounded-2xl p-1.5 shadow-[var(--shadow-float)] border border-[var(--border-subtle)] animate-modal-in">
                <button
                  onClick={() => { setShowAdd(false); setShowCreate(true); setFormError(""); }}
                  className="w-full text-left px-3.5 py-2.5 rounded-xl text-[15px] font-medium text-[var(--text-primary)] hover:bg-[var(--fill-soft)] tap-shrink"
                >
                  + New Group
                </button>
                <button
                  onClick={() => { setShowAdd(false); setShowJoin(true); setFormError(""); }}
                  className="w-full text-left px-3.5 py-2.5 rounded-xl text-[15px] font-medium text-[var(--text-primary)] hover:bg-[var(--fill-soft)] tap-shrink"
                >
                  Join Group
                </button>
              </div>
            )}
            <button
              onClick={() => setShowAdd((v) => !v)}
              className="flex items-center gap-2 bg-[var(--surface)] text-[var(--brand)] rounded-full pl-5 pr-6 py-4 shadow-[0_10px_30px_-6px_rgba(79,70,229,0.35)] tap-shrink"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
              <span className="text-[16px] font-semibold">Add</span>
            </button>
          </div>
        </div>
      </div>

      <BottomNav active="groups" />


      {showCreate && (
        <GlassModal title="New Group" onClose={() => setShowCreate(false)}>
          <form onSubmit={handleCreateGroup} className="space-y-3.5">
            <GlassField
              label="Group name"
              autoFocus
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="Goa Trip, Roommates…"
            />
            {formError && <p className="text-sm text-[var(--danger)]">{formError}</p>}
            <GlassButton disabled={busy} className="w-full">
              {busy ? "Creating…" : "Create"}
            </GlassButton>
          </form>
        </GlassModal>
      )}

      {showJoin && (
        <GlassModal title="Join Group" onClose={() => setShowJoin(false)}>
          <form onSubmit={handleJoinGroup} className="space-y-3.5">
            <GlassField
              label="Invite code"
              autoFocus
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              placeholder="ABC123"
              className="uppercase tracking-widest"
            />
            {formError && <p className="text-sm text-[var(--danger)]">{formError}</p>}
            <GlassButton disabled={busy} className="w-full">
              {busy ? "Joining…" : "Join"}
            </GlassButton>
          </form>
        </GlassModal>
      )}
    </div>
  );
}
