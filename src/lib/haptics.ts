/**
 * Tactile feedback for completed actions. One honest rule: buzz only after
 * the write actually succeeded (post-await), never on tap — a vibration is a
 * promise kept, and this app never signals success for something that did
 * not happen.
 *
 * Platform truth: iOS Safari exposes no vibration API, so this is a silent
 * no-op on iPhones and real feedback on Android. Guarded to stay that way.
 */

function buzz(pattern: number | number[]): void {
  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate(pattern);
    }
  } catch {
    // Feedback is courtesy, never load-bearing.
  }
}

/** A message sent, a row tapped into place — light, single. */
export function hapticTap(): void {
  buzz(8);
}

/** A write confirmed: expense saved, payment recorded, request approved. */
export function hapticSuccess(): void {
  buzz([12, 40, 18]);
}
