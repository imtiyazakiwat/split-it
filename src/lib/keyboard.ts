import type { KeyboardEvent } from "react";

/**
 * Makes a <label> wrapping a hidden file input keyboard-operable: Enter/Space
 * triggers the nested file picker. Pair with role="button" and tabIndex={0} on
 * the label so it's focusable and announced correctly.
 */
export function activateFileInputOnKey(e: KeyboardEvent<HTMLLabelElement>) {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    (e.currentTarget.querySelector('input[type="file"]') as HTMLInputElement | null)?.click();
  }
}
