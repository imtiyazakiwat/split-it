"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import {
  updateUserProfile,
  saveFcmToken,
  removeFcmToken,
  getUserProfile,
} from "@/lib/firestore";
import { isValidUpiId } from "@/lib/upi";
import LoginScreen from "@/components/LoginScreen";
import { uploadImage } from "@/lib/storage";
import {
  requestNotificationPermission,
  getFcmToken,
} from "@/lib/notifications";
import TopBar from "@/components/TopBar";
import Card from "@/components/ui/Card";
import { GlassField } from "@/components/ui/GlassField";
import GlassButton from "@/components/ui/GlassButton";
import { activateFileInputOnKey } from "@/lib/keyboard";

export default function SettingsPage() {
  const { user, loading, signOut } = useAuth();
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [upiId, setUpiId] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState("");
  const [notificationsOn, setNotificationsOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) return;
    const fallbackName = user.displayName || "";
    getUserProfile(user.uid)
      .then((data) => {
        setDisplayName(data?.displayName || fallbackName);
        setUpiId(data?.upiId || "");
        setPhotoPreview(data?.photoURL || user.photoURL || "");
        setNotificationsOn(!!data?.fcmToken);
      })
      .catch(() => {
        // Offline or blocked read: still let the user edit and save.
        setDisplayName(fallbackName);
        setPhotoPreview(user.photoURL || "");
      });
  }, [user]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-[var(--text-tertiary)]">Loading…</p>
      </div>
    );
  }
  // Rendering `null` here left Android users staring at a blank screen whenever
  // sign-in hadn't completed (which the popup-only flow made common).
  if (!user) return <LoginScreen />;

  const currentUser = user;

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoFile(file);
    const reader = new FileReader();
    reader.onload = () => setPhotoPreview(reader.result as string);
    reader.readAsDataURL(file);
  }

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    const trimmedUpi = upiId.trim();
    // Catching this here avoids saving an ID that no UPI app will ever accept,
    // which used to surface much later as a silent failure at payment time.
    if (trimmedUpi && !isValidUpiId(trimmedUpi)) {
      setError("That UPI ID doesn't look right. It should look like yourname@bank.");
      return;
    }
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      let photoURL = photoPreview || undefined;
      if (photoFile) {
        photoURL = await uploadImage(photoFile, "avatar");
      }
      // One write, and it mirrors name/photo/UPI onto every group membership so
      // the settle-up sheet can actually find the UPI ID.
      await updateUserProfile(currentUser.uid, {
        displayName: displayName.trim() || currentUser.displayName || "User",
        email: (currentUser.email || "").toLowerCase(),
        photoURL,
        upiId: trimmedUpi,
      });
      setPhotoFile(null);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  async function toggleNotifications() {
    if (notificationsOn) {
      await removeFcmToken(currentUser.uid);
      setNotificationsOn(false);
      return;
    }
    const granted = await requestNotificationPermission();
    if (!granted) {
      setError("Notification permission denied.");
      return;
    }
    const token = await getFcmToken();
    if (token) {
      await saveFcmToken(currentUser.uid, token);
      setNotificationsOn(true);
      setError("");
    } else {
      setError("Could not get notification token. Check FCM VAPID key config.");
    }
  }

  return (
    <div className="flex-1 flex flex-col">
      <TopBar title="Settings" onBack={() => router.push("/")} />
      <main className="flex-1 max-w-md w-full mx-auto p-4 space-y-4 scroll-momentum">
        <Card className="p-4">
          <form onSubmit={handleSaveProfile} className="space-y-4">
            <div className="flex flex-col items-center gap-3">
              <label
                role="button"
                tabIndex={0}
                aria-label="Change profile photo"
                onKeyDown={activateFileInputOnKey}
                className="relative cursor-pointer tap-shrink rounded-full"
              >
                {photoPreview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={photoPreview}
                    alt=""
                    className="w-20 h-20 rounded-full object-cover border-2 border-[var(--border-subtle)]"
                  />
                ) : (
                  <div className="w-20 h-20 rounded-full bg-[var(--accent)]/10 flex items-center justify-center border-2 border-[var(--border-subtle)]">
                    <span className="text-[28px] font-semibold text-[var(--accent)]">
                      {(displayName || "U").charAt(0).toUpperCase()}
                    </span>
                  </div>
                )}
                <span className="absolute bottom-0 right-0 bg-[var(--accent)] text-white text-[10px] px-1.5 py-0.5 rounded-full">
                  Edit
                </span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoChange}
                  className="hidden"
                />
              </label>
            </div>

            <GlassField
              label="Display name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your name"
            />

            <div>
              <GlassField
                label="UPI ID"
                value={upiId}
                onChange={(e) => setUpiId(e.target.value)}
                placeholder="yourname@bank"
                inputMode="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
              <p className="text-[12px] text-[var(--text-tertiary)] mt-1">
                Shared with your groups so they can pay you in one tap.
                {upiId.trim() && !isValidUpiId(upiId.trim()) && (
                  <span className="block text-[var(--danger)] mt-0.5">
                    Expected format: yourname@bank
                  </span>
                )}
              </p>
            </div>

            {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
            {saved && <p className="text-sm text-[var(--success)]">Saved.</p>}

            <GlassButton disabled={busy} className="w-full">
              {busy ? "Saving…" : "Save Profile"}
            </GlassButton>
          </form>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[15px] font-medium text-[var(--text-primary)]">
                Push notifications
              </p>
              <p className="text-[13px] text-[var(--text-tertiary)]">
                Get notified when someone sends a settlement request or adds an expense
              </p>
            </div>
            <button
              type="button"
              onClick={toggleNotifications}
              className={`relative w-12 h-7 rounded-full transition-colors ${
                notificationsOn ? "bg-[var(--accent)]" : "bg-[var(--border-subtle)]"
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white shadow transition-transform ${
                  notificationsOn ? "translate-x-5" : ""
                }`}
              />
            </button>
          </div>
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
