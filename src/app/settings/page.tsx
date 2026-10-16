"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { isValidUpiId } from "@/lib/upi";
import { uploadImage } from "@/lib/storage";
import { requestNotificationPermission, getFcmToken } from "@/lib/notifications";
import { activateFileInputOnKey } from "@/lib/keyboard";
import LoginScreen from "@/components/LoginScreen";
import { useToast } from "@/components/ui/Toast";
import Screen from "@/components/kit/Screen";
import { BarButton } from "@/components/kit/BarButton";
import { List, RowButton, Section } from "@/components/kit/List";
import { Avatar } from "@/components/kit/Avatar";
import { IconTile } from "@/components/kit/Tile";
import { FieldRow, Spinner, Switch } from "@/components/kit/Controls";
import { ConfirmSheet } from "@/components/kit/ActionSheet";
import { useNav } from "@/components/kit/nav";

// Firestore is imported where it's used, not here: this is a tab root, and a
// static import put the 641 kB SDK in front of its first paint for a profile
// read that can happen a moment later.
const firestore = () => import("@/lib/firestore");

interface Loaded {
  displayName: string;
  upiId: string;
  photoURL: string;
  notificationsOn: boolean;
}

export default function SettingsPage() {
  const { user, loading, signOut } = useAuth();
  const nav = useNav();
  const showToast = useToast();
  // What's saved, so the form knows when it has changes worth a Save button.
  const [saved, setSaved] = useState<Loaded | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [upiId, setUpiId] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState("");
  const [notificationsOn, setNotificationsOn] = useState(false);
  const [notifBusy, setNotifBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  useEffect(() => {
    if (!user) return;
    const fallback = {
      displayName: user.displayName || "",
      upiId: "",
      photoURL: user.photoURL || "",
      notificationsOn: false,
    };
    let cancelled = false;
    firestore()
      .then(({ getUserProfile }) => getUserProfile(user.uid))
      .then((data) => {
        if (cancelled) return;
        const loaded: Loaded = {
          displayName: data?.displayName || fallback.displayName,
          upiId: data?.upiId || "",
          photoURL: data?.photoURL || fallback.photoURL,
          notificationsOn: !!data?.fcmToken,
        };
        setSaved(loaded);
        setDisplayName(loaded.displayName);
        setUpiId(loaded.upiId);
        setPhotoPreview(loaded.photoURL);
        setNotificationsOn(loaded.notificationsOn);
      })
      .catch(() => {
        // Offline or blocked read: still let the user edit and save.
        if (cancelled) return;
        setSaved(fallback);
        setDisplayName(fallback.displayName);
        setPhotoPreview(fallback.photoURL);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (loading) {
    return (
      <Screen title="Settings" large tabBar>
        <div className="flex justify-center py-10 text-label-2">
          <Spinner />
        </div>
      </Screen>
    );
  }
  // Rendering `null` here left people staring at a blank screen whenever
  // sign-in hadn't completed.
  if (!user) return <LoginScreen />;

  const currentUser = user;
  const trimmedUpi = upiId.trim();
  const upiInvalid = !!trimmedUpi && !isValidUpiId(trimmedUpi);
  const dirty =
    !!saved &&
    (displayName !== saved.displayName || trimmedUpi !== saved.upiId || !!photoFile);

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoFile(file);
    const reader = new FileReader();
    reader.onload = () => setPhotoPreview(reader.result as string);
    reader.readAsDataURL(file);
  }

  async function handleSaveProfile(e?: React.FormEvent) {
    e?.preventDefault();
    // Catch it here rather than as a silent failure at payment time.
    if (upiInvalid) {
      setError("That UPI ID doesn't look right. It should look like yourname@bank.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      let photoURL = photoPreview || undefined;
      if (photoFile) photoURL = await uploadImage(photoFile, "avatar");
      const name = displayName.trim() || currentUser.displayName || "User";
      // One write that mirrors name/photo/UPI onto every group membership, so
      // the settle-up sheet can actually find the UPI ID.
      const { updateUserProfile } = await firestore();
      await updateUserProfile(currentUser.uid, {
        displayName: name,
        email: (currentUser.email || "").toLowerCase(),
        photoURL,
        upiId: trimmedUpi,
      });
      setPhotoFile(null);
      setSaved((s) => ({ ...(s as Loaded), displayName, upiId: trimmedUpi, photoURL: photoURL || "" }));
      showToast({ message: "Profile saved" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  async function toggleNotifications(next: boolean) {
    setNotifBusy(true);
    setError("");
    try {
      const { saveFcmToken, removeFcmToken } = await firestore();
      if (!next) {
        await removeFcmToken(currentUser.uid);
        setNotificationsOn(false);
        return;
      }
      const granted = await requestNotificationPermission();
      if (!granted) {
        setError("Notifications are blocked for SplitIt. Allow them in your device settings.");
        return;
      }
      const token = await getFcmToken();
      if (token) {
        await saveFcmToken(currentUser.uid, token);
        setNotificationsOn(true);
      } else {
        setError("Could not get a notification token. Check the FCM VAPID key configuration.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't change notifications");
    } finally {
      setNotifBusy(false);
    }
  }

  return (
    <Screen
      title="Settings"
      large
      tabBar
      trailing={
        dirty ? (
          <BarButton
            text={busy ? "Saving…" : "Save"}
            label="Save profile"
            prominent
            disabled={busy || upiInvalid}
            onClick={() => void handleSaveProfile()}
          />
        ) : undefined
      }
    >
      <form onSubmit={handleSaveProfile}>
        {/* Profile header, Apple Account style */}
        <div className="card flex items-center gap-4 p-4">
          <label
            role="button"
            tabIndex={0}
            aria-label="Change profile photo"
            onKeyDown={activateFileInputOnKey}
            className="relative shrink-0 cursor-pointer"
          >
            <Avatar name={displayName || currentUser.displayName || "You"} photoURL={photoPreview} size={64} />
            <span className="absolute -bottom-0.5 -right-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-[var(--tint)] text-white shadow-[0_0_0_2px_var(--cell)]">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden>
                <path d="M16.6 3.9a2.1 2.1 0 0 1 3 3L8.4 18.1 4 19.5l1.4-4.4L16.6 3.9Z" />
              </svg>
            </span>
            <input type="file" accept="image/*" onChange={handlePhotoChange} className="hidden" />
          </label>
          <div className="min-w-0">
            <p className="t-title3 truncate">{displayName || currentUser.displayName || "Your name"}</p>
            <p className="t-subhead truncate text-label-2">{currentUser.email}</p>
          </div>
        </div>

        <Section
          header="Profile"
          footer={
            upiInvalid ? (
              <span className="text-neg">Expected format: yourname@bank</span>
            ) : (
              "Your UPI ID is shared with your groups so they can pay you in one tap."
            )
          }
        >
          <List>
            {/* Until the saved profile arrives, show what's already known and
                hold edits, so a late read can't overwrite what was typed. */}
            <FieldRow
              label="Name"
              value={saved ? displayName : currentUser.displayName || ""}
              readOnly={!saved}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your name"
              autoComplete="name"
              maxLength={60}
            />
            <FieldRow
              label="UPI ID"
              value={saved ? upiId : ""}
              readOnly={!saved}
              onChange={(e) => setUpiId(e.target.value)}
              placeholder={saved ? "yourname@bank" : "Loading…"}
              inputMode="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          </List>
        </Section>

        <Section footer="Get notified when someone sends a settlement request or adds an expense.">
          <List>
            <div className="row">
              <IconTile icon="bell" color="var(--red)" />
              <span className="row-main">
                <span className="row-title">Notifications</span>
              </span>
              {notifBusy && <Spinner size={16} className="text-label-2" />}
              <Switch
                checked={notificationsOn}
                onChange={(v) => void toggleNotifications(v)}
                label="Push notifications"
                disabled={notifBusy}
              />
            </div>
          </List>
        </Section>

        {error && <p className="t-footnote mt-3 px-4 text-neg">{error}</p>}

        <Section>
          <List>
            <RowButton onClick={() => setConfirmSignOut(true)} title="Sign Out" destructive centered />
          </List>
        </Section>
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>

      {confirmSignOut && (
        <ConfirmSheet
          title="Sign out of SplitIt?"
          message="Your groups stay as they are. Sign back in with Google to see them again."
          confirmLabel="Sign Out"
          destructive
          onConfirm={async () => {
            await signOut();
            nav.replace("/");
          }}
          onClose={() => setConfirmSignOut(false)}
        />
      )}
    </Screen>
  );
}
