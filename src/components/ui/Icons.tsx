import { SVGProps } from "react";

/**
 * One icon family for the whole app: SF Symbols-style strokes, round caps and
 * joins, one weight. Sized by `size`; color follows `currentColor`.
 */
type IconProps = Omit<SVGProps<SVGSVGElement>, "stroke"> & { size?: number; weight?: number };

function Base({ size = 22, weight = 1.9, children, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={weight}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...rest}
    >
      {children}
    </svg>
  );
}

export const ChevronLeft = (p: IconProps) => (
  <Base weight={2.4} {...p}><path d="M15 4.5 7.5 12l7.5 7.5" /></Base>
);
export const ChevronRight = (p: IconProps) => (
  <Base size={14} weight={2.4} {...p}><path d="m9 5 7 7-7 7" /></Base>
);
export const ChevronUpDown = (p: IconProps) => (
  <Base size={14} weight={2.2} {...p}><path d="m8 9 4-4 4 4M8 15l4 4 4-4" /></Base>
);
export const ChevronDown = (p: IconProps) => (
  <Base size={14} weight={2.4} {...p}><path d="m6 9 6 6 6-6" /></Base>
);
export const Plus = (p: IconProps) => (
  <Base weight={2.3} {...p}><path d="M12 5v14M5 12h14" /></Base>
);
export const Xmark = (p: IconProps) => (
  <Base weight={2.3} {...p}><path d="M6.5 6.5l11 11M17.5 6.5l-11 11" /></Base>
);
export const Checkmark = (p: IconProps) => (
  <Base weight={2.6} {...p}><path d="m5 12.5 4.5 4.5L19 7.5" /></Base>
);
export const Ellipsis = (p: IconProps) => (
  <Base {...p}>
    <circle cx="5.5" cy="12" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="18.5" cy="12" r="1.5" fill="currentColor" stroke="none" />
  </Base>
);
export const Bell = (p: IconProps) => (
  <Base {...p}>
    <path d="M18 8.5a6 6 0 0 0-12 0c0 6.5-2.5 8.5-2.5 8.5h17S18 15 18 8.5" />
    <path d="M10.3 20.5a2 2 0 0 0 3.4 0" />
  </Base>
);
export const Magnifier = (p: IconProps) => (
  <Base size={17} weight={2.2} {...p}><circle cx="10.5" cy="10.5" r="6.5" /><path d="m20 20-4.6-4.6" /></Base>
);
export const Share = (p: IconProps) => (
  <Base {...p}><path d="M12 3.5v11M8 7l4-3.5L16 7" /><path d="M7.5 10.5H6a1.5 1.5 0 0 0-1.5 1.5v7A1.5 1.5 0 0 0 6 20.5h12a1.5 1.5 0 0 0 1.5-1.5v-7a1.5 1.5 0 0 0-1.5-1.5h-1.5" /></Base>
);
export const Download = (p: IconProps) => (
  <Base {...p}><path d="M12 3.5v11M8 11l4 3.5 4-3.5" /><path d="M5 20.5h14" /></Base>
);
export const People = (p: IconProps) => (
  <Base {...p}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5" />
    <path d="M16 4.8a3.3 3.3 0 0 1 0 6.4M18.5 14.8c1.8.7 2.8 2.4 3 5.2" />
  </Base>
);
export const PersonAdd = (p: IconProps) => (
  <Base {...p}>
    <circle cx="10" cy="8" r="3.5" />
    <path d="M3.5 20c.6-3.6 3.2-5.5 6.5-5.5 1.6 0 3 .4 4.1 1.3" />
    <path d="M18.5 14v6M15.5 17h6" />
  </Base>
);
export const Clock = (p: IconProps) => (
  <Base {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></Base>
);
export const Doc = (p: IconProps) => (
  <Base {...p}>
    <path d="M7 3.5h7l4.5 4.5v11a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5Z" />
    <path d="M14 3.5V8h4.5M9 12.5h6M9 16h6" />
  </Base>
);
export const Gear = (p: IconProps) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 13.5a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V20a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H4a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3h0a1.6 1.6 0 0 0 1-1.5V4a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5h0a1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8v0a1.6 1.6 0 0 0 1.5 1H20a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" />
  </Base>
);
export const Bubble = (p: IconProps) => (
  <Base {...p}><path d="M20.5 11.5c0 4.4-3.8 8-8.5 8-1.3 0-2.6-.3-3.7-.8L3.5 20l1.4-3.6A7.6 7.6 0 0 1 3.5 11.5c0-4.4 3.8-8 8.5-8s8.5 3.6 8.5 8Z" /></Base>
);
export const Rupee = (p: IconProps) => (
  <Base {...p}><path d="M7 4.5h10M7 9h10M10 4.5c3.5 0 5 1.5 5 4.5s-2 4.5-5 4.5H7.5l7.5 6.5" /></Base>
);
export const RupeeCircle = (p: IconProps) => (
  <Base {...p}><circle cx="12" cy="12" r="8.5" /><path d="M9 8h6M9 10.8h6M10.5 8c1.9 0 2.8.9 2.8 2.6s-1.1 2.6-2.8 2.6H9.2l4 3.3" /></Base>
);
export const Receipt = (p: IconProps) => (
  <Base {...p}><path d="M6 3.5h12v17l-2.5-1.6L13 20.5l-2.5-1.6L8 20.5l-2-1.3V3.5Z" transform="translate(0 0)" /><path d="M9 8.5h6M9 12h6M9 15.5h3" /></Base>
);
export const CheckCircle = (p: IconProps) => (
  <Base {...p}><circle cx="12" cy="12" r="8.5" /><path d="m8.5 12.2 2.4 2.4 4.6-5" /></Base>
);
export const Arrows = (p: IconProps) => (
  <Base {...p}><path d="M7 7.5h12M15.5 4 19 7.5 15.5 11M17 16.5H5M8.5 13 5 16.5 8.5 20" /></Base>
);
export const Camera = (p: IconProps) => (
  <Base {...p}><path d="M4 8a1.5 1.5 0 0 1 1.5-1.5h2.3l1.4-2h5.6l1.4 2h2.3A1.5 1.5 0 0 1 20 8v10a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18V8Z" /><circle cx="12" cy="12.8" r="3.3" /></Base>
);
export const Paperclip = (p: IconProps) => (
  <Base {...p}><path d="m20 11.3-8.3 8.3a5 5 0 0 1-7-7l8.6-8.7a3.4 3.4 0 0 1 4.8 4.8l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l7.9-7.9" /></Base>
);
export const ArrowUp = (p: IconProps) => (
  <Base weight={2.6} {...p}><path d="M12 19V5.5M6 11l6-6 6 6" /></Base>
);
export const Archive = (p: IconProps) => (
  <Base {...p}><rect x="3.5" y="4.5" width="17" height="4" rx="1" /><path d="M5 8.5V18a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 18V8.5M10 12.5h4" /></Base>
);
export const Pencil = (p: IconProps) => (
  <Base {...p}><path d="M14.5 5.5 18.5 9.5M4.5 19.5l1-4.5L16 4.5a2.1 2.1 0 0 1 3 3L8.5 18l-4 1.5Z" /></Base>
);
export const Trash = (p: IconProps) => (
  <Base {...p}><path d="M4.5 6.5h15M9.5 6.5V4.8c0-.7.5-1.3 1.2-1.3h2.6c.7 0 1.2.6 1.2 1.3v1.7M6.5 6.5l.9 12.2A1.5 1.5 0 0 0 8.9 20h6.2a1.5 1.5 0 0 0 1.5-1.3l.9-12.2" /></Base>
);
export const Leave = (p: IconProps) => (
  <Base {...p}><path d="M14 4.5H6.5A1.5 1.5 0 0 0 5 6v12a1.5 1.5 0 0 0 1.5 1.5H14M10 12h10M17 8.5l3.5 3.5-3.5 3.5" /></Base>
);
export const Qr = (p: IconProps) => (
  <Base {...p}>
    <rect x="4" y="4" width="6" height="6" rx="1" />
    <rect x="14" y="4" width="6" height="6" rx="1" />
    <rect x="4" y="14" width="6" height="6" rx="1" />
    <path d="M14 14h2.5v2.5H14zM17.5 17.5H20V20h-2.5zM14 19.5v.5M20 14v.5" />
  </Base>
);
export const Wifi = (p: IconProps) => (
  <Base {...p}><path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.3a9.6 9.6 0 0 1 13 0M8.6 15.6a5 5 0 0 1 6.8 0" /><circle cx="12" cy="19" r="1" fill="currentColor" stroke="none" /></Base>
);
export const Sort = (p: IconProps) => (
  <Base {...p}><path d="M7.5 4.5v15M4 8l3.5-3.5L11 8M16.5 19.5v-15M13 16l3.5 3.5L20 16" /></Base>
);
export const Copy = (p: IconProps) => (
  <Base {...p}><rect x="8.5" y="8.5" width="11" height="11" rx="2" /><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" /></Base>
);
export const Sparkle = (p: IconProps) => (
  <Base {...p}><path d="M12 3.5c.6 3.9 2.3 5.9 6.5 6.5-4.2.6-5.9 2.6-6.5 6.5-.6-3.9-2.3-5.9-6.5-6.5 4.2-.6 5.9-2.6 6.5-6.5Z" /></Base>
);

