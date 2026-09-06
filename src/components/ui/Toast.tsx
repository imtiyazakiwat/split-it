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
 * Sits above the tab bar so it never covers navigation. Timer pauses while
 * touched, and an upward swipe dismisses — same contract as before.
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
          className="fixed inset-x-0 z-[60] bottom-[calc(4.5rem+env(safe-area-inset-bottom))] px-4 pointer-events-none"
          role="status"
          aria-live="polite"
        >
          <div className="max-w-md mx-auto">
            <div
              onTouchStart={onTouchStart}
              onTouchEnd={onTouchEnd}
              className="pointer-events-auto rounded-2xl bg-[var(--surface-elevated)] border border-[var(--border-subtle)] shadow-[var(--shadow-float)] px-4 py-3 flex items-center gap-3 animate-toast-in"
            >
              <span className="flex-1 min-w-0 text-[15px] text-[var(--text-primary)]">
                {toast.message}
              </span>
              {toast.actionLabel && (
                <button
                  onClick={handleAction}
                  className="shrink-0 min-h-[44px] px-2 text-[15px] font-semibold text-[var(--brand)] tap-shrink"
                >
                  {toast.actionLabel}
                </button>
              )}
            </div>
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
