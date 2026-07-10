"use client";

import { useEffect, useState } from "react";
import { searchUsers, addMemberToGroup, UserSearchResult } from "@/lib/firestore";
import GlassModal from "@/components/ui/GlassModal";
import { useToast } from "@/components/ui/Toast";

export default function AddMemberModal({
  groupId,
  existingUids,
  onClose,
}: {
  groupId: string;
  existingUids: string[];
  onClose: () => void;
}) {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [addingUid, setAddingUid] = useState<string | null>(null);
  const [error, setError] = useState("");
  const showToast = useToast();

  useEffect(() => {
    const t = term.trim();
    let cancelled = false;
    const handle = setTimeout(async () => {
      if (t.length < 2) {
        if (!cancelled) {
          setResults([]);
          setSearching(false);
        }
        return;
      }
      if (!cancelled) setSearching(true);
      try {
        const found = await searchUsers(term, existingUids);
        if (!cancelled) setResults(found);
      } catch {
        if (!cancelled) setError("Search failed. Try again.");
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [term, existingUids]);

  async function handleAdd(u: UserSearchResult) {
    setAddingUid(u.uid);
    setError("");
    try {
      await addMemberToGroup(groupId, u.uid, {
        displayName: u.displayName,
        email: u.email,
        photoURL: u.photoURL,
      });
      showToast({ message: `${u.displayName} added to the group` });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add member");
      setAddingUid(null);
    }
  }

  return (
    <GlassModal title="Add member" onClose={onClose}>
      <div className="space-y-3">
        <input
          autoFocus
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search by name or email…"
          className="w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--surface)] px-3.5 py-2.5 text-[15px] text-[var(--label-primary)] outline-none focus:border-[var(--accent)]"
        />

        {searching && <p className="text-[13px] text-[var(--label-tertiary)]">Searching…</p>}

        {!searching && term.trim().length >= 2 && results.length === 0 && (
          <p className="text-[13px] text-[var(--label-tertiary)]">
            No users found. They need to have signed in to SplitIt at least once.
          </p>
        )}

        <div className="space-y-1 max-h-72 overflow-y-auto">
          {results.map((u) => (
            <div key={u.uid} className="flex items-center gap-2.5 py-2">
              {u.photoURL ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={u.photoURL} alt="" className="w-9 h-9 rounded-full object-cover shrink-0" />
              ) : (
                <div className="w-9 h-9 rounded-full bg-[var(--accent)]/10 flex items-center justify-center shrink-0">
                  <span className="text-[14px] font-medium text-[var(--accent)]">
                    {u.displayName.charAt(0).toUpperCase()}
                  </span>
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-[14px] text-[var(--label-primary)] truncate">{u.displayName}</p>
                <p className="text-[12px] text-[var(--label-tertiary)] truncate">{u.email}</p>
              </div>
              <button
                onClick={() => handleAdd(u)}
                disabled={addingUid === u.uid}
                className="rounded-full bg-[var(--brand-solid)] text-white px-3.5 py-1.5 text-[13px] font-medium shrink-0 tap-shrink disabled:opacity-50"
              >
                {addingUid === u.uid ? "Adding…" : "Add"}
              </button>
            </div>
          ))}
        </div>

        {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
      </div>
    </GlassModal>
  );
}
