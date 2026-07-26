"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useGroupData } from "@/lib/group-data-context";
import { createGroup, joinGroupByCode } from "@/lib/firestore";
import {
  canRespondToSettlement,
  computeBalances,
  formatCurrency,
} from "@/lib/balance";
import { computeCounterpartyBalances } from "@/lib/global-balance";
import LoginScreen from "@/components/LoginScreen";
import GlassModal from "@/components/ui/GlassModal";
import GlassButton from "@/components/ui/GlassButton";
import { GlassField } from "@/components/ui/GlassField";
import BottomNav from "@/components/home/BottomNav";
import GroupRow from "@/components/home/GroupRow";
import HomeSkeleton from "@/components/home/HomeSkeleton";
import Skeleton from "@/components/ui/Skeleton";
import GlobalSettleModal from "@/components/GlobalSettleModal";
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
  const [showAdd, setShowAdd] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  // Stored by uid, not as a snapshot of the object, so the open sheet keeps
  // following live data instead of acting on figures frozen at tap time.
  const [settleTargetUid, setSettleTargetUid] = useState<string | null>(null);
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
      };
    });
  }, [groups, byGroup, uid]);

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
  const settledCount = rows.filter((r) => r.loaded && Math.abs(r.net) < 0.01).length;
  const actionableCount = rows.reduce((s, r) => s + r.pendingCount, 0);

  // Show skeletons rather than a misleading ₹0 while data is still arriving.
  const balancesPending = groups.length > 0 && !allLoaded;

  // People whose balances span more than one group, or that cancel out across
  // groups — the cases per-group settling can't resolve on its own.
  const crossGroupPeople = counterparties.filter(
    (c) => c.groups.length > 1 || c.offsetable > 0.01
  );
  const peopleToShow = counterparties.filter((c) => Math.abs(c.net) > 0.01 || c.offsetable > 0.01);
  const settleTarget = settleTargetUid
    ? counterparties.find((c) => c.uid === settleTargetUid) ?? null
    : null;

  const filtered = groups.filter((g) =>
    g.name.toLowerCase().includes(query.trim().toLowerCase())
  );
  const filteredIds = new Set(filtered.map((g) => g.id));
  const sortedRows = rows
    .filter((r) => filteredIds.has(r.group.id))
    .sort((a, b) =>
      sort === "name"
        ? a.group.name.localeCompare(b.group.name)
        : (b.lastActivityTs || b.group.createdAt) - (a.lastActivityTs || a.group.createdAt)
    );

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
          ) : totalOwe > 0.01 ? (
            <div>
              <p className="text-[15px] text-[var(--text-tertiary)]">You owe</p>
              <p className="text-[36px] font-extrabold text-[var(--neg)] leading-tight mt-0.5 truncate">
                {formatCurrency(totalOwe)}
              </p>
              {totalReceive > 0.01 && (
                <p className="text-[14px] text-[var(--text-secondary)] mt-1">
                  You&rsquo;ll also receive{" "}
                  <span className="font-semibold text-[var(--pos)]">{formatCurrency(totalReceive)}</span>
                </p>
              )}
            </div>
          ) : totalReceive > 0.01 ? (
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
              </p>
            </div>
            <span className="text-[var(--text-quaternary)] text-lg">›</span>
          </button>
        </div>

        {/* Balances by person — the only place cross-group debts can be settled */}
        {peopleToShow.length > 0 && (
          <section className="mt-6">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-[20px] font-bold text-[var(--text-primary)]">By person</h2>
              {crossGroupPeople.length > 0 && (
                <span className="rounded-full bg-[var(--tint-accent)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--brand)]">
                  {crossGroupPeople.length} across groups
                </span>
              )}
            </div>
            <p className="text-[13px] text-[var(--text-tertiary)] mb-3">
              Balances netted across every group you share. Tap to settle in one go.
            </p>
            <div className="space-y-2.5">
              {peopleToShow.map((person) => {
                const iOweNet = person.net > 0.01;
                return (
                  <button
                    key={person.uid}
                    onClick={() => setSettleTargetUid(person.uid)}
                    // Settling across groups needs every group's data in hand,
                    // otherwise the plan could be built from a partial ledger.
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
                      {person.offsetable > 0.01 && (
                        <span className="inline-block mt-1 rounded-full bg-[var(--tint-accent)] px-2 py-0.5 text-[11px] font-medium text-[var(--brand)]">
                          {formatCurrency(person.offsetable)} cancels out
                        </span>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[11px] text-[var(--text-tertiary)]">
                        {Math.abs(person.net) < 0.01 ? "net" : iOweNet ? "you owe" : "owes you"}
                      </p>
                      <p
                        className={`text-[16px] font-bold ${
                          Math.abs(person.net) < 0.01
                            ? "text-[var(--text-tertiary)]"
                            : iOweNet
                            ? "text-[var(--neg)]"
                            : "text-[var(--pos)]"
                        }`}
                      >
                        {Math.abs(person.net) < 0.01 ? "₹0" : formatCurrency(Math.abs(person.net))}
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

        {/* Group list */}
        <div className="mt-3 space-y-3">
          {sortedRows.length === 0 && (
            <p className="text-center text-[var(--text-tertiary)] text-sm py-14">
              {query ? "No groups match your search." : "No groups yet. Tap Add to create or join one."}
            </p>
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
            />
          ))}
        </div>

        {/* All-settled banner */}
        {settledCount > 0 && (
          <div className="mt-4 flex items-center gap-3 bg-[var(--tint-accent)] rounded-[var(--radius-card)] p-4">
            <span className="w-10 h-10 rounded-full bg-[var(--surface)] text-[var(--brand)] flex items-center justify-center shrink-0 shadow-sm">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2l1.9 5.8L20 9.7l-5 3.6 1.9 6L12 15.8 6.1 19.3 8 13.3l-5-3.6 6.1-1.9z" />
              </svg>
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-[15px] font-semibold text-[var(--text-primary)]">
                You&rsquo;re all settled in {settledCount} group{settledCount !== 1 ? "s" : ""}.
              </p>
              <p className="text-[13px] text-[var(--text-tertiary)]">Great job keeping things balanced! 🎉</p>
            </div>
          </div>
        )}
      </main>

      {/* Click-away layer to dismiss the Add popover on outside tap */}
      {showAdd && (
        <div className="fixed inset-0 z-30" onClick={() => setShowAdd(false)} aria-hidden />
      )}

      {/* Floating Add — pinned bottom-right, clearing the tab bar */}
      <div className="fixed z-40 inset-x-0 bottom-[calc(6rem+env(safe-area-inset-bottom))] pointer-events-none">
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

      {settleTarget && (
        <GlobalSettleModal
          meUid={currentUser.uid}
          counterparty={settleTarget}
          onClose={() => setSettleTargetUid(null)}
        />
      )}

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
