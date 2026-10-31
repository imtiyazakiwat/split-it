"use client";

import { useEffect, useState } from "react";
import { searchUsers, addMemberToGroup, UserSearchResult } from "@/lib/firestore";
import GlassModal from "@/components/ui/GlassModal";
import { ListSection, Row } from "@/components/ui/List";
import { Avatar, SearchField } from "@/components/ui/Controls";
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
  // The term whose search last finished. Until it matches the current term,
  // the list is still waiting (debounce included), so "No Results" isn't true yet.
  const [searchedTerm, setSearchedTerm] = useState("");
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
        if (!cancelled) {
          setSearching(false);
          setSearchedTerm(t);
        }
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

  const pending = searching || term.trim() !== searchedTerm;

  return (
    <GlassModal title="Add Member" large onClose={onClose}>
      <SearchField value={term} onChange={setTerm} placeholder="Name or Email" label="Search people" autoFocus className="mt-1" />

      {term.trim().length >= 2 && (
        <ListSection
          elevated
          footer={
            !pending && results.length === 0
              ? "No one found. They need to have signed in to SplitIt at least once."
              : undefined
          }
        >
          {pending && results.length === 0 ? (
            <Row title={<span className="text-[var(--text-secondary)]">Searching…</span>} />
          ) : results.length === 0 ? (
            <Row title={<span className="text-[var(--text-secondary)]">No Results</span>} />
          ) : (
            results.map((u) => (
              <Row
                key={u.uid}
                leading={<Avatar name={u.displayName} photoURL={u.photoURL} size={36} seed={u.uid} uid={u.uid} />}
                separatorInset={64}
                title={u.displayName}
                subtitle={u.email}
                detail={
                  <button
                    type="button"
                    onClick={() => handleAdd(u)}
                    disabled={addingUid !== null}
                    className="btn-tinted btn-small -my-1"
                  >
                    {addingUid === u.uid ? "Adding…" : "Add"}
                  </button>
                }
              />
            ))
          )}
        </ListSection>
      )}

      {term.trim().length < 2 && (
        <p className="list-footer text-center !px-6 !pt-6">
          Search for someone who has signed in to SplitIt. To invite anyone else, share the group’s invite link.
        </p>
      )}

      {error && <p className="list-footer !text-[var(--neg)]">{error}</p>}
    </GlassModal>
  );
}
