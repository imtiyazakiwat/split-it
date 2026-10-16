import type { ReactElement, SVGProps } from "react";

/**
 * One glyph family for the whole app, drawn on a 24-pt grid in the SF Symbols
 * idiom: round caps and joins, a single regular weight, filled only where SF
 * fills (dots, badges). No emoji stand in for icons anywhere.
 *
 * Server-safe (no hooks), so skeletons and loading files can use it too.
 */

const G: Record<string, ReactElement> = {
  "chevron.left": <path d="M15 4.5 7.5 12l7.5 7.5" />,
  "chevron.right": <path d="m9 4.5 7.5 7.5L9 19.5" />,
  "chevron.down": <path d="m5 9 7 7 7-7" />,
  "chevron.up.down": <path d="m8 9.5 4-4 4 4M8 14.5l4 4 4-4" />,
  plus: <path d="M12 4.5v15M4.5 12h15" />,
  xmark: <path d="M6 6l12 12M18 6 6 18" />,
  checkmark: <path d="m4.5 12.5 4.8 4.8L19.5 7" />,
  ellipsis: (
    <>
      <circle cx="5" cy="12" r="1.9" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.9" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.9" fill="currentColor" stroke="none" />
    </>
  ),
  bell: (
    <>
      <path d="M18 9.5a6 6 0 1 0-12 0c0 6-2.5 7.5-2.5 7.5h17S18 15.5 18 9.5Z" />
      <path d="M10 20.5a2.2 2.2 0 0 0 4 0" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3.1" />
      <path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.6-2-3.4-2.4.9a7.6 7.6 0 0 0-2.6-1.5L14 2.4h-4l-.4 2.5A7.6 7.6 0 0 0 7 6.4l-2.4-.9-2 3.4 2 1.6a7.6 7.6 0 0 0 0 3l-2 1.6 2 3.4 2.4-.9a7.6 7.6 0 0 0 2.6 1.5l.4 2.5h4l.4-2.5a7.6 7.6 0 0 0 2.6-1.5l2.4.9 2-3.4-2-1.6Z" />
    </>
  ),
  person: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20.5c.6-3.8 3.6-6 7.5-6s6.9 2.2 7.5 6" />
    </>
  ),
  "person.2": (
    <>
      <circle cx="9" cy="8.5" r="3.6" />
      <path d="M2.5 20c.5-3.5 3.1-5.6 6.5-5.6s6 2.1 6.5 5.6" />
      <path d="M15.6 5.2a3.6 3.6 0 0 1 0 6.6M17.4 14.6c2.3.6 3.8 2.5 4.1 5.4" />
    </>
  ),
  "person.badge.plus": (
    <>
      <circle cx="10" cy="8" r="4" />
      <path d="M3 20.5c.6-3.8 3.4-6 7-6 1.6 0 3 .4 4.2 1.2M18.5 13.5v7M15 17h7" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5.2l3.4 2" />
    </>
  ),
  "doc.text": (
    <>
      <path d="M6.5 2.8h7.4l4.6 4.6v12.3a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5.5 19.7V4.3A1.5 1.5 0 0 1 7 2.8Z" />
      <path d="M13.5 3v4.5h4.6M8.8 12.2h6.4M8.8 15.8h6.4" />
    </>
  ),
  "chart.bar": <path d="M5 20.5V12M10 20.5V5M15 20.5v-6.5M20 20.5V9M3 20.5h18" />,
  "rupee.bubble": (
    <>
      <path d="M12 3.2c5 0 9 3.4 9 7.8s-4 7.8-9 7.8c-1.1 0-2.2-.2-3.2-.5L4 20.5l1.2-4C3.8 15 3 13.1 3 11c0-4.4 4-7.8 9-7.8Z" />
      <path d="M9.3 7.6h5.4M9.3 10h5.4M11 7.6c1.6 0 2.6.9 2.6 2.4S12.6 12.4 11 12.4H9.6l3.6 3" />
    </>
  ),
  "indianrupee": <path d="M7 4.5h10M7 9h10M10 4.5c3 0 5 1.6 5 4.5s-2 4.5-5 4.5H8l7 6.5" />,
  magnifyingglass: (
    <>
      <circle cx="10.8" cy="10.8" r="6.6" />
      <path d="m16 16 4.6 4.6" />
    </>
  ),
  "line.3.decrease": <path d="M4 7h16M7 12h10M10 17h4" />,
  qrcode: (
    <>
      <rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1.4" />
      <rect x="14" y="3.5" width="6.5" height="6.5" rx="1.4" />
      <rect x="3.5" y="14" width="6.5" height="6.5" rx="1.4" />
      <path d="M14 14h2.5v2.5H14zM18 18h2.5v2.5H18zM18 14h2.5M14 18v2.5" />
    </>
  ),
  share: (
    <>
      <path d="M12 3.5v11M8 7.2 12 3.5l4 3.7" />
      <path d="M8.5 10.5H7A1.5 1.5 0 0 0 5.5 12v7A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5v-7a1.5 1.5 0 0 0-1.5-1.5h-1.5" />
    </>
  ),
  copy: (
    <>
      <rect x="8.5" y="8.5" width="11" height="12" rx="2" />
      <path d="M15.5 8.5V5.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h2" />
    </>
  ),
  pencil: (
    <>
      <path d="M16.6 3.9a2.1 2.1 0 0 1 3 3L8.4 18.1 4 19.5l1.4-4.4L16.6 3.9Z" />
      <path d="m14.6 5.9 3 3" />
    </>
  ),
  trash: (
    <>
      <path d="M4 6.5h16M9.5 6.5V4.8c0-.7.6-1.3 1.3-1.3h2.4c.7 0 1.3.6 1.3 1.3v1.7" />
      <path d="M6 6.5 7 19.2c.1 1 .9 1.8 1.9 1.8h6.2c1 0 1.8-.8 1.9-1.8L18 6.5M10 10.5v6.5M14 10.5v6.5" />
    </>
  ),
  archivebox: (
    <>
      <rect x="3" y="4" width="18" height="4.5" rx="1.2" />
      <path d="M4.5 8.5V18a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8.5M10 12h4" />
    </>
  ),
  "archivebox.up": (
    <>
      <rect x="3" y="4" width="18" height="4.5" rx="1.2" />
      <path d="M4.5 8.5V18a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8.5M12 17.5v-6M9.5 13.8 12 11.3l2.5 2.5" />
    </>
  ),
  leave: (
    <>
      <path d="M13.5 4.5H7A1.5 1.5 0 0 0 5.5 6v12A1.5 1.5 0 0 0 7 19.5h6.5" />
      <path d="M11 12h10M17.5 8.5 21 12l-3.5 3.5" />
    </>
  ),
  camera: (
    <>
      <path d="M4.5 7.5h3l1.6-2.5h5.8l1.6 2.5h3a1.5 1.5 0 0 1 1.5 1.5v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5V9a1.5 1.5 0 0 1 1.5-1.5Z" />
      <circle cx="12" cy="13.3" r="3.6" />
    </>
  ),
  photo: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2.2" />
      <circle cx="8.5" cy="9.5" r="1.6" />
      <path d="m3.5 17 5-4.5 3.5 3 3-2.5 5.5 4.5" />
    </>
  ),
  paperclip: <path d="m20 11.5-8.3 8.3a5 5 0 0 1-7.1-7.1l8.6-8.6a3.4 3.4 0 0 1 4.8 4.8l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l7.9-7.9" />,
  "square.and.arrow.down": (
    <>
      <path d="M12 3.5v11M8 10.8l4 3.7 4-3.7" />
      <path d="M8.5 7.5H7A1.5 1.5 0 0 0 5.5 9v10A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V9A1.5 1.5 0 0 0 17 7.5h-1.5" />
    </>
  ),
  message: <path d="M12 3.5c5 0 9 3.3 9 7.6s-4 7.6-9 7.6c-1.1 0-2.2-.2-3.2-.5L4 20.5l1.3-4C3.9 15 3 13.2 3 11.1 3 6.8 7 3.5 12 3.5Z" />,
  "arrow.up": <path d="M12 19.5v-15M5.8 10.7 12 4.5l6.2 6.2" />,
  forward: <path d="M14 5.5 20 11.5l-6 6M20 11.5h-9a7 7 0 0 0-7 7" />,
  "arrow.left.right": <path d="M4 8h15.5M15.5 4l4 4-4 4M20 16H4.5M8.5 12l-4 4 4 4" />,
  "checkmark.circle": (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12.3 2.8 2.8L16.2 9.6" />
    </>
  ),
  "checkmark.circle.fill": (
    <>
      <circle cx="12" cy="12" r="10" fill="currentColor" stroke="none" />
      <path d="m7.8 12.3 2.9 2.9 5.5-5.6" stroke="var(--on-fill, #fff)" />
    </>
  ),
  "circle": <circle cx="12" cy="12" r="9.5" />,
  "exclamationmark.triangle": (
    <>
      <path d="M10.3 4.2a2 2 0 0 1 3.4 0l7.6 13.2a2 2 0 0 1-1.7 3H4.4a2 2 0 0 1-1.7-3l7.6-13.2Z" />
      <path d="M12 9.5v4.5" />
      <circle cx="12" cy="17.2" r="1.05" fill="currentColor" stroke="none" />
    </>
  ),
  "info.circle": (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5" />
      <circle cx="12" cy="7.6" r="1.05" fill="currentColor" stroke="none" />
    </>
  ),
  "wifi.slash": (
    <>
      <path d="M2.8 9a14 14 0 0 1 6-2.9M21.2 9a14 14 0 0 0-8-3.3M5.8 12.4a9.5 9.5 0 0 1 4-2.1M18.2 12.4a9.5 9.5 0 0 0-2.4-1.6M8.9 15.7a5 5 0 0 1 6.2 0" />
      <circle cx="12" cy="19" r="1.1" fill="currentColor" stroke="none" />
      <path d="M4 3.5 20 20" />
    </>
  ),
  banknote: (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.7" />
      <path d="M6 9.5v5M18 9.5v5" />
    </>
  ),
  receipt: (
    <>
      <path d="M5.5 3.5h13v17l-2.6-1.6-2.3 1.6-1.6-1.2-1.6 1.2-2.3-1.6-2.6 1.6v-17Z" />
      <path d="M9 8.5h6M9 12h6M9 15.5h3.5" />
    </>
  ),
  "fork.knife": (
    <>
      <path d="M6.5 3v6.5a2.5 2.5 0 0 0 5 0V3M9 3v18" />
      <path d="M17.5 21V3.2c-1.9.7-3.3 3-3.3 6.3 0 2.2.9 3.6 3.3 4" />
    </>
  ),
  fuelpump: (
    <>
      <path d="M4.5 20.5V5a1.5 1.5 0 0 1 1.5-1.5h6.5A1.5 1.5 0 0 1 14 5v15.5M3 20.5h12.5M4.5 10.5H14" />
      <path d="M14 8h1.5a1.5 1.5 0 0 1 1.5 1.5v6.2a1.4 1.4 0 0 0 2.8 0V8.6L17 6" />
    </>
  ),
  bed: (
    <>
      <path d="M3 18.5V5.5M3 14.5h18v4M21 14.5v-2.5a3 3 0 0 0-3-3h-7v5.5" />
      <circle cx="7" cy="11" r="2" />
    </>
  ),
  car: (
    <>
      <path d="M4 15.5 5.4 9.8A2.5 2.5 0 0 1 7.8 8h8.4a2.5 2.5 0 0 1 2.4 1.8L20 15.5" />
      <rect x="2.8" y="15" width="18.4" height="4" rx="1.6" />
      <path d="M5.5 19v1.5M18.5 19v1.5" />
      <circle cx="7.3" cy="17" r=".6" fill="currentColor" />
      <circle cx="16.7" cy="17" r=".6" fill="currentColor" />
    </>
  ),
  bag: (
    <>
      <path d="M5.2 7.5h13.6l-.9 12.1a1.5 1.5 0 0 1-1.5 1.4H7.6a1.5 1.5 0 0 1-1.5-1.4L5.2 7.5Z" />
      <path d="M9 10V6.5a3 3 0 0 1 6 0V10" />
    </>
  ),
  "ellipsis.circle": (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="7.8" cy="12" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="16.2" cy="12" r="1.15" fill="currentColor" stroke="none" />
    </>
  ),
  link: (
    <>
      <path d="M10 14a4 4 0 0 0 5.7 0l3.2-3.2a4 4 0 0 0-5.7-5.7L11.6 6.7" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3.2 3.2a4 4 0 0 0 5.7 5.7l1.6-1.6" />
    </>
  ),
  "arrow.uturn.left": <path d="M9 14.5 4 9.5l5-5M4 9.5h10.5a5.5 5.5 0 0 1 0 11H12" />,
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.2" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
  at: (
    <>
      <circle cx="12" cy="12" r="3.6" />
      <path d="M15.6 12v1.4a2.6 2.6 0 0 0 5.2 0V12a8.8 8.8 0 1 0-3.4 7" />
    </>
  ),
  "person.crop.circle": (
    <>
      <circle cx="12" cy="12" r="9.2" />
      <circle cx="12" cy="10" r="3.2" />
      <path d="M6.2 18.3c1.2-2.2 3.3-3.4 5.8-3.4s4.6 1.2 5.8 3.4" />
    </>
  ),
  "bell.badge": (
    <>
      <path d="M17.6 11.4c.3 3.8 2.4 5.6 2.4 5.6H3.5S6 15.5 6 9.5a6 6 0 0 1 7.6-5.8" />
      <path d="M10 20.5a2.2 2.2 0 0 0 4 0" />
      <circle cx="18" cy="5.5" r="3" fill="currentColor" stroke="none" />
    </>
  ),
  sparkle: <path d="M12 3.5c.6 4.4 2.1 5.9 6.5 6.5-4.4.6-5.9 2.1-6.5 6.5-.6-4.4-2.1-5.9-6.5-6.5 4.4-.6 5.9-2.1 6.5-6.5Z" />,
  airplane: (
    <path d="M21 15.5v-1.6l-7.5-4.6V4.6c0-.9-.7-1.6-1.5-1.6s-1.5.7-1.5 1.6v4.7L3 13.9v1.6l7.5-2.3v4.9l-2 1.5V21l3.5-1 3.5 1v-1.4l-2-1.5v-4.9l7.5 2.3Z" />
  ),
  house: (
    <>
      <path d="M3.5 11 12 4l8.5 7" />
      <path d="M5.5 9.5v10a1 1 0 0 0 1 1h4v-6h3v6h4a1 1 0 0 0 1-1v-10" />
    </>
  ),
  briefcase: (
    <>
      <rect x="3" y="7" width="18" height="13" rx="2.2" />
      <path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M3 12.5h18" />
    </>
  ),
  gift: (
    <>
      <rect x="3.5" y="8" width="17" height="4" rx="1" />
      <path d="M5 12v7.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V12M12 8v12.5" />
      <path d="M12 8C10.5 5 7.5 4 7 6s3 2 5 2c2 0 5.5 0 5-2s-3.5-1-5 2" />
    </>
  ),
  figure: (
    <>
      <circle cx="13.5" cy="4.5" r="1.8" />
      <path d="m7 11 3-3.5 3.5 1.5 1.5 3.5 3 1M10 7.5 9 13l3.5 2.5-1 5M9 13l-3.5 6.5" />
    </>
  ),
  "hand.wave": (
    <>
      <path d="M8.5 11.2 6.2 8.9a1.5 1.5 0 0 1 2.1-2.1l4.4 4.4M9.8 8.4 8 6.6a1.5 1.5 0 0 1 2.1-2.1l4.5 4.5M12.2 6.6l-.6-.6a1.5 1.5 0 0 1 2.1-2.1l4.3 4.3a6.2 6.2 0 0 1-8.8 8.8l-3.6-3.6a1.5 1.5 0 0 1 2.1-2.1l1.7 1.7" />
    </>
  ),
};

export type IconName = keyof typeof G;

export function Icon({
  name,
  size = 22,
  strokeWidth = 1.8,
  className,
  style,
  title,
  ...rest
}: {
  name: IconName | string;
  size?: number;
  strokeWidth?: number;
  className?: string;
  style?: SVGProps<SVGSVGElement>["style"];
  title?: string;
} & Omit<SVGProps<SVGSVGElement>, "name">) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      aria-label={title}
      focusable="false"
      {...rest}
    >
      {G[name] ?? G["ellipsis.circle"]}
    </svg>
  );
}
