"use client";

import type { CSSProperties, ReactNode } from "react";
import { Icon } from "./Icon";
import { NavLink } from "./nav";
import type { NavKind } from "@/lib/nav-transitions";

/** Inset-grouped section: optional 13-pt header, a card, an optional footer. */
export function Section({
  header,
  headerAction,
  footer,
  prominent = false,
  tight = false,
  className = "",
  id,
  children,
}: {
  header?: ReactNode;
  headerAction?: ReactNode;
  footer?: ReactNode;
  /** A 22-pt bold header for the few sections that lead a screen. */
  prominent?: boolean;
  tight?: boolean;
  className?: string;
  id?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className={`section ${tight ? "is-tight" : ""} ${className}`}>
      {(header || headerAction) && (
        <div className={`section-header ${prominent ? "is-prominent" : ""}`}>
          <h2 className="min-w-0 truncate">{header}</h2>
          {headerAction && <span className="section-header-action shrink-0">{headerAction}</span>}
        </div>
      )}
      {children}
      {footer && <div className="section-footer">{footer}</div>}
    </section>
  );
}

/** A card of rows with hairline separators. */
export function List({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`card list ${className}`}>{children}</div>;
}

/** A plain card: no separators (stats, summaries). */
export function Card({
  children,
  className = "",
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div className={`card ${className}`} style={style}>
      {children}
    </div>
  );
}

type RowProps = {
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  detail?: ReactNode;
  value?: ReactNode;
  trailing?: ReactNode;
  /** Defaults to on for navigating rows. */
  chevron?: boolean;
  /** Blue title: the row performs an action. */
  action?: boolean;
  destructive?: boolean;
  centered?: boolean;
  tall?: boolean;
  wrap?: boolean;
  /** Where the separator above this row starts: "tile" (30-pt), "avatar" (40-pt), or px. */
  inset?: "tile" | "avatar" | "avatar-lg" | number;
  className?: string;
  ariaLabel?: string;
  disabled?: boolean;
  titleClassName?: string;
};

function insetPx(inset: RowProps["inset"], hasLeading: boolean): number {
  if (typeof inset === "number") return inset;
  if (inset === "tile") return 58;
  if (inset === "avatar") return 68;
  if (inset === "avatar-lg") return 72;
  return hasLeading ? 58 : 16;
}

function RowInner({
  leading,
  title,
  subtitle,
  detail,
  value,
  trailing,
  chevron,
  wrap,
  titleClassName = "",
}: RowProps) {
  return (
    <>
      {leading}
      <span className="row-main">
        <span className={`row-title ${wrap ? "is-wrap" : ""} ${titleClassName}`}>{title}</span>
        {subtitle && <span className={`row-subtitle ${wrap ? "is-wrap" : ""}`}>{subtitle}</span>}
        {detail && <span className="row-detail">{detail}</span>}
      </span>
      {trailing ?? (value !== undefined && value !== null && <span className="row-value">{value}</span>)}
      {chevron && (
        <span className="row-chevron" aria-hidden>
          <Icon name="chevron.right" size={15} strokeWidth={2.4} />
        </span>
      )}
    </>
  );
}

function rowClass(p: RowProps, pressable: boolean) {
  return [
    "row",
    pressable ? "is-pressable" : "",
    p.action ? "is-action" : "",
    p.destructive ? "is-destructive" : "",
    p.centered ? "is-centered" : "",
    p.tall || p.subtitle ? "is-tall" : "",
    p.className ?? "",
  ].join(" ");
}

/** A row that navigates: one row, one tap target, chevron by default. */
export function RowLink({
  href,
  kind = "push",
  ...p
}: RowProps & { href: string; kind?: NavKind }) {
  const chevron = p.chevron ?? true;
  return (
    <NavLink
      href={href}
      kind={kind}
      aria-label={p.ariaLabel}
      className={rowClass(p, true)}
      style={{ "--sep-inset": `${insetPx(p.inset, !!p.leading)}px` } as CSSProperties}
    >
      <RowInner {...p} chevron={chevron} />
    </NavLink>
  );
}

/** A row that performs an action (opens a sheet, toggles, confirms). */
export function RowButton({
  onClick,
  ...p
}: RowProps & { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={p.disabled}
      aria-label={p.ariaLabel}
      className={rowClass(p, true)}
      style={{ "--sep-inset": `${insetPx(p.inset, !!p.leading)}px` } as CSSProperties}
    >
      <RowInner {...p} chevron={p.chevron ?? false} />
    </button>
  );
}

/** A static row (labels, values, or one that hosts its own controls). */
export function Row(p: RowProps) {
  return (
    <div
      className={rowClass(p, false)}
      style={{ "--sep-inset": `${insetPx(p.inset, !!p.leading)}px` } as CSSProperties}
    >
      <RowInner {...p} chevron={p.chevron ?? false} />
    </div>
  );
}

/** Separator inset for hand-built rows inside a <List>. */
export function sepInset(px: number): CSSProperties {
  return { "--sep-inset": `${px}px` } as CSSProperties;
}

/** Label-left, value-right detail row ("Paid by · Asha"). */
export function DetailRow({ label, value, valueClassName = "" }: { label: ReactNode; value: ReactNode; valueClassName?: string }) {
  return (
    <div className="row" style={{ "--sep-inset": "16px" } as CSSProperties}>
      <span className="row-main">
        <span className="row-title">{label}</span>
      </span>
      <span className={`row-value ${valueClassName}`}>{value}</span>
    </div>
  );
}
