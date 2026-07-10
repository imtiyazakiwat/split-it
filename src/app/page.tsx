"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { createGroup, joinGroupByCode, subscribeToUserGroups } from "@/lib/firestore";
import { formatCurrency } from "@/lib/balance";
import { Group } from "@/lib/types";
import { readHomeCache, writeHomeCache } from "@/lib/homeCache";
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
  const [groups, setGroups] = useState<Group[]>([]);
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"recent" | "name">("recent");
  const [showAdd, setShowAdd] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const showToast = useToast();

  useEffect(() => {
    if (!user) return;
    const unsub = subscribeToUserGroups(user.uid, setGroups);
    return unsub;
  }, [user]);

  // Hydrate last-known groups/balances from cache on first load so the summary
  // shows real numbers instantly (no empty-to-value flash on refresh).
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (!user || hydratedRef.current) return;
    hydratedRef.current = true;
    const cached = readHomeCache(user.uid);
    if (!cached) return;
    queueMicrotask(() => {
      if (cached.groups?.length) setGroups((g) => (g.length ? g : cached.groups));
      if (cached.balances) setBalances((b) => (Object.keys(b).length ? b : cached.balances));
    });
  }, [user]);

  // Persist current state so the next refresh can hydrate from it.
  useEffect(() => {
    if (!user || groups.length === 0) return;
    writeHomeCache(user.uid, { groups, balances });
  }, [user, groups, balances]);

  const handleBalance = useCallback((groupId: string, net: number) => {
    setBalances((prev) => (prev[groupId] === net ? prev : { ...prev, [groupId]: net }));
  }, []);

  if (loading) {
    return <HomeSkeleton />;
  }

  if (!user) return <LoginScreen />;

  const currentUser = user;

  async function handleCreateGroup(e: React.FormEvent) {
    e.preventDefault();
    if (!groupName.trim()) return;
    setBusy(true);
    setError("");
    try {
      const id = await createGroup(groupName.trim(), currentUser.uid, {
        displayName: currentUser.displayName || currentUser.email || "User",
        email: currentUser.email || "",
        photoURL: currentUser.photoURL || "",
      });
      setShowCreate(false);
      setGroupName("");
      showToast({ message: "Group created" });
      router.push(`/groups/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create group");
    } finally {
      setBusy(false);
    }
  }

  async function handleJoinGroup(e: React.FormEvent) {
    e.preventDefault();
    if (!joinCode.trim()) return;
    setBusy(true);
    setError("");
    try {
      const id = await joinGroupByCode(joinCode.trim(), currentUser.uid, {
        displayName: currentUser.displayName || currentUser.email || "User",
        email: currentUser.email || "",
        photoURL: currentUser.photoURL || "",
      });
      if (!id) {
        setError("No group found with that invite code.");
        return;
      }
      setShowJoin(false);
      setJoinCode("");
      showToast({ message: "Joined group" });
      router.push(`/groups/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to join group");
    } finally {
      setBusy(false);
    }
  }

  const firstName = (currentUser.displayName || "there").split(" ")[0];

  const nets = groups.map((g) => balances[g.id]);
  const totalReceive = nets.reduce<number>((s, n) => s + (n && n > 0 ? n : 0), 0);
  const totalOwe = nets.reduce<number>((s, n) => s + (n && n < 0 ? -n : 0), 0);
  const settledCount = groups.filter((g) => {
    const n = balances[g.id];
    return n !== undefined && Math.abs(n) < 0.01;
  }).length;

  // True while we have groups but haven't computed every group's balance yet —
  // used to show skeletons instead of a misleading ₹0 in the summary hero.
  const balancesPending =
    groups.length > 0 && !groups.every((g) => balances[g.id] !== undefined);

  const filtered = groups.filter((g) =>
    g.name.toLowerCase().includes(query.trim().toLowerCase())
  );
  const sorted = [...filtered].sort((a, b) =>
    sort === "name" ? a.name.localeCompare(b.name) : b.createdAt - a.createdAt
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
              aria-label="Notifications"
              className="w-11 h-11 rounded-2xl bg-[var(--surface)] text-[var(--text-secondary)] shadow-[0_2px_10px_-2px_rgba(0,0,0,0.12)] flex items-center justify-center tap-shrink"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.7 21a2 2 0 0 1-3.4 0" />
              </svg>
            </button>
            <button
              onClick={() => router.push("/settings")}
              aria-label="Settings"
              className="w-11 h-11 rounded-2xl bg-[var(--surface)] text-[var(--text-secondary)] shadow-[0_2px_10px_-2px_rgba(0,0,0,0.12)] flex items-center justify-center tap-shrink"
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

        {/* Summary chip */}
        <div className="mt-3 inline-flex items-center gap-2 bg-[var(--surface)] rounded-full pl-3 pr-4 py-2 shadow-[0_1px_4px_rgba(0,0,0,0.05)] border border-[var(--border-subtle)]">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="text-[var(--brand)]">
            <path d="M12 2l1.9 5.8L20 9.7l-5 3.6 1.9 6L12 15.8 6.1 19.3 8 13.3l-5-3.6 6.1-1.9z" />
          </svg>
          <span className="text-[14px] text-[var(--text-secondary)]">Here&rsquo;s your summary across all groups</span>
        </div>

        {/* Summary card — leads with the actionable balance (owe first) */}
        <div className="mt-4 bg-[var(--surface)] rounded-[28px] p-5 shadow-[0_2px_8px_rgba(0,0,0,0.03),0_18px_40px_-24px_rgba(0,0,0,0.25)]">
          {/* Hero */}
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

          {/* Divider */}
          <div className="h-px bg-[var(--border-subtle)] my-4" />

          {/* Footer: groups nav */}
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
            className="flex items-center gap-1.5 bg-[var(--surface)] rounded-full px-3.5 py-2 text-[14px] font-medium text-[var(--text-secondary)] shadow-[0_1px_4px_rgba(0,0,0,0.05)] tap-shrink"
          >
            {sort === "recent" ? "Recent" : "Name"}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 4v16M4 7l3-3 3 3M17 20V4M14 17l3 3 3-3" />
            </svg>
          </button>
        </div>

        {/* Group list */}
        <div className="mt-3 space-y-3">
          {sorted.length === 0 && (
            <p className="text-center text-[var(--text-tertiary)] text-sm py-14">
              {query ? "No groups match your search." : "No groups yet. Tap Add to create or join one."}
            </p>
          )}
          {sorted.map((group, i) => (
            <GroupRow
              key={group.id}
              group={group}
              currentUid={currentUser.uid}
              index={i}
              onBalance={handleBalance}
              onOpen={() => router.push(`/groups/${group.id}`)}
            />
          ))}
        </div>

        {/* All-settled banner */}
        {settledCount > 0 && (
          <div className="mt-4 flex items-center gap-3 bg-[var(--tint-accent)] rounded-[22px] p-4">
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
            <span className="text-[var(--text-quaternary)] text-lg shrink-0">›</span>
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
              <div className="absolute right-0 bottom-full mb-3 w-44 bg-[var(--surface)] rounded-2xl p-1.5 shadow-[0_10px_40px_-8px_rgba(0,0,0,0.28)] border border-[var(--border-subtle)] animate-modal-in">
                <button
                  onClick={() => { setShowAdd(false); setShowCreate(true); setError(""); }}
                  className="w-full text-left px-3.5 py-2.5 rounded-xl text-[15px] font-medium text-[var(--text-primary)] hover:bg-[var(--fill-soft)] tap-shrink"
                >
                  + New Group
                </button>
                <button
                  onClick={() => { setShowAdd(false); setShowJoin(true); setError(""); }}
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
            {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
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
            {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
            <GlassButton disabled={busy} className="w-full">
              {busy ? "Joining…" : "Join"}
            </GlassButton>
          </form>
        </GlassModal>
      )}
    </div>
  );
}
