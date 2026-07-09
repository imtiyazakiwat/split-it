"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { subscribeToUserGroups, updateSettlementStatus } from "@/lib/firestore";
import { Group, Settlement } from "@/lib/types";
import LoginScreen from "@/components/LoginScreen";
import NotificationFeeder, { NotificationItem } from "@/components/notifications/NotificationFeeder";

function dateBucket(ts: number): string {
  const now = new Date();
  const d = new Date(ts);
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function timeLabel(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
}

function KindIcon({ kind }: { kind: NotificationItem["kind"] }) {
  if (kind === "request")
    return (
      <span className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
      </span>
    );
  if (kind === "status")
    return (
      <span className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center shrink-0">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" /><path d="m8.5 12 2.5 2.5 4.5-5" />
        </svg>
      </span>
    );
  return (
    <span className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center shrink-0">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4f46e5" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z" /><path d="M9 8h6M9 12h6" />
      </svg>
    </span>
  );
}

export default function NotificationsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [groups, setGroups] = useState<Group[]>([]);
  const [itemsByGroup, setItemsByGroup] = useState<Record<string, NotificationItem[]>>({});
  const [seenAt] = useState<number>(() => {
    if (typeof window === "undefined") return 0;
    return Number(localStorage.getItem("splitit-notif-seen") || 0);
  });

  useEffect(() => {
    if (!user) return;
    return subscribeToUserGroups(user.uid, setGroups);
  }, [user]);

  const handleItems = useCallback((groupId: string, items: NotificationItem[]) => {
    setItemsByGroup((prev) => ({ ...prev, [groupId]: items }));
  }, []);

  const groupIds = new Set(groups.map((g) => g.id));
  const allItems = Object.entries(itemsByGroup)
    .filter(([gid]) => groupIds.has(gid))
    .flatMap(([, items]) => items)
    .sort((a, b) => b.ts - a.ts);

  useEffect(() => {
    if (allItems.length === 0 || typeof window === "undefined") return;
    const maxTs = allItems.reduce((m, i) => Math.max(m, i.ts), 0);
    localStorage.setItem("splitit-notif-seen", String(maxTs));
  }, [allItems]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-[var(--label-tertiary)]">Loading…</p>
      </div>
    );
  }
  if (!user) return <LoginScreen />;

  function handleApprove(s: Settlement) {
    updateSettlementStatus(s.groupId, s.id, "approved");
  }
  function handleReject(s: Settlement) {
    updateSettlementStatus(s.groupId, s.id, "rejected");
  }

  const rows = allItems.map((item, i) => {
    const bucket = dateBucket(item.ts);
    const prevBucket = i > 0 ? dateBucket(allItems[i - 1].ts) : null;
    return { item, bucket, showBucket: bucket !== prevBucket, unread: item.ts > seenAt };
  });

  return (
    <div className="flex-1 flex flex-col bg-[var(--background)] min-h-full">
      {groups.map((g) => (
        <NotificationFeeder key={g.id} group={g} currentUid={user.uid} onItems={handleItems} />
      ))}

      <header className="max-w-md w-full mx-auto px-4 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={() => router.push("/")}
            aria-label="Back"
            className="w-11 h-11 rounded-2xl bg-white shadow-[0_2px_10px_-2px_rgba(0,0,0,0.12)] flex items-center justify-center tap-shrink"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
          </button>
          <h1 className="text-[24px] font-extrabold text-slate-800">Notifications</h1>
        </div>
      </header>

      <main className="flex-1 max-w-md w-full mx-auto px-4 pt-4 pb-10 scroll-momentum">
        {allItems.length === 0 ? (
          <div className="text-center py-24">
            <div className="w-16 h-16 rounded-full bg-indigo-50 flex items-center justify-center mx-auto mb-3">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#4f46e5" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" />
              </svg>
            </div>
            <p className="text-[16px] font-semibold text-slate-700">You&rsquo;re all caught up</p>
            <p className="text-[13px] text-slate-400 mt-1">Payment requests and new expenses will show up here.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {rows.map(({ item, bucket, showBucket, unread }) => (
              <div key={item.key}>
                {showBucket && (
                  <p className="text-[12px] font-semibold text-slate-400 mb-2 mt-2">{bucket}</p>
                )}
                <div
                  onClick={() => router.push(`/groups/${item.groupId}`)}
                  className={`flex items-start gap-3 rounded-[18px] p-3.5 cursor-pointer tap-shrink ${
                    unread ? "bg-indigo-50/60" : "bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)]"
                  }`}
                >
                  <KindIcon kind={item.kind} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[15px] text-slate-800 leading-snug">{item.title}</p>
                    <p className="text-[13px] text-slate-400 mt-0.5 truncate">{item.subtitle}</p>
                    {item.kind === "request" && item.settlement && (
                      <div className="flex gap-2 mt-2">
                        <button
                          onClick={(ev) => { ev.stopPropagation(); handleApprove(item.settlement!); }}
                          className="rounded-full bg-indigo-600 text-white px-3.5 py-1.5 text-[13px] font-medium tap-shrink"
                        >
                          Approve
                        </button>
                        <button
                          onClick={(ev) => { ev.stopPropagation(); handleReject(item.settlement!); }}
                          className="rounded-full bg-slate-100 text-slate-600 px-3.5 py-1.5 text-[13px] font-medium tap-shrink"
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className="text-[12px] text-slate-400">{timeLabel(item.ts)}</span>
                    {unread && <span className="w-2 h-2 rounded-full bg-indigo-500" />}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
