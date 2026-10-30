"use client";

import Link from "next/link";
import NavHint from "@/components/NavHint";
import { formatCurrency } from "@/lib/balance";
import { isSettled } from "@/lib/money";
import { Group } from "@/lib/types";
import Skeleton from "@/components/ui/Skeleton";
import { Avatar } from "@/components/ui/Controls";
import { ChevronRight } from "@/components/ui/Icons";

function timeAgo(ts: number): string {
  if (!ts) return "";
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return "Yesterday";
  if (d < 7) return new Date(ts).toLocaleDateString("en-IN", { weekday: "long" });
  return new Date(ts).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

/**
 * One row in the inset-grouped Groups list. One row = one tap target: the
 * whole row pushes the group. Archive/Restore moved to a swipe action (with
 * the same action in the group's info sheet as the non-gesture path).
 */
export default function GroupRow({
  group,
  net,
  loaded,
  lastActivityTs,
  pendingCount = 0,
  href,
}: {
  group: Group;
  net: number;
  loaded: boolean;
  lastActivityTs: number;
  pendingCount?: number;
  href: string;
}) {
  const settled = isSettled(net);
  const members = group.memberIds.length;

  return (
    <Link href={href} className="list-row is-tall" style={{ ["--sep-inset" as string]: "72px" }}>
      <NavHint />
      <span className="relative shrink-0">
        <Avatar name={group.name} photoURL={group.photoURL} size={44} seed={group.id} />
        {pendingCount > 0 && (
          <span
            className="absolute -top-1 -right-1 min-w-[20px] h-[20px] px-1 rounded-full bg-[var(--red)] text-white text-[12px] font-semibold grid place-items-center ring-2 ring-[var(--surface)]"
            aria-label={`${pendingCount} waiting for you`}
          >
            {pendingCount}
          </span>
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block t-headline text-[var(--text-primary)] truncate">{group.name}</span>
        <span className="block t-subhead text-[var(--text-secondary)] truncate mt-px">
          {members} {members === 1 ? "member" : "members"}
          {lastActivityTs ? ` · ${timeAgo(lastActivityTs)}` : ""}
        </span>
      </span>

      <span className="shrink-0 text-right">
        {!loaded ? (
          <span className="flex flex-col items-end gap-1.5">
            <Skeleton className="h-3 w-12 rounded-md" />
            <Skeleton className="h-4 w-16 rounded-md" />
          </span>
        ) : settled ? (
          <span className="t-subhead text-[var(--text-secondary)]">Settled up</span>
        ) : (
          <>
            <span className="block t-caption text-[var(--text-secondary)]">{net > 0 ? "you get back" : "you owe"}</span>
            <span className={`block t-headline t-numeral ${net > 0 ? "text-[var(--pos)]" : "text-[var(--neg)]"}`}>
              {formatCurrency(Math.abs(net))}
            </span>
          </>
        )}
      </span>
      <ChevronRight className="row-chevron -mr-1" />
    </Link>
  );
}
