"use client";

import { useRouter } from "next/navigation";

type Tab = "groups" | "pay" | "activity" | "reports" | "profile";

const INDIGO = "var(--brand)";

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

function ReportsIcon({ active }: { active: boolean }) {
  const stroke = active ? "var(--brand)" : "var(--label-secondary)";
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 4h16v16H4zM8 4v16M8 9h12M8 14h12" />
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

function PayIcon({ active }: { active: boolean }) {
  const stroke = active ? INDIGO : "currentColor";
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
      stroke={stroke} strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {/* Speech bubble with a rupee inside: the tab is a conversation about money. */}
      <path d="M21 11.5a8 8 0 0 1-8 8H8l-4 3v-4.6A8 8 0 0 1 13 3.5a8 8 0 0 1 8 8Z" />
      <path d="M10.5 8h4M10.5 10.5h4M10.5 8v6M10.5 10.5h1.2c1 0 1.8.5 1.8 1.3 0 .9-.8 1.4-1.8 1.4h-1.2l3.2 2.8" />
    </svg>
  );
}

export default function BottomNav({
  active,
  /** Small dot on the Pay tab: unseen messages, or money awaiting a decision. */
  payBadge = false,
}: {
  active: Tab;
  payBadge?: boolean;
}) {
  const router = useRouter();

  const items: { id: Tab; label: string; href: string; Icon: (p: { active: boolean }) => React.ReactElement }[] = [
    { id: "groups", label: "Groups", href: "/", Icon: GroupsIcon },
    { id: "pay", label: "Pay", href: "/pay", Icon: PayIcon },
    { id: "activity", label: "Activity", href: "/activity", Icon: ActivityIcon },
    { id: "reports", label: "Statements", href: "/reports", Icon: ReportsIcon },
    { id: "profile", label: "Settings", href: "/settings", Icon: ProfileIcon },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-20 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 pointer-events-none">
      <div className="pointer-events-auto max-w-md mx-auto glass-strong rounded-[var(--radius-xl)] px-2 py-2 flex items-center shadow-[var(--shadow-float)]">
        {items.map(({ id, label, href, Icon }) => {
          const isActive = id === active;
          return (
            <button
              key={id}
              onClick={() => router.push(href)}
              className={`flex-1 flex flex-col items-center gap-1 py-1.5 rounded-[var(--radius-inner)] tap-shrink ${
                isActive ? "bg-[var(--tint-accent)]" : ""
              }`}
            >
              <span className="relative">
                <Icon active={isActive} />
                {id === "pay" && payBadge && (
                  <span
                    className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-[var(--neg)] ring-2 ring-[var(--surface)]"
                    aria-label="Unread"
                  />
                )}
              </span>
              <span
                className={`text-[11px] font-medium ${
                  isActive ? "text-[var(--brand)]" : "text-[var(--label-secondary)]"
                }`}
              >
                {label}
              </span>
              <span
                className={`h-1 w-1 rounded-full ${isActive ? "bg-[var(--brand)]" : "bg-transparent"}`}
              />
            </button>
          );
        })}
      </div>
    </nav>
  );
}
