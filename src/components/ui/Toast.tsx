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
 * Minimal single-slot toast. Auto-dismisses after `duration` (default 4s).
 * Supports one optional action (e.g. "Undo"); tapping it runs `onAction` and
 * dismisses. Rendered above the tab bar so it never covers navigation.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  const showToast = useCallback((o: ToastOptions) => {
    clearTimer();
    setToast({ id: Date.now(), ...o });
    timerRef.current = setTimeout(() => setToast(null), o.duration ?? 4000);
  }, []);

  useEffect(() => () => clearTimer(), []);

  function handleAction() {
    toast?.onAction?.();
    clearTimer();
    setToast(null);
  }

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toast && (
        <div
          className="fixed inset-x-0 z-50 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] px-4 pointer-events-none"
          role="status"
          aria-live="polite"
        >
          <div className="max-w-md mx-auto flex justify-center">
            <div className="pointer-events-auto glass glass-strong rounded-full pl-4 pr-2 py-2 flex items-center gap-3 shadow-[0_8px_30px_-8px_rgba(0,0,0,0.3)] animate-modal-in">
              <span className="text-[14px] font-medium text-[var(--text-primary)]">
                {toast.message}
              </span>
              {toast.actionLabel && (
                <button
                  onClick={handleAction}
                  className="rounded-full bg-[var(--brand-solid)] text-[var(--brand-fg)] px-3.5 py-1.5 text-[13px] font-semibold tap-shrink"
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
