"use client";

import { RefObject, useEffect, useRef } from "react";

/**
 * Overlay stack: at most one overlay owns Escape, focus trapping and initial
 * focus — the topmost. Sibling document-level listeners can't do this with
 * stopPropagation (it doesn't stop same-node listeners), so ownership is
 * checked against a live stack at event time instead of render time: no
 * re-renders when a second sheet opens over the first.
 *
 * Sheets open sheets here (group menu → invite sheet, chat → group picker),
 * so "every overlay handles its own keys" collapses the whole stack on one
 * Escape and lets a background sheet steal focus from the foreground one.
 */

let stack: number[] = [];
let nextId = 1;

function isTopmost(id: number): boolean {
  return stack.length > 0 && stack[stack.length - 1] === id;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusablesIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement
  );
}

/**
 * @param ref container with role="dialog". Focused on open (unless an inner
 * field already claimed it, e.g. an autofocused amount), trapped while open,
 * returned to the opener on close.
 * @param onEscape runs only when this overlay is topmost.
 */
export function useOverlayBehavior(
  ref: RefObject<HTMLElement | null>,
  onEscape: () => void
): void {
  // Latest callback without re-subscribing: openers usually pass inline
  // arrows (`onClose={() => setShowX(false)}`), whose identity changes every
  // render while the effect below runs once on mount.
  const escapeRef = useRef(onEscape);
  useEffect(() => {
    escapeRef.current = onEscape;
  });

  useEffect(() => {
    const id = nextId++;
    stack.push(id);
    const opener = document.activeElement as HTMLElement | null;
    const node = ref.current;

    // Enter the dialog for keyboard/VoiceOver users. Touch users keep focus
    // wherever it was — except iOS Safari leaves it on <body>, which is also
    // the signal to move in. Never steal from an autofocused field: focusing
    // the container would dismiss the keyboard the field just raised.
    if (node) {
      const activeInside = node.contains(document.activeElement);
      if (!activeInside) {
        node.setAttribute("tabindex", "-1");
        node.focus({ preventScroll: true });
      }
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (!isTopmost(id) || !ref.current) return;
      if (e.key === "Escape") {
        e.preventDefault();
        escapeRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusablesIn(ref.current);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (!ref.current.contains(active)) {
        // Focus escaped to the background (or browser chrome): pull it back.
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      stack = stack.filter((s) => s !== id);
      // Give focus back to whatever opened the overlay, so keyboard users
      // don't restart from the top of the page. Guards: the opener may have
      // unmounted while the sheet was up (list re-rendered underneath).
      try {
        if (opener && opener.isConnected) opener.focus({ preventScroll: true });
      } catch {
        // Focus restoration is a courtesy, never load-bearing.
      }
    };
  }, [ref]);
}
