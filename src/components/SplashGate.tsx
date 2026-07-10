"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import SplashScreen from "@/components/SplashScreen";

/**
 * Shows the animated splash on launch until auth has resolved and a minimum
 * display time has elapsed (so it doesn't flicker), then fades out and unmounts.
 */
export default function SplashGate() {
  const { loading } = useAuth();
  const [minElapsed, setMinElapsed] = useState(false);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setMinElapsed(true), 1300);
    return () => clearTimeout(t);
  }, []);

  if (gone) return null;

  const done = !loading && minElapsed;

  return (
    <div
      className={`fixed inset-0 z-[100] ${done ? "animate-splash-out" : ""}`}
      onAnimationEnd={() => {
        if (done) setGone(true);
      }}
      aria-hidden={done}
    >
      <SplashScreen />
    </div>
  );
}
