"use client";

import { ReactNode, useEffect, useState, ButtonHTMLAttributes, forwardRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { previousPath } from "@/components/PageTransition";
import { ChevronLeft } from "@/components/ui/Icons";

/**
 * Glass bar button: a 44 pt circle (icon) or capsule (text) floating over
 * content, the way iOS 26/27 renders navigation-bar items.
 */
export const BarButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { prominent?: boolean; text?: boolean }
>(function BarButton({ prominent, text, className = "", children, type = "button", ...rest }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      className={`bar-btn ${prominent ? "is-prominent" : ""} ${text ? "is-text" : ""} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
});

/**
 * Back navigation that behaves like a navigation stack: return to the screen
 * the user came from when there is one, otherwise to the parent.
 */
export function useBack(fallbackHref: string) {
  const router = useRouter();
  // With an in-app previous screen, it is also the entry behind us in browser
  // history (the stack only grows from in-app navigation and reconciles on
  // popstate), so a real pop keeps both in step. Without one (a deep link, a
  // fresh tab), go to the parent instead of leaving the app.
  return () => (previousPath() ? router.back() : router.push(fallbackHref));
}

function useScrollY(): number {
  const [y, setY] = useState(0);
  useEffect(() => {
    let raf = 0;
    const read = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setY(window.scrollY));
    };
    read();
    window.addEventListener("scroll", read, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", read);
    };
  }, []);
  return y;
}

/**
 * A screen in a navigation stack.
 *
 * - Root screens (`large`) show a 34 pt large title in the content; the
 *   inline title fades in once it scrolls away.
 * - Pushed screens get a glass back chevron (no previous-title text) and a
 *   centred inline title.
 * - The bar has no background. Buttons are glass; a scroll-edge fade appears
 *   under them once content scrolls, so rows never collide with controls.
 */
export default function Screen({
  title,
  large = false,
  subtitle,
  backHref,
  onBack,
  leading,
  trailing,
  inlineTitleAfter,
  tabBar = true,
  children,
}: {
  title: string;
  large?: boolean;
  /** One gray line of context under a large title. */
  subtitle?: ReactNode;
  /** Parent route for the back chevron (pushed screens). */
  backHref?: string;
  onBack?: () => void;
  leading?: ReactNode;
  trailing?: ReactNode;
  /** Scroll offset at which the inline title appears. */
  inlineTitleAfter?: number;
  /** Reserve room for the floating tab bar. */
  tabBar?: boolean;
  children: ReactNode;
}) {
  const y = useScrollY();
  const goBack = useBack(backHref || "/");
  const threshold = inlineTitleAfter ?? (large ? 44 : -1);
  const showInline = y > threshold;
  const hasBack = !!(backHref || onBack);

  return (
    <div className="flex-1 flex flex-col min-h-full bg-[var(--background)]">
      {/* Sticky, not fixed: a fixed bar inside a transformed ancestor (push
          animation, edge swipe) would pin to that ancestor and jump away. */}
      <header className="sticky top-0 z-10 pt-[env(safe-area-inset-top)] pointer-events-none">
        <div className="scroll-edge-top" data-visible={y > 6} aria-hidden />
        <div className="relative max-w-md mx-auto h-[52px] px-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 pointer-events-auto min-w-[44px]">
            {hasBack && (
              <BarButton onClick={onBack ?? goBack} aria-label="Back">
                <ChevronLeft size={22} />
              </BarButton>
            )}
            {leading}
          </div>
          <h1
            className="absolute left-1/2 -translate-x-1/2 max-w-[calc(100%-176px)] truncate t-headline text-[var(--text-primary)] transition-opacity duration-200"
            style={{ opacity: showInline ? 1 : 0 }}
            aria-hidden={large}
          >
            {title}
          </h1>
          <div className="flex items-center gap-2 pointer-events-auto">{trailing}</div>
        </div>
      </header>

      <main
        className={`flex-1 max-w-md w-full mx-auto px-4 ${
          tabBar ? "pb-[var(--content-bottom)]" : "pb-[max(2rem,env(safe-area-inset-bottom))]"
        }`}
      >
        {large && (
          <div className="pt-0.5 pb-3.5 px-1">
            <h1 className="t-large-title text-[var(--text-primary)] truncate">{title}</h1>
            {subtitle && <p className="t-subhead text-[var(--text-meta)] mt-0.5">{subtitle}</p>}
          </div>
        )}
        {children}
      </main>
    </div>
  );
}

/** A text link styled as an inline action (blue, no chrome). */
export function TextLink({ href, children, className = "" }: { href: string; children: ReactNode; className?: string }) {
  return (
    <Link href={href} className={`text-[var(--brand)] font-medium ${className}`}>
      {children}
    </Link>
  );
}
