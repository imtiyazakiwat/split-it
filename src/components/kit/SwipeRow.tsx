"use client";

import { useEffect, useId, useRef, type CSSProperties, type ReactNode } from "react";
import { Icon } from "./Icon";
import { hapticTap } from "@/lib/haptics";

export interface SwipeAction {
  label: string;
  icon: string;
  color: string;
  onAction: () => void;
  /**
   * The row leaves this list when the action runs (delete, archive): it slides
   * out and collapses first, the way a deleted Mail row does. Leave off for
   * actions that only ask (a confirmation sheet), which spring the row closed.
   */
  removesRow?: boolean;
}

const ACTION_W = 84;
/** Past this share of the row's width, releasing runs the first action. */
const ARM_AT = 0.55;
/** Opening one row closes any other: rows announce themselves on this event. */
const OPEN_EVENT = "splitit:swipe-row-open";

/**
 * Trailing swipe actions on a list row (iOS Mail/Messages).
 *
 * Drag left and the content follows the finger 1:1 while the actions fill the
 * space it reveals. Release past a third (or flick) to keep them open; keep
 * going past ~55% and the first action stretches across the row with a tick —
 * release there and it runs (full swipe). The row's own tap still works, and a
 * click that ends a drag is swallowed so a swipe never also opens the row.
 * There is always a non-gesture path to the same action elsewhere.
 */
