"use client";

import { useSyncExternalStore } from "react";
import { readPushStatus, subscribePushStatus, type PushStatus } from "./notifications";

/**
 * Live push status for this device, for whichever screen shows a switch.
 *
 * An external-store read rather than useState + useEffect: the status lives in
 * browser state (permission, localStorage) that changes outside React — our own
 * enable/disable calls, or the user flipping permission in OS settings while the
 * app is backgrounded. `useSyncExternalStore` re-reads on those signals and
 * never renders a stale value. The server snapshot is "off"; every screen that
 * uses this renders client-side after auth anyway.
 */
export function usePushStatus(uid: string | null | undefined): PushStatus {
  return useSyncExternalStore(
    subscribePushStatus,
    () => readPushStatus(uid),
    () => "off"
  );
}
