"use client";

import Link from "next/link";
import { ReactNode, useRef, useState, CSSProperties } from "react";
import NavHint from "@/components/NavHint";
import { ChevronRight } from "@/components/ui/Icons";

/**
 * Inset-grouped list section: optional uppercase header, a rounded card of
 * rows, optional footer that explains the section.
 */
export function ListSection({
  header,
  headerTrailing,
  prominentHeader = false,
  footer,
  elevated = false,
  className = "",
  children,
  id,
}: {
  header?: ReactNode;
  headerTrailing?: ReactNode;
  prominentHeader?: boolean;
  footer?: ReactNode;
  /** Use inside sheets (rows sit on the elevated cell color). */
  elevated?: boolean;
  className?: string;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className={`mt-7 first:mt-2 ${className}`}>
      {(header || headerTrailing) && (
        <div className={`flex items-end justify-between gap-3 ${prominentHeader ? "list-header-prominent" : "list-header"}`}>
          <h2 className="min-w-0 truncate">{header}</h2>
          {headerTrailing && <div className="shrink-0 normal-case tracking-normal">{headerTrailing}</div>}
        </div>
      )}
      <div className={`list-section ${elevated ? "is-elevated" : ""}`}>{children}</div>
      {footer && <div className="list-footer">{footer}</div>}
    </section>
  );
}

type RowBase = {
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Trailing value text (secondary color) or any node. */
  detail?: ReactNode;
  chevron?: boolean;
  destructive?: boolean;
  /** Blue "action" text row. */
  action?: boolean;
  tall?: boolean;
  /** Separator inset; defaults to the text edge when a leading element exists. */
  separatorInset?: number;
  className?: string;
  "aria-label"?: string;
};

function RowContent({ leading, title, subtitle, detail, chevron, destructive, action }: RowBase) {
  return (
    <>
      {leading && <span className="shrink-0 flex items-center">{leading}</span>}
      <span className="min-w-0 flex-1">
        <span
          className={`block truncate t-body ${
            destructive ? "text-[var(--neg)]" : action ? "text-[var(--brand)]" : "text-[var(--text-primary)]"
          }`}
        >
          {title}
        </span>
        {subtitle && (
          <span className="block truncate t-subhead text-[var(--text-secondary)] mt-px">{subtitle}</span>
        )}
      </span>
      {detail !== undefined && detail !== null && (
        <span className="shrink-0 max-w-[55%] text-right t-body text-[var(--text-secondary)] truncate">{detail}</span>
      )}
      {chevron && <ChevronRight className="row-chevron -mr-1" />}
    </>
  );
}

function rowStyle(p: RowBase): CSSProperties | undefined {
  const inset = p.separatorInset ?? (p.leading ? 16 + 44 + 12 : 16);
  return { ["--sep-inset" as string]: `${inset}px` } as CSSProperties;
}

/** A row that navigates. Chevron on by default. */
export function LinkRow({ href, prefetch, ...p }: RowBase & { href: string; prefetch?: boolean }) {
  return (
    <Link
      href={href}
      prefetch={prefetch}
      aria-label={p["aria-label"]}
      className={`list-row ${p.tall ? "is-tall" : ""} ${p.className ?? ""}`}
      style={rowStyle(p)}
    >
      <NavHint />
      <RowContent chevron {...p} />
    </Link>
  );
}

/** A row that acts (opens a sheet, toggles, runs an action). */
export function ButtonRow({
  onClick,
  disabled,
  ...p
}: RowBase & { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={p["aria-label"]}
      className={`list-row ${p.tall ? "is-tall" : ""} disabled:opacity-40 ${p.className ?? ""}`}
      style={rowStyle(p)}
    >
      <RowContent {...p} />
    </button>
  );
}

/** A static row (label/value, or a row containing a control). */
export function Row({ children, title, ...p }: Omit<RowBase, "title"> & { title?: ReactNode; children?: ReactNode }) {
  const hasText = title !== undefined && title !== null && title !== "";
  return (
    <div className={`list-row ${p.tall ? "is-tall" : ""} ${p.className ?? ""}`} style={rowStyle({ ...p, title })}>
      {hasText ? <RowContent title={title} {...p} /> : p.leading}
      {children}
    </div>
  );
}

