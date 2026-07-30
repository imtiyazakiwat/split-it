"use client";

import { useEffect } from "react";

/**
 * Tracks how many sheets/modals are open at once.
 *
 * Two things depend on this being a *counter* rather than a boolean. A sheet can
 * open another sheet (the group menu opens the invite sheet; the chat opens the
 * "add to group" picker), and React re-runs effects on every mount — including
 * the extra mount/unmount pair StrictMode does in development. Flipping a
 * boolean would leave the page permanently unscrollable, or restore scrolling
 * while a sheet was still up.
 */
let openSheets = 0;
let previousOverflow = "";

/**
 * Locks background scrolling and marks the document as "a sheet is open", which
 * is what pulls the floating action button out of the way.
 *
 * The FAB used to sit at z-30/z-40 while every sheet rendered at z-20, so the
 * "+" button floated on top of the expense you had just opened — visible
 * through the dim backdrop and still tappable. Sheets now render above the
 * floating chrome, and `body[data-sheet-open]` fades the FAB out entirely so it
 * doesn't show through the scrim (see `.fab-layer` in globals.css).
 */
export function useSheetLayer(): void {
  useEffect(() => {
    if (openSheets === 0) {
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      document.body.dataset.sheetOpen = "true";
    }
    openSheets += 1;
    return () => {
      openSheets = Math.max(0, openSheets - 1);
      if (openSheets === 0) {
        document.body.style.overflow = previousOverflow;
        delete document.body.dataset.sheetOpen;
      }
    };
  }, []);
}
