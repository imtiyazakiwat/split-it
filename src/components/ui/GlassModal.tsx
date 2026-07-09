"use client";

import { ReactNode, useEffect } from "react";

export default function GlassModal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-20 flex items-end sm:items-center justify-center">
      <div
        className="absolute inset-0 bg-black/30 animate-fade-in"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="glass-strong glass relative w-full sm:max-w-md rounded-t-[var(--radius-xl)] sm:rounded-[var(--radius-xl)] p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] max-h-[88vh] overflow-y-auto scroll-momentum animate-modal-in"
      >
        <div className="mx-auto mb-3 h-1.5 w-9 rounded-full bg-[var(--label-tertiary)] sm:hidden" />
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-[var(--label-primary)]">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid place-items-center w-8 h-8 rounded-full bg-[var(--label-tertiary)]/20 text-[var(--label-secondary)] text-lg tap-shrink"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
