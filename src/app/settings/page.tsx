"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import {
  updateUserProfile,
  getUserProfile,
} from "@/lib/firestore";
import { isValidUpiId } from "@/lib/upi";
import LoginScreen from "@/components/LoginScreen";
import { uploadImage } from "@/lib/storage";
import {
  describePushFailure,
  disablePushForUser,
  enablePushForUser,
} from "@/lib/notifications";
import { usePushStatus } from "@/lib/use-push";
import { sendTestNotification } from "@/lib/send-notification";
import { activateFileInputOnKey } from "@/lib/keyboard";
import Screen from "@/components/ui/Screen";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { ButtonRow, FieldRow, IconTile, ListSection, Row } from "@/components/ui/List";
import { Avatar, Switch } from "@/components/ui/Controls";
import { Bell, Camera, RupeeCircle } from "@/components/ui/Icons";

export default function SettingsPage() {
  const { user, loading, signOut } = useAuth();
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [upiId, setUpiId] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState("");
  // Per device, read from the browser — not `!!users/{uid}.fcmToken`, which
  // reported "on" on every device once any one of them had a token.
  const pushStatus = usePushStatus(user?.uid);
  const notificationsOn = pushStatus === "on";
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMessage, setPushMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState<{ name: string; upi: string; photo: string } | null>(null);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const showToast = useToast();

  useEffect(() => {
    if (!user) return;
    const fallbackName = user.displayName || "";
    getUserProfile(user.uid)
      .then((data) => {
        const name = data?.displayName || fallbackName;
        const upi = data?.upiId || "";
        const photo = data?.photoURL || user.photoURL || "";
        setDisplayName(name);
        setUpiId(upi);
        setPhotoPreview(photo);
        setLoaded({ name, upi, photo });
      })
      .catch(() => {
        // Offline or blocked read: still let the user edit and save.
        setDisplayName(fallbackName);
        setPhotoPreview(user.photoURL || "");
        setLoaded({ name: fallbackName, upi: "", photo: user.photoURL || "" });
      });
  }, [user]);

  if (loading) return <Screen title="Settings" large>{null}</Screen>;
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
    try {
      let photoURL = photoPreview || undefined;
      if (photoFile) {
        photoURL = await uploadImage(photoFile, "avatar");
      }
      // One write, and it mirrors name/photo/UPI onto every group membership so
      // the settle-up sheet can actually find the UPI ID.
      const savedName = displayName.trim() || currentUser.displayName || "User";
      await updateUserProfile(currentUser.uid, {
        displayName: savedName,
        email: (currentUser.email || "").toLowerCase(),
        photoURL,
        upiId: trimmedUpi,
      });
      setPhotoFile(null);
      setDisplayName(savedName);
      setLoaded({ name: savedName, upi: trimmedUpi, photo: photoURL || "" });
      showToast({ message: "Profile saved" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  async function toggleNotifications() {
    if (pushBusy) return;
    setPushBusy(true);
    setPushMessage("");
    try {
      if (notificationsOn) {
        await disablePushForUser(currentUser.uid);
        return;
      }
      const result = await enablePushForUser(currentUser.uid);
      if (!result.ok) setPushMessage(describePushFailure(result.reason));
    } finally {
      setPushBusy(false);
    }
  }

  // Proves the whole pipeline — this device's token, the server, FCM and the
  // service worker — in one tap, which is the fastest way to answer
  // "are notifications working?" for a user or for us.
  async function handleTestPush() {
    setPushBusy(true);
    setPushMessage("");
    try {
      const result = await sendTestNotification();
      setPushMessage(
        result.ok
          ? "Sent. It should arrive in a few seconds."
          : result.reason === "rate-limited"
          ? "Too many tests in a row. Try again in a few minutes."
          : result.reason === "no-device"
          ? "This device isn't registered yet. Turn notifications off and on again."
          : "Couldn't send a test. Check your connection and try again."
      );
    } finally {
      setPushBusy(false);
    }
  }

  const profileDirty =
    !!loaded &&
    (displayName.trim() !== loaded.name || upiId.trim() !== loaded.upi || !!photoFile);
  const upiInvalid = !!upiId.trim() && !isValidUpiId(upiId.trim());
  const pushUnavailable =
    pushStatus === "needs-install" || pushStatus === "unsupported" || pushStatus === "unavailable";

  return (
    <Screen title="Settings" large>
      <form onSubmit={handleSaveProfile}>
        {/* Profile header, Apple ID style. */}
        <div className="flex flex-col items-center text-center pt-1 pb-2">
          <label
            role="button"
            tabIndex={0}
            aria-label="Change profile photo"
            onKeyDown={activateFileInputOnKey}
            className="relative cursor-pointer rounded-full flex flex-col items-center"
          >
            <Avatar name={displayName || currentUser.displayName || "You"} photoURL={photoPreview} size={88} seed={currentUser.uid} uid={currentUser.uid} />
            <span className="mt-2 t-subhead font-semibold text-[var(--brand)] flex items-center gap-1">
              <Camera size={16} /> Edit Photo
            </span>
            <input type="file" accept="image/*" onChange={handlePhotoChange} className="hidden" />
          </label>
          <p className="t-footnote text-[var(--text-secondary)] mt-1 selectable">{currentUser.email}</p>
        </div>

        <ListSection
          header="Profile"
          footer={
            upiInvalid ? (
              <span className="text-[var(--neg)]">A UPI ID looks like yourname@bank.</span>
            ) : (
              "Your UPI ID is shared with your groups so they can pay you in one tap."
            )
          }
        >
          <FieldRow label="Name">
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your Name"
              aria-label="Display name"
              autoComplete="name"
              className="row-input py-[13px]"
            />
          </FieldRow>
          <FieldRow label="UPI ID">
            <input
              value={upiId}
              onChange={(e) => setUpiId(e.target.value)}
              placeholder="yourname@bank"
              aria-label="UPI ID"
              inputMode="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className={`row-input py-[13px] ${upiInvalid ? "!text-[var(--neg)]" : ""}`}
            />
          </FieldRow>
        </ListSection>

        {(profileDirty || busy || error) && (
          <div className="mt-4">
            <button type="submit" disabled={busy || upiInvalid} className="btn-prominent w-full">
              {busy ? "Saving…" : "Save Changes"}
            </button>
            {error && <p className="list-footer !text-[var(--neg)]">{error}</p>}
          </div>
        )}
      </form>

      <ListSection
        header="Notifications"
        footer={
          pushMessage ||
          (pushStatus === "denied" || pushStatus === "needs-install"
            ? describePushFailure(pushStatus === "denied" ? "denied" : "needs-install")
            : "Get notified when someone adds an expense, asks you to confirm a payment, or pays you back.")
        }
      >
        <Row
          leading={<IconTile color="var(--red)"><Bell size={17} /></IconTile>}
          separatorInset={58}
          title="Push Notifications"
        >
          <Switch
            checked={notificationsOn}
            onChange={() => void toggleNotifications()}
            label="Push notifications"
            busy={pushBusy}
            disabled={pushBusy || pushUnavailable}
          />
        </Row>
        {notificationsOn && (
          <ButtonRow onClick={handleTestPush} disabled={pushBusy} title="Send a Test Notification" action />
        )}
      </ListSection>

      <ListSection header="About">
        <Row
          leading={<IconTile color="var(--indigo)"><RupeeCircle size={18} /></IconTile>}
          separatorInset={58}
          title="SplitIt"
          detail="Split bills, settle with UPI"
        />
      </ListSection>

      <ListSection>
        <ButtonRow onClick={() => setConfirmSignOut(true)} title="Sign Out" destructive className="justify-center [&>span]:text-center" />
      </ListSection>

      {confirmSignOut && (
        <ConfirmDialog
          title="Sign out of SplitIt?"
          message="Your groups and balances stay saved to your account."
          confirmLabel="Sign Out"
          destructive
          onConfirm={async () => {
            await signOut();
            router.push("/");
          }}
          onClose={() => setConfirmSignOut(false)}
        />
      )}
    </Screen>
  );
}
