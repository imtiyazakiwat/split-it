"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  ReactNode,
} from "react";
import { useAuth } from "./auth-context";
import {
  subscribeToUserGroups,
  subscribeToGroup,
  subscribeToExpenses,
  subscribeToSettlements,
} from "./firestore";
import { Expense, Group, Settlement } from "./types";
import { GroupDataset } from "./global-balance";

/**
 * One shared subscription layer for all of the user's group data.
 *
 * Previously every screen re-subscribed independently: the home page opened two
 * listeners per group row, the activity page opened two more per group via a
 * hidden "feeder" component, and the notifications page did the same again.
 * With five groups that's thirty concurrent listeners, all torn down and
 * re-established on every navigation — the main reason data arrived late,
 * partially, or not at all on mobile, where connections are slower and get
 * suspended in the background.
 *
 * Now each group is subscribed exactly once for the lifetime of the session and
 * every screen reads from this cache.
 */

export interface GroupData {
  expenses: Expense[];
  settlements: Settlement[];
  loaded: boolean;
}

interface GroupDataContextValue {
  groups: Group[];
  groupsLoaded: boolean;
  byGroup: Record<string, GroupData>;
  /** Groups plus their data, ready for cross-group balance math. */
  datasets: GroupDataset[];
  /** True once every group's expenses and settlements have arrived. */
  allLoaded: boolean;
  error: string | null;
}

const EMPTY_DATA: GroupData = { expenses: [], settlements: [], loaded: false };
const NO_GROUPS: Group[] = [];
const NO_DATA: Record<string, GroupData> = {};

const GroupDataContext = createContext<GroupDataContextValue | undefined>(undefined);

interface GroupsState {
  uid: string | null;
  groups: Group[];
  loaded: boolean;
}

