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
import { Icon } from "@/components/kit/Icon";

type Tone = "success" | "error" | "info";

interface ToastOptions {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  /** ms. Defaults to 2.4 s, or 5 s when there is an action to take. */
  duration?: number;
  /** Inferred from the wording when omitted ("Couldn't…" reads as an error). */
  tone?: Tone;
}

interface ToastState extends ToastOptions {
  id: number;
  leaving: boolean;
}

const ToastContext = createContext<{ showToast: (o: ToastOptions) => void } | undefined>(
  undefined
);

const ERROR_WORDING = /^(couldn['’]?t|could not|can['’]?t|failed|unable|error|export failed)/i;

function toneOf(t: ToastOptions): Tone {
  if (t.tone) return t.tone;
  return ERROR_WORDING.test(t.message.trim()) ? "error" : "success";
}

/**
 * iOS HUD: a glass capsule that drops in under the status bar, with a glyph
 * that says what kind of news it is. Auto-dismisses (2.4 s; 5 s with Undo),
 * pauses while touched, and flicks away upward.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remainingRef = useRef(0);
  const startedAtRef = useRef(0);
  const touchYRef = useRef<number | null>(null);

  const clearTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  const leave = useCallback(() => {
    clearTimer();
    setToast((t) => (t ? { ...t, leaving: true } : t));
    timerRef.current = setTimeout(() => setToast(null), 240);
  }, []);

  const arm = useCallback(
    (ms: number) => {
      clearTimer();
      remainingRef.current = ms;
      startedAtRef.current = Date.now();
      timerRef.current = setTimeout(leave, ms);
    },
    [leave]
  );

  const showToast = useCallback(
    (o: ToastOptions) => {
      clearTimer();
      setToast({ id: Date.now(), leaving: false, ...o });
      arm(o.duration ?? (o.actionLabel ? 5000 : 2400));
    },
    [arm]
  );

  useEffect(() => () => clearTimer(), []);

  function handleAction() {
    toast?.onAction?.();
    leave();
  }

  function onTouchStart(e: React.TouchEvent) {
    touchYRef.current = e.touches[0]?.clientY ?? null;
    if (timerRef.current && !toast?.leaving) {
      clearTimer();
      remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - startedAtRef.current));
    }
  }

  function onTouchEnd(e: React.TouchEvent) {
    const startY = touchYRef.current;
    touchYRef.current = null;
    const endY = e.changedTouches[0]?.clientY;
    if (startY !== null && endY !== undefined && startY - endY > 18) {
      leave();
      return;
    }
    if (toast && !toast.leaving) arm(Math.max(1200, remainingRef.current));
  }

  const tone = toast ? toneOf(toast) : "success";

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="hud-layer" role="status" aria-live="polite">
        {toast && (
          <div
            key={toast.id}
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
            className={`hud glass-thick ${toast.leaving ? "is-leaving" : ""}`}
          >
            <span
              className="shrink-0"
              style={{
                color: tone === "error" ? "var(--orange)" : tone === "info" ? "var(--tint)" : "var(--green)",
              }}
              aria-hidden
            >
              <Icon
                name={
                  tone === "error"
                    ? "exclamationmark.triangle"
                    : tone === "info"
                    ? "info.circle"
                    : "checkmark.circle"
                }
                size={22}
                strokeWidth={2.1}
              />
            </span>
            <span className="hud-text">{toast.message}</span>
            {toast.actionLabel && (
              <button
                type="button"
                onClick={handleAction}
                className="btn btn-tinted is-sm shrink-0"
                style={{ height: 36 }}
              >
                {toast.actionLabel}
              </button>
            )}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx.showToast;
}
