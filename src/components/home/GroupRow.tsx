"use client";

import { formatCurrency } from "@/lib/balance";
import { isSettled } from "@/lib/money";
import { Group } from "@/lib/types";
import { RowLink } from "@/components/kit/List";
import { GroupAvatar } from "@/components/kit/Tile";
import { SwipeRow } from "@/components/kit/SwipeRow";
import Skeleton from "@/components/ui/Skeleton";

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
 * One group in the home list. Purely presentational: balances and timestamps
 * are derived once by the home screen from the shared group-data cache.
 *
 * A real <Link> (via RowLink), so /groups/[id] — the heaviest route — is
 * prefetched before the tap. Archive/Restore is a trailing swipe action here;
 * the same action lives in the group's own menu for anyone who doesn't swipe.
 */
export default function GroupRow({
  group,
  net,
  loaded,
  lastActivityTs,
  pendingCount = 0,
  href,
  action,
}: {
  group: Group;
  net: number;
  loaded: boolean;
  lastActivityTs: number;
  pendingCount?: number;
  href: string;
  action?: { label: string; ariaLabel: string; onClick: () => void };
}) {
  const settled = isSettled(net);
  const members = group.memberIds.length;

  const trailing = !loaded ? (
    <span className="flex flex-col items-end gap-1.5" aria-label="Loading balance">
      <Skeleton className="h-3 w-12 rounded-md" />
      <Skeleton className="h-4 w-16 rounded-md" />
    </span>
  ) : settled ? (
    <span className="t-subhead shrink-0 text-label-2">Settled</span>
  ) : (
    <span className="flex shrink-0 flex-col items-end">
      <span className="t-caption text-label-2">{net > 0 ? "you're owed" : "you owe"}</span>
      <span className={`num t-headline ${net > 0 ? "text-pos" : "text-neg"}`}>
        {formatCurrency(Math.abs(net))}
      </span>
    </span>
  );

  const subtitle = (
    <>
      {members} member{members !== 1 ? "s" : ""} · {timeAgo(lastActivityTs)}
      {pendingCount > 0 && (
        <span className="font-medium text-warn"> · {pendingCount} to approve</span>
      )}
    </>
  );

  const row = (
    <RowLink
      href={href}
      inset={72}
      tall
      leading={<GroupAvatar id={group.id} name={group.name} photoURL={group.photoURL} size={44} />}
      title={group.name}
      titleClassName="font-semibold"
      subtitle={subtitle}
      trailing={trailing}
    />
  );

  if (!action) return row;
  return (
    <SwipeRow
      inset={72}
      actions={[
        {
          label: action.label,
          icon: action.label === "Restore" ? "archivebox.up" : "archivebox",
          color: "var(--indigo)",
          removesRow: true,
          onAction: action.onClick,
        },
      ]}
    >
      {row}
    </SwipeRow>
  );
}
