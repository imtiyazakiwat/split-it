"use client";

import { formatCurrency } from "@/lib/balance";
import { isSettled } from "@/lib/money";
import { Group } from "@/lib/types";
import Skeleton from "@/components/ui/Skeleton";

const THEMES = [
  { bg: "bg-indigo-100", ring: "ring-indigo-200" },
  { bg: "bg-emerald-100", ring: "ring-emerald-200" },
  { bg: "bg-amber-100", ring: "ring-amber-200" },
  { bg: "bg-sky-100", ring: "ring-sky-200" },
  { bg: "bg-rose-100", ring: "ring-rose-200" },
  { bg: "bg-violet-100", ring: "ring-violet-200" },
];

function emojiFor(name: string): string | null {
  const n = name.toLowerCase();
  if (/(trip|goa|travel|vacation|holiday|beach|tour)/.test(n)) return "🏝️";
  if (/(office|work|team|company)/.test(n)) return "💼";
  if (/(home|room|flat|house|mate|pg|hostel)/.test(n)) return "🏠";
  if (/(food|dinner|lunch|restaurant|cafe|eat|meal)/.test(n)) return "🍽️";
  if (/(party|birthday|celebrat)/.test(n)) return "🎉";
  if (/(car|cab|ride|fuel|petrol)/.test(n)) return "🚗";
  if (/(gym|sport|game|club)/.test(n)) return "🏋️";
  return null;
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

/**
 * Purely presentational. Balances and activity timestamps are now computed
 * once by the home page from the shared group-data cache instead of each row
 * opening its own pair of Firestore listeners.
 */
export default function GroupRow({
  group,
  index,
  net,
  loaded,
  lastActivityTs,
  pendingCount = 0,
  onOpen,
  action,
}: {
  group: Group;
  index: number;
  net: number;
  loaded: boolean;
  lastActivityTs: number;
  pendingCount?: number;
  onOpen: () => void;
  /**
   * Optional row-level action, e.g. Archive or Restore.
   *
   * The row used to be a single `<button>`, which left nowhere to put a second
   * control: nesting one button inside another is invalid HTML and screen
   * readers announce it unpredictably. The card is now a plain container with the
   * navigation button and this action as siblings.
   */
  action?: { label: string; ariaLabel: string; onClick: () => void };
}) {
  const theme = THEMES[index % THEMES.length];
  const emoji = emojiFor(group.name);
  const settled = isSettled(net);

  const memberPhotos = group.memberIds
    .slice(0, 3)
    .map((uid) => group.members[uid]?.photoURL)
    .filter(Boolean) as string[];
  const extra = group.memberIds.length - Math.min(group.memberIds.length, 3);

  return (
    <div className="bg-[var(--surface)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)]">
      <button
        onClick={onOpen}
        className="w-full text-left p-4 flex items-center gap-3.5 tap-shrink"
      >
          {/* Group icon */}
        {group.photoURL ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={group.photoURL} alt="" className="w-14 h-14 rounded-full object-cover shrink-0" />
        ) : (
          <div className={`w-14 h-14 rounded-full ${theme.bg} flex items-center justify-center shrink-0`}>
            {emoji ? (
              <span className="text-[26px] leading-none">{emoji}</span>
            ) : (
              <span className="text-[22px] font-semibold text-indigo-600">
                {group.name.charAt(0).toUpperCase()}
              </span>
            )}
          </div>
        )}

        {/* Name + members */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="text-[16px] font-semibold text-[var(--text-primary)] truncate">{group.name}</p>
            {pendingCount > 0 && (
              <span className="shrink-0 rounded-full bg-[var(--tint-warning)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--warning)]">
                {pendingCount}
              </span>
            )}
          </div>
          <p className="text-[13px] text-[var(--text-tertiary)] mt-0.5">
            {group.memberIds.length} member{group.memberIds.length !== 1 ? "s" : ""}
          </p>
          <div className="flex items-center mt-1.5">
            <div className="flex -space-x-2">
              {memberPhotos.map((url, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={i} src={url} alt="" className="w-6 h-6 rounded-full border-2 border-[var(--surface)] object-cover" />
              ))}
              {memberPhotos.length === 0 &&
                group.memberIds.slice(0, 3).map((uid) => (
                  <span
                    key={uid}
                    className="w-6 h-6 rounded-full border-2 border-[var(--surface)] bg-[var(--fill)] flex items-center justify-center text-[10px] font-medium text-[var(--text-secondary)]"
                  >
                    {(group.members[uid]?.displayName || "?").charAt(0).toUpperCase()}
                  </span>
                ))}
            </div>
            {extra > 0 && (
              <span className="ml-1 h-6 min-w-6 px-1.5 rounded-full bg-[var(--fill)] flex items-center justify-center text-[11px] font-medium text-[var(--text-secondary)]">
                +{extra}
              </span>
            )}
          </div>
        </div>

        {/* Right: amount + status */}
        <div className="flex items-center gap-2 shrink-0">
          {!loaded ? (
            <>
              <div className="text-right flex flex-col items-end gap-1.5">
                <Skeleton className="h-3 w-14 rounded-md" />
                <Skeleton className="h-4 w-12 rounded-md" />
              </div>
              <Skeleton className="w-9 h-9 rounded-full" />
            </>
          ) : (
            <>
              <div className="text-right">
                {settled ? (
                  <p className="text-[13px] font-medium text-[var(--text-tertiary)]">Settled up</p>
                ) : (
                  <>
                    <p className="text-[12px] text-[var(--text-tertiary)]">
                      {net > 0 ? "You will receive" : "You owe"}
                    </p>
                    <p className={`text-[16px] font-bold ${net > 0 ? "text-[var(--pos)]" : "text-[var(--neg)]"}`}>
                      {formatCurrency(Math.abs(net))}
                    </p>
                  </>
                )}
                <p className="flex items-center justify-end gap-1 text-[11px] text-[var(--text-tertiary)] mt-1">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {timeAgo(lastActivityTs)}
                </p>
              </div>
              {settled ? (
                <span className="w-9 h-9 rounded-full bg-[var(--tint-success)] text-[var(--pos)] flex items-center justify-center shrink-0">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                </span>
              ) : (
                <span className="w-9 h-9 rounded-full bg-[var(--fill-soft)] text-[var(--text-tertiary)] flex items-center justify-center shrink-0 shadow-[var(--shadow-sm)]">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                </span>
              )}
            </>
          )}
        </div>
      </button>
      {action && (
        <div className="px-4 pb-3 -mt-1">
          <button
            onClick={action.onClick}
            aria-label={action.ariaLabel}
            className="rounded-full bg-[var(--fill-soft)] px-3 py-1.5 text-[12px] font-semibold text-[var(--text-secondary)] tap-shrink"
          >
            {action.label}
          </button>
        </div>
      )}
    </div>
  );
}
