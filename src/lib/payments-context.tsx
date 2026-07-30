"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  ReactNode,
} from "react";
import { useAuth } from "./auth-context";
import { subscribeToMyTransfers, pendingForMe, unappliedForMe } from "./transfers";
import { subscribeToMyThreads, hasUnread, threadIdFor } from "./chat";
import { ChatThread, DirectTransfer } from "./types";

/**
 * One shared pair of listeners for direct transfers and chat threads.
 *
 * Same reasoning as GroupDataProvider: the Pay tab, the conversation screen and
 * any badge that needs a count all read from here rather than each opening its
 * own query. Two listeners for the whole session, regardless of how many people
 * the user talks to.
 *
 * Individual *messages* are deliberately not held here — only the thread
 * summaries. Subscribing to every conversation's messages up front would mean a
 * listener per contact for data almost none of which is on screen.
 */
interface PaymentsContextValue {
  /** Every direct transfer the user is either side of, newest first. */
  transfers: DirectTransfer[];
  /** Incoming transfers waiting on the user to say what they were. */
  pendingIncoming: DirectTransfer[];
  /** Confirmed transfers the user never attributed to a group. */
  unattributed: DirectTransfer[];
  threads: ChatThread[];
  threadWith: (otherUid: string) => ChatThread | undefined;
  unreadFrom: (otherUid: string) => boolean;
  /** How many conversations have an unseen message. */
  unreadCount: number;
  loaded: boolean;
  error: string | null;
}

const NO_TRANSFERS: DirectTransfer[] = [];
const NO_THREADS: ChatThread[] = [];

const PaymentsContext = createContext<PaymentsContextValue | undefined>(undefined);

interface OwnedState<T> {
  uid: string | null;
  items: T[];
  loaded: boolean;
}

export function PaymentsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const uid = user?.uid ?? null;

  // Tagged with the uid they belong to, so signing out or switching accounts
  // can't briefly show the previous user's payments while the new listener
  // warms up. Same guard GroupDataProvider uses.
  const [transferState, setTransferState] = useState<OwnedState<DirectTransfer>>({
    uid: null,
    items: NO_TRANSFERS,
    loaded: false,
  });
  const [threadState, setThreadState] = useState<OwnedState<ChatThread>>({
    uid: null,
    items: NO_THREADS,
    loaded: false,
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) return;
    return subscribeToMyTransfers(
      uid,
      (items) => {
        setError(null);
        setTransferState({ uid, items, loaded: true });
      },
      (err) => {
        // A failed listener still has to settle `loaded`, or the Pay tab sits
        // on a skeleton for the rest of the session.
        setTransferState((prev) => (prev.uid === uid ? { ...prev, loaded: true } : prev));
        setError(err.message);
      }
    );
  }, [uid]);

  useEffect(() => {
    if (!uid) return;
    return subscribeToMyThreads(
      uid,
      (items) => setThreadState({ uid, items, loaded: true }),
      (err) => {
        setThreadState((prev) => (prev.uid === uid ? { ...prev, loaded: true } : prev));
        setError(err.message);
      }
    );
  }, [uid]);

  const value = useMemo<PaymentsContextValue>(() => {
    const transfers = transferState.uid === uid ? transferState.items : NO_TRANSFERS;
    const threads = threadState.uid === uid ? threadState.items : NO_THREADS;
    const byId = new Map(threads.map((t) => [t.id, t]));
    const threadWith = (otherUid: string) =>
      uid ? byId.get(threadIdFor(uid, otherUid)) : undefined;

    return {
      transfers,
      pendingIncoming: uid ? pendingForMe(transfers, uid) : NO_TRANSFERS,
      unattributed: uid ? unappliedForMe(transfers, uid) : NO_TRANSFERS,
      threads,
      threadWith,
      unreadFrom: (otherUid: string) => (uid ? hasUnread(threadWith(otherUid), uid) : false),
      unreadCount: uid ? threads.filter((t) => hasUnread(t, uid)).length : 0,
      loaded:
        transferState.uid === uid &&
        transferState.loaded &&
        threadState.uid === uid &&
        threadState.loaded,
      error,
    };
  }, [uid, transferState, threadState, error]);

  return <PaymentsContext.Provider value={value}>{children}</PaymentsContext.Provider>;
}

export function usePayments(): PaymentsContextValue {
  const ctx = useContext(PaymentsContext);
  if (!ctx) throw new Error("usePayments must be used within PaymentsProvider");
  return ctx;
}
