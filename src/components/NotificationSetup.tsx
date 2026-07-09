"use client";

import { useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { saveFcmToken } from "@/lib/firestore";
import { getFcmToken, onForegroundMessage } from "@/lib/notifications";

export default function NotificationSetup() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;

    const unsubMessage = onForegroundMessage((payload) => {
      if (payload.title && "Notification" in window && Notification.permission === "granted") {
        new Notification(payload.title, {
          body: payload.body,
          icon: "/icon-192.png",
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
      getFcmToken().then((token) => {
        if (token) saveFcmToken(user.uid, token);
      });
    }
  }, [user]);

  return null;
}
