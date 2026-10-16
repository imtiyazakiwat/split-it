"use client";

import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { registerScreen } from "@/lib/nav-transitions";
import { BarButton } from "./BarButton";
import { useNav } from "./nav";

/**
 * One screen of the app: a transparent navigation bar with floating glass
 * buttons over a scrolling body.
 *
 * Root screens (`large`) carry a 34-pt large title that scrolls with the
 * content; the inline 17-pt title fades in once it has passed under the bar.
 * Pushed screens get a glass back chevron (no previous-title text) and an
 * inline title. Both get the scroll-edge wash once content moves beneath the
 * bar.
 *
 * Neither effect touches React state: the observers write data attributes on
 * the bar directly, so scrolling never re-renders the screen's content.
 */
export default function Screen({
  title,
  large = false,
  heroTitle = false,
  back,
  leading,
  trailing,
  inlineTitle,
  subtitle,
  tabBar = false,
  fixed = false,
  fixedClassName = "",
  bodyClassName = "",
  children,
}: {
  title: string;
  /** Root screen: large title in the content, inline title on scroll. */
  large?: boolean;
  /**
   * Pushed screen with its own hero header (a group, a person): the inline
   * title stays hidden until the element marked `data-hero-title` scrolls
   * under the bar, so the name isn't shown twice at the top.
   */
  heroTitle?: boolean;
  /** Pushed screen: where Back goes when there is no in-app history. */
  back?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  /** Replaces the plain inline title (e.g. an avatar + name in a chat). */
  inlineTitle?: ReactNode;
  /** A line of information under the large title. Use sparingly. */
  subtitle?: ReactNode;
  /** Reserve room so the last row clears the floating tab bar. */
  tabBar?: boolean;
  /** Full-height, non-scrolling layout whose children manage their own scroll. */
  fixed?: boolean;
  fixedClassName?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const nav = useNav();

  // Layout effect: registration has to happen before first paint so the
  // arriving screen is never seen un-animated.
  useLayoutEffect(() => {
    if (!rootRef.current) return;
    return registerScreen(rootRef.current, back ?? null);
    // Registered once per mount; a screen doesn't change what it is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const bar = barRef.current;
    if (!bar || fixed || typeof IntersectionObserver === "undefined") return;
    const observers: IntersectionObserver[] = [];
    if (sentinelRef.current) {
      const io = new IntersectionObserver(([e]) => {
        bar.dataset.scrolled = String(!e.isIntersecting);
      });
      io.observe(sentinelRef.current);
      observers.push(io);
    }
    const titleEl = large
      ? titleRef.current
      : heroTitle
      ? rootRef.current?.querySelector<HTMLElement>("[data-hero-title]")
      : null;
    if (titleEl) {
      const io = new IntersectionObserver(
        ([e]) => {
          bar.dataset.inlineTitle = e.isIntersecting ? "hidden" : "shown";
        },
        { rootMargin: `-${bar.offsetHeight}px 0px 0px 0px` }
      );
      io.observe(titleEl);
      observers.push(io);
    }
    return () => observers.forEach((o) => o.disconnect());
  }, [large, heroTitle, fixed]);

  const bar = (
    <header
      ref={barRef}
      className="nav-bar"
      data-screen-part={fixed ? undefined : ""}
      data-scrolled={fixed ? "true" : "false"}
      data-inline-title={large || heroTitle ? "hidden" : "shown"}
    >
      <div className="nav-bar-row">
        <div className="nav-leading">
          {back ? (
            <BarButton icon="chevron.left" label="Back" onClick={() => nav.back(back)} />
          ) : (
            leading
          )}
        </div>
        {large ? (
          <div className="nav-title" aria-hidden>
            {inlineTitle ?? title}
          </div>
        ) : (
          <h1 className="nav-title">{inlineTitle ?? title}</h1>
        )}
        <div className="nav-trailing">{trailing}</div>
      </div>
    </header>
  );

  if (fixed) {
    return (
      <div ref={rootRef} data-screen="" data-screen-part="" className={`screen-fixed ${fixedClassName}`}>
        {bar}
        {children}
      </div>
    );
  }

  return (
    <div ref={rootRef} data-screen="" className="screen">
      {bar}
      <main
        data-screen-part=""
        className={`screen-body ${tabBar ? "has-tabbar" : ""} ${bodyClassName}`}
      >
        <div ref={sentinelRef} aria-hidden className="pointer-events-none absolute left-0 top-2 h-px w-px" />
        <div className="screen-inner">
          {large && (
            <h1 ref={titleRef} className="large-title t-large-title">
              {title}
            </h1>
          )}
          {subtitle && <div className="large-title-sub t-subhead text-label-2">{subtitle}</div>}
          {children}
        </div>
      </main>
    </div>
  );
}