/** A form row: label on the left, an input filling the rest. */
export function FieldRow({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <label className="list-row !py-0 min-h-[48px]">
      {label && <span className="t-body text-[var(--text-primary)] shrink-0 w-[108px]">{label}</span>}
      {children}
    </label>
  );
}

/**
 * Trailing swipe actions (Mail/Messages style). The row follows the finger,
 * opens past a third of the action width or on a fast flick, and a click that
 * ends a drag is swallowed so releasing a swipe never also opens the row.
 * Always pair with a non-gesture path to the same action.
 */
export function SwipeRow({
  actions,
  children,
  separatorInset = 16 + 44 + 12,
}: {
  actions: { label: string; tone?: "destructive" | "neutral" | "accent"; onClick: () => void }[];
  children: ReactNode;
  separatorInset?: number;
}) {
  const ACTION_W = 84;
  const total = ACTION_W * actions.length;
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const g = useRef({ x: 0, y: 0, start: 0, lastX: 0, lastT: 0, v: 0, locked: false, active: false, dragged: false });

  const close = () => setOffset(0);

  return (
    <div
      className="list-row-wrap overflow-hidden"
      style={{ ["--sep-inset" as string]: `${separatorInset}px` } as CSSProperties}
    >
      <div className="absolute inset-y-0 right-0 flex" aria-hidden={offset === 0} style={{ width: total }}>
        {actions.map((a) => (
          <button
            key={a.label}
            type="button"
            tabIndex={offset === 0 ? -1 : 0}
            onClick={() => {
              close();
              a.onClick();
            }}
            className="h-full text-white text-[15px] font-medium"
            style={{
              width: ACTION_W,
              background:
                a.tone === "destructive" ? "var(--red)" : a.tone === "accent" ? "var(--brand-solid)" : "var(--gray)",
            }}
          >
            {a.label}
          </button>
        ))}
      </div>
      <div
        className="relative bg-[var(--surface)]"
        style={{
          transform: `translateX(${offset}px)`,
          transition: dragging ? "none" : "transform 0.38s cubic-bezier(0.32,0.72,0,1)",
        }}
        onTouchStart={(e) => {
          const t = e.touches[0];
          g.current = { x: t.clientX, y: t.clientY, start: offset, lastX: t.clientX, lastT: e.timeStamp, v: 0, locked: false, active: true, dragged: false };
        }}
        onTouchMove={(e) => {
          const s = g.current;
          if (!s.active) return;
          const t = e.touches[0];
          const dx = t.clientX - s.x;
          const dy = t.clientY - s.y;
          if (!s.locked) {
            if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) {
              s.active = false;
              return;
            }
            if (Math.abs(dx) < 8) return;
            s.locked = true;
            s.dragged = true;
            setDragging(true);
          }
          const dt = Math.max(1, e.timeStamp - s.lastT);
          s.v = ((t.clientX - s.lastX) / dt) * 1000;
          s.lastX = t.clientX;
          s.lastT = e.timeStamp;
          let next = s.start + dx;
          if (next > 0) next = next * 0.12;
          if (next < -total) next = -total + (next + total) * 0.12;
          setOffset(next);
        }}
        onTouchEnd={() => {
          const s = g.current;
          s.active = false;
          if (!s.locked) return;
          setDragging(false);
          const open = offset < -total / 3 || s.v < -450;
          setOffset(open && s.v < 450 ? -total : 0);
          setTimeout(() => (g.current.dragged = false), 120);
        }}
        onClickCapture={(e) => {
          if (g.current.dragged) {
            e.preventDefault();
            e.stopPropagation();
            return;
          }
          if (offset !== 0) {
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

/** Settings-style colored icon tile. */
export function IconTile({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span className="icon-tile" style={{ background: color }}>
      {children}
    </span>
  );
}
