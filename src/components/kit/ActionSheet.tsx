"use client";

import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useSheetLayer } from "@/lib/sheet-layer";
import { useOverlayBehavior } from "@/lib/overlay-stack";
import { hapticTap } from "@/lib/haptics";
import { Spinner } from "./Controls";

const subscribeNoop = () => () => {};
const EXIT_MS = 280;

export interface ActionSheetAction {
  label: string;
  destructive?: boolean;
  onSelect: () => void | Promise<void>;
}

/**
 * iOS action sheet: a glass group of actions with a title and message, then
 * a separate bold Cancel. Used for every irreversible or consequential choice.
 *
 * An action may be async: while it runs the sheet shows progress and can't be
 * dismissed, and if it throws, the error appears in the sheet instead of the
 * sheet closing on a write that didn't happen.
 */
export function ActionSheet({
  title,
  message,
  actions,
  cancelLabel = "Cancel",
  onClose,
}: {
  title?: ReactNode;
  message?: ReactNode;
  actions: ActionSheetAction[];
  cancelLabel?: string;
  onClose: () => void;
}) {
  useSheetLayer();
  const isClient = useSyncExternalStore(subscribeNoop, () => true, () => false);
  const ref = useRef<HTMLDivElement | null>(null);
  const [closing, setClosing] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState("");
  const closingRef = useRef(false);
  const busyRef = useRef(false);
  const onCloseRef = useRef(onClose);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  });

  const close = useCallback(() => {
    if (closingRef.current || busyRef.current) return;
    closingRef.current = true;
    setClosing(true);
    window.setTimeout(() => onCloseRef.current(), EXIT_MS);
  }, []);

  useOverlayBehavior(ref, close);

  async function select(i: number, action: ActionSheetAction) {
    if (busyRef.current) return;
    if (action.destructive) hapticTap();
    busyRef.current = true;
    setBusy(i);
    setError("");
    try {
      await action.onSelect();
      busyRef.current = false;
      close();
    } catch (err) {
      busyRef.current = false;
      setBusy(null);
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    }
  }

  if (!isClient) return null;

  return createPortal(
    <div className="sheet-root" style={{ zIndex: 75 }} data-state={closing ? "closing" : "open"}>
      <div className="sheet-backdrop" onClick={close} aria-hidden />
      <div
        ref={ref}
        role="alertdialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : "Confirm"}
        className="action-sheet"
      >
        <div className="action-group glass-thick">
          {(title || message || error) && (
            <div className="action-head">
              {title && <p className="t-footnote font-semibold text-label-2">{title}</p>}
              {message && (
                <p className="t-footnote mt-1 whitespace-pre-line text-label-2">{message}</p>
              )}
              {error && <p className="t-footnote mt-2 font-medium text-neg">{error}</p>}
            </div>
          )}
          {actions.map((a, i) => (
            <button
              key={a.label}
              type="button"
              disabled={busy !== null}
              onClick={() => void select(i, a)}
              className={`action-btn ${a.destructive ? "is-destructive" : ""}`}
            >
              {busy === i ? <Spinner size={20} /> : a.label}
            </button>
          ))}
        </div>
        <div className="action-group glass-thick">
          <button
            type="button"
            onClick={close}
            disabled={busy !== null}
            className="action-btn is-cancel"
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

/**
 * The common single-action case. Same contract the old ConfirmDialog had:
 * `onConfirm` may be async; it closes on success and stays open with the
 * error on failure.
 */
export function ConfirmSheet({
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
  return (
    <ActionSheet
      title={title}
      message={message}
      cancelLabel={cancelLabel}
      actions={[{ label: confirmLabel, destructive, onSelect: onConfirm }]}
      onClose={onClose}
    />
  );
}
