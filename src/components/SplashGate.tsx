"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import SplashScreen from "@/components/SplashScreen";

/**
 * Shows the animated splash on launch until auth resolves and a minimum
 * display time elapses, then fades out and unmounts. Dismissal is timer-driven
 * (not dependent on animationend) with a hard safety cap so it can never block
 * the app.
 */
export default function SplashGate() {
  const { loading } = useAuth();
  const [minElapsed, setMinElapsed] = useState(false);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    const min = setTimeout(() => setMinElapsed(true), 1200);
    // Safety net: never let the splash trap the user, even if auth stalls.
    const max = setTimeout(() => setGone(true), 6000);
    return () => {
      clearTimeout(min);
      clearTimeout(max);
    };
  }, []);

  const done = !loading && minElapsed;

  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setGone(true), 400); // let the fade-out play
    return () => clearTimeout(t);
  }, [done]);

  if (gone) return null;

  return (
    <div className={`fixed inset-0 z-[100] ${done ? "animate-splash-out" : ""}`} aria-hidden={done}>
      <SplashScreen />
    </div>
  );
}
