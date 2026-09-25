import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";
import { app } from "./firebase";

/**
 * The Firestore instance, isolated so it can be loaded off the critical path.
 *
 * Importing this module anywhere reachable from `app/layout.tsx` without a
 * dynamic `import()` puts 641 kB back in front of first interaction. Every
 * consumer — `firestore.ts`, `transfers.ts`, `chat.ts`, `send-notification.ts` —
 * is itself only reached via `await import(...)`, which keeps the whole subtree
 * async.
 *
 * The persistent (IndexedDB) cache is what makes `onSnapshot` return last-known
 * data locally on startup instead of flashing empty values, and it is why the
 * speculative-uid head start in `auth-hint.ts` is worth anything: the data is
 * already on the device, so attaching a listener early paints immediately.
 *
 * Falls back to the default in-memory instance on the server, or if the cache
 * cannot be initialised (private browsing, storage disabled, or an HMR re-init
 * where `initializeFirestore` has already run for this app).
 */
function createDb() {
  if (typeof window === "undefined") return getFirestore(app);
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch {
    return getFirestore(app);
  }
}

export const db = createDb();
