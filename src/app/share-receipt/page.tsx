"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useGroupData } from "@/lib/group-data-context";
import { activateFileInputOnKey } from "@/lib/keyboard";
import LoginScreen from "@/components/LoginScreen";
import AddExpenseModal from "@/components/AddExpenseModal";
import Screen from "@/components/kit/Screen";
import { Card, List, RowButton, Section } from "@/components/kit/List";
import { GroupAvatar } from "@/components/kit/Tile";
import { EmptyState } from "@/components/kit/Controls";
import { Icon } from "@/components/kit/Icon";
import { useNav } from "@/components/kit/nav";

/**
 * Landing page for the Web Share Target: an image shared from Photos/Gallery
 * arrives here (via the service worker's cache), you pick the group, and the
 * expense sheet opens with the image attached.
 */
export default function ShareReceiptPage() {
  const { user, loading } = useAuth();
  const nav = useNav();
  const { groups } = useGroupData();
  const [selectedGroupId, setSelectedGroupId] = useState<string>("");
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const preview = useMemo(() => (receiptFile ? URL.createObjectURL(receiptFile) : ""), [receiptFile]);
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  useEffect(() => {
    if ("caches" in window) {
      caches.open("share-target-cache").then(async (cache) => {
        const res = await cache.match("shared-receipt");
        if (res) {
          const blob = await res.blob();
          setReceiptFile(new File([blob], "receipt.jpg", { type: blob.type || "image/jpeg" }));
          await cache.delete("shared-receipt");
        }
      });
    }
  }, []);

  if (loading) {
    return (
      <Screen title="Add Receipt" back="/">
        <div />
      </Screen>
    );
  }
  if (!user) return <LoginScreen />;

  const group = groups.find((g) => g.id === selectedGroupId);

  return (
    <Screen title="Add Receipt" back="/">
      {receiptFile ? (
        <Card className="mt-1 overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="Shared receipt" className="max-h-72 w-full bg-[var(--fill-4)] object-contain" />
        </Card>
      ) : (
        <label
          role="button"
          tabIndex={0}
          aria-label="Choose an image to attach"
          onKeyDown={activateFileInputOnKey}
          className="card mt-1 flex cursor-pointer flex-col items-center gap-2 px-6 py-8 text-center"
        >
          <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-[var(--fill-4)] text-tint">
            <Icon name="photo" size={26} />
          </span>
          <span className="t-headline">No Image Received</span>
          <span className="t-subhead text-label-2">Tap to choose one from your photos.</span>
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => setReceiptFile(e.target.files?.[0] || null)}
          />
        </label>
      )}

      <Section header="Add it to" footer="Opens a new expense with this image attached.">
        {groups.length === 0 ? (
          <Card>
            <EmptyState compact icon="person.2" title="No Groups Yet" message="Create or join a group first." />
          </Card>
        ) : (
          <List>
            {groups.map((g) => (
              <RowButton
                key={g.id}
                onClick={() => setSelectedGroupId(g.id)}
                inset={58}
                leading={<GroupAvatar id={g.id} name={g.name} photoURL={g.photoURL} size={30} />}
                title={g.name}
                chevron
              />
            ))}
          </List>
        )}
      </Section>

      {group && (
        <AddExpenseModal
          group={group}
          currentUid={user.uid}
          onClose={() => nav.replace(`/groups/${group.id}`)}
          prefillReceipt={receiptFile}
        />
      )}
    </Screen>
  );
}
