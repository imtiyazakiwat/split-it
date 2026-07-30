import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "./firebase";
import { ChatMessage, ChatThread } from "./types";
import { notifyUsers } from "./send-notification";

/**
 * Two-person chat threads.
 *
 * Only text lives here. Payments, settlements and shared expenses are *not*
 * copied into the thread — the conversation screen merges them in from the
 * ledger at render time (see lib/conversation.ts). Storing a payment as a chat
 * message as well would create a second copy of money data that could disagree
 * with the balances, which is the one thing this app cannot afford.
 */

export const MAX_MESSAGE_LENGTH = 1000;

/** How many messages a conversation loads. Older ones are simply not fetched. */
const MESSAGE_WINDOW = 200;

/**
 * Deterministic thread id, so both people derive the same one without a lookup
 * or a round trip to create it.
 */
export function threadIdFor(uidA: string, uidB: string): string {
  return [uidA, uidB].sort().join("_");
}

function toThread(id: string, data: Record<string, unknown>): ChatThread {
  return {
    id,
    participants: (data.participants as string[]) || [],
    lastMessage: (data.lastMessage as string) || undefined,
    lastMessageFrom: (data.lastMessageFrom as string) || undefined,
    lastMessageAt: (data.lastMessageAt as number) || undefined,
    lastRead: (data.lastRead as Record<string, number>) || {},
  };
}

export function subscribeToMyThreads(
  uid: string,
  callback: (threads: ChatThread[]) => void,
  onError?: (err: Error) => void
) {
  const q = query(collection(db, "threads"), where("participants", "array-contains", uid));
  return onSnapshot(
    q,
    (snap) => callback(snap.docs.map((d) => toThread(d.id, d.data()))),
    (err) => {
      console.error("[chat] threads listener failed:", err);
      onError?.(err);
    }
  );
}

/**
 * The newest `MESSAGE_WINDOW` messages in a thread, oldest first.
 *
 * The query descends and is then reversed, so the window is the *latest*
 * messages rather than the first ones ever sent. A single-field order needs no
 * composite index.
 */
export function subscribeToMessages(
  threadId: string,
  callback: (messages: ChatMessage[]) => void,
  onError?: (err: Error) => void
) {
  const q = query(
    collection(db, "threads", threadId, "messages"),
    orderBy("createdAt", "desc"),
    limit(MESSAGE_WINDOW)
  );
  return onSnapshot(
    q,
    (snap) => {
      const messages = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<ChatMessage, "id">) }))
        .reverse();
      callback(messages);
    },
    (err) => {
      console.error("[chat] messages listener failed:", err);
      onError?.(err);
    }
  );
}

export async function sendMessage(
  fromUid: string,
  toUid: string,
  rawText: string
): Promise<void> {
  const text = rawText.trim().slice(0, MAX_MESSAGE_LENGTH);
  if (!text) return;

  const threadId = threadIdFor(fromUid, toUid);
  const threadRef = doc(db, "threads", threadId);
  const messageRef = doc(collection(db, "threads", threadId, "messages"));
  const now = Date.now();

  const batch = writeBatch(db);
  // Merged rather than created outright: the thread may already exist, and the
  // rules require its participants to stay exactly as they were.
  batch.set(
    threadRef,
    {
      participants: [fromUid, toUid].sort(),
      lastMessage: text,
      lastMessageFrom: fromUid,
      lastMessageAt: now,
      // Your own message is read by definition; without this the sender's own
      // thread would show as unread to themselves.
      lastRead: { [fromUid]: now },
    },
    { merge: true }
  );
  batch.set(messageRef, { fromUid, text, createdAt: now });
  await batch.commit();

  try {
    notifyUsers([toUid], {
      title: "New message",
      body: text.length > 120 ? `${text.slice(0, 117)}…` : text,
      link: `/chat/${fromUid}`,
    });
  } catch {
    // best-effort
  }
}

/** Marks everything up to now as seen by `uid`. */
export async function markThreadRead(
  uid: string,
  otherUid: string,
  upToTs: number
): Promise<void> {
  const threadId = threadIdFor(uid, otherUid);
  try {
    await setDoc(
      doc(db, "threads", threadId),
      {
        participants: [uid, otherUid].sort(),
        lastRead: { [uid]: upToTs },
      },
      { merge: true }
    );
  } catch {
    // A read receipt failing must never break the screen.
  }
}

/** True when the other person's newest message hasn't been seen yet. */
export function hasUnread(thread: ChatThread | undefined, meUid: string): boolean {
  if (!thread?.lastMessageAt) return false;
  if (thread.lastMessageFrom === meUid) return false;
  return thread.lastMessageAt > (thread.lastRead?.[meUid] ?? 0);
}
