"use client";

import {
  createContext,
  useCallback,
  useContext,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type Ref,
} from "react";
import { createPortal } from "react-dom";
import { useSheetLayer } from "@/lib/sheet-layer";
import { useOverlayBehavior } from "@/lib/overlay-stack";
import { Icon } from "./Icon";
import { ConfirmSheet } from "./ActionSheet";

export interface SheetHandle {
  /** Animate out and then call onClose — skips the discard guard. */
  dismiss: () => void;
}

const SheetContext = createContext<{ requestClose: () => void; dismiss: () => void } | null>(null);

/** For content inside a sheet that needs to close it (with the exit animation). */
export function useSheet() {
  const ctx = useContext(SheetContext);
  if (!ctx) throw new Error("useSheet must be used inside <Sheet>");
  return ctx;
}

const subscribeNoop = () => () => {};
/** True once on the client; false during SSR and hydration. */
export function useIsClient(): boolean {
  return useSyncExternalStore(subscribeNoop, () => true, () => false);
}

const EXIT_MS = 300;
const DISMISS_DISTANCE = 130;
const DISMISS_VELOCITY = 0.7; // px/ms

/**
 * iOS 26/27 sheet.
 *
 * Default: a floating card inset from the screen edges that sizes to its
 * content (medium detent). `large`: near full height for forms, anchored to the
 * top so the keyboard shortens it instead of covering its fields.
 *
 * Header: glass ✕ leading, centred title, the commit action trailing. Drag the
 * header down to dismiss (1:1, rubber-banded upward); release past 130 pt or
 * fast enough and it leaves, otherwise it springs back. With `dirty` set, any
 * dismissal (✕, backdrop, drag, Escape, Android back) asks before throwing
 * changes away.
 *
 * Rendered into a portal at <body> so it never moves with a screen transition.
 */
