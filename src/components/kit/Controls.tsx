"use client";

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { Icon } from "./Icon";
import { hapticTap } from "@/lib/haptics";

type ButtonVariant =
  | "prominent"
  | "tinted"
  | "gray"
  | "plain"
  | "destructive"
  | "destructive-prominent"
  | "success";

/** HIG buttons: one prominent capsule per flow, tinted for secondary, plain for tertiary. */
export function Button({
  variant = "prominent",
  size = "lg",
  block = false,
  busy = false,
  icon,
  className = "",
  children,
  ...rest
}: {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  block?: boolean;
  busy?: boolean;
  icon?: string;
  children: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-busy={busy || undefined}
      className={`btn btn-${variant} ${size === "sm" ? "is-sm" : size === "md" ? "is-md" : ""} ${
        block ? "is-block" : ""
      } ${busy ? "is-busy" : ""} ${className}`}
      {...rest}
    >
      {busy ? <Spinner size={18} /> : icon ? <Icon name={icon} size={size === "sm" ? 17 : 20} strokeWidth={2.1} /> : null}
      <span className="min-w-0 truncate">{children}</span>
    </button>
  );
}

/** Segmented control: switches views of the same data. 2–4 short segments. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className = "",
}: {
  value: T;
  onChange: (v: T) => void;
  options: { id: T; label: string; count?: number | null }[];
  label: string;
  className?: string;
}) {
  const idx = Math.max(0, options.findIndex((o) => o.id === value));
  return (
    <div role="tablist" aria-label={label} className={`segmented ${className}`}>
      <span
        aria-hidden
        className="segmented-thumb"
        style={{
          width: `calc((100% - 6px) / ${options.length})`,
          transform: `translateX(${idx * 100}%)`,
        }}
      />
      {options.map((o) => {
        const selected = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => {
              if (!selected) hapticTap();
              onChange(o.id);
            }}
            className="segmented-item"
          >
            <span className="truncate">{o.label}</span>
            {typeof o.count === "number" && o.count > 0 && (
              <span className="segmented-count">{o.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** iOS switch. */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => {
        hapticTap();
        onChange(!checked);
      }}
      className="switch"
    >
      <span className="switch-thumb" />
    </button>
  );
}

/** iOS 26 capsule search field. */
export function SearchField({
  value,
  onChange,
  placeholder = "Search",
  label,
  autoFocus,
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  label: string;
  autoFocus?: boolean;
  className?: string;
}) {
  return (
    <div className={`search-field ${className}`}>
      <Icon name="magnifyingglass" size={17} strokeWidth={2.1} />
      <input
        type="search"
        enterKeyHint="search"
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange("")}
          className="-mr-1 inline-flex h-8 w-8 items-center justify-center text-label-3"
        >
          <span className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-full bg-[var(--label-3)] text-[var(--cell)]">
            <Icon name="xmark" size={11} strokeWidth={3} />
          </span>
        </button>
      )}
    </div>
  );
}

/** Text field that *is* the row: label left, input right (or full width). */
export function FieldRow({
  label,
  inputClassName = "",
  trailing,
  ...input
}: {
  label?: ReactNode;
  inputClassName?: string;
  trailing?: ReactNode;
} & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="row" style={{ cursor: "text" }}>
      {label && <span className="shrink-0 text-label">{label}</span>}
      <input className={`field ${label ? "is-right" : ""} ${inputClassName}`} {...input} />
      {trailing}
    </label>
  );
}

/** 8-pt capsule meter. */
export function Meter({ value, color, label }: { value: number; color?: string; label: string }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div
      className="meter"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
    >
      <span style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

/** iOS activity indicator. Only for genuinely remote work, never for cached data. */
export function Spinner({ size = 20, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={`spinner ${className}`}
      aria-hidden
    >
      {Array.from({ length: 8 }, (_, i) => (
        <line
          key={i}
          x1="12"
          y1="3"
          x2="12"
          y2="7.2"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          opacity={0.25 + (i / 8) * 0.75}
          transform={`rotate(${i * 45} 12 12)`}
        />
      ))}
    </svg>
  );
}

/** Centered empty state: glyph, title, message, at most one button. */
export function EmptyState({
  icon,
  title,
  message,
  action,
  compact = false,
}: {
  icon: string;
  title: ReactNode;
  message?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className="empty-state" style={compact ? { padding: "28px 20px" } : undefined}>
      <span className="empty-state-glyph">
        <Icon name={icon} size={30} strokeWidth={1.7} />
      </span>
      <p className="t-title3 text-label">{title}</p>
      {message && <p className="t-subhead max-w-[300px] text-label-2">{message}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
