"use client";

import { useState } from "react";
import GlassModal from "./GlassModal";

/**
 * Styled replacement for native confirm()/alert(). The confirm action may be
 * async: while it runs the dialog shows a busy state and locks dismissal, and
 * if it throws, the error is shown inline instead of closing (so failed
 * mutations no longer need a separate alert()).
 */
export default function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
  onClose,
}: {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleConfirm() {
    setBusy(true);
    setError("");
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
      setBusy(false);
    }
  }

  return (
    <GlassModal title={title} onClose={busy ? () => {} : onClose}>
      <div className="space-y-4">
        {message && (
          <p className="text-[14px] leading-relaxed text-[var(--label-secondary)] whitespace-pre-line">
            {message}
          </p>
        )}
        {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
        <div className="flex gap-2.5">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="flex-1 rounded-full bg-[var(--label-tertiary)]/15 px-4 py-2.5 text-[15px] font-medium text-[var(--label-primary)] tap-shrink disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={busy}
            className={`flex-1 rounded-full px-4 py-2.5 text-[15px] font-semibold text-white tap-shrink disabled:opacity-50 ${
              destructive ? "bg-[var(--danger)]" : "bg-[var(--accent)]"
            }`}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </GlassModal>
  );
}
