"use client";

import { useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { refreshPushForUser } from "@/lib/notifications";

/**
 * Keeps this device's push registration fresh on launch.
 *
 * It never prompts for permission (that only happens from a tap, which iOS
 * requires), and it does nothing when the user turned notifications off on this
 * device. The old version re-saved the token on every launch whenever
 * permission was granted, so switching notifications off in Settings was
 * silently undone the next time the app opened.
 *
 * The old foreground `onMessage` handler is gone too: it only ever fired when
 * the Firebase messaging worker was the active one, and the app now has a
 * single worker (public/sw.js) that shows every push itself.
 *
 * Firestore and firebase/messaging are both reached through dynamic imports
 * inside `refreshPushForUser`, so this component — rendered by the root layout —
 * adds nothing to the critical path.
 */
export default function NotificationSetup() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;
    void refreshPushForUser(user.uid);
  }, [user]);

  return null;
}
