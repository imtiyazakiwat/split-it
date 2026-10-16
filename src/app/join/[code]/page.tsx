"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { getGroupByInviteCode, joinGroupByCode } from "@/lib/firestore";
import LoginScreen from "@/components/LoginScreen";
import { Button, EmptyState, Spinner } from "@/components/kit/Controls";
import { useNav } from "@/components/kit/nav";

/**
 * Joining by invite link is a redirect in disguise: resolve the code, join,
 * then replace this URL with the group (so Back doesn't land here again).
 */
export default function JoinPage() {
  const { code } = useParams<{ code: string }>();
  const nav = useNav();
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
          nav.replace(`/groups/${group.id}`);
          return;
        }
        const id = await joinGroupByCode(code, currentUser.uid, {
          displayName: currentUser.displayName || currentUser.email || "User",
          email: currentUser.email || "",
          photoURL: currentUser.photoURL || "",
        });
        if (cancelled) return;
        if (id) nav.replace(`/groups/${id}`);
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
    // `nav` is a fresh object each render; the router inside it is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, user, loading]);

  if (loading) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-[var(--bg)] text-label-2">
        <Spinner size={24} />
      </main>
    );
  }

  if (!user) {
    return <LoginScreen title="You're Invited" note="Sign in to join the group." />;
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[var(--bg)] px-6">
      {error ? (
        <EmptyState
          icon="person.2"
          title="Couldn't Join"
          message={error}
          action={
            <Button size="md" onClick={() => nav.replace("/")}>
              Go to Groups
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col items-center gap-3 text-center text-label-2" role="status">
          <Spinner size={28} />
          <p className="t-callout">{busy && groupName ? `Joining ${groupName}…` : "Looking up the group…"}</p>
        </div>
      )}
    </main>
  );
}
