/**
 * Pure decision logic for /api/notify: request parsing, who may be notified,
 * which device tokens to send to, dead-token detection and rate limiting.
 *
 * Kept free of Firebase so every rule can be unit tested. The route handler
 * does the I/O and defers every decision to this module.
 */

export const LIMITS = {
  MAX_RECIPIENTS: 50,
  MAX_TITLE: 120,
  MAX_BODY: 400,
  MAX_TAG: 96,
  MAX_ID: 128,
  /** Pushes a single caller may trigger per window. */
  RATE_MAX: 60,
  RATE_WINDOW_MS: 10 * 60 * 1000,
} as const;

/**
 * Links become in-app navigation targets in the service worker, so only
 * same-origin absolute paths are accepted. The worker checks again.
 */
export function safeLink(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const link = value.trim();
  if (!link.startsWith("/") || link.startsWith("//")) return null;
  return link.slice(0, 512);
}

/** Trims, collapses control characters and caps length. */
export function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, max);
}

/** Small stable hash, so a long link still contributes to the dedupe identity. */
export function shortHash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * Two pushes collapse into one only when they say the same thing *and* go to the
 * same place. Keying on title and body alone let "Asha added an expense" in two
 * different groups replace each other, with the survivor carrying the wrong link.
 */
export function dedupeTag(title: string, body: string, link: string | null): string {
  const source = `${title}|${body}|${link ?? ""}`;
  if (source.length <= LIMITS.MAX_TAG) return source;
  const suffix = `#${shortHash(source)}`;
  return `${source.slice(0, LIMITS.MAX_TAG - suffix.length)}${suffix}`;
}

function isIdLike(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= LIMITS.MAX_ID &&
    !value.includes("/")
  );
}

export interface NotifyRequest {
  /** Explicit recipients. With `groupId`, narrows the group; without it, required. */
  uids: string[];
  /** Notify this group's members; the server checks membership and titles it. */
  groupId: string | null;
  /** Empty means "use the group name" (group mode only). */
  title: string;
  body: string;
  link: string | null;
  /** Send a fixed test message to the caller's own devices. */
  test: boolean;
}

export type ParseResult = { ok: true; request: NotifyRequest } | { ok: false; error: string };

/**
 * Validates the request body. Accepts the old shape ({ uids, title, body, link })
 * unchanged, so a phone still running a cached bundle keeps working.
 */
export function parseNotifyRequest(payload: unknown): ParseResult {
  if (!payload || typeof payload !== "object") return { ok: false, error: "Invalid request" };
  const p = payload as Record<string, unknown>;

  if (p.test === true) {
    return {
      ok: true,
      request: { uids: [], groupId: null, title: "", body: "", link: null, test: true },
    };
  }

  const uids = Array.isArray(p.uids)
    ? [...new Set(p.uids.filter(isIdLike))].slice(0, LIMITS.MAX_RECIPIENTS)
    : [];
  const groupId = isIdLike(p.groupId) ? p.groupId : null;
  const title = cleanText(p.title, LIMITS.MAX_TITLE);
  const body = cleanText(p.body, LIMITS.MAX_BODY);
  const link = safeLink(p.link);

  if (!groupId && uids.length === 0) return { ok: false, error: "No recipients" };
  if (!body) return { ok: false, error: "Missing body" };
  if (!groupId && !title) return { ok: false, error: "Missing title" };

  return { ok: true, request: { uids, groupId, title, body, link, test: false } };
}

/**
 * Recipients for a group-scoped push: current members other than the caller,
 * narrowed to `requested` when given. Anyone requested who isn't a member is
 * dropped rather than reached.
 */
export function resolveGroupRecipients(
  callerUid: string,
  memberIds: readonly unknown[],
  requested: readonly string[]
): string[] {
  const members = new Set(memberIds.filter(isIdLike));
  members.delete(callerUid);
  if (requested.length === 0) return [...members];
  return requested.filter((uid) => members.has(uid));
}

export interface DeviceRecord {
  id: string;
  token: unknown;
  enabled: unknown;
}

export interface RecipientDevices {
  uid: string;
  devices: DeviceRecord[];
  /** The pre-devices `users/{uid}.fcmToken` field, honoured during migration. */
  legacyToken: unknown;
}

export interface DeviceTarget {
  uid: string;
  token: string;
  /** Device document holding this token, if any. */
  deviceId: string | null;
  /** True when the legacy field also holds this token and must be cleared if it dies. */
  legacy: boolean;
}

/**
 * Every live token for the recipients, once each. A device document wins over
 * the legacy field when both hold the same token, but the target remembers the
 * legacy copy so pruning a dead token clears both.
 */
export function collectTargets(recipients: readonly RecipientDevices[]): DeviceTarget[] {
  const byToken = new Map<string, DeviceTarget>();
  for (const r of recipients) {
    for (const d of r.devices) {
      if (d.enabled !== true || typeof d.token !== "string" || !d.token) continue;
      if (!byToken.has(d.token)) {
        byToken.set(d.token, { uid: r.uid, token: d.token, deviceId: d.id, legacy: false });
      }
    }
    if (typeof r.legacyToken === "string" && r.legacyToken) {
      const existing = byToken.get(r.legacyToken);
      if (existing) existing.legacy = true;
      else byToken.set(r.legacyToken, { uid: r.uid, token: r.legacyToken, deviceId: null, legacy: true });
    }
  }
  return [...byToken.values()];
}

/**
 * FCM errors that mean a token will never work again: the app was uninstalled,
 * site data cleared, or permission revoked. Left in place, such a token fails on
 * every send forever — which is how "notifications just stopped" presents.
 */
const DEAD_TOKEN_ERRORS = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/invalid-argument",
]);

export function isDeadTokenError(code: string | undefined): boolean {
  return !!code && DEAD_TOKEN_ERRORS.has(code);
}

export interface RateState {
  windowStart: number;
  count: number;
}

/**
 * Fixed-window limiter. Returns whether this call is allowed and the state to
 * store. A denied call stores nothing, so hammering doesn't extend the window.
 */
export function consumeRate(
  state: Partial<RateState> | undefined,
  now: number,
  limit: number = LIMITS.RATE_MAX,
  windowMs: number = LIMITS.RATE_WINDOW_MS
): { allowed: boolean; next: RateState } {
  const start = Number(state?.windowStart) || 0;
  const count = Number(state?.count) || 0;
  if (now - start >= windowMs || now < start) {
    return { allowed: true, next: { windowStart: now, count: 1 } };
  }
  if (count >= limit) return { allowed: false, next: { windowStart: start, count } };
  return { allowed: true, next: { windowStart: start, count: count + 1 } };
}
