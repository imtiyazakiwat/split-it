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
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { auth, googleProvider, db } from "./firebase";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/** Keeps `users/{uid}` in step with the Google account, for member lookups. */
async function upsertUserDoc(u: User): Promise<void> {
  try {
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
 * Popups are unreliable on Android — in an installed PWA or an in-app webview
 * `signInWithPopup` either throws immediately or opens a window that can never
 * post back, which left the app stuck with `user === null` and screens that
 * rendered nothing. We keep the popup for desktop (better UX) and fall back to
 * a full-page redirect whenever it isn't viable.
 */
function shouldUseRedirect(): boolean {
  if (typeof window === "undefined") return false;
  const ua = navigator.userAgent;
  const isAndroid = /Android/i.test(ua);
  const isStandalone =
    window.matchMedia?.("(display-mode: standalone)").matches ||
    ("standalone" in navigator && (navigator as unknown as { standalone: boolean }).standalone);
  // Facebook / Instagram / Line etc. in-app browsers block popups outright.
  const isInAppBrowser = /FBAN|FBAV|Instagram|Line|WebView|; wv\)/i.test(ua);
  return isAndroid || !!isStandalone || isInAppBrowser;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const syncedUidRef = useRef<string | null>(null);

  useEffect(() => {
    // Completes a redirect sign-in when the browser lands back on the app.
    getRedirectResult(auth).catch((err) => {
      console.error("[auth] redirect sign-in failed:", err);
    });

    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
      // Runs for redirect sign-ins too, where there's no popup result to hook
      // the profile write onto.
      if (u && syncedUidRef.current !== u.uid) {
        syncedUidRef.current = u.uid;
        void upsertUserDoc(u);
      }
      if (!u) syncedUidRef.current = null;
    });
    return unsubscribe;
  }, []);

  async function signInWithGoogle() {
    if (shouldUseRedirect()) {
      await signInWithRedirect(auth, googleProvider);
      return;
    }
    try {
      const result = await signInWithPopup(auth, googleProvider, browserPopupRedirectResolver);
      await upsertUserDoc(result.user);
    } catch (err) {
      const code = (err as { code?: string }).code || "";
      const recoverable = [
        "auth/popup-blocked",
        "auth/popup-closed-by-user",
        "auth/cancelled-popup-request",
        "auth/operation-not-supported-in-this-environment",
        "auth/web-storage-unsupported",
        "auth/internal-error",
      ].includes(code);
      if (!recoverable) throw err;
      await signInWithRedirect(auth, googleProvider);
    }
  }

  async function signOut() {
    await firebaseSignOut(auth);
  }

  return (
    <AuthContext.Provider value={{ user, loading, signInWithGoogle, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
