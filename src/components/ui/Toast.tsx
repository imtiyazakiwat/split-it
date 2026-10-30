"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  ReactNode,
} from "react";

interface ToastOptions {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  duration?: number; // ms
}

interface ToastState extends ToastOptions {
  id: number;
}

const ToastContext = createContext<{ showToast: (o: ToastOptions) => void } | undefined>(
  undefined
);

/**
 * Minimal single-slot banner. Auto-dismisses after `duration` (default 4s).
 * Supports one optional action; tapping it runs `onAction` and dismisses.
 * iOS HUD: a glass capsule that drops in at the top centre, clear of the tab
 * bar and of sheet commit buttons. Timer pauses while touched, and an upward
 * swipe dismisses it.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remainingRef = useRef<number>(0);
  const startedAtRef = useRef<number>(0);
  const touchYRef = useRef<number | null>(null);

  const clearTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  const armTimer = (ms: number) => {
    clearTimer();
    remainingRef.current = ms;
    startedAtRef.current = Date.now();
    timerRef.current = setTimeout(() => setToast(null), ms);
  };

  const showToast = useCallback((o: ToastOptions) => {
    clearTimer();
    setToast({ id: Date.now(), ...o });
    const ms = o.duration ?? 4000;
    remainingRef.current = ms;
    startedAtRef.current = Date.now();
    timerRef.current = setTimeout(() => setToast(null), ms);
  }, []);

  useEffect(() => () => clearTimer(), []);

  function handleAction() {
    toast?.onAction?.();
    clearTimer();
    setToast(null);
  }

  // Pause the countdown while a finger is down so slow readers don't lose it.
  function onTouchStart(e: React.TouchEvent) {
    touchYRef.current = e.touches[0]?.clientY ?? null;
    if (timerRef.current) {
      clearTimer();
      remainingRef.current = Math.max(
        0,
        remainingRef.current - (Date.now() - startedAtRef.current)
      );
    }
  }

  function onTouchEnd(e: React.TouchEvent) {
    const startY = touchYRef.current;
    touchYRef.current = null;
    const endY = e.changedTouches[0]?.clientY;
    // Upward flick dismisses, like flicking away a notification.
    if (startY !== null && endY !== undefined && startY - endY > 24) {
      clearTimer();
      setToast(null);
      return;
    }
    if (toast) armTimer(remainingRef.current);
  }

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toast && (
        <div
          className="fixed inset-x-0 z-[60] top-[calc(env(safe-area-inset-top)+8px)] px-4 pointer-events-none flex justify-center"
          role="status"
          aria-live="polite"
        >
          <div
            key={toast.id}
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
            className="glass glass-strong pointer-events-auto max-w-[min(100%,420px)] rounded-full min-h-[48px] pl-4 pr-2 py-1.5 flex items-center gap-2.5 animate-toast-in"
          >
            <span className="shrink-0 w-[22px] h-[22px] rounded-full bg-[var(--fill)] text-[var(--text-primary)] grid place-items-center" aria-hidden>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
            </span>
            <span className="min-w-0 flex-1 text-[15px] leading-[20px] font-semibold text-[var(--text-primary)] line-clamp-2 py-1 pr-2">
              {toast.message}
            </span>
            {toast.actionLabel && (
              <button
                onClick={handleAction}
                className="shrink-0 min-h-[36px] px-3.5 rounded-full bg-[var(--tint-accent)] text-[15px] font-semibold text-[var(--brand)]"
              >
                {toast.actionLabel}
              </button>
            )}
          </div>
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx.showToast;
}
