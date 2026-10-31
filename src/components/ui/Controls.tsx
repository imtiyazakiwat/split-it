"use client";

import { ReactNode, useCallback, useLayoutEffect, useRef, useState } from "react";
import { Magnifier, Xmark } from "@/components/ui/Icons";

/* ── Avatar ─────────────────────────────────────────────────────────────── */

const AVATAR_TINTS = ["var(--indigo)", "var(--teal)", "var(--orange)", "var(--pink)", "var(--purple)", "var(--green)", "var(--blue)"];

function initials(name: string): string {
  // Words that start with a letter: "Goa Trip 2026" → "GT", not "G2".
  const words = name.trim().split(/\s+/).filter(Boolean);
  const lettered = words.filter((w) => /^\p{L}/u.test(w));
  const parts = lettered.length > 0 ? lettered : words;
  if (parts.length === 0) return "?";
  const first = parts[0][0] || "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] || "" : "";
  return (first + last).toUpperCase();
}

function tintFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_TINTS[h % AVATAR_TINTS.length];
}

/**
 * Contacts-style avatar: the photo when it loads, otherwise initials on a
 * soft gradient. A broken photo URL falls back to initials instead of an
 * empty box.
 */
export function Avatar({
  name,
  photoURL,
  size = 40,
  seed,
  ring = false,
}: {
  name: string;
  photoURL?: string | null;
  size?: number;
  seed?: string;
  ring?: boolean;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const showPhoto = !!photoURL && failed !== photoURL;
  // An image that failed before hydration never fires React's onError, so
  // also check on attach.
  const imgRef = useCallback(
    (el: HTMLImageElement | null) => {
      if (el && el.complete && el.naturalWidth === 0 && photoURL) setFailed(photoURL);
    },
    [photoURL]
  );
  const tint = tintFor(seed || name || "?");
  const style = { width: size, height: size, ...(ring ? { boxShadow: "0 0 0 2px var(--surface)" } : {}) };
  if (showPhoto) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        ref={imgRef}
        src={photoURL!}
        alt=""
        onError={() => setFailed(photoURL!)}
        className="rounded-full object-cover shrink-0 bg-[var(--fill-soft)]"
        style={style}
        referrerPolicy="no-referrer"
      />
    );
  }
  return (
    <span
      aria-hidden
      className="rounded-full shrink-0 inline-flex items-center justify-center font-semibold text-white select-none"
      style={{
        ...style,
        fontSize: Math.round(size * 0.4),
        letterSpacing: "0.01em",
        background: `linear-gradient(180deg, color-mix(in srgb, ${tint} 72%, white), ${tint})`,
      }}
    >
      {initials(name)}
    </span>
  );
}

/** Overlapping avatar stack with a "+N" capsule. */
export function AvatarStack({
  people,
  max = 3,
  size = 24,
}: {
  people: { id: string; name: string; photoURL?: string }[];
  max?: number;
  size?: number;
}) {
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  return (
    <span className="inline-flex items-center">
      {shown.map((p, i) => (
        <span key={p.id} style={{ marginLeft: i === 0 ? 0 : -size * 0.3 }} className="rounded-full">
          <Avatar name={p.name} photoURL={p.photoURL} size={size} seed={p.id} ring />
        </span>
      ))}
      {extra > 0 && (
        <span
          className="ml-1 rounded-full bg-[var(--fill-soft)] text-[var(--text-secondary)] inline-flex items-center justify-center px-1.5 font-medium"
          style={{ height: size, minWidth: size, fontSize: Math.max(10, size * 0.45) }}
        >
          +{extra}
        </span>
      )}
    </span>
  );
}

/* ── Segmented control ──────────────────────────────────────────────────── */

/**
 * iOS segmented control: 2–4 short segments, sliding thumb. For switching
 * views of the same data — not for navigation.
 */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className = "",
}: {
  value: T;
  onChange: (v: T) => void;
  options: { id: T; label: ReactNode }[];
  label: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [thumb, setThumb] = useState<{ x: number; w: number } | null>(null);
  const index = Math.max(0, options.findIndex((o) => o.id === value));

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const btn = el.querySelectorAll<HTMLButtonElement>(":scope > button")[index];
      if (btn) setThumb({ x: btn.offsetLeft - 2, w: btn.offsetWidth });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [index, options.length]);

  return (
    <div ref={ref} role="tablist" aria-label={label} className={`segmented ${className}`}>
      {thumb && (
        <span
          aria-hidden
          className="segmented-thumb"
          style={{ width: thumb.w, transform: `translateX(${thumb.x}px)` }}
        />
      )}
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="tab"
          aria-selected={o.id === value}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ── Switch ─────────────────────────────────────────────────────────────── */

export function Switch({
  checked,
  onChange,
  label,
  disabled,
  busy,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-busy={busy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="ios-switch"
    />
  );
}

/* ── Search field ───────────────────────────────────────────────────────── */

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
  label?: string;
  autoFocus?: boolean;
  className?: string;
}) {
  return (
    <label className={`search-field ${className}`}>
      <Magnifier className="shrink-0" />
      <input
        type="search"
        enterKeyHint="search"
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label || placeholder}
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="shrink-0 -mr-1 w-[22px] h-[22px] rounded-full grid place-items-center bg-[var(--text-tertiary)] text-[var(--surface)]"
        >
          <Xmark size={12} weight={3} />
        </button>
      )}
    </label>
  );
}

/* ── Empty state ────────────────────────────────────────────────────────── */

export function EmptyState({
  icon,
  title,
  message,
  action,
}: {
  icon: ReactNode;
  title: string;
  message?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center text-center px-8 py-14">
      <span className="text-[var(--text-tertiary)] mb-3">{icon}</span>
      <p className="t-title3 text-[var(--text-primary)]">{title}</p>
      {message && <p className="t-subhead text-[var(--text-secondary)] mt-1.5 max-w-[300px]">{message}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/* ── Money ──────────────────────────────────────────────────────────────── */

/** Signed tone for an amount from the viewer's side. */
export function toneClass(tone: "pos" | "neg" | "flat"): string {
  return tone === "pos" ? "text-[var(--pos)]" : tone === "neg" ? "text-[var(--neg)]" : "text-[var(--text-secondary)]";
}

/* ── Amount entry ───────────────────────────────────────────────────────── */

/**
 * Large centred amount field (Apple Cash style). The input sizes to its
 * content so the ₹ sign sits right next to the digits.
 */
export function AmountInput({
  value,
  onChange,
  autoFocus,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
  id?: string;
}) {
  const chars = Math.max(1, (value || "0").length);
  return (
    <label htmlFor={id} className="flex items-baseline justify-center gap-0.5 max-w-full">
      <span className="text-[38px] font-semibold text-[var(--text-secondary)] t-numeral">₹</span>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        step="0.01"
        min="0"
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0"
        aria-label="Amount"
        style={{ width: `calc(${chars}ch + 6px)` }}
        className="min-w-[1.2ch] max-w-[78vw] bg-transparent outline-none text-left text-[60px] leading-[68px] font-bold tracking-[-0.03em] t-numeral text-[var(--text-primary)] placeholder:text-[var(--text-quaternary)] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
    </label>
  );
}
