"use client";

import { useState } from "react";
import {
  describePushFailure,
  enablePushForUser,
  getPushSupport,
} from "@/lib/notifications";
import { usePushStatus } from "@/lib/use-push";

/** Don't ask again for this long after "Not now". */
const SNOOZE_MS = 14 * 24 * 60 * 60 * 1000;
const SNOOZE_KEY = "splitit:push-prompt-snoozed-at";

function snoozedRecently(): boolean {
  try {
    const at = Number(window.localStorage.getItem(SNOOZE_KEY));
    return Number.isFinite(at) && at > 0 && Date.now() - at < SNOOZE_MS;
  } catch {
    return false;
  }
}

/**
 * A soft ask for notification permission, shown on Home.
 *
 * Before this, the only place that ever requested permission was a switch at
 * the bottom of Settings — which is why 4 of 7 accounts had never registered a
 * device. Asking in context ("know when friends pay you"), from a tap, is the
 * standard pattern: the browser's own prompt only appears once the user has
 * said yes here, so a "Not now" never burns the one-shot native prompt.
 *
 * Only shown when it can actually work: push supported, never decided, not
 * turned off here, not snoozed, and the user is in at least one group (with no
 * groups there's nothing to be notified about). iPhone users in a Safari tab
 * get the install banner from PwaBootstrap instead, since push can't work there.
 */
export default function NotificationPrompt({ uid, hasGroups }: { uid: string; hasGroups: boolean }) {
  const status = usePushStatus(uid);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const eligible =
    hasGroups &&
    !hidden &&
    status === "off" &&
    getPushSupport() === "supported" &&
    typeof Notification !== "undefined" &&
    Notification.permission === "default" &&
    !snoozedRecently();

  if (!eligible && !message) return null;

  async function turnOn() {
    setBusy(true);
    setMessage("");
    const result = await enablePushForUser(uid);
    setBusy(false);
    if (result.ok) {
      setHidden(true);
      return;
    }
    setMessage(describePushFailure(result.reason));
  }

  function notNow() {
    try {
      window.localStorage.setItem(SNOOZE_KEY, String(Date.now()));
    } catch {
      /* storage disabled: it simply asks again next launch */
    }
    setHidden(true);
    setMessage("");
  }

  return (
    <section aria-labelledby="push-prompt-title" className="list-section mt-4 px-4 pt-4 pb-3">
      <div className="flex items-start gap-3">
        <span aria-hidden className="icon-tile !w-10 !h-10 !rounded-[11px]" style={{ background: "var(--red)" }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8.5a6 6 0 0 0-12 0c0 6.5-2.5 8.5-2.5 8.5h17S18 15 18 8.5" />
            <path d="M10.3 20.5a2 2 0 0 0 3.4 0" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="push-prompt-title" className="t-headline text-[var(--text-primary)]">
            Turn On Notifications
          </h2>
          <p className="t-subhead text-[var(--text-secondary)] mt-0.5">
            Know when friends add expenses, ask you to confirm a payment, or pay you back.
          </p>
          {message && (
            <p role="status" className="t-footnote text-[var(--neg)] mt-2">
              {message}
            </p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 mt-3.5">
        <button type="button" onClick={notNow} disabled={busy} className="btn-gray btn-small flex-1 !min-h-[40px]">
          Not Now
        </button>
        <button type="button" onClick={turnOn} disabled={busy} className="btn-prominent btn-small flex-1 !min-h-[40px]">
          {busy ? "Turning On…" : "Turn On"}
        </button>
      </div>
    </section>
  );
}