export function GroupDataProvider({ children }: { children: ReactNode }) {
  // `dataUid`, not `user.uid`: the remembered uid from the last confirmed
  // session, so listeners attach in the first render instead of waiting on the
  // auth network round trip. Firestore serves a listener's first callback from
  // its on-device cache, so this is what lets known data paint immediately.
  //
  // Safety rests on the uid tagging already used below: every piece of state
  // records which uid it belongs to and is discarded on mismatch, so if the hint
  // turns out to be stale nothing from it is ever shown. See lib/auth-hint.ts.
  const { dataUid, loading: authLoading } = useAuth();
  const uid = dataUid;
  const authSettled = !authLoading;
  /**
   * Bumped to re-establish the listeners exactly once, if they failed while the
   * uid was still speculative.
   *
   * A Firestore permission error is terminal — the SDK does not retry it. So if a
   * listener attached on a remembered uid were ever rejected because the auth
   * token had not arrived yet, the screen would sit on empty data forever with
   * nothing to trigger a repair. That is a severe failure for a money app, so it
   * gets a safety net even though the SDK is expected to hold requests until
   * auth resolves rather than send them unauthenticated.
   *
   * One shot only: the effect below depends on `authSettled` and `uid`, neither
   * of which changes again, so a genuine permission failure cannot loop.
   */
  const [retryGen, setRetryGen] = useState(0);
  // Tagged with the uid it belongs to, so a sign-out or account switch can
  // never surface the previous user's groups while the new listener warms up.
  const [groupsState, setGroupsState] = useState<GroupsState>({
    uid: null,
    groups: NO_GROUPS,
    loaded: false,
  });
  const [byGroup, setByGroup] = useState<Record<string, GroupData>>(NO_DATA);
  /**
   * Tagged with the uid it came from, for the same reason the data is.
   *
   * Listeners can now start on a speculative uid, and a stale one fails the
   * security rules. Untagged, that would surface "Couldn't load the latest data
   * (Missing or insufficient permissions)" on the home screen even though the
   * app had simply guessed wrong and already recovered. An error only belongs to
   * the uid that produced it.
   */
  const [errorState, setErrorState] = useState<{ uid: string | null; message: string } | null>(
    null
  );

  useEffect(() => {
    if (!uid) return;
    return subscribeToUserGroups(
      uid,
      (groups) => {
        setErrorState(null);
        setGroupsState({ uid, groups, loaded: true });
      },
      (err) => {
        setGroupsState((prev) => (prev.uid === uid ? { ...prev, loaded: true } : prev));
        setErrorState({ uid, message: err.message });
      }
    );
  }, [uid, retryGen]);

  const groups = groupsState.uid === uid ? groupsState.groups : NO_GROUPS;
  const groupsLoaded = groupsState.uid === uid && groupsState.loaded;
  const groupIdsKey = groups.map((g) => g.id).sort().join(",");

  // Keep exactly one expenses + settlements listener per group, adding and
  // tearing them down only as group membership actually changes.
  const listenersRef = useRef(new Map<string, () => void>());
  const lastRetryRef = useRef(retryGen);

  useEffect(() => {
    const live = listenersRef.current;
    // On a repair pass, drop everything first — otherwise the `live.has()` guard
    // below would skip re-attaching the very listeners that failed.
    if (lastRetryRef.current !== retryGen) {
      lastRetryRef.current = retryGen;
      live.forEach((stop) => stop());
      live.clear();
    }
    const ids = uid && groupIdsKey ? groupIdsKey.split(",") : [];

    ids.forEach((groupId) => {
      if (live.has(groupId)) return;
      let gotExpenses = false;
      let gotSettlements = false;

      // A failed listener still has to settle the "loaded" flag, otherwise a
      // single permission error would pin every screen on a skeleton for the
      // rest of the session.
      const markSettled = (which: "expenses" | "settlements") => {
        if (which === "expenses") gotExpenses = true;
        else gotSettlements = true;
        setByGroup((prev) => ({
          ...prev,
          [groupId]: {
            ...(prev[groupId] || EMPTY_DATA),
            loaded: gotExpenses && gotSettlements,
          },
        }));
      };

      const unsubExpenses = subscribeToExpenses(
        groupId,
        (expenses) => {
          gotExpenses = true;
          setByGroup((prev) => ({
            ...prev,
            [groupId]: {
              ...(prev[groupId] || EMPTY_DATA),
              expenses,
              loaded: gotExpenses && gotSettlements,
            },
          }));
        },
        (err) => {
          setErrorState({ uid, message: err.message });
          markSettled("expenses");
        }
      );
      const unsubSettlements = subscribeToSettlements(
        groupId,
        (settlements) => {
          gotSettlements = true;
          setByGroup((prev) => ({
            ...prev,
            [groupId]: {
              ...(prev[groupId] || EMPTY_DATA),
              settlements,
              loaded: gotExpenses && gotSettlements,
            },
          }));
        },
        (err) => {
          setErrorState({ uid, message: err.message });
          markSettled("settlements");
        }
      );

      live.set(groupId, () => {
        unsubExpenses();
        unsubSettlements();
      });
    });

    // Stop listening to groups the user has left. Their cached entry is simply
    // never read again, because everything is derived from `groups`.
    Array.from(live.keys())
      .filter((groupId) => !ids.includes(groupId))
      .forEach((groupId) => {
        live.get(groupId)?.();
        live.delete(groupId);
      });
  }, [uid, groupIdsKey, retryGen]);

  useEffect(() => {
    const live = listenersRef.current;
    return () => {
      live.forEach((stop) => stop());
      live.clear();
    };
  }, []);

  // Only report a failure that belongs to the uid currently being displayed.
  const error = errorState && errorState.uid === uid ? errorState.message : null;

  // The one-shot repair described on `retryGen`.
  //
  // Guarded by a ref keyed on the uid rather than by omitting `errorState` from
  // the deps: a ref written during render is not safe under concurrent
  // rendering, and the linter is right to reject it. Written inside the effect
  // it is fine, and it makes the retry exactly once per uid — so a genuine
  // permission failure re-erroring cannot start a loop.
  const repairedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!authSettled || !uid) return;
    if (!errorState || errorState.uid !== uid) return;
    if (repairedForRef.current === uid) return;
    repairedForRef.current = uid;
    setErrorState(null);
    setRetryGen((n) => n + 1);
  }, [authSettled, uid, errorState]);

  const value = useMemo<GroupDataContextValue>(() => {
    const datasets: GroupDataset[] = groups.map((group) => ({
      group,
      expenses: byGroup[group.id]?.expenses || [],
      settlements: byGroup[group.id]?.settlements || [],
    }));
    return {
      groups,
      groupsLoaded,
      byGroup,
      datasets,
      allLoaded: groupsLoaded && groups.every((g) => byGroup[g.id]?.loaded),
      error,
    };
  }, [groups, groupsLoaded, byGroup, error]);

  return <GroupDataContext.Provider value={value}>{children}</GroupDataContext.Provider>;
}

