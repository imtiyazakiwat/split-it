"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { getGroupByInviteCode, joinGroupByCode } from "@/lib/firestore";

export default function JoinPage() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();
  const { user, loading, signInWithGoogle } = useAuth();
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

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-[var(--label-tertiary)]">Loading…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-4 gap-4">
        <p className="text-[var(--label-secondary)] text-center">
          Sign in to join this group
        </p>
        <button
          onClick={signInWithGoogle}
          className="glass rounded-full px-6 py-2.5 text-[15px] font-medium text-[var(--label-primary)] tap-shrink"
        >
          Sign in with Google
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex items-center justify-center p-4">
      <div className="text-center">
        {busy ? (
          <>
            <div className="w-12 h-12 rounded-full border-2 border-[var(--accent)] border-t-transparent animate-spin mx-auto mb-3" />
            <p className="text-[var(--label-secondary)]">
              {groupName ? `Joining ${groupName}…` : "Looking up group…"}
            </p>
          </>
        ) : error ? (
          <>
            <p className="text-[var(--danger)] text-[15px] mb-2">{error}</p>
            <button
              onClick={() => router.push("/")}
              className="text-[var(--accent)] text-sm tap-shrink"
            >
              Go home
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
