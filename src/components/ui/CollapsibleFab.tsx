"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Floating action button that collapses to a circle while you scroll down the
 * list and expands back to a labelled pill when you scroll up, reach the top, or
 * simply stop. A permanently wide pill covers a good slice of the content it is
 * floating over; a permanently bare circle makes people guess what it does.
 *
 * The label is animated with max-width rather than being unmounted, so the
 * button never reflows the layout around it and the icon stays put.
 */
export default function CollapsibleFab({
  label,
  onClick,
  className = "",
}: {
  label: string;
  onClick: () => void;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(true);
  const lastY = useRef(0);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    lastY.current = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      const delta = y - lastY.current;
      // Ignore sub-pixel jitter and rubber-banding, or the button flickers.
      if (Math.abs(delta) < 6) return;
      lastY.current = y;
      if (y < 24) {
        setExpanded(true);
      } else {
        setExpanded(delta < 0);
      }
      // Expanding again once scrolling stops keeps the label discoverable
      // without it being in the way during the scroll itself.
      if (idleTimer.current) clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(() => setExpanded(true), 1200);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, []);

  return (
    <button
      onClick={onClick}
      // The label is hidden from the accessibility tree while collapsed, so the
      // button carries its name itself either way.
      aria-label={label}
      aria-expanded={expanded}
      className={`pointer-events-auto flex items-center rounded-full bg-[var(--brand-solid)] text-white py-3.5 shadow-[0_12px_28px_-6px_rgba(79,70,229,0.6)] tap-shrink transition-[padding] duration-200 ease-out motion-reduce:transition-none ${
        expanded ? "pl-4 pr-5" : "px-4"
      } ${className}`}
    >
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        className="shrink-0"
        aria-hidden
      >
        <path d="M12 5v14M5 12h14" />
      </svg>
      <span
        aria-hidden={!expanded}
        className={`overflow-hidden whitespace-nowrap text-[16px] font-semibold transition-all duration-200 ease-out motion-reduce:transition-none ${
          expanded ? "ml-2 max-w-[10rem] opacity-100" : "ml-0 max-w-0 opacity-0"
        }`}
      >
        {label}
      </span>
    </button>
  );
}