export function Sheet({
  ref,
  title,
  subtitle,
  label,
  onClose,
  large = false,
  dirty = false,
  leading,
  trailing,
  footer,
  bodyClassName = "",
  children,
}: {
  ref?: Ref<SheetHandle>;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Accessible name when the title isn't plain text. */
  label?: string;
  /** Called after the exit animation. Unmount the sheet here. */
  onClose: () => void;
  large?: boolean;
  dirty?: boolean;
  /** Replaces the ✕ button. Pass `null` for none. */
  leading?: ReactNode | null;
  trailing?: ReactNode;
  /** Pinned under the scrolling body (a primary CTA). */
  footer?: ReactNode;
  bodyClassName?: string;
  children: ReactNode;
}) {
  useSheetLayer();
  const isClient = useIsClient();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [closing, setClosing] = useState(false);
  const [askDiscard, setAskDiscard] = useState(false);
  const closingRef = useRef(false);
  // Latest props for callbacks that outlive a render (timers, the overlay
  // stack's Escape handler). Synced in a layout effect, never during render.
  const onCloseRef = useRef(onClose);
  const dirtyRef = useRef(dirty);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
    dirtyRef.current = dirty;
  });

  const dismiss = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    window.setTimeout(() => onCloseRef.current(), EXIT_MS);
  }, []);

  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    if (dirtyRef.current) {
      setAskDiscard(true);
      return;
    }
    dismiss();
  }, [dismiss]);

  useImperativeHandle(ref, () => ({ dismiss }), [dismiss]);
  useOverlayBehavior(panelRef, requestClose);

  // ── Drag to dismiss (header only, so content scrolls normally) ──────────
  const drag = useRef<{ y: number; t: number; lastY: number; lastT: number; id: number } | null>(null);
  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0 || closingRef.current) return;
    if ((e.target as HTMLElement).closest("button, a, input, select, textarea")) return;
    drag.current = { y: e.clientY, t: e.timeStamp, lastY: e.clientY, lastT: e.timeStamp, id: e.pointerId };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    const panel = panelRef.current;
    if (!d || !panel || d.id !== e.pointerId) return;
    const dy = e.clientY - d.y;
    // Rubber band upward: the sheet resists rather than detaching.
    const offset = dy >= 0 ? dy : -Math.sqrt(-dy) * 2;
    panel.classList.add("is-dragging");
    panel.style.transform = `translate3d(0, ${offset}px, 0)`;
    d.lastY = e.clientY;
    d.lastT = e.timeStamp;
  }
  function onPointerUp(e: React.PointerEvent) {
    const d = drag.current;
    const panel = panelRef.current;
    drag.current = null;
    if (!d || !panel) return;
    const dy = e.clientY - d.y;
    const dt = Math.max(1, e.timeStamp - d.t);
    const v = dy / dt;
    panel.classList.remove("is-dragging");
    if (dy > DISMISS_DISTANCE || (v > DISMISS_VELOCITY && dy > 24)) {
      if (dirtyRef.current) {
        settle(panel);
        setAskDiscard(true);
      } else {
        dismiss();
      }
      return;
    }
    settle(panel);
  }
  function settle(panel: HTMLDivElement) {
    panel.classList.add("is-settling");
    panel.style.transform = "translate3d(0, 0, 0)";
    window.setTimeout(() => {
      panel.classList.remove("is-settling");
      panel.style.transform = "";
    }, 440);
  }

  if (!isClient) return null;

  const accessibleName = label ?? (typeof title === "string" ? title : undefined);

  return createPortal(
    <SheetContext.Provider value={{ requestClose, dismiss }}>
      <div className={`sheet-root ${large ? "is-large" : ""}`} data-state={closing ? "closing" : "open"}>
        <div className="sheet-backdrop" onClick={requestClose} aria-hidden />
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label={accessibleName}
          className={`sheet-panel ${large ? "is-large" : ""}`}
        >
          <div
            className="sheet-header"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <span className="sheet-grabber" aria-hidden />
            <div className="flex justify-start">
              {leading === undefined ? <SheetIconButton icon="xmark" label="Close" onClick={requestClose} /> : leading}
            </div>
            <div className="sheet-title">
              <span>{title}</span>
              {subtitle && <span>{subtitle}</span>}
            </div>
            <div className="flex justify-end">{trailing}</div>
          </div>
          <div className={`sheet-body ${footer ? "has-footer" : ""} ${bodyClassName}`}>{children}</div>
          {footer && <div className="sheet-footer">{footer}</div>}
        </div>
      </div>
      {askDiscard && (
        <ConfirmSheet
          title="Discard changes?"
          message="What you've entered here hasn't been saved."
          confirmLabel="Discard Changes"
          cancelLabel="Keep Editing"
          destructive
          onConfirm={dismiss}
          onClose={() => setAskDiscard(false)}
        />
      )}
    </SheetContext.Provider>,
    document.body
  );
}

/** 44-pt glass circle used in sheet headers (✕, ✓). */
export function SheetIconButton({
  icon,
  label,
  onClick,
  prominent = false,
  disabled = false,
  type = "button",
  form,
}: {
  icon: string;
  label: string;
  onClick?: () => void;
  prominent?: boolean;
  disabled?: boolean;
  type?: "button" | "submit";
  form?: string;
}) {
  return (
    <button
      type={type}
      form={form}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`bar-btn ${prominent ? "is-prominent" : "glass"}`}
    >
      <Icon name={icon} size={prominent ? 20 : 19} strokeWidth={prominent ? 2.6 : 2.2} />
    </button>
  );
}

/** Text capsule for a sheet header ("Edit", "Done"). */
export function SheetTextButton({
  children,
  onClick,
  prominent = false,
  disabled = false,
  type = "button",
  form,
}: {
  children: ReactNode;
  onClick?: () => void;
  prominent?: boolean;
  disabled?: boolean;
  type?: "button" | "submit";
  form?: string;
}) {
  return (
    <button
      type={type}
      form={form}
      onClick={onClick}
      disabled={disabled}
      className={`bar-btn is-text ${prominent ? "is-prominent" : "glass"}`}
      style={{ height: 40, fontSize: 16, fontWeight: 600 }}
    >
      {children}
    </button>
  );
}