export function useGroupData(): GroupDataContextValue {
  const ctx = useContext(GroupDataContext);
  if (!ctx) throw new Error("useGroupData must be used within GroupDataProvider");
  return ctx;
}

export interface SingleGroupData extends GroupData {
  group: Group | null;
  /** True while the first snapshot for this group is still outstanding. */
  loading: boolean;
  /** The group doesn't exist, or the user can't read it. */
  notFound: boolean;
}

interface FallbackState {
  groupId: string;
  group: Group | null;
  resolved: boolean;
  expenses: Expense[];
  settlements: Settlement[];
  gotExpenses: boolean;
  gotSettlements: boolean;
}

/**
 * Data for one group. Served from the shared cache when the user is already
 * known to be a member; otherwise (a deep link, or a group joined moments ago
 * whose membership hasn't propagated yet) it falls back to a direct
 * subscription so the screen still fills in instead of hanging on a skeleton
 * forever.
 */
export function useSingleGroup(groupId: string | undefined): SingleGroupData {
  const { groups, groupsLoaded, byGroup } = useGroupData();
  const cachedGroup = groupId ? groups.find((g) => g.id === groupId) : undefined;
  const cachedData = groupId ? byGroup[groupId] : undefined;
  const needsFallback = !!groupId && groupsLoaded && !cachedGroup;

  // Keyed by group id so a stale result from a previously viewed group can
  // never be shown for the current one.
  const [fallback, setFallback] = useState<FallbackState | null>(null);

  useEffect(() => {
    if (!needsFallback || !groupId) return;
    const patch = (change: Partial<FallbackState>) =>
      setFallback((prev) => ({
        groupId,
        group: null,
        resolved: false,
        expenses: [],
        settlements: [],
        gotExpenses: false,
        gotSettlements: false,
        ...(prev && prev.groupId === groupId ? prev : {}),
        ...change,
      }));

    // Both collections must report in before this counts as loaded — treating
    // whichever answered first as "done" would render balances with the
    // settlements still missing.
    const unsubs = [
      subscribeToGroup(
        groupId,
        (group) => patch({ group, resolved: true }),
        () => patch({ resolved: true })
      ),
      subscribeToExpenses(
        groupId,
        (expenses) => patch({ expenses, gotExpenses: true }),
        () => patch({ gotExpenses: true })
      ),
      subscribeToSettlements(
        groupId,
        (settlements) => patch({ settlements, gotSettlements: true }),
        () => patch({ gotSettlements: true })
      ),
    ];
    return () => unsubs.forEach((u) => u());
  }, [needsFallback, groupId]);

  if (cachedGroup) {
    const data = cachedData || EMPTY_DATA;
    return { group: cachedGroup, ...data, loading: !data.loaded, notFound: false };
  }

  const fb = fallback && fallback.groupId === groupId ? fallback : null;
  const fallbackLoaded = !!fb?.gotExpenses && !!fb?.gotSettlements;
  return {
    group: fb?.group ?? null,
    expenses: fb?.expenses ?? [],
    settlements: fb?.settlements ?? [],
    loaded: fallbackLoaded,
    loading: !groupsLoaded || (needsFallback && (!fb?.resolved || !fallbackLoaded)),
    notFound: needsFallback && !!fb?.resolved && !fb.group,
  };
}
