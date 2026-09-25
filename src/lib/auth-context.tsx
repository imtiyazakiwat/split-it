"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  ReactNode,
} from "react";
import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  browserPopupRedirectResolver,
  signOut as firebaseSignOut,
  User,
} from "firebase/auth";
import { auth, googleProvider } from "./firebase";
import { clearAuthHint, readAuthHint, writeAuthHint } from "./auth-hint";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  /**
   * Whose data to load, available before `onAuthStateChanged` has resolved.
   *
   * `onAuthStateChanged` costs a network round trip on cold start (it revalidates
   * the refresh token), and until it returned, every data provider sat behind
   * `if (!uid) return;` — so Firestore's on-device cache, which serves a
   * listener's first callback locally, was never even consulted. This is the
   * remembered uid from the last confirmed session, so loading can start
   * immediately and the two waits overlap.
   *
   * Use this ONLY to fetch. Never use it to decide whether someone is signed in:
   * that stays `user`, which is authoritative. See lib/auth-hint.ts.
   */
  dataUid: string | null;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/**
 * Marks that we handed the tab off to a full-page redirect sign-in, so the next
 * load knows to wait for `getRedirectResult` before deciding nobody is signed
 * in. Survives the navigation because it lives in sessionStorage.
 */
const REDIRECT_PENDING_KEY = "splitit:auth-redirect-pending";

const redirectPending = {
  get(): boolean {
    try {
      return sessionStorage.getItem(REDIRECT_PENDING_KEY) === "1";
    } catch {
      return false;
    }
  },
  set() {
    try {
      sessionStorage.setItem(REDIRECT_PENDING_KEY, "1");
    } catch {
      /* private mode / storage disabled */
    }
  },
  clear() {
    try {
      sessionStorage.removeItem(REDIRECT_PENDING_KEY);
    } catch {
      /* ignore */
    }
  },
};

/**
 * Keeps `users/{uid}` in step with the Google account, for member lookups.
 *
 * Firestore is imported dynamically here rather than at module scope. This module
 * is in the root layout's import graph (via AuthProvider), so a static
 * `from "firebase/firestore"` dragged the entire 641 kB SDK onto the critical
 * path of every route — for three functions called once per session, in a
 * fire-and-forget write nobody waits on.
 */
async function upsertUserDoc(u: User): Promise<void> {
  try {
    const [{ doc, setDoc, serverTimestamp }, { db }] = await Promise.all([
      import("firebase/firestore"),
      import("./firebase-db"),
    ]);
    await setDoc(
      doc(db, "users", u.uid),
      {
        uid: u.uid,
        displayName: u.displayName || u.email || "User",
        email: (u.email || "").toLowerCase(),
        photoURL: u.photoURL || "",
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  } catch (err) {
    // Non-fatal: the session is valid even if the mirror write fails.
    console.error("[auth] failed to sync user profile:", err);
  }
}

/**
 * In-app webviews (Facebook, Instagram, Line) rewrite `window.open` into a
 * same-tab navigation. The Auth SDK opens a popup and then waits for a message
 * that can never arrive, so it hangs forever; a redirect is the only flow with
 * any chance of completing there.
 *
 * Everything else — including installed PWAs and Android Chrome — uses a popup.
 * This used to redirect for `isAndroid || isStandalone`, which is what caused
 * the sign-in loop: `signInWithRedirect` sends an installed PWA out to Chrome,
 * the OAuth round-trip completes in Chrome's browsing context, and the return
 * to `start_url` is captured by the PWA — a different context that never held
 * the pending-redirect state. `getRedirectResult` there resolves to null, the
 * login screen comes back, and tapping again repeats the whole trip.
 *
 * Firebase documents the popup as the required fix for any app not served from
 * `<project>.firebaseapp.com`, because the redirect flow depends on a
 * cross-origin iframe against `authDomain` that browsers now partition:
 * https://firebase.google.com/docs/auth/web/redirect-best-practices
 */
function mustUseRedirect(): boolean {
  if (typeof window === "undefined") return false;
  return /FBAN|FBAV|Instagram|Line\//i.test(navigator.userAgent);
}

/** Popup failures that are worth retrying as a redirect. */
const POPUP_FALLBACK_CODES = new Set([
  "auth/popup-blocked",
  "auth/operation-not-supported-in-this-environment",
  "auth/web-storage-unsupported",
]);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const syncedUidRef = useRef<string | null>(null);
  /**
   * Seeded synchronously on first render so the data providers can attach their
   * listeners in the same tick, rather than waiting on the auth round trip.
   * Read via an initialiser (not an effect) precisely because an effect would
   * cost a render and give back the head start we are trying to win.
   */
  const [hintUid, setHintUid] = useState<string | null>(() => readAuthHint());

  useEffect(() => {
    let cancelled = false;

    // Only touched when we know a redirect is outstanding. Calling this on every
    // cold start forced the SDK to spin up its cross-origin auth iframe against
    // authDomain before the app could render — a network round-trip to another
    // origin on the critical path, for a flow almost nobody uses.
    const pending = redirectPending.get();
    const settleRedirect = pending
      ? getRedirectResult(auth)
          .catch((err) => {
            console.error("[auth] redirect sign-in failed:", err);
            return null;
          })
          .finally(() => redirectPending.clear())
      : Promise.resolve(null);

    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);

      // Reconcile the speculative uid against the real one. A mismatch means the
      // hint was stale (signed out elsewhere, or a different account), so the
      // data providers must drop what they loaded on its behalf — which they do
      // automatically, because their state is tagged with the uid it belongs to.
      if (u) {
        writeAuthHint(u.uid);
        setHintUid(u.uid);
      } else {
        clearAuthHint();
        setHintUid(null);
      }

      // Runs for redirect sign-ins too, where there's no popup result to hook
      // the profile write onto.
      if (u && syncedUidRef.current !== u.uid) {
        syncedUidRef.current = u.uid;
        void upsertUserDoc(u);
      }
      if (!u) syncedUidRef.current = null;

      if (u) {
        setLoading(false);
        return;
      }
      // Signed out *might* just mean the redirect result hasn't landed yet.
      // Releasing the loading gate here is what made the login screen flash
      // back up mid-redirect and invited the user to start another one.
      void settleRedirect.then(() => {
        if (!cancelled) setLoading(false);
      });
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  async function signInWithGoogle() {
    if (mustUseRedirect()) {
      redirectPending.set();
      await signInWithRedirect(auth, googleProvider);
      return;
    }
    try {
      const result = await signInWithPopup(auth, googleProvider, browserPopupRedirectResolver);
      await upsertUserDoc(result.user);
    } catch (err) {
      const code = (err as { code?: string }).code || "";
      // The user closing the popup, or double-tapping the button, is not a
      // failure to escalate — retrying as a redirect there would drag them
      // through a full page navigation they never asked for.
      if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
        return;
      }
      if (!POPUP_FALLBACK_CODES.has(code)) throw err;
      redirectPending.set();
      await signInWithRedirect(auth, googleProvider);
    }
  }

  async function signOut() {
    redirectPending.clear();
    // Cleared before the sign-out resolves so a reload racing it cannot start
    // speculative listeners for an account that is on its way out.
    clearAuthHint();
    setHintUid(null);
    await firebaseSignOut(auth);
  }

  // Prefer the confirmed uid the moment it exists; fall back to the hint only
  // while auth is still in flight.
  const dataUid = user?.uid ?? (loading ? hintUid : null);

  return (
    <AuthContext.Provider value={{ user, loading, dataUid, signInWithGoogle, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
