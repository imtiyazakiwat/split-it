"use client";

import { useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { getFcmToken, onForegroundMessage } from "@/lib/notifications";

/**
 * `saveFcmToken` is imported dynamically below rather than here.
 *
 * This component is rendered by the root layout, so a static
 * `import { saveFcmToken } from "@/lib/firestore"` put the 641 kB Firestore chunk
 * on the critical path of every route — for a single token write that happens
 * after permission has already been granted. It was the last edge keeping that
 * chunk in the initial script set after every other path had been made async,
 * and it was found by `scripts/trace-critical-imports.mjs` rather than by
 * reading, because one missed edge is invisible in the bundle output.
 */

export default function NotificationSetup() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;

    const unsubMessage = onForegroundMessage((payload) => {
      if (payload.title && "Notification" in window && Notification.permission === "granted") {
        // Tagging means the same message can't appear twice, whichever path
        // renders it (this handler, or the service worker mid-transition).
        new Notification(payload.title, {
          body: payload.body,
          icon: "/icon-192.png",
          tag: payload.tag,
        });
      }
    });

    return () => {
      unsubMessage?.();
    };
  }, [user]);

  // Refresh token on user change
  useEffect(() => {
    if (!user) return;
    if (!("Notification" in window)) return;

    if (Notification.permission === "granted") {
      void (async () => {
        const token = await getFcmToken();
        if (!token) return;
        const { saveFcmToken } = await import("@/lib/firestore");
        await saveFcmToken(user.uid, token);
      })();
    }
  }, [user]);

  return null;
}
