/**
 * UPI (Unified Payments Interface) deep links — India, Android-first.
 *
 * Three things break UPI links in a PWA, and all three are handled here:
 *
 *  1. **App-specific schemes are unreliable.** `tez://`, `phonepe://` and
 *     `paytmmp://` are undocumented and change between app versions. On
 *     Android the supported way to target a specific app is an `intent://`
 *     URL that names the package and declares `scheme=upi`, with a browser
 *     fallback baked in. We now emit those and keep the private scheme only
 *     as a last-resort retry.
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
  /** Android package name; absent for the generic "any app" entry. */
  packageName?: string;
  /** Legacy private scheme, used only as a retry if the intent link fails. */
  legacyScheme?: string;
  /**
   * iOS Universal Link base URL.
   * On iOS, the generic `upi://pay` scheme opens whichever app registered it
   * first (usually WhatsApp Pay), regardless of which button the user tapped.
   * Universal Links bypass this by routing directly through the app's own
   * HTTPS domain, which iOS verifies against the AASA file.
   * Set to `null` when no reliable link is available for that app on iOS.
   */
  iosLink?: string | null;
}

export const UPI_APPS: UpiApp[] = [
  {
    id: "gpay",
    label: "Google Pay",
    color: "#4285F4",
    packageName: "com.google.android.apps.nbbang",
    legacyScheme: "tez://upi/pay",
    // iOS Universal Link: opens Google Pay directly without a scheme chooser.
    iosLink: "https://pay.google.com/gp/v/app/pay",
  },
  {
    id: "phonepe",
    label: "PhonePe",
    color: "#5F259F",
    packageName: "com.phonepe.app",
    legacyScheme: "phonepe://pay",
    // PhonePe registers this Universal Link on iOS.
    iosLink: "https://phon.pe/ru_",
  },
  {
    id: "paytm",
    label: "Paytm",
    color: "#00BAF2",
    packageName: "net.one97.paytm",
    legacyScheme: "paytmmp://pay",
    // Paytm doesn't have a reliable iOS Universal Link for UPI payments,
    // so we fall back to the generic upi:// scheme for it on iOS.
    iosLink: null,
  },
  {
    id: "other",
    label: "Any UPI app",
    color: "#34C759",
  },
];

/**
 * Builds the best available URI for an app on the current platform.
 *
 * Android: intent:// URL with the app's package name.
 * iOS: Universal Link (HTTPS) when the app provides one, so the correct app
 *       opens directly. The generic `upi://pay` scheme on iOS opens whichever
 *       single app registered it first — usually WhatsApp Pay — regardless of
 *       what the user tapped. Universal Links fix this completely because iOS
 *       verifies the domain → app association.
 * Elsewhere: standard `upi://pay` and let the OS figure it out.
 */
export function buildAppUri(app: UpiApp, params: UpiPaymentParams): string {
  if (app.packageName && isLikelyAndroid()) return buildIntentUri(params, app.packageName);
  if (isLikelyIOS() && app.iosLink) return buildIosLink(app.iosLink, params);
  return buildUpiUri(params);
}

/**
 * Builds an iOS Universal Link for the given UPI app. The UPI params are passed
 * as query parameters on the HTTPS URL. Each app parses them from the incoming
 * link — the query names (pa, pn, am, cu, tn) are the standard UPI spec, so
 * every app that supports Universal Links for payments accepts them.
 */
function buildIosLink(baseUrl: string, params: UpiPaymentParams): string {
  const query = buildQuery(params);
  const separator = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}${separator}${query}`;
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

  // If the intent URL couldn't be handled the page stays visible; retry once
  // with the app's own scheme (older app versions) before giving up.
  if (app.legacyScheme && isLikelyAndroid()) {
    const legacy = `${app.legacyScheme}?${buildQuery(params)}`;
    window.setTimeout(() => {
      if (document.visibilityState === "visible") {
        try {
          window.location.href = legacy;
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
