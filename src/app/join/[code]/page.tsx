"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { getGroupByInviteCode, joinGroupByCode } from "@/lib/firestore";
import LoginScreen from "@/components/LoginScreen";
import { EmptyState } from "@/components/ui/Controls";
import { People } from "@/components/ui/Icons";

export default function JoinPage() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();
  const { user, loading } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [groupName, setGroupName] = useState("");

  useEffect(() => {
    if (!code || loading || !user) return;
    const currentUser = user;
    let cancelled = false;

    async function run() {
      setBusy(true);
      setError("");
      try {
        const group = await getGroupByInviteCode(code);
        if (cancelled) return;
        if (!group) {
          setError("No group found with that invite code.");
          return;
        }
        setGroupName(group.name);
        if (group.memberIds.includes(currentUser.uid)) {
          router.replace(`/groups/${group.id}`);
          return;
        }
        const id = await joinGroupByCode(code, currentUser.uid, {
          displayName: currentUser.displayName || currentUser.email || "User",
          email: currentUser.email || "",
          photoURL: currentUser.photoURL || "",
        });
        if (cancelled) return;
        if (id) router.replace(`/groups/${id}`);
        else setError("Failed to join group.");
      } catch {
        if (!cancelled) setError("Something went wrong.");
      } finally {
        if (!cancelled) setBusy(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [code, user, loading, router]);

  if (loading) return <div className="flex-1 min-h-[100dvh] bg-[var(--background)]" />;

  // Signing in from an invite link uses the same welcome screen as the app;
  // once signed in, this effect joins and redirects.
  if (!user) return <LoginScreen />;

  return (
    <div className="flex-1 min-h-[100dvh] flex items-center justify-center p-4 bg-[var(--background)]">
      {error ? (
        <EmptyState
          icon={<People size={56} weight={1.4} />}
          title="Couldn’t Join"
          message={error}
          action={
            <button onClick={() => router.push("/")} className="btn-prominent">
              Go to Groups
            </button>
          }
        />
      ) : (
        <div className="flex flex-col items-center text-center gap-3" role="status">
          <span className="w-7 h-7 rounded-full border-[2.5px] border-[var(--text-tertiary)] border-t-transparent animate-spin" aria-hidden />
          <p className="t-subhead text-[var(--text-secondary)]">
            {busy ? (groupName ? `Joining ${groupName}…` : "Looking up the group…") : "Opening…"}
          </p>
        </div>
      )}
    </div>
  );
}
