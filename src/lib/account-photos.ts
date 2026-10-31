"use client";

import { useSyncExternalStore } from "react";

/**
 * Account photos (users/{uid}.photoURL), used as the fallback when a group's
 * copy of someone's photo can't load.
 *
 * A group stores its own copy of each member's photo. When someone uploaded a
 * custom photo that the image host later lost, every group kept pointing at the
 * dead copy, while their account still had a working Google photo. Avatars now
 * try the group copy first and this second.
 *
 * Looked up lazily, once per uid per session, and only for people whose photo
 * actually failed, so a normal screen reads nothing extra.
 */

const photos = new Map<string, string | null>();
const inflight = new Set<string>();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Starts the lookup for `uid` if it hasn't been done this session. */
export function requestAccountPhoto(uid: string | undefined): void {
  if (!uid || photos.has(uid) || inflight.has(uid)) return;
  inflight.add(uid);
  void import("./firestore")
    .then(({ getUserProfile }) => getUserProfile(uid))
    .then((p) => photos.set(uid, p?.photoURL || null))
    .catch(() => photos.set(uid, null))
    .finally(() => {
      inflight.delete(uid);
      emit();
    });
}

/** The account photo for `uid` once looked up, else null. */
export function useAccountPhoto(uid: string | undefined): string | null {
  return useSyncExternalStore(
    subscribe,
    () => (uid ? photos.get(uid) ?? null : null),
    () => null
  );
}
