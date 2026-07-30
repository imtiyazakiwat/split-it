/**
 * UPI (Unified Payments Interface) deep links — India, Android-first.
 *
 * Three things break UPI links in a PWA, and all three are handled here:
 *
 *  1. **Targeting one specific app differs per platform.** On Android the
 *     supported route is an `intent://` URL naming the package, with a browser
 *     fallback baked in. On iOS there is no intent mechanism and no UPI app
 *     publishes a Universal Link, so the app's own scheme (`phonepe://pay`,
 *     `tez://upi/pay`, `paytmmp://pay`) is the only thing that works. Falling
 *     back to the generic `upi://pay` on iOS is what made every button open
 *     WhatsApp Pay: it owns that scheme on most iPhones.
 *  2. **Unsanitised parameters.** UPI apps silently reject a payment when the
 *     payee name or note contains characters outside a narrow safe set, or
 *     when the note is longer than 50 characters. Both are now normalised.
 *  3. **Launching via a synthesised `<a>` click.** Installed PWAs frequently
 *     ignore programmatic clicks on links with a non-http scheme. Assigning
 *     `window.location.href` works in Chrome, Android WebView and standalone
 *     PWAs alike.
 */

export interface UpiPaymentParams {
  payeeVpa: string; // recipient's UPI ID, e.g. "name@bank"
  payeeName: string;
  amount: number;
  note?: string;
}

/**
 * A UPI ID looks like `handle@psp`. Rejecting malformed IDs up front is much
 * better than handing the user off to an app that shows an opaque error.
 */
export function isValidUpiId(value: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,255}@[a-zA-Z][a-zA-Z0-9.-]{1,63}$/.test(value.trim());
}

/** UPI apps only reliably accept a conservative character set. */
function sanitizeText(value: string, maxLength: number): string {
  const cleaned = value
    .normalize("NFKD")
    .replace(/[^\w\s.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, maxLength);
}

export function normalizeParams(params: UpiPaymentParams): UpiPaymentParams {
  return {
    payeeVpa: params.payeeVpa.trim(),
    payeeName: sanitizeText(params.payeeName || "Payee", 50) || "Payee",
    amount: Math.round(params.amount * 100) / 100,
    note: params.note ? sanitizeText(params.note, 50) : undefined,
  };
}

function buildQuery(raw: UpiPaymentParams): string {
  const params = normalizeParams(raw);
  const qs = new URLSearchParams({
    pa: params.payeeVpa,
    pn: params.payeeName,
    am: params.amount.toFixed(2),
    cu: "INR",
  });
  if (params.note) qs.set("tn", params.note);
  return qs.toString();
}

/** The generic link every UPI app registers; Android shows an app chooser. */
export function buildUpiUri(params: UpiPaymentParams): string {
  return `upi://pay?${buildQuery(params)}`;
}

/**
 * Android intent URL targeting one app by package name. If the app isn't
 * installed, Android falls back to `S.browser_fallback_url`, so the user gets
 * a useful screen instead of a dead tab.
 */
function buildIntentUri(params: UpiPaymentParams, packageName: string): string {
  const fallback = encodeURIComponent(
    typeof window !== "undefined" ? window.location.href : "https://splitit.app"
  );
  return (
    `intent://pay?${buildQuery(params)}` +
    `#Intent;scheme=upi;package=${packageName};` +
    `S.browser_fallback_url=${fallback};end`
  );
}

export interface UpiApp {
  id: string;
  label: string;
  color: string;
  /** Android package name, used to build an `intent://` URL. */
  packageName?: string;
  /**
   * The app's own URL scheme *and* payment path, e.g. "phonepe://pay".
   *
   * This is the documented way to open one specific UPI app, and it is the only
   * thing that works on iOS: the generic `upi://pay` scheme there is claimed by
   * whichever UPI app registered it first (WhatsApp Pay on most iPhones), so
   * every button would open that same app regardless of what the user tapped.
   *
   * Schemes per NTT DATA Payment Services' iOS UPI intent guide:
   * https://in.nttdatapay.com/docs/integration-guide/use-cases-and-solutions/upi-intent-in-webView-ios
   */
  scheme?: string;
}

export const UPI_APPS: UpiApp[] = [
  {
    id: "gpay",
    label: "Google Pay",
    color: "#4285F4",
    packageName: "com.google.android.apps.nbbang",
    // Google Pay India shipped as "Tez" and kept the scheme.
    scheme: "tez://upi/pay",
  },
  {
    id: "phonepe",
    label: "PhonePe",
    color: "#5F259F",
    packageName: "com.phonepe.app",
    scheme: "phonepe://pay",
  },
  {
    id: "paytm",
    label: "Paytm",
    color: "#00BAF2",
    packageName: "net.one97.paytm",
    scheme: "paytmmp://pay",
  },
  {
    // No scheme on purpose: this is the "let the OS choose" entry, which is
    // exactly what `upi://pay` does.
    id: "other",
    label: "Any UPI app",
    color: "#34C759",
  },
];

/**
 * Builds the best available URI for an app on the current platform.
 *
 * Android — `intent://` naming the package, with a browser fallback baked in.
 * iOS     — the app's own scheme (`phonepe://pay`, `tez://upi/pay`, ...).
 *           Universal Links are *not* used: none of the UPI apps publish an
 *           HTTPS payment link, so an https:// URL just renders their marketing
 *           page in the browser instead of opening the app.
 * Anywhere else — plain `upi://pay` and let the OS decide.
 */
export function buildAppUri(app: UpiApp, params: UpiPaymentParams): string {
  if (app.packageName && isLikelyAndroid()) return buildIntentUri(params, app.packageName);
  if (app.scheme && isLikelyIOS()) return `${app.scheme}?${buildQuery(params)}`;
  return buildUpiUri(params);
}

export function isLikelyAndroid(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android/i.test(navigator.userAgent);
}

export function isLikelyIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

/**
 * Hands off to the UPI app. Returns false when we can be sure nothing could
 * be launched, so the caller can show the manual "copy the UPI ID" path.
 */
export function launchUpi(app: UpiApp, params: UpiPaymentParams): boolean {
  if (typeof window === "undefined") return false;
  if (!isValidUpiId(params.payeeVpa) || params.amount <= 0) return false;

  const primary = buildAppUri(app, params);
  try {
    window.location.href = primary;
  } catch {
    return false;
  }

  // Android only: if the intent URL couldn't be handled the page stays visible,
  // so retry once with the app's own scheme before giving up. On iOS the scheme
  // *is* the primary attempt, so there is nothing left to fall back to in code —
  // the caller's UI offers "copy the UPI ID" instead.
  if (app.scheme && isLikelyAndroid()) {
    const direct = `${app.scheme}?${buildQuery(params)}`;
    window.setTimeout(() => {
      if (document.visibilityState === "visible") {
        try {
          window.location.href = direct;
        } catch {
          // caller already shows the manual fallback
        }
      }
    }, 1200);
  }
  return true;
}

export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof window === "undefined") return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
