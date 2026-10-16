"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import SplashScreen from "@/components/SplashScreen";

/**
 * Shows the launch splash until auth resolves, then fades and unmounts.
 * Timer-driven with a hard safety cap so it can never trap the user.
 *
 * The minimum exists only to stop the splash strobing on a warm start; it is
 * not a loading indicator (it used to be 1.2 s, which was the single largest
 * contributor to the app feeling slow to open).
 */
const MIN_SPLASH_MS = 300;
/** Must match `.splash.is-leaving` in globals.css. */
const FADE_MS = 250;
const SAFETY_MS = 6000;

export default function SplashGate() {
  const { loading } = useAuth();
  const [minElapsed, setMinElapsed] = useState(false);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    const min = setTimeout(() => setMinElapsed(true), MIN_SPLASH_MS);
    const max = setTimeout(() => setGone(true), SAFETY_MS);
    return () => {
      clearTimeout(min);
      clearTimeout(max);
    };
  }, []);

  const done = !loading && minElapsed;

  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setGone(true), FADE_MS);
    return () => clearTimeout(t);
  }, [done]);

  if (gone) return null;
  return (
    <div aria-hidden={done}>
      <SplashScreen leaving={done} />
    </div>
  );
}
