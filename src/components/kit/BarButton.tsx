"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Icon } from "./Icon";
import { NavLink } from "./nav";
import type { NavKind } from "@/lib/nav-transitions";

type Common = {
  /** Glyph for a circular glass button. */
  icon?: string;
  /** Visible text for a capsule button ("Edit", "Done"). */
  text?: ReactNode;
  /** Accessible name; required for icon-only buttons. */
  label: string;
  /** Tinted fill: reserved for the one commit action in a sheet. */
  prominent?: boolean;
  /** Small red count on the button (notifications). */
  badge?: number;
  className?: string;
};

/**
 * iOS 26/27 navigation-bar button: a 44-pt Liquid Glass circle for glyphs, a
 * capsule for words. Monochrome label-coloured glyphs; tint is reserved for
 * the prominent commit button.
 */
export const BarButton = forwardRef<
  HTMLButtonElement,
  Common & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">
>(function BarButton({ icon, text, label, prominent, badge, className = "", ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={text ? undefined : label}
      title={label}
      className={`bar-btn ${prominent ? "is-prominent" : "glass"} ${text ? "is-text" : ""} ${className}`}
      {...rest}
    >
      {icon && <Icon name={icon} size={prominent ? 20 : 21} strokeWidth={prominent ? 2.3 : 1.9} />}
      {text}
      {!!badge && badge > 0 && (
        <span className="bar-btn-badge" aria-hidden>
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </button>
  );
});

/** The same glass button as a prefetching link. */
export function BarLink({
  href,
  kind = "push",
  icon,
  text,
  label,
  badge,
  className = "",
}: Common & { href: string; kind?: NavKind }) {
  return (
    <NavLink
      href={href}
      kind={kind}
      aria-label={
        text ? undefined : badge ? `${label}, ${badge} needing attention` : label
      }
      className={`bar-btn glass ${text ? "is-text" : ""} ${className}`}
    >
      {icon && <Icon name={icon} size={21} strokeWidth={1.9} />}
      {text}
      {!!badge && badge > 0 && (
        <span className="bar-btn-badge" aria-hidden>
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </NavLink>
  );
}
