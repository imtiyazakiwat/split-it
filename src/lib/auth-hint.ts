/**
 * A locally remembered uid, used only to start loading data earlier.
 *
 * ## The problem this solves
 *
 * `onAuthStateChanged` does not merely read the persisted session from
 * IndexedDB — it POSTs to Firebase to confirm the refresh token is still valid
 * and the account has not been disabled. That is a network round trip on every
 * cold start, and on a weak mobile connection it takes seconds. The telltale
 * signature, widely reported, is that auth resolves *instantly in airplane mode*
 * and slowly on a bad connection.
 *
 * Meanwhile both data providers begin with `if (!uid) return;`, so no Firestore
 * listener was attached until that round trip finished. And Firestore with
 * `persistentLocalCache` serves a listener's first callback straight from the
 * on-device cache. So the data was already on the phone, waiting behind a
 * network call it did not need:
 *
 *   before:  auth POST ──────────────► uid ──► listener ──► cache ──► paint
 *   after:   hint ──► listener ──► cache ──► paint
 *            auth POST ──────────────► uid ──► confirm / discard
 *
 * The two latencies now overlap instead of queueing.
 *
 * ## Why this is safe
 *
 * This is an *identifier*, not a credential. Storing it grants nothing:
 *
 * - Firestore security rules are evaluated server-side against the real ID
 *   token. A listener opened with a stale or wrong uid returns nothing it
 *   shouldn't; it fails with a permission error, which every subscription here
 *   already handles by settling its loaded flag.
 * - It is never used to decide whether someone is signed in. The UI still gates
 *   on the real `user` from `onAuthStateChanged`, so a stale hint can never show
 *   a logged-out person a logged-in screen.
 * - Both providers tag their state with the uid it belongs to and discard it on
 *   mismatch, so speculative data for the wrong account is thrown away rather
 *   than displayed.
 * - It is cleared on sign-out and whenever auth resolves to a different user.
 *
 * Worst case the hint is wrong and the speculative listeners are discarded —
 * which costs a few reads and lands exactly where the old behaviour was.
 */

const KEY = "splitit:last-uid";

/** The uid this device most recently had a confirmed session for. */
export function readAuthHint(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(KEY);
    // Firebase uids are 28 chars of [A-Za-z0-9]; reject anything else rather
    // than feeding a malformed value into a query path.
    return v && /^[A-Za-z0-9]{8,128}$/.test(v) ? v : null;
  } catch {
    // Private browsing, or storage disabled. Fall back to waiting for auth.
    return null;
  }
}

export function writeAuthHint(uid: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, uid);
  } catch {
    /* non-fatal: we simply lose the head start next time */
  }
}

export function clearAuthHint(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
