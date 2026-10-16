"use client";

import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";
import { useOverlayBehavior } from "@/lib/overlay-stack";
import { hapticTap } from "@/lib/haptics";

export type MenuItem =
  | {
      label: string;
      subtitle?: string;
      icon?: string;
      destructive?: boolean;
      disabled?: boolean;
      /** Selection menus: leading checkmark on the current choice. */
      checked?: boolean;
      onSelect: () => void;
    }
  | "separator";

const subscribeNoop = () => () => {};
const PANEL_W = 254;

interface Anchor {
  top: number;
  left: number;
  originX: "left" | "right";
  originY: "top" | "bottom";
}

function place(trigger: HTMLElement, align: "start" | "end", estHeight: number): Anchor {
  const r = trigger.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.visualViewport?.height ?? window.innerHeight;
  const margin = 8;
  let left = align === "end" ? r.right - PANEL_W : r.left;
  left = Math.max(margin, Math.min(left, vw - PANEL_W - margin));
  const below = r.bottom + 8;
  const fitsBelow = below + estHeight <= vh - margin;
  const top = fitsBelow ? below : Math.max(margin, r.top - 8 - estHeight);
  return {
    top,
    left,
    originX: align === "end" ? "right" : "left",
    originY: fitsBelow ? "top" : "bottom",
  };
}

/**
 * Pull-down / pop-up menu: a glass panel that springs out of its trigger's
 * corner. Outside tap, Escape or a choice closes it; focus returns to the
 * trigger.
 */
export function Menu({
  items,
  title,
  align = "end",
  children,
}: {
  items: MenuItem[];
  title?: string;
  align?: "start" | "end";
  /** Render prop: spread `props` onto the trigger button. */
  children: (props: {
    ref: React.RefObject<HTMLButtonElement | null>;
    onClick: () => void;
    "aria-haspopup": "menu";
    "aria-expanded": boolean;
  }) => ReactNode;
}) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [closing, setClosing] = useState(false);

  const open = useCallback(() => {
    const t = triggerRef.current;
    if (!t) return;
    hapticTap();
    const rows = items.filter((i) => i !== "separator").length;
    const seps = items.length - rows;
    setClosing(false);
    setAnchor(place(t, align, rows * 46 + seps * 12 + (title ? 30 : 0) + 12));
  }, [items, align, title]);

  const close = useCallback(() => {
    setClosing(true);
    window.setTimeout(() => {
      setAnchor(null);
      setClosing(false);
    }, 140);
  }, []);

  return (
    <>
      {children({
        ref: triggerRef,
        onClick: () => (anchor ? close() : open()),
        "aria-haspopup": "menu",
        "aria-expanded": !!anchor,
      })}
      {anchor && (
        <MenuLayer anchor={anchor} items={items} title={title} closing={closing} onClose={close} />
      )}
    </>
  );
}

function MenuLayer({
  anchor,
  items,
  title,
  closing,
  onClose,
}: {
  anchor: Anchor;
  items: MenuItem[];
  title?: string;
  closing: boolean;
  onClose: () => void;
}) {
  const isClient = useSyncExternalStore(subscribeNoop, () => true, () => false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  useOverlayBehavior(panelRef, onClose);

  useLayoutEffect(() => {
    panelRef.current?.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus({ preventScroll: true });
  }, []);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const buttons = Array.from(
      panelRef.current?.querySelectorAll<HTMLButtonElement>("button:not([disabled])") ?? []
    );
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === "ArrowDown" ? (i + 1) % buttons.length : (i - 1 + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }

  if (!isClient) return null;
  return createPortal(
    <div className="menu-layer" data-state={closing ? "closing" : "open"} onClick={onClose}>
      <div
        ref={panelRef}
        role="menu"
        aria-label={title}
        className="menu-panel glass-thick"
        onKeyDown={onKeyDown}
        onClick={(e) => e.stopPropagation()}
        style={{
          top: anchor.top,
          left: anchor.left,
          transformOrigin: `${anchor.originY} ${anchor.originX}`,
        }}
      >
        {title && <p className="menu-title">{title}</p>}
        {items.map((item, i) =>
          item === "separator" ? (
            <div key={`sep-${i}`} className="menu-sep" role="separator" />
          ) : (
            <button
              key={item.label}
              type="button"
              role={item.checked !== undefined ? "menuitemradio" : "menuitem"}
              aria-checked={item.checked}
              disabled={item.disabled}
              onClick={() => {
                onClose();
                item.onSelect();
              }}
              className={`menu-item ${item.destructive ? "is-destructive" : ""}`}
            >
              {item.checked !== undefined && (
                <span className="menu-check" aria-hidden>
                  {item.checked && <Icon name="checkmark" size={16} strokeWidth={2.6} />}
                </span>
              )}
              <span className="menu-item-label">
                {item.label}
                {item.subtitle && <span className="menu-item-sub">{item.subtitle}</span>}
              </span>
              {item.icon && <Icon name={item.icon} size={20} strokeWidth={1.9} />}
            </button>
          )
        )}
      </div>
    </div>,
    document.body
  );
}
