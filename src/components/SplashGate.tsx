"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import SplashScreen from "@/components/SplashScreen";

/**
 * Shows the animated splash on launch until auth resolves, then fades out and
 * unmounts. Dismissal is timer-driven (not dependent on animationend) with a
 * hard safety cap so it can never block the app.
 *
 * The minimum display time exists only to stop the splash strobing on a fast
 * warm start — it is not a loading indicator. It used to be 1200ms plus a 400ms
 * fade, which put 1.6 seconds of pure waiting in front of every launch even when
 * the session was already cached and auth resolved in single-digit
 * milliseconds. That was the single largest contributor to the app feeling slow
 * to open.
 */
const MIN_SPLASH_MS = 300;
/** Must match the `.animate-splash-out` duration in globals.css. */
const FADE_MS = 250;
const SAFETY_MS = 6000;

export default function SplashGate() {
  const { loading } = useAuth();
  const [minElapsed, setMinElapsed] = useState(false);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    const min = setTimeout(() => setMinElapsed(true), MIN_SPLASH_MS);
    // Safety net: never let the splash trap the user, even if auth stalls.
    const max = setTimeout(() => setGone(true), SAFETY_MS);
    return () => {
      clearTimeout(min);
      clearTimeout(max);
    };
  }, []);

  const done = !loading && minElapsed;

  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setGone(true), FADE_MS); // let the fade-out play
    return () => clearTimeout(t);
  }, [done]);

  if (gone) return null;

  return (
    <div className={`fixed inset-0 z-[100] ${done ? "animate-splash-out" : ""}`} aria-hidden={done}>
      <SplashScreen />
    </div>
  );
}
