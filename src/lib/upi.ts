/**
 * UPI (Unified Payments Interface) deep links — India-only, Android-only.
 * There is no equivalent for iOS; UPI apps aren't available there.
 *
 * The generic `upi://pay` intent is honored by every UPI app (GPay, PhonePe,
 * Paytm, BHIM, etc.) — the OS shows an app picker if more than one is
 * installed. Some apps also support their own scheme for a more direct deep
 * link when you know the user has that specific app.
 */

export interface UpiPaymentParams {
  payeeVpa: string; // recipient's UPI ID, e.g. "name@bank"
  payeeName: string;
  amount: number;
  note?: string;
}

function buildQuery(params: UpiPaymentParams): string {
  const qs = new URLSearchParams({
    pa: params.payeeVpa,
    pn: params.payeeName,
    am: params.amount.toFixed(2),
    cu: "INR",
  });
  if (params.note) qs.set("tn", params.note);
  return qs.toString();
}

export function buildUpiUri(params: UpiPaymentParams): string {
  return `upi://pay?${buildQuery(params)}`;
}

export interface UpiApp {
  id: string;
  label: string;
  color: string;
  buildUri: (params: UpiPaymentParams) => string;
}

/**
 * Per-app URI schemes. Falls back to the generic `upi://pay` scheme for
 * apps without (or with unreliable) dedicated schemes — Android will still
 * route it correctly via the intent system if that specific app is chosen
 * from the resulting chooser.
 */
export const UPI_APPS: UpiApp[] = [
  {
    id: "gpay",
    label: "Google Pay",
    color: "#4285F4",
    buildUri: (p) => `tez://upi/pay?${buildQuery(p)}`,
  },
  {
    id: "phonepe",
    label: "PhonePe",
    color: "#5F259F",
    buildUri: (p) => `phonepe://pay?${buildQuery(p)}`,
  },
  {
    id: "paytm",
    label: "Paytm",
    color: "#00BAF2",
    buildUri: (p) => `paytmmp://pay?${buildQuery(p)}`,
  },
  {
    id: "other",
    label: "Other UPI app",
    color: "#34C759",
    buildUri: (p) => buildUpiUri(p),
  },
];

export function isLikelyAndroid(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android/i.test(navigator.userAgent);
}
