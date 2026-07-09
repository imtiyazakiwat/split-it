"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { subscribeToUserGroups } from "@/lib/firestore";
import { Group } from "@/lib/types";
import TopBar from "@/components/TopBar";
import Card from "@/components/ui/Card";
import { GlassSelect } from "@/components/ui/GlassField";
import AddExpenseModal from "@/components/AddExpenseModal";

/**
 * Landing page registered as the Web Share Target (see app/manifest.ts).
 * When a user shares an image (e.g. a payment screenshot) from another app
 * into SplitIt, the browser POSTs it here as multipart/form-data. We read
 * the file client-side via a small companion route, then let the user pick
 * which group and finish creating the expense.
 */
export default function ShareReceiptPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string>("");
  const [receiptFile, setReceiptFile] = useState<File | null>(null);

  useEffect(() => {
    if (!user) return;
    const unsub = subscribeToUserGroups(user.uid, setGroups);
    return unsub;
  }, [user]);

  useEffect(() => {
    // The shared file arrives via a POST to this route. Since this is a
    // client component, we grab it from the same-origin request using the
    // Cache Storage bridge set up in the service worker, falling back to
    // manual file selection if unavailable.
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

  if (loading || !user) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-[var(--label-tertiary)] text-sm">Loading…</p>
      </div>
    );
  }

  const group = groups.find((g) => g.id === selectedGroupId);

  return (
    <div className="flex-1 flex flex-col">
      <TopBar title="Add Receipt" onBack={() => router.push("/")} />
      <main className="flex-1 max-w-md w-full mx-auto p-4 space-y-4 scroll-momentum">
        <p className="text-sm text-[var(--label-secondary)]">
          Received a shared image. Pick a group to attach it to a new expense.
        </p>

        {!receiptFile && (
          <label className="block bg-[var(--surface)] border-2 border-dashed border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6 text-center text-sm text-[var(--label-tertiary)] cursor-pointer tap-shrink">
            No image detected. Tap to select one manually.
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => setReceiptFile(e.target.files?.[0] || null)}
            />
          </label>
        )}

        {receiptFile && (
          <Card className="p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={URL.createObjectURL(receiptFile)}
              alt="Shared receipt preview"
              className="w-full rounded-[var(--radius-md)] max-h-64 object-contain"
            />
          </Card>
        )}

        <GlassSelect
          label="Group"
          value={selectedGroupId}
          onChange={(e) => setSelectedGroupId(e.target.value)}
        >
          <option value="">Select a group…</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </GlassSelect>
      </main>

      {group && (
        <AddExpenseModal
          group={group}
          currentUid={user.uid}
          onClose={() => router.push(`/groups/${group.id}`)}
          prefillReceipt={receiptFile}
        />
      )}
    </div>
  );
}
