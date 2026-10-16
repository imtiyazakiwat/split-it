"use client";

import { useState } from "react";

/** Up to two initials: "Asha Rao" → "AR", "ROHAN DESHPANDE" → "RD", "Karan" → "K". */
export function initials(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/[\s-]+/)
    .filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0][0] ?? "";
  const last = words.length > 1 ? words[words.length - 1][0] ?? "" : "";
  return (first + last).toUpperCase();
}

/**
 * Contacts-style monogram: the grey gradient iOS uses for people without a
 * photo. A photo that fails to load falls back to the monogram instead of the
 * browser's broken-image glyph.
 */
export function Avatar({
  name,
  photoURL,
  size = 40,
  className = "",
}: {
  name: string;
  photoURL?: string | null;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const showPhoto = !!photoURL && failed !== photoURL;
  const letters = size < 32 ? initials(name).slice(0, 1) : initials(name);
  return (
    <span
      className={`avatar ${className}`}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.4),
        background: showPhoto ? "var(--fill-3)" : "linear-gradient(180deg, #a5abb9 0%, #858a96 100%)",
      }}
      aria-hidden
    >
      {showPhoto ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photoURL!}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(photoURL!)}
          // An image that failed before hydration fired its error event before
          // React was listening; catch that case when the node attaches.
          ref={(el) => {
            if (el && el.complete && el.naturalWidth === 0 && el.currentSrc) setFailed(photoURL!);
          }}
        />
      ) : (
        <span style={{ letterSpacing: size > 60 ? "0.02em" : 0 }}>{letters}</span>
      )}
    </span>
  );
}

export function AvatarStack({
  people,
  size = 26,
  max = 4,
  className = "",
}: {
  people: { id: string; name: string; photoURL?: string | null }[];
  size?: number;
  max?: number;
  className?: string;
}) {
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  return (
    <span className={`avatar-stack ${className}`} aria-hidden>
      {shown.map((p) => (
        <Avatar key={p.id} name={p.name} photoURL={p.photoURL} size={size} />
      ))}
      {extra > 0 && (
        <span
          className="avatar"
          style={{
            width: size,
            height: size,
            fontSize: Math.round(size * 0.38),
            background: "var(--fill-2)",
            color: "var(--label-2)",
          }}
        >
          +{extra}
        </span>
      )}
    </span>
  );
}
