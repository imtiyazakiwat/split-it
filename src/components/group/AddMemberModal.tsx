"use client";

import { useEffect, useRef, useState } from "react";
import { searchUsers, addMemberToGroup, UserSearchResult } from "@/lib/firestore";
import { useToast } from "@/components/ui/Toast";
import { Sheet, type SheetHandle } from "@/components/kit/Sheet";
import { Button, EmptyState, SearchField, Spinner } from "@/components/kit/Controls";
import { List, Row } from "@/components/kit/List";
import { Avatar } from "@/components/kit/Avatar";

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
  const sheetRef = useRef<SheetHandle>(null);
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
      sheetRef.current?.dismiss();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add member");
      setAddingUid(null);
    }
  }

  const searched = term.trim().length >= 2;

  return (
    <Sheet ref={sheetRef} large title="Add Member" onClose={onClose}>
      <SearchField
        value={term}
        onChange={setTerm}
        autoFocus
        placeholder="Name or email"
        label="Search people by name or email"
        className="mt-1"
      />

      {searching && (
        <div className="flex justify-center py-6 text-label-2">
          <Spinner />
        </div>
      )}

      {!searching && searched && results.length === 0 && (
        <EmptyState
          compact
          icon="magnifyingglass"
          title="No Results"
          message="They need to have signed in to SplitIt at least once. You can also send them an invite link."
        />
      )}

      {!searched && (
        <p className="section-footer mt-3">
          Search for anyone who has signed in to SplitIt. For someone new, share the group&rsquo;s invite link instead.
        </p>
      )}

      {results.length > 0 && (
        <List className="mt-4">
          {results.map((u) => (
            <Row
              key={u.uid}
              inset="avatar"
              leading={<Avatar name={u.displayName} photoURL={u.photoURL} size={40} />}
              title={u.displayName}
              subtitle={u.email}
              trailing={
                <Button
                  size="sm"
                  variant="tinted"
                  busy={addingUid === u.uid}
                  disabled={!!addingUid}
                  onClick={() => handleAdd(u)}
                >
                  Add
                </Button>
              }
            />
          ))}
        </List>
      )}

      {error && <p className="t-footnote mt-4 px-4 text-neg">{error}</p>}
    </Sheet>
  );
}
