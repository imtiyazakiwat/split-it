"use client";

import { ReactNode, useCallback, useLayoutEffect, useRef, useState } from "react";
import { Magnifier, Xmark } from "@/components/ui/Icons";
import { requestAccountPhoto, useAccountPhoto } from "@/lib/account-photos";

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
/**
 * ImgBB answers a missing or unavailable image with HTTP 404/503 *and* a
 * 180×180 "image not found" PNG. Browsers render that body, so it counts as a
 * successful load and the placeholder logo showed up as someone's photo. Real
 * uploads are never exactly 180×180 (camera photos aren't square at that size,
 * and avatars are resized to 512 px), so treat that shape from ImgBB as a miss.
 */
function isImgbbPlaceholder(el: HTMLImageElement): boolean {
  return /(^|\.)ibb\.co$/.test(safeHost(el.currentSrc || el.src)) && el.naturalWidth === 180 && el.naturalHeight === 180;
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

export function Avatar({
  name,
  photoURL: primaryURL,
  fallbackURL,
  uid,
  size = 40,
  seed,
  ring = false,
}: {
  name: string;
  photoURL?: string | null;
  /** Tried when `photoURL` fails. Defaults to the person's account photo when `uid` is given. */
  fallbackURL?: string | null;
  /** A person's uid: enables the account-photo fallback. Omit for groups. */
  uid?: string;
  size?: number;
  seed?: string;
  ring?: boolean;
}) {
  const [primaryDead, setPrimaryDead] = useState<string | null>(null);
  const accountPhoto = useAccountPhoto(primaryDead || !primaryURL ? uid : undefined);
  const fallback = fallbackURL ?? accountPhoto;
  const usePrimary = !!primaryURL && primaryDead !== primaryURL;
  const photoURL = usePrimary ? primaryURL : fallback && fallback !== primaryURL ? fallback : null;
  // Per URL: "loaded" shows the photo, "failed" keeps the initials. Anything
  // else (still loading) shows the initials with the photo fading in on top,
  // so a slow photo never leaves a blank circle and a fast one never flashes.
  const [state, setState] = useState<{ url: string; status: "loaded" | "retrying" | "failed"; retried: boolean } | null>(null);
  const current = state?.url === photoURL ? state : null;
  const tint = tintFor(seed || name || "?");
  const ringStyle = ring ? { boxShadow: "0 0 0 2px var(--surface)" } : {};

  // A photo that finished before hydration fired its load/error events before
  // React was listening. Read the real outcome when the node attaches, and
  // only call it a failure once the browser has actually tried a source:
  // `complete` is also true for an image that hasn't started, which used to
  // mark good photos as broken and show initials instead.
  const imgRef = useCallback(
    (el: HTMLImageElement | null) => {
      if (!el || !photoURL || !el.complete || !el.currentSrc) return;
      if (el.naturalWidth > 0 && isImgbbPlaceholder(el)) {
        setState((prev) => (prev?.url === photoURL ? prev : { url: photoURL, status: "failed", retried: true }));
        if (photoURL === primaryURL) {
          setPrimaryDead(primaryURL);
          requestAccountPhoto(uid);
        }
        return;
      }
      if (el.naturalWidth > 0) {
        setState((prev) => (prev?.url === photoURL ? prev : { url: photoURL, status: "loaded", retried: false }));
        return;
      }
      // Failed before React listened: give it the same single retry.
      setState((prev) => (prev?.url === photoURL ? prev : { url: photoURL, status: "retrying", retried: true }));
      setTimeout(() => {
        el.src = photoURL + (photoURL.includes("?") ? "&" : "?") + "r=1";
      }, 1200);
    },
    [photoURL, primaryURL, uid]
  );

  const onError = (e: React.SyntheticEvent<HTMLImageElement>) => {
    if (!photoURL) return;
    const el = e.currentTarget;
    // One retry: the image host (ImgBB) intermittently answers 503, and
    // Google profile photos rate-limit bursts. A second try usually succeeds.
    if (!current?.retried) {
      setState({ url: photoURL, status: "retrying", retried: true });
      setTimeout(() => {
        el.src = photoURL + (photoURL.includes("?") ? "&" : "?") + "r=1";
      }, 1200);
      return;
    }
    setState({ url: photoURL, status: "failed", retried: true });
    if (photoURL === primaryURL) {
      setPrimaryDead(primaryURL);
      requestAccountPhoto(uid);
    }
  };

  // Kept mounted through the single retry; dropped once that retry fails too.
  const gaveUp = current?.status === "failed" && current.retried;
  const showImg = !!photoURL && !gaveUp;
  const loaded = current?.status === "loaded";

  return (
    <span
      className="relative rounded-full shrink-0 inline-flex items-center justify-center overflow-hidden select-none"
      style={{ width: size, height: size, ...ringStyle }}
      aria-hidden
    >
      <span
        className="absolute inset-0 inline-flex items-center justify-center font-semibold text-white"
        style={{
          fontSize: Math.round(size * 0.4),
          letterSpacing: "0.01em",
          background: `linear-gradient(180deg, color-mix(in srgb, ${tint} 72%, white), ${tint})`,
        }}
      >
        {initials(name)}
      </span>
      {showImg && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={photoURL}
          ref={imgRef}
          src={photoURL!}
          alt=""
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={(e) => {
            if (isImgbbPlaceholder(e.currentTarget)) {
              setState({ url: photoURL!, status: "failed", retried: true });
              if (photoURL === primaryURL) {
                setPrimaryDead(primaryURL!);
                requestAccountPhoto(uid);
              }
              return;
            }
            setState({ url: photoURL!, status: "loaded", retried: current?.retried ?? false });
          }}
          onError={onError}
          className="absolute inset-0 w-full h-full object-cover transition-opacity duration-200"
          style={{ opacity: loaded ? 1 : 0 }}
        />
      )}
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
          <Avatar name={p.name} photoURL={p.photoURL} size={size} seed={p.id} uid={p.id} ring />
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
