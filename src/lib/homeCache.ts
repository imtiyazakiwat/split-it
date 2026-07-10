import { Group } from "./types";

/**
 * Lightweight localStorage cache of the home dashboard's last-known state, so
 * a refresh paints real numbers immediately instead of flashing from empty.
 * Firestore's own cache then reconciles with live data a moment later.
 */
export interface HomeCache {
  groups: Group[];
  balances: Record<string, number>;
}

const key = (uid: string) => `splitit:home:${uid}`;

export function readHomeCache(uid: string): HomeCache | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(key(uid));
    return raw ? (JSON.parse(raw) as HomeCache) : null;
  } catch {
    return null;
  }
}

export function writeHomeCache(uid: string, data: HomeCache): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key(uid), JSON.stringify(data));
  } catch {
    // storage full / unavailable — non-critical
  }
}