/* Category glyphs (expenses). Emoji were used before; one stroke family now. */
export function CategoryGlyph({ id, size = 20 }: { id?: string; size?: number }) {
  switch (id) {
    case "meal":
      return <Base size={size}><path d="M6.5 3.5v6.5a2 2 0 0 0 2 2V20.5M8.5 3.5v5M10.5 3.5v6.5a2 2 0 0 1-2 2M16.5 20.5V3.5c-2 1-3 3.5-3 6.5 0 1.5.8 2.5 3 2.5" /></Base>;
    case "fuel":
      return <Base size={size}><path d="M4.5 20.5V5A1.5 1.5 0 0 1 6 3.5h6A1.5 1.5 0 0 1 13.5 5v15.5M3.5 20.5h11M4.5 11h9" /><path d="M13.5 8h1.5a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 0 3 0V9l-2.5-2.5" /></Base>;
    case "hotel":
      return <Base size={size}><path d="M3.5 19.5v-12M3.5 15.5h17v4M20.5 15.5v-3a3 3 0 0 0-3-3h-7v6" /><circle cx="7" cy="11.5" r="1.8" /></Base>;
    case "transport":
      return <Base size={size}><path d="M5.5 16.5h13M5 16.5v2.5M19 16.5v2.5M4.5 16.5l1.4-6.2A2 2 0 0 1 7.9 8.8h8.2a2 2 0 0 1 2 1.5l1.4 6.2M3.5 11.5h1.5M19 11.5h1.5" /><circle cx="7.8" cy="13.6" r=".6" fill="currentColor" /><circle cx="16.2" cy="13.6" r=".6" fill="currentColor" /></Base>;
    case "shopping":
      return <Base size={size}><path d="M5.5 7.5h13l-1 12a1.5 1.5 0 0 1-1.5 1.5H8a1.5 1.5 0 0 1-1.5-1.5l-1-12Z" /><path d="M9 10V7a3 3 0 0 1 6 0v3" /></Base>;
    default:
      return <Receipt size={size} />;
  }
}

/** System color for each category's icon tile (Settings-style). */
export function categoryTint(id?: string): string {
  switch (id) {
    case "meal": return "var(--orange)";
    case "fuel": return "var(--red)";
    case "hotel": return "var(--indigo)";
    case "transport": return "var(--yellow)";
    case "shopping": return "var(--pink)";
    default: return "var(--gray)";
  }
}
