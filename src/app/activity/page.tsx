"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { subscribeToUserGroups } from "@/lib/firestore";
import { Group } from "@/lib/types";
import LoginScreen from "@/components/LoginScreen";
import BottomNav from "@/components/home/BottomNav";
import GroupActivityFeeder, { GlobalActivityItem } from "@/components/activity/GroupActivityFeeder";

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

export default function ActivityPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [groups, setGroups] = useState<Group[]>([]);
  const [itemsByGroup, setItemsByGroup] = useState<Record<string, GlobalActivityItem[]>>({});

  useEffect(() => {
    if (!user) return;
    return subscribeToUserGroups(user.uid, setGroups);
  }, [user]);

  const handleItems = useCallback((groupId: string, items: GlobalActivityItem[]) => {
    setItemsByGroup((prev) => ({ ...prev, [groupId]: items }));
  }, []);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-[var(--label-tertiary)]">Loading…</p>
      </div>
    );
  }
  if (!user) return <LoginScreen />;

  const groupIds = new Set(groups.map((g) => g.id));
  const allItems = Object.entries(itemsByGroup)
    .filter(([gid]) => groupIds.has(gid))
    .flatMap(([, items]) => items)
    .sort((a, b) => b.ts - a.ts);

  const rows = allItems.map((item, i) => {
    const bucket = dateBucket(item.ts);
    const prevBucket = i > 0 ? dateBucket(allItems[i - 1].ts) : null;
    return { item, bucket, showBucket: bucket !== prevBucket };
  });

  return (
    <div className="flex-1 flex flex-col bg-[var(--background)] min-h-full">
      {groups.map((g) => (
        <GroupActivityFeeder key={g.id} group={g} currentUid={user.uid} onItems={handleItems} />
      ))}

      <main className="flex-1 max-w-md w-full mx-auto px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-32 scroll-momentum">
        <div className="flex items-center justify-between pt-3">
          <h1 className="text-[30px] font-extrabold text-slate-800">Activity</h1>
          <button
            onClick={() => router.push("/settings")}
            aria-label="Settings"
            className="w-11 h-11 rounded-2xl bg-white shadow-[0_2px_10px_-2px_rgba(0,0,0,0.12)] flex items-center justify-center tap-shrink"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="1.8">
              <path d="M12 15a3 3 0 100-6 3 3 0 000 6z" />
              <path d="M19.4 13a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V19a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H4a2 2 0 110-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33h0a1.65 1.65 0 001-1.51V4a2 2 0 114 0v.09a1.65 1.65 0 001 1.51h0a1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82v0a1.65 1.65 0 001.51 1H20a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" />
            </svg>
          </button>
        </div>
        <p className="text-[15px] text-slate-400 mt-1 mb-4">Everything happening across your groups</p>

        {allItems.length === 0 ? (
          <p className="text-center text-slate-400 text-sm py-20">No activity yet.</p>
        ) : (
          <div className="relative">
            <div className="absolute left-[18px] top-2 bottom-2 w-px bg-slate-200" aria-hidden />
            <div className="space-y-1">
              {rows.map(({ item, bucket, showBucket }) => (
                <div key={item.key}>
                  {showBucket && (
                    <div className="relative z-[1] inline-block bg-[var(--background)] rounded-full px-2.5 py-0.5 my-1.5 ml-0.5">
                      <span className="text-[12px] font-medium text-slate-500">{bucket}</span>
                    </div>
                  )}
                  <button
                    onClick={() => router.push(`/groups/${item.groupId}`)}
                    className="w-full text-left relative flex items-start gap-3 py-1.5 tap-shrink"
                  >
                    <span className={`relative z-[1] w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${item.kind === "settlement" ? "bg-green-100" : "bg-indigo-100"}`}>
                      {item.kind === "settlement" ? (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="9" /><path d="m8.5 12 2.5 2.5 4.5-5" />
                        </svg>
                      ) : (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4f46e5" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z" /><path d="M9 8h6M9 12h6" />
                        </svg>
                      )}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[15px] text-slate-800">{item.title}</p>
                      <p className="text-[13px] text-slate-400 mt-0.5 truncate">{item.subtitle}</p>
                      <span className="inline-block mt-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                        {item.groupName}
                      </span>
                    </div>
                    <span className="text-[12px] text-slate-400 shrink-0">{timeLabel(item.ts)}</span>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      <BottomNav active="activity" />
    </div>
  );
}
