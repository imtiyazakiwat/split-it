"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import NotificationPrompt from "@/components/home/NotificationPrompt";
import { useAuth } from "@/lib/auth-context";
import { useGroupData } from "@/lib/group-data-context";
// Write functions are dynamically imported at the point of use, not here: this is
// the entry route, and a static import puts the 641 kB Firestore chunk in front of
// first interaction for the sake of three handlers the user may never trigger.
import {
  canRespondToSettlement,
  computeBalances,
  formatCurrency,
} from "@/lib/balance";
import { isSettled } from "@/lib/money";
import { computeCounterpartyBalances } from "@/lib/global-balance";
import { usePayments } from "@/lib/payments-context";
import {
  archivedAtFor,
  classifyGroup,
  countByTab,
  GROUP_TABS,
  GroupTab,
  isArchivedFor,
} from "@/lib/group-filters";
import LoginScreen from "@/components/LoginScreen";
import GlassModal from "@/components/ui/GlassModal";
import GroupRow from "@/components/home/GroupRow";
import HomeSkeleton from "@/components/home/HomeSkeleton";
import Skeleton from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import Screen, { BarButton } from "@/components/ui/Screen";
import { LinkRow, ListSection, Row, SwipeRow } from "@/components/ui/List";
import { Avatar, EmptyState, SearchField, Segmented } from "@/components/ui/Controls";
import Menu from "@/components/ui/Menu";
import { Archive, Bell, Ellipsis, People, PersonAdd, Plus } from "@/components/ui/Icons";

function todayLine(): string {
  return new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });
}

const noopSubscribe = () => () => {};
/** Today's date, computed on the client only (the page is prerendered at build time). */
function useTodayLine(): string {
  return useSyncExternalStore(noopSubscribe, todayLine, () => "");
}

