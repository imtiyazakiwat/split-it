"use client";

import { ReactNode, useEffect } from "react";
import { useSheetLayer } from "@/lib/sheet-layer";

/**
 * Bottom sheet on phones, centred dialog on wider screens.
 *
 * Stacking order across the app, highest last:
 *   z-10  sticky top bar
 *   z-20  bottom tab bar
 *   z-30  install prompt
 *   z-40  floating action buttons
 *   z-50  sheets and modals (this component, AddExpenseModal)
 *   z-60  toasts
 *   z-100 splash
 *
 * This used to render at z-20, i.e. underneath the floating "+" button, so the
 * FAB sat on top of whatever sheet you opened.
 */
export default function GlassModal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useSheetLayer();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px] [-webkit-backdrop-filter:blur(2px)] animate-fade-in"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="sheet sheet-viewport relative w-full sm:max-w-md rounded-t-[var(--radius-xl)] sm:rounded-[var(--radius-xl)] p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] overflow-y-auto scroll-momentum animate-modal-in"
      >
        <div className="mx-auto mb-3 h-[5px] w-9 rounded-full bg-[var(--border-subtle)] sm:hidden" />
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid place-items-center w-11 h-11 -m-2 rounded-full tap-shrink"
          >
            <span className="grid place-items-center w-8 h-8 rounded-full bg-[var(--text-tertiary)]/20 text-[var(--text-secondary)] text-lg">
              ×
            </span>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