export function SwipeRow({
  actions,
  disabled = false,
  inset = 16,
  children,
}: {
  actions: SwipeAction[];
  disabled?: boolean;
  /** Separator inset for the list this row sits in. */
  inset?: number;
  children: ReactNode;
}) {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const actionsRef = useRef<HTMLDivElement | null>(null);
  const id = useId();
  const state = useRef({
    startX: 0,
    startY: 0,
    base: 0,
    offset: 0,
    lastX: 0,
    lastT: 0,
    v: 0,
    tracking: false,
    dragging: false,
    armed: false,
    committing: false,
    swallowClick: false,
    pointerId: -1,
  });
  const openW = ACTION_W * actions.length;

  function setOffset(x: number, animate: boolean) {
    const el = contentRef.current;
    const acts = actionsRef.current;
    if (!el) return;
    state.current.offset = x;
    if (rowRef.current) {
      if (x === 0) delete rowRef.current.dataset.open;
      else rowRef.current.dataset.open = "";
    }
    el.classList.toggle("is-animating", animate);
    acts?.classList.toggle("is-animating", animate);
    el.style.transform = x === 0 ? "" : `translate3d(${x}px, 0, 0)`;
    if (acts) acts.style.width = `${Math.max(0, -x)}px`;
  }

  function setArmed(armed: boolean) {
    const s = state.current;
    if (s.armed === armed) return;
    s.armed = armed;
    actionsRef.current?.classList.toggle("is-armed", armed);
    if (armed) hapticTap();
  }

  function close() {
    setArmed(false);
    setOffset(0, true);
  }

  /** Slide the content off, collapse the row if it's leaving, then act. */
  function commit(action: SwipeAction) {
    const s = state.current;
    if (s.committing) return;
    s.committing = true;
    const width = contentRef.current?.offsetWidth ?? 320;
    setArmed(true);
    setOffset(-width, true);
    const row = rowRef.current;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!action.removesRow || !row) {
      window.setTimeout(() => {
        action.onAction();
        s.committing = false;
        close();
      }, reduce ? 0 : 200);
      return;
    }
    window.setTimeout(
      () => {
        row.style.height = `${row.offsetHeight}px`;
        void row.offsetHeight;
        row.classList.add("is-collapsing");
        row.style.height = "0px";
        window.setTimeout(
          () => {
            action.onAction();
            // If the row is still here (the action failed, or the list kept
            // it), put it back rather than leave a zero-height gap.
            window.setTimeout(() => {
              if (!row.isConnected) return;
              row.classList.remove("is-collapsing");
              row.style.height = "";
              s.committing = false;
              setArmed(false);
              setOffset(0, false);
            }, 400);
          },
          reduce ? 0 : 240
        );
      },
      reduce ? 0 : 180
    );
  }

  useEffect(() => {
    const onOtherOpen = (e: Event) => {
      const s = state.current;
      if ((e as CustomEvent<string>).detail !== id && s.offset !== 0 && !s.committing) {
        const el = contentRef.current;
        const acts = actionsRef.current;
        if (!el) return;
        s.offset = 0;
        if (rowRef.current) delete rowRef.current.dataset.open;
        el.classList.add("is-animating");
        el.style.transform = "";
        if (acts) {
          acts.classList.add("is-animating");
          acts.style.width = "0px";
        }
      }
    };
    window.addEventListener(OPEN_EVENT, onOtherOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOtherOpen);
  }, [id]);

  function onPointerDown(e: React.PointerEvent) {
    const s = state.current;
    if (disabled || e.button !== 0 || s.committing) return;
    s.tracking = true;
    s.dragging = false;
    s.startX = e.clientX;
    s.startY = e.clientY;
    s.base = s.offset;
    s.lastX = e.clientX;
    s.lastT = e.timeStamp;
    s.v = 0;
    s.pointerId = e.pointerId;
  }

  function onPointerMove(e: React.PointerEvent) {
    const s = state.current;
    if (!s.tracking || e.pointerId !== s.pointerId) return;
    const dx = e.clientX - s.startX;
    const dy = e.clientY - s.startY;
    if (!s.dragging) {
      if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy) * 1.2) {
        if (Math.abs(dy) > 10) s.tracking = false;
        return;
      }
      // A closed row only opens leftward; a rightward drag is the edge-swipe
      // back gesture (or nothing) and must not be captured here.
      if (s.base === 0 && dx > 0) {
        s.tracking = false;
        return;
      }
      s.dragging = true;
      s.swallowClick = true;
      window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: id }));
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
    const width = contentRef.current?.offsetWidth ?? 320;
    let x = s.base + dx;
    if (x > 0) x = x / 4; // resist the wrong way
    if (x < -width) x = -width;
    const dt = Math.max(1, e.timeStamp - s.lastT);
    s.v = (e.clientX - s.lastX) / dt;
    s.lastX = e.clientX;
    s.lastT = e.timeStamp;
    setOffset(x, false);
    setArmed(!!actions[0] && x < -Math.max(openW + 24, width * ARM_AT));
  }

  function onPointerUp(e: React.PointerEvent) {
    const s = state.current;
    if (!s.tracking || e.pointerId !== s.pointerId) return;
    s.tracking = false;
    if (!s.dragging) return;
    s.dragging = false;
    window.setTimeout(() => {
      s.swallowClick = false;
    }, 120);
    if (s.armed && actions[0] && e.type !== "pointercancel") {
      commit(actions[0]);
      return;
    }
    setArmed(false);
    if (s.offset < -openW / 3 || s.v < -0.45) {
      setOffset(-openW, true);
    } else {
      close();
    }
  }

  return (
    <div ref={rowRef} className="swipe-row" style={{ "--sep-inset": `${inset}px` } as CSSProperties}>
      {/* Hidden from assistive tech: the same actions live in the row's
          detail sheet, which is the accessible path. */}
      <div ref={actionsRef} className="swipe-actions" aria-hidden style={{ width: 0 }}>
        {actions.map((a) => (
          <button
            key={a.label}
            type="button"
            tabIndex={-1}
            onClick={() => {
              if (a.removesRow) {
                commit(a);
                return;
              }
              close();
              a.onAction();
            }}
            className="swipe-action"
            style={{ background: a.color }}
          >
            <span className="swipe-action-inner">
              <Icon name={a.icon} size={20} strokeWidth={2} />
              {a.label}
            </span>
          </button>
        ))}
      </div>
      <div
        ref={contentRef}
        className="swipe-content"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClickCapture={(e) => {
          const s = state.current;
          if (s.swallowClick) {
            e.preventDefault();
            e.stopPropagation();
            return;
          }
          if (s.offset !== 0) {
            e.preventDefault();
            e.stopPropagation();
            close();
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}
