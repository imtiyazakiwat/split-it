"use client";

import { useState } from "react";
import { Icon } from "./Icon";

/** Settings-style tile: a tinted rounded square with a white glyph. */
export function IconTile({
  icon,
  color = "var(--gray)",
  size = "md",
  className = "",
}: {
  icon: string;
  color?: string;
  size?: "md" | "lg" | "xl";
  className?: string;
}) {
  const glyph = size === "xl" ? 30 : size === "lg" ? 22 : 18;
  return (
    <span
      className={`tile ${size === "lg" ? "is-lg" : size === "xl" ? "is-xl" : ""} ${className}`}
      style={{ background: color }}
      aria-hidden
    >
      <Icon name={icon} size={glyph} strokeWidth={size === "md" ? 2.1 : 2} />
    </span>
  );
}

const CATEGORY: Record<string, { icon: string; color: string }> = {
  meal: { icon: "fork.knife", color: "var(--orange)" },
  fuel: { icon: "fuelpump", color: "var(--green)" },
  hotel: { icon: "bed", color: "var(--indigo)" },
  transport: { icon: "car", color: "var(--blue)" },
  shopping: { icon: "bag", color: "var(--pink)" },
  others: { icon: "receipt", color: "var(--gray)" },
};

export function categoryStyle(id?: string) {
  return CATEGORY[id || ""] ?? CATEGORY.others;
}

/** The glyph tile for an expense category (replaces the old emoji). */
export function CategoryTile({ id, size = "md" }: { id?: string; size?: "md" | "lg" | "xl" }) {
  const c = categoryStyle(id);
  return <IconTile icon={c.icon} color={c.color} size={size} />;
}

const GROUP_COLORS = [
  "var(--blue)",
  "var(--indigo)",
  "var(--purple)",
  "var(--pink)",
  "var(--orange)",
  "var(--green)",
  "var(--teal)",
  "var(--mint)",
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** A glyph that says what kind of group this is, when the name makes it obvious. */
function groupGlyph(name: string): string | null {
  const n = name.toLowerCase();
  if (/(trip|goa|travel|vacation|holiday|beach|tour|manali|ladakh)/.test(n)) return "airplane";
  if (/(home|room|flat|house|mate|pg|hostel|apartment|rent)/.test(n)) return "house";
  if (/(food|dinner|lunch|restaurant|cafe|eat|meal|breakfast)/.test(n)) return "fork.knife";
  if (/(office|work|team|company|colleague)/.test(n)) return "briefcase";
  if (/(party|birthday|celebrat|diwali|wedding|fest)/.test(n)) return "gift";
  if (/(car|cab|ride|fuel|petrol|bike)/.test(n)) return "car";
  if (/(gym|sport|game|club|cricket|football|badminton)/.test(n)) return "figure";
  return null;
}

/**
 * A group's picture: its photo, or an app-icon-like tile in a colour derived
 * from the group id with either a meaningful glyph or its initial.
 */
export function GroupAvatar({
  id,
  name,
  photoURL,
  size = 44,
}: {
  id: string;
  name: string;
  photoURL?: string | null;
  size?: number;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const radius = Math.round(size * 0.26);
  if (photoURL && failed !== photoURL) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={photoURL}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setFailed(photoURL)}
        ref={(el) => {
          if (el && el.complete && el.naturalWidth === 0 && el.currentSrc) setFailed(photoURL);
        }}
        className="shrink-0 object-cover"
        style={{ width: size, height: size, borderRadius: radius, background: "var(--fill-3)" }}
      />
    );
  }
  const color = GROUP_COLORS[hash(id || name) % GROUP_COLORS.length];
  const glyph = groupGlyph(name);
  return (
    <span
      aria-hidden
      className="shrink-0 inline-flex items-center justify-center text-white"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: `linear-gradient(180deg, color-mix(in srgb, ${color} 78%, white) 0%, ${color} 100%)`,
        boxShadow: "inset 0 0 0 0.5px rgba(0,0,0,0.06)",
      }}
    >
      {glyph ? (
        <Icon name={glyph} size={Math.round(size * 0.5)} strokeWidth={2} />
      ) : (
        <span style={{ fontSize: Math.round(size * 0.44), fontWeight: 600, lineHeight: 1 }}>
          {(name.trim()[0] || "G").toUpperCase()}
        </span>
      )}
    </span>
  );
}
