"use client";

import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

export default function TopBar({
  title,
  onBack,
}: {
  title: string;
  onBack?: () => void;
}) {
  const { user } = useAuth();
  const router = useRouter();

  return (
    <header className="sticky top-0 z-10 pt-[env(safe-area-inset-top)] px-4">
      <div className="glass max-w-md mx-auto rounded-[var(--radius-lg)] px-4 h-14 flex items-center justify-between mt-2">
        <div className="flex items-center gap-1 min-w-0">
          {onBack && (
            <button
              onClick={onBack}
              aria-label="Back"
              className="grid place-items-center w-11 h-11 -ml-2.5 rounded-full text-[var(--accent)] tap-shrink"
            >
              <svg width="14" height="22" viewBox="0 0 14 22" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="m11 2-8 9 8 9" />
              </svg>
            </button>
          )}
          <h1 className="font-semibold text-[var(--text-primary)] truncate text-[17px]">
            {title}
          </h1>
        </div>
        {user && (
          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={() => router.push("/settings")}
              aria-label="Settings"
              className="grid place-items-center w-11 h-11 -mr-2 rounded-full text-[var(--text-secondary)] tap-shrink"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M12 15a3 3 0 100-6 3 3 0 000 6z" />
                <path d="M19.4 13a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V19a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H4a2 2 0 110-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33h0a1.65 1.65 0 001-1.51V4a2 2 0 114 0v.09a1.65 1.65 0 001 1.51h0a1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82v0a1.65 1.65 0 001.51 1H20a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
