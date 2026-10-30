"use client";

import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Checkmark } from "@/components/ui/Icons";

export type MenuItem =
  | {
      label: string;
      icon?: ReactNode;
      onSelect: () => void;
      destructive?: boolean;
      checked?: boolean;
      disabled?: boolean;
    }
  | { divider: true };

/**
 * Pull-down menu: a glass panel that springs out of its trigger's corner.
 * Items are 46 pt with a trailing icon; the selected option gets a leading
 * check; destructive items are red. Escape or an outside tap closes it.
 */
export default function Menu({
  trigger,
  items,
  label,
  align = "right",
}: {
  trigger: (props: { onClick: () => void; "aria-expanded": boolean; "aria-haspopup": "menu"; ref: React.Ref<HTMLButtonElement> }) => ReactNode;
  items: MenuItem[];
  label: string;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left?: number; right?: number } | null>(null);
  const hasChecks = items.some((i) => "checked" in i && i.checked !== undefined);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setPos(
      align === "right"
        ? { top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) }
        : { top: r.bottom + 8, left: Math.max(8, r.left) }
    );
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    const first = panelRef.current?.querySelector<HTMLButtonElement>("button:not([disabled])");
    first?.focus({ preventScroll: true });
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, pos]);

  return (
    <>
      {trigger({ onClick: () => setOpen((v) => !v), "aria-expanded": open, "aria-haspopup": "menu", ref: btnRef })}
      {open &&
        pos &&
        createPortal(
          <div className="fixed inset-0 z-[45]" onClick={() => setOpen(false)}>
            <div
              ref={panelRef}
              role="menu"
              aria-label={label}
              onClick={(e) => e.stopPropagation()}
              className="glass glass-strong menu-panel fixed w-[254px] rounded-[22px] py-1.5 overflow-hidden"
              style={{ top: pos.top, left: pos.left, right: pos.right, transformOrigin: align === "right" ? "top right" : "top left" }}
            >
              {items.map((item, i) =>
                "divider" in item ? (
                  <div key={`d${i}`} className="h-[7px] my-0.5 bg-[var(--fill-soft)]" />
                ) : (
                  <button
                    key={item.label}
                    type="button"
                    role={hasChecks ? "menuitemradio" : "menuitem"}
                    aria-checked={hasChecks ? !!item.checked : undefined}
                    disabled={item.disabled}
                    onClick={() => {
                      setOpen(false);
                      item.onSelect();
                    }}
                    className={`w-full min-h-[46px] flex items-center gap-2.5 px-4 text-left text-[17px] tracking-[-0.015em] active:bg-[var(--pressed)] disabled:opacity-40 ${
                      item.destructive ? "text-[var(--red)]" : "text-[var(--text-primary)]"
                    }`}
                  >
                    {hasChecks && (
                      <span className="w-4 shrink-0">{item.checked && <Checkmark size={16} />}</span>
                    )}
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.icon && <span className="shrink-0 opacity-90">{item.icon}</span>}
                  </button>
                )
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
