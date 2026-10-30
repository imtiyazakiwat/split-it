"use client";

import { ReactNode, useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSheetLayer } from "@/lib/sheet-layer";
import { useOverlayBehavior } from "@/lib/overlay-stack";
import { BarButton } from "@/components/ui/Screen";
import { Checkmark, Xmark } from "@/components/ui/Icons";

/**
 * iOS sheet. Bottom sheet on phones (rises with a spring, drags down to
 * dismiss), centred card on wider screens.
 *
 * Header: glass ✕ on the left, centred title, and — when the sheet commits
 * something — a prominent ✓ on the right that stays disabled until valid.
 * `dirty` guards against losing input: ✕, backdrop tap, Escape and the drag
 * all ask "Discard Changes?" first.
 *
 * Stacking order across the app, highest last:
 *   z-10  navigation bar     z-20  tab bar     z-30  install prompt
 *   z-50  sheets and dialogs z-[60] HUD        z-[100] splash
 */
export default function GlassModal({
  title,
  onClose,
  children,
  confirm,
  dirty = false,
  large = false,
  hideHeader = false,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** The sheet's commit action, rendered as the ✓ bar button. */
  confirm?: { label: string; onConfirm: () => void; disabled?: boolean; busy?: boolean; formId?: string };
  /** Unsaved input: closing asks first. */
  dirty?: boolean;
  /** Near-full-height (forms) instead of content-height. */
  large?: boolean;
  hideHeader?: boolean;
  /** Pinned below the scroll area (e.g. a primary button). */
  footer?: ReactNode;
}) {
  useSheetLayer();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [closing, setClosing] = useState(false);
  const [askDiscard, setAskDiscard] = useState(false);
  const [drag, setDrag] = useState(0);
  const dragRef = useRef({ y: 0, lastY: 0, lastT: 0, v: 0, active: false });
  const [dragging, setDragging] = useState(false);

  const finish = useCallback(() => {
    if (closing) return;
    setClosing(true);
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    setTimeout(onClose, reduce ? 160 : 300);
  }, [closing, onClose]);

  const requestClose = useCallback(() => {
    if (dirty) {
      setDrag(0);
      setAskDiscard(true);
      return;
    }
    finish();
  }, [dirty, finish]);

  useOverlayBehavior(dialogRef, requestClose);

  function onDragStart(e: React.TouchEvent) {
    const t = e.touches[0];
    dragRef.current = { y: t.clientY, lastY: t.clientY, lastT: e.timeStamp, v: 0, active: true };
    setDragging(true);
  }
  function onDragMove(e: React.TouchEvent) {
    const d = dragRef.current;
    if (!d.active) return;
    const t = e.touches[0];
    const dt = Math.max(1, e.timeStamp - d.lastT);
    d.v = ((t.clientY - d.lastY) / dt) * 1000;
    d.lastY = t.clientY;
    d.lastT = e.timeStamp;
    const dy = t.clientY - d.y;
    setDrag(dy > 0 ? dy : dy * 0.15);
  }
  function onDragEnd() {
    const d = dragRef.current;
    if (!d.active) return;
    d.active = false;
    setDragging(false);
    if (drag > 130 || d.v > 700) {
      if (dirty) {
        setDrag(0);
        setAskDiscard(true);
      } else {
        finish();
      }
    } else {
      setDrag(0);
    }
  }

  const sheet = (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div
        className={`absolute inset-0 bg-[var(--scrim)] ${closing ? "animate-fade-out" : "animate-fade-in"}`}
        onClick={requestClose}
        aria-hidden
      />
      {/* The entrance/exit animation lives on this wrapper: an animation's
          fill would otherwise override the inline drag transform below. */}
      <div className={`relative w-full sm:max-w-[440px] ${closing ? "animate-sheet-down" : "animate-sheet-up"}`}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`sheet relative w-full flex flex-col rounded-t-[var(--radius-sheet)] sm:rounded-[var(--radius-sheet)] ${
          large ? "h-[calc(var(--app-height,100dvh)-max(env(safe-area-inset-top),12px)-10px)] sm:h-auto sm:max-h-[86vh]" : "sheet-viewport"
        }`}
        style={{
          transform: drag ? `translateY(${drag}px)` : undefined,
          transition: dragging ? "none" : "transform 0.38s cubic-bezier(0.32,0.72,0,1)",
        }}
      >
        {/* Drag handle area: grabber + header. Dragging here never scrolls content. */}
        <div
          className="shrink-0 touch-none"
          onTouchStart={onDragStart}
          onTouchMove={onDragMove}
          onTouchEnd={onDragEnd}
          onTouchCancel={onDragEnd}
        >
          <div className="pt-[6px] pb-[2px] flex justify-center sm:hidden">
            <span className="grabber" />
          </div>
          {!hideHeader && (
            <div className="grid grid-cols-[44px_1fr_44px] items-center gap-2 px-4 pt-1.5 pb-2">
              <BarButton onClick={requestClose} aria-label="Close">
                <Xmark size={18} />
              </BarButton>
              <h2 className="t-headline text-center truncate text-[var(--text-primary)]">{title}</h2>
              {confirm ? (
                <BarButton
                  prominent
                  type={confirm.formId ? "submit" : "button"}
                  form={confirm.formId}
                  onClick={confirm.formId ? undefined : confirm.onConfirm}
                  disabled={confirm.disabled || confirm.busy}
                  aria-label={confirm.label}
                  aria-busy={confirm.busy}
                >
                  {confirm.busy ? (
                    <span className="w-[18px] h-[18px] rounded-full border-2 border-current border-t-transparent animate-spin" />
                  ) : (
                    <Checkmark size={20} />
                  )}
                </BarButton>
              ) : (
                <span />
              )}
            </div>
          )}
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain scroll-momentum px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          {children}
        </div>
        {footer && (
          <div className="shrink-0 px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))]">{footer}</div>
        )}
      </div>
      </div>

      {askDiscard && (
        <ActionSheetInline
          title="Are you sure you want to discard your changes?"
          onCancel={() => setAskDiscard(false)}
          actions={[
            {
              label: "Discard Changes",
              destructive: true,
              onClick: () => {
                setAskDiscard(false);
                finish();
              },
            },
          ]}
          cancelLabel="Keep Editing"
        />
      )}
    </div>
  );

  // Portal to <body> so a sheet opened from a transformed screen (push
  // animation) still covers the viewport. Sheets only mount after a user
  // action, never during SSR, so `document` is always available here.
  if (typeof document === "undefined") return null;
  return createPortal(sheet, document.body);
}

