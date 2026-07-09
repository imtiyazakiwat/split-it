"use client";

import { useRouter } from "next/navigation";

type Tab = "groups" | "activity" | "profile";

const INDIGO = "#4f46e5";

function GroupsIcon({ active }: { active: boolean }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
      stroke={active ? INDIGO : "currentColor"} strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function ActivityIcon({ active }: { active: boolean }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
      stroke={active ? INDIGO : "currentColor"} strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function ProfileIcon({ active }: { active: boolean }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
      stroke={active ? INDIGO : "currentColor"} strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

export default function BottomNav({ active }: { active: Tab }) {
  const router = useRouter();

  const items: { id: Tab; label: string; href: string; Icon: (p: { active: boolean }) => React.ReactElement }[] = [
    { id: "groups", label: "Groups", href: "/", Icon: GroupsIcon },
    { id: "activity", label: "Activity", href: "/", Icon: ActivityIcon },
    { id: "profile", label: "Profile", href: "/settings", Icon: ProfileIcon },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-20 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 pointer-events-none">
      <div className="pointer-events-auto max-w-md mx-auto glass-strong rounded-[26px] px-2 py-2 flex items-center shadow-[0_8px_30px_-8px_rgba(0,0,0,0.18)]">
        {items.map(({ id, label, href, Icon }) => {
          const isActive = id === active;
          return (
            <button
              key={id}
              onClick={() => router.push(href)}
              className={`flex-1 flex flex-col items-center gap-1 py-1.5 rounded-[18px] tap-shrink ${
                isActive ? "bg-indigo-50" : ""
              }`}
            >
              <Icon active={isActive} />
              <span
                className={`text-[11px] font-medium ${
                  isActive ? "text-indigo-600" : "text-[var(--label-secondary)]"
                }`}
              >
                {label}
              </span>
              <span
                className={`h-1 w-1 rounded-full ${isActive ? "bg-indigo-600" : "bg-transparent"}`}
              />
            </button>
          );
        })}
      </div>
    </nav>
  );
}
