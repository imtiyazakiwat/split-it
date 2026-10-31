"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useGroupData } from "@/lib/group-data-context";
import LoginScreen from "@/components/LoginScreen";
import Screen from "@/components/ui/Screen";
import { ButtonRow, ListSection } from "@/components/ui/List";
import { Avatar } from "@/components/ui/Controls";
import AddExpenseModal from "@/components/AddExpenseModal";
import { activateFileInputOnKey } from "@/lib/keyboard";

export default function ShareReceiptPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const { groups } = useGroupData();
  const [selectedGroupId, setSelectedGroupId] = useState<string>("");
  const [receiptFile, setReceiptFile] = useState<File | null>(null);

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

  if (loading) return <Screen title="Add Receipt" backHref="/" tabBar={false}>{null}</Screen>;
  if (!user) return <LoginScreen />;

  const group = groups.find((g) => g.id === selectedGroupId);

  return (
    <Screen title="Add Receipt" backHref="/" tabBar={false} large>
      {receiptFile ? (
        <div className="list-section p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={URL.createObjectURL(receiptFile)}
            alt="Shared receipt preview"
            className="w-full rounded-[16px] max-h-72 object-contain bg-[var(--fill-soft)]"
          />
        </div>
      ) : (
        <ListSection footer="Nothing was shared with SplitIt. Pick an image to attach.">
          <label
            role="button"
            tabIndex={0}
            aria-label="Select an image to attach"
            onKeyDown={activateFileInputOnKey}
            className="list-row cursor-pointer active:bg-[var(--pressed)]"
          >
            <span className="flex-1 t-body text-[var(--brand)]">Choose Image</span>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => setReceiptFile(e.target.files?.[0] || null)}
            />
          </label>
        </ListSection>
      )}

      <ListSection header="Add to group" footer="Pick a group to start a new expense with this receipt attached.">
        {groups.length === 0 ? (
          <div className="list-row t-body text-[var(--text-secondary)]">You’re not in any groups yet.</div>
        ) : (
          groups.map((g) => (
            <ButtonRow
              key={g.id}
              onClick={() => setSelectedGroupId(g.id)}
              leading={<Avatar name={g.name} photoURL={g.photoURL} size={32} seed={g.id} />}
              separatorInset={60}
              title={g.name}
              chevron
            />
          ))
        )}
      </ListSection>

      {group && (
        <AddExpenseModal
          group={group}
          currentUid={user.uid}
          onClose={() => router.push(`/groups/${group.id}`)}
          prefillReceipt={receiptFile}
        />
      )}
    </Screen>
  );
}