export default function Home() {
  const { user, loading } = useAuth();
  const router = useRouter();
  // `allLoaded` deliberately not consumed here any more: gating this screen on
  // every group having reported was the cause of the blanked hero and the
  // unresponsive people rows. Progress is now tracked per group below.
  const { groups, groupsLoaded, byGroup, datasets, error } = useGroupData();
  const { transfers } = usePayments();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"recent" | "name">("recent");
  const [tab, setTab] = useState<GroupTab>("active");
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const showToast = useToast();
  const today = useTodayLine();
  const uid = user?.uid;

  /**
   * Per-group figures, derived once from the shared cache. Each row used to
   * open its own listeners and report balances back up via a callback, which
   * meant the summary could sit on stale or partial numbers.
   */
  const rows = useMemo(() => {
    if (!uid) return [];
    return groups.map((group) => {
      const data = byGroup[group.id];
      const expenses = data?.expenses || [];
      const settlements = data?.settlements || [];
      const balances = computeBalances(group.memberIds, expenses, settlements);
      const net = balances.find((b) => b.uid === uid)?.netAmount ?? 0;
      const lastActivityTs = Math.max(
        group.createdAt || 0,
        ...expenses.map((e) => e.updatedAt || e.createdAt),
        ...settlements.map((s) => s.updatedAt || s.createdAt)
      );
      return {
        group,
        net,
        loaded: !!data?.loaded,
        lastActivityTs,
        pendingCount: settlements.filter((s) => canRespondToSettlement(s, uid)).length,
        hasActivity: expenses.length > 0 || settlements.length > 0,
      };
    });
  }, [groups, byGroup, uid]);

  const tabCounts = useMemo(() => (uid ? countByTab(rows, uid) : { active: 0, settled: 0, archived: 0 }), [rows, uid]);

  const counterparties = useMemo(
    () => (uid ? computeCounterpartyBalances(uid, datasets, transfers) : []),
    [uid, datasets, transfers]
  );

  if (loading || (!groupsLoaded && user)) {
    return <HomeSkeleton />;
  }

  if (!user) return <LoginScreen />;

  const currentUser = user;

  async function handleCreateGroup(e: React.FormEvent) {
    e.preventDefault();
    if (!groupName.trim()) return;
    setBusy(true);
    setFormError("");
    try {
      const { createGroup } = await import("@/lib/firestore");
      const id = await createGroup(groupName.trim(), currentUser.uid, {
        displayName: currentUser.displayName || currentUser.email || "User",
        email: (currentUser.email || "").toLowerCase(),
        photoURL: currentUser.photoURL || "",
      });
      setShowCreate(false);
      setGroupName("");
      showToast({ message: "Group created" });
      router.push(`/groups/${id}`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to create group");
    } finally {
      setBusy(false);
    }
  }

  async function handleJoinGroup(e: React.FormEvent) {
    e.preventDefault();
    if (!joinCode.trim()) return;
    setBusy(true);
    setFormError("");
    try {
      const { joinGroupByCode } = await import("@/lib/firestore");
      const id = await joinGroupByCode(joinCode.trim(), currentUser.uid, {
        displayName: currentUser.displayName || currentUser.email || "User",
        email: (currentUser.email || "").toLowerCase(),
        photoURL: currentUser.photoURL || "",
      });
      if (!id) {
        setFormError("No group found with that invite code.");
        return;
      }
      setShowJoin(false);
      setJoinCode("");
      showToast({ message: "Joined group" });
      router.push(`/groups/${id}`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to join group");
    } finally {
      setBusy(false);
    }
  }

  // Totals net across groups AND confirmed direct payments, so they agree with
  // "By person" below. Per-group rows stay group-only; direct lives in the
  // person totals.
  const totalOwe = counterparties.reduce((s, c) => s + (c.net > 0 ? c.net : 0), 0);
  const totalReceive = counterparties.reduce((s, c) => s + (c.net < 0 ? -c.net : 0), 0);
  const actionableCount = rows.reduce((s, r) => s + r.pendingCount, 0);

  /**
   * Two different states, previously conflated into one.
   *
   * The original gate was `groups.length > 0 && !allLoaded`, and `allLoaded`
   * requires *every* group's expenses AND settlements to have arrived — ten
   * snapshots for five groups. So one slow or failed listener blanked the
   * headline figure and disabled the entire people list indefinitely, which is
   * the worst of both worlds: a number the user already knew is replaced by a
   * skeleton, and rows they can see refuse to respond to a tap.
   *
   * Hiding a total computed from zero groups is right — that really is a
   * misleading ₹0. But a total from four groups out of five is a real number
   * that only needs a quiet note that it is still settling.
   */
  const loadedGroupCount = groups.filter((g) => byGroup[g.id]?.loaded).length;
  const noBalancesYet = groups.length > 0 && loadedGroupCount === 0;
  const balancesSettling = loadedGroupCount > 0 && loadedGroupCount < groups.length;

  const peopleToShow = counterparties.filter((c) => !isSettled(c.net));

  const needle = query.trim().toLowerCase();
  const sortedRows = rows
    .filter((r) => classifyGroup(r, currentUser.uid) === tab)
    .filter((r) => r.group.name.toLowerCase().includes(needle))
    .sort((a, b) =>
      sort === "name"
        ? a.group.name.localeCompare(b.group.name)
        : tab === "archived"
        ? // Most recently tidied away first, which is where a mistake will be.
          archivedAtFor(b.group, currentUser.uid) - archivedAtFor(a.group, currentUser.uid)
        : (b.lastActivityTs || b.group.createdAt) - (a.lastActivityTs || a.group.createdAt)
    );

  // Archiving is a view preference, never a write-off, so the totals above keep
  // counting archived groups. This surfaces the money that is sitting in a tab
  // the user isn't looking at, rather than letting it quietly disappear.
  const archivedOutstanding = rows
    .filter((r) => isArchivedFor(r.group, currentUser.uid) && !isSettled(r.net))
    .length;

  async function handleToggleArchive(groupId: string, archived: boolean) {
    try {
      const { setGroupArchived } = await import("@/lib/firestore");
      await setGroupArchived(groupId, currentUser.uid, archived);
      showToast({ message: archived ? "Group archived" : "Group restored" });
    } catch (err) {
      showToast({
        message: err instanceof Error ? `Couldn't update: ${err.message}` : "Couldn't update the group",
      });
    }
  }

  const emptyCopy = query
    ? { title: "No Results", message: `No groups match “${query}”.` }
    : tab === "archived"
    ? { title: "No Archived Groups", message: "Swipe left on a group to archive it. Archiving only tidies this list; balances still count." }
    : tab === "settled"
    ? { title: "Nothing Settled Yet", message: "Groups where everyone is square show up here." }
    : groups.length === 0
    ? { title: "No Groups", message: "Create a group for a trip, a flat or a dinner, or join one with an invite code." }
    : { title: "All Caught Up", message: "Nothing needs your attention. Settled groups are under Settled." };

  const openCreate = () => {
    setFormError("");
    setShowCreate(true);
  };
  const openJoin = () => {
    setFormError("");
    setShowJoin(true);
  };

  return (
    <Screen
      title="Groups"
      large
      subtitle={today || "\u00a0"}
      trailing={
        <>
          <BarButton
            onClick={() => router.push("/notifications")}
            aria-label={actionableCount > 0 ? `Notifications, ${actionableCount} needing action` : "Notifications"}
          >
            <Bell size={21} />
            {actionableCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[var(--red)] text-white text-[11px] font-semibold grid place-items-center">
                {actionableCount}
              </span>
            )}
          </BarButton>
          <Menu
            label="Group options"
            items={[
              { label: "Sort by Recent", checked: sort === "recent", onSelect: () => setSort("recent") },
              { label: "Sort by Name", checked: sort === "name", onSelect: () => setSort("name") },
            ]}
            trigger={(t) => (
              <BarButton {...t} aria-label="More">
                <Ellipsis size={21} />
              </BarButton>
            )}
          />
          <Menu
            label="Add"
            items={[
              { label: "New Group", icon: <People size={20} />, onSelect: openCreate },
              { label: "Join with Code", icon: <PersonAdd size={20} />, onSelect: openJoin },
            ]}
            trigger={(t) => (
              <BarButton {...t} prominent aria-label="Add group">
                <Plus size={21} />
              </BarButton>
            )}
          />
        </>
      }
    >
      {error && (
        <p className="mx-1 mb-3 t-footnote text-[var(--neg)]">
          Couldn&rsquo;t load the latest data. Showing what&rsquo;s saved on this iPhone.
        </p>
      )}

      {/* Summary: the one number that matters, then where it comes from. */}
      <div className="list-section px-4 pt-3.5 pb-4">
        {noBalancesYet ? (
          <div>
            <Skeleton className="h-4 w-20 rounded-md" />
            <Skeleton className="h-9 w-40 mt-2 rounded-lg" />
          </div>
        ) : !isSettled(totalOwe) ? (
          <div>
            <p className="t-subhead text-[var(--text-secondary)]">You owe</p>
            <p className="t-large-title t-numeral text-[var(--neg)] truncate">{formatCurrency(totalOwe)}</p>
            {!isSettled(totalReceive) && (
              <p className="t-subhead text-[var(--text-secondary)] mt-0.5">
                and you&rsquo;re owed <span className="font-semibold text-[var(--pos)]">{formatCurrency(totalReceive)}</span>
              </p>
            )}
          </div>
        ) : !isSettled(totalReceive) ? (
          <div>
            <p className="t-subhead text-[var(--text-secondary)]">You&rsquo;re owed</p>
            <p className="t-large-title t-numeral text-[var(--pos)] truncate">{formatCurrency(totalReceive)}</p>
            <p className="t-subhead text-[var(--text-secondary)] mt-0.5">Across all your groups</p>
          </div>
        ) : (
          <div>
            <p className="t-subhead text-[var(--text-secondary)]">Balance</p>
            <p className="t-title1 text-[var(--text-primary)]">All settled up</p>
            <p className="t-subhead text-[var(--text-secondary)] mt-0.5">No one owes anyone</p>
          </div>
        )}
        {balancesSettling && (
          <p role="status" className="mt-2 t-footnote text-[var(--text-secondary)]">
            Still adding up {groups.length - loadedGroupCount} of {groups.length} groups…
          </p>
        )}
      </div>

      <NotificationPrompt uid={currentUser.uid} hasGroups={groups.length > 0} />

      {peopleToShow.length > 0 && (
        <ListSection header="People" footer="Netted across every group you share, plus direct payments.">
          {peopleToShow.map((person) => {
            const iOweNet = person.net > 0;
            const hasDirect = !isSettled(person.directNet || 0);
            const sub =
              person.groups.length > 0
                ? person.groups.map((g) => g.groupName).join(", ") + (hasDirect ? " · direct" : "")
                : person.sharedGroupCount > 0
                ? `${person.sharedGroupCount} shared group${person.sharedGroupCount !== 1 ? "s" : ""}`
                : "Direct payment";
            return (
              <LinkRow
                key={person.uid}
                href={`/reports?person=${person.uid}`}
                leading={<Avatar name={person.displayName} photoURL={person.photoURL} size={36} seed={person.uid} uid={person.uid} />}
                separatorInset={64}
                title={person.displayName}
                subtitle={sub}
                detail={
                  <span className="flex flex-col items-end leading-tight">
                    <span className="t-caption text-[var(--text-secondary)]">{iOweNet ? "you owe" : "owes you"}</span>
                    <span className={`t-headline t-numeral ${iOweNet ? "text-[var(--neg)]" : "text-[var(--pos)]"}`}>
                      {formatCurrency(Math.abs(person.net))}
                    </span>
                  </span>
                }
              />
            );
          })}
        </ListSection>
      )}

      <section id="your-groups" className="mt-7 scroll-mt-24">
        <div className="list-header-prominent">Your Groups</div>
        {groups.length > 4 && (
          <SearchField value={query} onChange={setQuery} placeholder="Search" label="Search groups" className="mb-3" />
        )}
        <Segmented
          label="Show groups"
          value={tab}
          onChange={setTab}
          options={GROUP_TABS.map((t) => ({
            id: t.id,
            label: tabCounts[t.id] > 0 ? `${t.label} ${tabCounts[t.id]}` : t.label,
          }))}
        />
        {tab === "archived" && archivedOutstanding > 0 && (
          <p className="list-footer !px-1 !pt-2.5">
            {archivedOutstanding} archived group{archivedOutstanding !== 1 ? "s" : ""} still{" "}
            {archivedOutstanding !== 1 ? "have" : "has"} an open balance, still counted in your totals.
          </p>
        )}

        <div className="mt-3">
          {sortedRows.length === 0 ? (
            <EmptyState
              icon={<People size={56} weight={1.4} />}
              title={emptyCopy.title}
              message={emptyCopy.message}
              action={
                groups.length === 0 && !query ? (
                  <button onClick={openCreate} className="btn-prominent">
                    New Group
                  </button>
                ) : undefined
              }
            />
          ) : (
            <div className="list-section">
              {sortedRows.map((row) => (
                <SwipeRow
                  key={row.group.id}
                  actions={[
                    tab === "archived"
                      ? { label: "Restore", tone: "accent", onClick: () => handleToggleArchive(row.group.id, false) }
                      : { label: "Archive", tone: "neutral", onClick: () => handleToggleArchive(row.group.id, true) },
                  ]}
                >
                  <GroupRow
                    group={row.group}
                    net={row.net}
                    loaded={row.loaded}
                    lastActivityTs={row.lastActivityTs}
                    pendingCount={row.pendingCount}
                    href={`/groups/${row.group.id}`}
                  />
                </SwipeRow>
              ))}
            </div>
          )}
          {sortedRows.length > 0 && (
            <p className="list-footer flex items-center gap-1.5">
              <Archive size={14} />
              {tab === "archived" ? "Swipe left to restore a group." : "Swipe left to archive a group."}
            </p>
          )}
        </div>
      </section>

      {showCreate && (
        <GlassModal
          title="New Group"
          onClose={() => setShowCreate(false)}
          dirty={!!groupName.trim() && !busy}
          confirm={{ label: "Create", formId: "create-group", disabled: !groupName.trim(), busy, onConfirm: () => {} }}
        >
          <form id="create-group" onSubmit={handleCreateGroup} className="pt-2">
            <ListSection elevated footer="You can add a photo, a description and members after creating it.">
              <Row className="!py-0">
                <input
                  autoFocus
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder="Group Name"
                  aria-label="Group name"
                  enterKeyHint="done"
                  className="row-input py-[13px]"
                />
              </Row>
            </ListSection>
            {formError && <p className="list-footer !text-[var(--neg)]">{formError}</p>}
          </form>
        </GlassModal>
      )}

      {showJoin && (
        <GlassModal
          title="Join Group"
          onClose={() => setShowJoin(false)}
          dirty={!!joinCode.trim() && !busy}
          confirm={{ label: "Join", formId: "join-group", disabled: !joinCode.trim(), busy, onConfirm: () => {} }}
        >
          <form id="join-group" onSubmit={handleJoinGroup} className="pt-2">
            <ListSection elevated footer="Ask someone in the group for the six-character code, or open their invite link.">
              <Row className="!py-0">
                <input
                  autoFocus
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  placeholder="Invite Code"
                  aria-label="Invite code"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint="go"
                  className="row-input py-[13px] tracking-[0.18em] font-semibold"
                />
              </Row>
            </ListSection>
            {formError && <p className="list-footer !text-[var(--neg)]">{formError}</p>}
          </form>
        </GlassModal>
      )}
    </Screen>
  );
}
