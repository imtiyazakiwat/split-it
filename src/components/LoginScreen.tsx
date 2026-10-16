"use client";

import { useState } from "react";
import Image from "next/image";
import { useAuth } from "@/lib/auth-context";
import { IconTile } from "@/components/kit/Tile";
import { Spinner } from "@/components/kit/Controls";

const FEATURES = [
  {
    icon: "person.2",
    color: "var(--blue)",
    title: "Split with your group",
    text: "Log a bill once and everyone's share is worked out to the paise.",
  },
  {
    icon: "indianrupee",
    color: "var(--green)",
    title: "Settle up over UPI",
    text: "Pay from Google Pay, PhonePe or Paytm, then record it in a tap.",
  },
  {
    icon: "doc.text",
    color: "var(--orange)",
    title: "Every rupee, explained",
    text: "A running statement with each person shows exactly why you owe what you owe.",
  },
];

function GoogleMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" className="shrink-0" aria-hidden>
      <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" />
      <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" />
      <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" />
      <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 01-4.087 5.571l6.19 5.238C41.986 35.135 44 29.99 44 24c0-1.341-.138-2.65-.389-3.917z" />
    </svg>
  );
}

/**
 * Welcome screen, in the shape Apple's own first-run screens take: the app,
 * what it does in three lines, one way in.
 */
export default function LoginScreen({ title = "Welcome to SplitIt", note }: { title?: string; note?: string }) {
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

  return (
    <main className="flex min-h-dvh flex-col bg-[var(--bg)] px-[calc(24px+var(--sal))] pb-[max(24px,var(--sab))] pt-[calc(var(--nav-top)+40px)]">
      <div className="mx-auto flex w-full max-w-[420px] flex-1 flex-col">
        <div className="flex flex-col items-center text-center">
          <Image
            src="/icon-512.png"
            alt=""
            width={88}
            height={88}
            priority
            className="h-[88px] w-[88px] rounded-[20px] shadow-[0_10px_30px_-10px_rgba(0,136,255,0.55)]"
          />
          <h1 className="t-large-title mt-6 text-label">{title}</h1>
          {note && <p className="t-callout mt-2 text-label-2">{note}</p>}
        </div>

        <ul className="mt-10 space-y-6">
          {FEATURES.map((f) => (
            <li key={f.title} className="flex items-start gap-4">
              <IconTile icon={f.icon} color={f.color} size="lg" />
              <div className="min-w-0">
                <p className="t-headline text-label">{f.title}</p>
                <p className="t-subhead mt-0.5 text-label-2">{f.text}</p>
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-auto pt-10">
          {error && <p className="t-footnote mb-3 text-center text-neg">{error}</p>}
          <button
            type="button"
            onClick={handleSignIn}
            disabled={busy}
            className="btn is-block bg-[var(--label)] text-[var(--bg)]"
          >
            {busy ? (
              <Spinner size={18} />
            ) : (
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white">
                <GoogleMark />
              </span>
            )}
            <span>{busy ? "Signing in…" : "Continue with Google"}</span>
          </button>
          <p className="t-footnote mt-4 text-center text-label-2">
            Your name, email and photo are shared with the members of groups you join.
          </p>
        </div>
      </div>
    </main>
  );
}
