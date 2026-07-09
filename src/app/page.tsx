"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { createGroup, joinGroupByCode, subscribeToUserGroups } from "@/lib/firestore";
import { Group } from "@/lib/types";
import LoginScreen from "@/components/LoginScreen";
import TopBar from "@/components/TopBar";
import Card from "@/components/ui/Card";
import GlassButton from "@/components/ui/GlassButton";
import { GlassField } from "@/components/ui/GlassField";

export default function Home() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [groups, setGroups] = useState<Group[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) return;
    const unsub = subscribeToUserGroups(user.uid, setGroups);
    return unsub;
  }, [user]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-[var(--label-tertiary)]">Loading…</p>
      </div>
    );
  }

  if (!user) {
    return <LoginScreen />;
  }

  async function handleCreateGroup(e: React.FormEvent) {
    e.preventDefault();
    if (!groupName.trim() || !user) return;
    setBusy(true);
    setError("");
    try {
      const id = await createGroup(groupName.trim(), user.uid, {
        displayName: user.displayName || user.email || "User",
        email: user.email || "",
        photoURL: user.photoURL || "",
      });
      setShowCreate(false);
      setGroupName("");
      router.push(`/groups/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create group");
    } finally {
      setBusy(false);
    }
  }

  async function handleJoinGroup(e: React.FormEvent) {
    e.preventDefault();
    if (!joinCode.trim() || !user) return;
    setBusy(true);
    setError("");
    try {
      const id = await joinGroupByCode(joinCode.trim(), user.uid, {
        displayName: user.displayName || user.email || "User",
        email: user.email || "",
        photoURL: user.photoURL || "",
      });
      if (!id) {
        setError("No group found with that invite code.");
        return;
      }
      setShowJoin(false);
      setJoinCode("");
      router.push(`/groups/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to join group");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex-1 flex flex-col">
      <TopBar title="SplitIt" />
      <main className="flex-1 max-w-md w-full mx-auto p-4 space-y-4 scroll-momentum">
        <div className="flex gap-2.5">
          <GlassButton
            variant="primary"
            className="flex-1"
            onClick={() => {
              setShowCreate(true);
              setShowJoin(false);
              setError("");
            }}
          >
            + New Group
          </GlassButton>
          <GlassButton
            variant="glass"
            className="flex-1"
            onClick={() => {
              setShowJoin(true);
              setShowCreate(false);
              setError("");
            }}
          >
            Join Group
          </GlassButton>
        </div>

        {showCreate && (
          <Card className="p-4 animate-modal-in">
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
          </Card>
        )}

        {showJoin && (
          <Card className="p-4 animate-modal-in">
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
          </Card>
        )}

        <div className="space-y-2.5">
          {groups.length === 0 && !showCreate && !showJoin && (
            <p className="text-center text-[var(--label-tertiary)] text-sm py-16">
              No groups yet. Create one or join with an invite code.
            </p>
          )}
          {groups.map((group) => (
            <Card
              key={group.id}
              interactive
              onClick={() => router.push(`/groups/${group.id}`)}
              className="p-4 flex items-center justify-between"
            >
              <div className="min-w-0">
                <p className="font-medium text-[var(--label-primary)] truncate">{group.name}</p>
                <p className="text-[13px] text-[var(--label-tertiary)] mt-0.5">
                  {group.memberIds.length} member{group.memberIds.length !== 1 ? "s" : ""} · Code:{" "}
                  {group.inviteCode}
                </p>
              </div>
              <span className="text-[var(--label-tertiary)] text-xl shrink-0 ml-2">›</span>
            </Card>
          ))}
        </div>
      </main>
    </div>
  );
}
