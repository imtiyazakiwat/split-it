"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { updateUpiId, syncProfileToGroups } from "@/lib/firestore";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import TopBar from "@/components/TopBar";
import Card from "@/components/ui/Card";
import { GlassField } from "@/components/ui/GlassField";
import GlassButton from "@/components/ui/GlassButton";

export default function SettingsPage() {
  const { user, loading, signOut } = useAuth();
  const router = useRouter();
  const [upiId, setUpiId] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) return;
    getDoc(doc(db, "users", user.uid)).then((snap) => {
      const data = snap.data();
      if (data?.upiId) setUpiId(data.upiId);
    });
  }, [user]);

  if (loading || !user) return null;

  const currentUser = user;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const trimmed = upiId.trim();
      await updateUpiId(currentUser.uid, trimmed);
      await syncProfileToGroups(currentUser.uid, {
        displayName: currentUser.displayName || currentUser.email || "User",
        email: currentUser.email || "",
        photoURL: currentUser.photoURL || "",
        upiId: trimmed || undefined,
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex-1 flex flex-col">
      <TopBar title="Settings" onBack={() => router.push("/")} />
      <main className="flex-1 max-w-md w-full mx-auto p-4 space-y-4 scroll-momentum">
        <Card className="p-4">
          <div className="flex items-center gap-3 mb-3 pb-3 border-b border-[var(--border-subtle)]">
            {user.photoURL && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={user.photoURL}
                alt=""
                className="w-12 h-12 rounded-full"
                referrerPolicy="no-referrer"
              />
            )}
            <div className="min-w-0 flex-1">
              <p className="font-medium text-[var(--label-primary)] truncate">
                {user.displayName || "User"}
              </p>
              <p className="text-[13px] text-[var(--label-tertiary)] truncate">{user.email}</p>
            </div>
          </div>
          <form onSubmit={handleSave} className="space-y-3.5">
            <GlassField
              label="Your UPI ID"
              value={upiId}
              onChange={(e) => {
                setUpiId(e.target.value);
                setSaved(false);
              }}
              placeholder="yourname@bank"
            />
            <p className="text-[12px] text-[var(--label-tertiary)]">
              Lets group members pay you directly via GPay, PhonePe, Paytm, or
              any UPI app when settling up. Leave blank to hide this option.
            </p>
            {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
            {saved && <p className="text-sm text-[var(--success)]">Saved.</p>}
            <GlassButton disabled={busy} className="w-full">
              {busy ? "Saving…" : "Save"}
            </GlassButton>
          </form>
        </Card>
        <button
          onClick={async () => {
            await signOut();
            router.push("/");
          }}
          className="w-full text-center py-3 text-[15px] text-[var(--danger)] font-medium tap-shrink"
        >
          Sign Out
        </button>
      </main>
    </div>
  );
}
