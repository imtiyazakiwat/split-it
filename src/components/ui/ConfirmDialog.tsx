"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSheetLayer } from "@/lib/sheet-layer";
import { useOverlayBehavior } from "@/lib/overlay-stack";
import { ActionSheetInline } from "./GlassModal";

/**
 * Confirmation as an iOS action sheet: title + message, the action (red when
 * destructive), and a separate Cancel. The confirm action may be async: while
 * it runs the sheet locks, and if it throws the error shows inline instead of
 * closing.
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
  useSheetLayer();
  const ref = useRef<HTMLDivElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useOverlayBehavior(ref, () => {
    if (!busy) onClose();
  });

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

  if (typeof document === "undefined") return null;
  return createPortal(
    <div ref={ref}>
      <ActionSheetInline
        title={title}
        message={message}
        error={error}
        busy={busy}
        cancelLabel={cancelLabel}
        onCancel={onClose}
        actions={[{ label: confirmLabel, destructive, onClick: handleConfirm }]}
      />
    </div>,
    document.body
  );
}
