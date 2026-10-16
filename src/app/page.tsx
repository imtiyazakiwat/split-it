"use client";

import { useMemo, useRef, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useGroupData } from "@/lib/group-data-context";
// Write functions are dynamically imported at the point of use, not here: this
// is the entry route, and a static import puts the 641 kB Firestore chunk in
// front of first interaction for three handlers the user may never trigger.
import { canRespondToSettlement, computeBalances, formatCurrency } from "@/lib/balance";
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
import GroupRow from "@/components/home/GroupRow";
import HomeSkeleton from "@/components/home/HomeSkeleton";
import Skeleton from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import Screen from "@/components/kit/Screen";
import { BarButton, BarLink } from "@/components/kit/BarButton";
import { Menu } from "@/components/kit/Menu";
import { List, RowButton, RowLink, Section, Card } from "@/components/kit/List";
import { Avatar } from "@/components/kit/Avatar";
import { IconTile } from "@/components/kit/Tile";
import { EmptyState, FieldRow, SearchField, Segmented, Button } from "@/components/kit/Controls";
import { Sheet, SheetIconButton, type SheetHandle } from "@/components/kit/Sheet";
import { Icon } from "@/components/kit/Icon";
import { useNav } from "@/components/kit/nav";

export default function Home() {
  const { user, loading } = useAuth();
  const nav = useNav();
  // `allLoaded` deliberately not consumed: gating this screen on every group
  // having reported blanked the totals and deadened the people rows. Progress
  // is tracked per group below.
  const { groups, groupsLoaded, byGroup, datasets, error } = useGroupData();
  const { transfers } = usePayments();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"recent" | "name">("recent");
  const [tab, setTab] = useState<GroupTab>("active");
  const [sheet, setSheet] = useState<"create" | "join" | null>(null);
  const [groupName, setGroupName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const sheetRef = useRef<SheetHandle>(null);
  const showToast = useToast();
  const uid = user?.uid;

  /** Per-group figures, derived once from the shared cache. */
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

  const tabCounts = useMemo(
    () => (uid ? countByTab(rows, uid) : { active: 0, settled: 0, archived: 0 }),
    [rows, uid]
  );

  const counterparties = useMemo(
    () => (uid ? computeCounterpartyBalances(uid, datasets, transfers) : []),
    [uid, datasets, transfers]
  );

  if (loading || (!groupsLoaded && user)) return <HomeSkeleton />;
  if (!user) return <LoginScreen />;

  const currentUser = user;
  const member = {
    displayName: currentUser.displayName || currentUser.email || "User",
    email: (currentUser.email || "").toLowerCase(),
    photoURL: currentUser.photoURL || "",
  };

  function openSheet(which: "create" | "join") {
    setFormError("");
    setSheet(which);
  }

  async function handleCreateGroup(e?: React.FormEvent) {
    e?.preventDefault();
    if (!groupName.trim() || busy) return;
    setBusy(true);
    setFormError("");
    try {
      const { createGroup } = await import("@/lib/firestore");
      const id = await createGroup(groupName.trim(), currentUser.uid, member);
      setGroupName("");
      showToast({ message: "Group created" });
      sheetRef.current?.dismiss();
      nav.push(`/groups/${id}`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to create group");
    } finally {
      setBusy(false);
    }
  }

  async function handleJoinGroup(e?: React.FormEvent) {
    e?.preventDefault();
    if (!joinCode.trim() || busy) return;
    setBusy(true);
    setFormError("");
    try {
      const { joinGroupByCode } = await import("@/lib/firestore");
      const id = await joinGroupByCode(joinCode.trim(), currentUser.uid, member);
      if (!id) {
        setFormError("No group found with that invite code.");
        return;
      }
      setJoinCode("");
      showToast({ message: "Joined group" });
      sheetRef.current?.dismiss();
      nav.push(`/groups/${id}`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to join group");
    } finally {
      setBusy(false);
    }
  }

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

  // Totals net across groups AND confirmed direct payments, so they agree with
  // the people list below.
  const owePeople = counterparties.filter((c) => !isSettled(c.net) && c.net > 0);
  const owedPeople = counterparties.filter((c) => !isSettled(c.net) && c.net < 0);
  const totalOwe = counterparties.reduce((s, c) => s + (c.net > 0 ? c.net : 0), 0);
  const totalReceive = counterparties.reduce((s, c) => s + (c.net < 0 ? -c.net : 0), 0);
  const actionableCount = rows.reduce((s, r) => s + r.pendingCount, 0);

  // Hiding a total computed from zero groups is right — that's a misleading
  // ₹0. A total from four groups of five is real and only needs a note.
  const loadedGroupCount = groups.filter((g) => byGroup[g.id]?.loaded).length;
  const noBalancesYet = groups.length > 0 && loadedGroupCount === 0;
  const balancesSettling = loadedGroupCount > 0 && loadedGroupCount < groups.length;
  const allSquare = isSettled(totalOwe) && isSettled(totalReceive);

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

  // Archiving is a view preference, never a write-off: totals keep counting
  // archived groups. Say so when money is sitting in a tab out of sight.
  const archivedOutstanding = rows.filter(
    (r) => isArchivedFor(r.group, currentUser.uid) && !isSettled(r.net)
  ).length;

  const emptyState = query ? (
    <EmptyState compact icon="magnifyingglass" title="No Results" message={`No groups match “${query}”.`} />
  ) : tab === "archived" ? (
    <EmptyState compact icon="archivebox" title="Nothing Archived" message="Swipe a group to archive it. It moves here without changing any balance." />
  ) : tab === "settled" ? (
    <EmptyState compact icon="checkmark.circle" title="No Settled Groups" message="Groups where everyone is square land here." />
  ) : groups.length === 0 ? (
    <EmptyState
      icon="person.2"
      title="No Groups Yet"
      message="Create a group for a trip, a flat or a team, or join one with an invite code."
      action={
        <Button size="md" icon="plus" onClick={() => openSheet("create")}>
          New Group
        </Button>
      }
    />
  ) : (
    <EmptyState compact icon="checkmark.circle" title="Nothing Needs Attention" message="All your groups are settled. They're in the Settled tab." />
  );

  return (
    <Screen
      title="Groups"
      large
      tabBar
      trailing={
        <>
          <BarLink
            href="/notifications"
            icon="bell"
            label="Notifications"
            badge={actionableCount}
          />
          <Menu
            items={[
              { label: "New Group", icon: "plus", onSelect: () => openSheet("create") },
              { label: "Join with Code", icon: "qrcode", onSelect: () => openSheet("join") },
            ]}
          >
            {(props) => <BarButton icon="plus" label="Add group" {...props} />}
          </Menu>
        </>
      }
    >
      {error && (
        <Card className="mb-3 flex items-start gap-3 p-4">
          <span className="mt-0.5 text-[var(--orange)]">
            <Icon name="exclamationmark.triangle" size={20} />
          </span>
          <p className="t-footnote text-label-2">
            Couldn&rsquo;t load the latest data ({error}). Showing what&rsquo;s saved on this device.
          </p>
        </Card>
      )}

      {/* Balance summary — answers "what needs my attention?" first. */}
      <Card className="mt-1 p-4" style={{ minHeight: 104 }}>
        {noBalancesYet ? (
          <div className="grid grid-cols-2" aria-label="Loading balances">
            {[0, 1].map((i) => (
              <div key={i} className={i ? "border-l-[0.5px] border-[var(--separator)] pl-4" : "pr-4"}>
                <Skeleton className="h-3 w-14 rounded-md" />
                <Skeleton className="mt-2 h-7 w-24 rounded-lg" />
              </div>
            ))}
          </div>
        ) : groups.length > 0 && allSquare ? (
          <div className="flex items-center gap-3 py-1">
            <IconTile icon="checkmark" color="var(--green)" size="lg" />
            <div className="min-w-0">
              <p className="t-headline">All settled up</p>
              <p className="t-subhead text-label-2">No outstanding balances in any group.</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2">
            <div className="min-w-0 pr-4">
              <p className="t-footnote font-medium uppercase text-label-2">You owe</p>
              <p className={`num t-title1 mt-0.5 truncate ${isSettled(totalOwe) ? "text-label-3" : "text-neg"}`}>
                {formatCurrency(totalOwe)}
              </p>
              <p className="t-footnote mt-0.5 text-label-2">
                {owePeople.length === 0
                  ? "Nothing to pay"
                  : `${owePeople.length} ${owePeople.length === 1 ? "person" : "people"}`}
              </p>
            </div>
            <div className="min-w-0 border-l-[0.5px] border-[var(--separator)] pl-4">
              <p className="t-footnote font-medium uppercase text-label-2">You&rsquo;re owed</p>
              <p className={`num t-title1 mt-0.5 truncate ${isSettled(totalReceive) ? "text-label-3" : "text-pos"}`}>
                {formatCurrency(totalReceive)}
              </p>
              <p className="t-footnote mt-0.5 text-label-2">
                {owedPeople.length === 0
                  ? "Nobody owes you"
                  : `${owedPeople.length} ${owedPeople.length === 1 ? "person" : "people"}`}
              </p>
            </div>
          </div>
        )}
        {balancesSettling && (
          <p role="status" className="t-footnote mt-3 flex items-center gap-1.5 text-label-2">
            <span aria-hidden className="dot animate-pulse bg-[var(--tint)]" style={{ width: 6, height: 6 }} />
            Still adding up {groups.length - loadedGroupCount} of {groups.length} groups
          </p>
        )}
      </Card>

      {/* People with an open balance, netted across groups + direct payments. */}
      {peopleToShow.length > 0 && (
        <Section
          header="People"
          footer="Netted across every group you share, plus direct payments. Tap for the full statement."
        >
          <List>
            {peopleToShow.map((person) => {
              const iOwe = person.net > 0;
              const hasDirect = !isSettled(person.directNet || 0);
              const sub =
                person.groups.length > 0
                  ? person.groups.map((g) => g.groupName).join(" · ") +
                    (hasDirect ? ` · ${formatCurrency(Math.abs(person.directNet))} direct` : "")
                  : person.sharedGroupCount > 0
                  ? `${person.sharedGroupCount} shared group${person.sharedGroupCount !== 1 ? "s" : ""}` +
                    (hasDirect ? ` · ${formatCurrency(Math.abs(person.directNet))} direct` : "")
                  : "Direct payment";
              return (
                <RowLink
                  key={person.uid}
                  href={`/reports?person=${person.uid}`}
                  inset="avatar"
                  leading={<Avatar name={person.displayName} photoURL={person.photoURL} size={40} />}
                  title={person.displayName}
                  subtitle={sub}
                  trailing={
                    <span className="flex shrink-0 flex-col items-end">
                      <span className="t-caption text-label-2">{iOwe ? "you owe" : "owes you"}</span>
                      <span className={`num t-headline ${iOwe ? "text-neg" : "text-pos"}`}>
                        {formatCurrency(Math.abs(person.net))}
                      </span>
                    </span>
                  }
                />
              );
            })}
          </List>
        </Section>
      )}

      {/* Groups */}
      <Section
        header="Your Groups"
        headerAction={
          <Menu
            align="end"
            title="Sort by"
            items={[
              { label: "Recent Activity", checked: sort === "recent", onSelect: () => setSort("recent") },
              { label: "Name", checked: sort === "name", onSelect: () => setSort("name") },
            ]}
          >
            {(props) => (
              <button
                type="button"
                {...props}
                className="inline-flex min-h-[32px] items-center gap-1 text-[15px] text-tint"
                aria-label={`Sorted by ${sort === "recent" ? "recent activity" : "name"}. Change sort.`}
              >
                {sort === "recent" ? "Recent" : "Name"}
                <Icon name="chevron.up.down" size={14} strokeWidth={2.2} />
              </button>
            )}
          </Menu>
        }
      >
        {groups.length > 0 && (
          <div className="mb-3 space-y-3">
            <SearchField value={query} onChange={setQuery} placeholder="Search groups" label="Search groups" />
            <Segmented
              label="Show groups"
              value={tab}
              onChange={setTab}
              options={GROUP_TABS.map((t) => ({ id: t.id, label: t.label, count: tabCounts[t.id] }))}
            />
          </div>
        )}
        {sortedRows.length === 0 ? (
          <Card>{emptyState}</Card>
        ) : (
          <List>
            {sortedRows.map((row) => (
              <GroupRow
                key={row.group.id}
                group={row.group}
                net={row.net}
                loaded={row.loaded}
                lastActivityTs={row.lastActivityTs}
                pendingCount={row.pendingCount}
                href={`/groups/${row.group.id}`}
                action={
                  tab === "archived"
                    ? {
                        label: "Restore",
                        ariaLabel: `Restore ${row.group.name} to your active groups`,
                        onClick: () => handleToggleArchive(row.group.id, false),
                      }
                    : {
                        label: "Archive",
                        ariaLabel: `Archive ${row.group.name}`,
                        onClick: () => handleToggleArchive(row.group.id, true),
                      }
                }
              />
            ))}
          </List>
        )}
        {tab === "archived" && archivedOutstanding > 0 && (
          <p className="section-footer text-warn">
            {archivedOutstanding} archived group{archivedOutstanding !== 1 ? "s" : ""} still
            {archivedOutstanding !== 1 ? " have" : " has"} an open balance. Archiving only tidies
            this list — they still count in your totals.
          </p>
        )}
        {tab !== "archived" && sortedRows.length > 0 && (
          <p className="section-footer">Swipe left on a group to archive it.</p>
        )}
      </Section>

      {tab === "active" && tabCounts.settled > 0 && (
        <Section>
          <List>
            <RowButton
              onClick={() => setTab("settled")}
              leading={<IconTile icon="checkmark" color="var(--green)" />}
              title={`${tabCounts.settled} settled group${tabCounts.settled !== 1 ? "s" : ""}`}
              subtitle="Everyone's square. Review or archive them."
              chevron
            />
          </List>
        </Section>
      )}

      {sheet === "create" && (
        <Sheet
          ref={sheetRef}
          title="New Group"
          dirty={!!groupName.trim() && !busy}
          onClose={() => {
            setSheet(null);
            setGroupName("");
          }}
          trailing={
            <SheetIconButton
              icon="checkmark"
              label="Create group"
              prominent
              disabled={!groupName.trim() || busy}
              onClick={() => void handleCreateGroup()}
            />
          }
        >
          <form onSubmit={handleCreateGroup}>
            <List>
              <FieldRow
                autoFocus
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="Group name"
                aria-label="Group name"
                enterKeyHint="done"
                maxLength={60}
              />
            </List>
            <p className="section-footer">A trip, a flat, a team — anything you split costs for.</p>
            {formError && <p className="t-footnote mt-3 px-4 text-neg">{formError}</p>}
            <button type="submit" hidden aria-hidden tabIndex={-1} />
          </form>
        </Sheet>
      )}

      {sheet === "join" && (
        <Sheet
          ref={sheetRef}
          title="Join a Group"
          dirty={!!joinCode.trim() && !busy}
          onClose={() => {
            setSheet(null);
            setJoinCode("");
          }}
          trailing={
            <SheetIconButton
              icon="checkmark"
              label="Join group"
              prominent
              disabled={!joinCode.trim() || busy}
              onClick={() => void handleJoinGroup()}
            />
          }
        >
          <form onSubmit={handleJoinGroup}>
            <List>
              <FieldRow
                autoFocus
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                placeholder="Invite code"
                aria-label="Invite code"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="go"
                inputClassName="font-semibold uppercase tracking-[0.2em]"
              />
            </List>
            <p className="section-footer">
              Ask any member for the 6-character code, or scan the QR code on their phone.
            </p>
            {formError && <p className="t-footnote mt-3 px-4 text-neg">{formError}</p>}
            <button type="submit" hidden aria-hidden tabIndex={-1} />
          </form>
        </Sheet>
      )}
    </Screen>
  );
}