/**
 * Action sheet rendered inside an existing overlay (no extra sheet layer).
 * Two glass groups: actions, then a separate bold Cancel.
 */
export function ActionSheetInline({
  title,
  message,
  actions,
  onCancel,
  cancelLabel = "Cancel",
  busy,
  error,
}: {
  title?: string;
  message?: string;
  actions: { label: string; destructive?: boolean; onClick: () => void; disabled?: boolean }[];
  onCancel: () => void;
  cancelLabel?: string;
  busy?: boolean;
  error?: string;
}) {
  return (
    <div className="fixed inset-0 z-[55] flex items-end sm:items-center justify-center" role="alertdialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-[var(--scrim)] animate-fade-in" onClick={busy ? undefined : onCancel} aria-hidden />
      <div className="relative w-full sm:max-w-[400px] px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] space-y-2 animate-sheet-up">
        <div className="glass-strong glass rounded-[18px] overflow-hidden text-center">
          {(title || message) && (
            <div className="px-5 pt-4 pb-3.5">
              {title && <p className="text-[13px] font-semibold text-[var(--text-secondary)]">{title}</p>}
              {message && (
                <p className="text-[13px] text-[var(--text-secondary)] mt-1 whitespace-pre-line leading-[18px]">{message}</p>
              )}
              {error && <p className="text-[13px] text-[var(--neg)] mt-2">{error}</p>}
            </div>
          )}
          {actions.map((a) => (
            <button
              key={a.label}
              type="button"
              onClick={a.onClick}
              disabled={busy || a.disabled}
              className={`relative w-full min-h-[57px] text-[20px] tracking-[-0.02em] active:bg-[var(--pressed)] disabled:opacity-50 ${
                a.destructive ? "text-[var(--red)]" : "text-[var(--brand)]"
              } before:absolute before:inset-x-0 before:top-0 before:h-[0.5px] before:bg-[var(--separator)]`}
            >
              {busy ? "…" : a.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="glass-strong glass w-full min-h-[57px] rounded-[18px] text-[20px] font-semibold tracking-[-0.02em] text-[var(--brand)] active:bg-[var(--pressed)] disabled:opacity-50"
        >
          {cancelLabel}
        </button>
      </div>
    </div>
  );
}
