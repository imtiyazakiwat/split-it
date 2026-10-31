"use client";

import { useState } from "react";
import Image from "next/image";
import { useAuth } from "@/lib/auth-context";

/**
 * Welcome screen in the style of Apple's own onboarding: app icon, a large
 * title, three short feature rows, and one prominent button pinned near the
 * bottom.
 */
export default function LoginScreen() {
  const { signInWithGoogle } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSignIn() {
    setBusy(true);
    setError("");
    try {
      await signInWithGoogle();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setBusy(false);
    }
  }

  const features = [
    { color: "var(--indigo)", title: "Split with your group", body: "Add an expense once. Everyone sees what they owe." },
    { color: "var(--green)", title: "Settle with UPI", body: "Open your UPI app with the amount filled in, then record it." },
    { color: "var(--orange)", title: "Always know where you stand", body: "One balance per person, across every group you share." },
  ];

  return (
    <div className="flex-1 min-h-[100dvh] flex flex-col bg-[var(--background)] px-8 pt-[max(4rem,calc(env(safe-area-inset-top)+3rem))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <div className="flex-1 max-w-sm w-full mx-auto flex flex-col">
        <div className="w-[88px] h-[88px] rounded-[22px] overflow-hidden mx-auto shadow-[0_8px_24px_rgba(0,0,0,0.12)]">
          <Image src="/icon-512.png" alt="" width={88} height={88} priority className="w-full h-full" />
        </div>
        <h1 className="t-large-title text-center text-[var(--text-primary)] mt-6">Welcome to SplitIt</h1>

        <ul className="mt-10 space-y-6">
          {features.map((f) => (
            <li key={f.title} className="flex items-start gap-4">
              <span className="w-[10px] h-[10px] mt-[7px] rounded-full shrink-0" style={{ background: f.color }} aria-hidden />
              <span>
                <span className="block t-headline text-[var(--text-primary)]">{f.title}</span>
                <span className="block t-subhead text-[var(--text-secondary)] mt-0.5">{f.body}</span>
              </span>
            </li>
          ))}
        </ul>

        <div className="flex-1 min-h-8" />

        <p className="t-caption text-center text-[var(--text-secondary)] mb-4 px-2">
          Your name, email and photo are shared with people in your groups.
        </p>
        <button type="button" onClick={handleSignIn} disabled={busy} className="btn-prominent w-full">
          <svg width="20" height="20" viewBox="0 0 48 48" className="shrink-0 bg-white rounded-full p-[2px]" aria-hidden>
            <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"/>
            <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"/>
            <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"/>
            <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 01-4.087 5.571l6.19 5.238C41.986 35.135 44 29.99 44 24c0-1.341-.138-2.65-.389-3.917z"/>
          </svg>
          {busy ? "Signing In…" : "Continue with Google"}
        </button>
        {error && <p className="t-footnote text-center text-[var(--neg)] mt-3">{error}</p>}
      </div>
    </div>
  );
}
