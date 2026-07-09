"use client";

import { useState } from "react";
import Image from "next/image";
import { useAuth } from "@/lib/auth-context";
import GlassButton from "@/components/ui/GlassButton";

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

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 text-center relative overflow-hidden">
      {/* Ambient background blobs for depth, iOS 26 style */}
      <div
        aria-hidden
        className="absolute -top-24 -left-24 w-72 h-72 rounded-full bg-[var(--accent)]/25 blur-3xl"
      />
      <div
        aria-hidden
        className="absolute -bottom-32 -right-16 w-80 h-80 rounded-full bg-[var(--success)]/20 blur-3xl"
      />

      <div className="relative z-[1] flex flex-col items-center w-full max-w-sm">
        <div className="w-24 h-24 rounded-[var(--radius-xl)] overflow-hidden shadow-[0_12px_32px_-8px_var(--accent)] mb-6">
          <Image src="/icon-512.png" alt="" width={96} height={96} priority className="w-full h-full" />
        </div>

        <h1 className="text-[34px] font-semibold text-[var(--label-primary)] mb-2 tracking-tight leading-none">
          SplitIt
        </h1>
        <p className="text-[var(--label-secondary)] mb-10 max-w-xs text-[15px] leading-relaxed">
          Split bills with friends. Track who paid, who owes, and settle up —
          together.
        </p>

        <GlassButton
          variant="glass"
          size="lg"
          onClick={handleSignIn}
          disabled={busy}
          className="w-full"
        >
          <svg width="20" height="20" viewBox="0 0 48 48" className="shrink-0" aria-hidden>
            <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"/>
            <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"/>
            <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"/>
            <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 01-4.087 5.571l6.19 5.238C41.986 35.135 44 29.99 44 24c0-1.341-.138-2.65-.389-3.917z"/>
          </svg>
          <span className="truncate">{busy ? "Signing in…" : "Continue with Google"}</span>
        </GlassButton>

        {error && <p className="text-sm text-[var(--danger)] mt-4">{error}</p>}

        <p className="text-[12px] text-[var(--label-tertiary)] mt-8 leading-relaxed">
          By continuing, you agree to share your name, email, and photo with
          your group members.
        </p>
      </div>
    </div>
  );
}
