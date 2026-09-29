import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

/**
 * Runs the real public/sw.js inside a fake ServiceWorkerGlobalScope and drives
 * its push and notificationclick handlers.
 *
 * This is the file that decides whether a notification ever appears on a phone,
 * and it had no push handler at all until now. Every case here is something that
 * silently failed, or could, in production.
 */

const ROOT = path.resolve(__dirname, "..", "..");
const SW_SOURCE = readFileSync(path.join(ROOT, "public", "sw.js"), "utf8");
const SHIM_SOURCE = readFileSync(path.join(ROOT, "public", "firebase-messaging-sw.js"), "utf8");
const ORIGIN = "https://splitit.example";

type Listener = (event: unknown) => void;

function makeWorker(options: { clients?: FakeClient[]; source?: string } = {}) {
  const listeners = new Map<string, Listener[]>();
  const shown: { title: string; options: Record<string, unknown> }[] = [];
  const opened: string[] = [];
  const windows = options.clients ?? [];

  const self = {
    location: new URL(`${ORIGIN}/sw.js`),
    addEventListener(type: string, fn: Listener) {
      listeners.set(type, [...(listeners.get(type) ?? []), fn]);
    },
    skipWaiting: vi.fn(async () => {}),
    registration: {
      showNotification: vi.fn(async (title: string, opts: Record<string, unknown>) => {
        shown.push({ title, options: opts });
      }),
    },
    clients: {
      claim: vi.fn(async () => {}),
      matchAll: vi.fn(async () => windows),
      openWindow: vi.fn(async (url: string) => {
        opened.push(url);
        return null;
      }),
    },
  };

  const context = vm.createContext({
    self,
    URL,
    Response,
    console,
    caches: { open: vi.fn(), keys: vi.fn(async () => []), match: vi.fn() },
    fetch: vi.fn(),
    // The shim calls importScripts("/sw.js"); resolve it to the real file.
    importScripts: (url: string) => {
      if (url !== "/sw.js") throw new Error(`unexpected importScripts(${url})`);
      vm.runInContext(SW_SOURCE, context);
    },
  });
  vm.runInContext(options.source ?? SW_SOURCE, context);

  /** Fires an event and waits for everything it passed to waitUntil. */
  async function dispatch(type: string, event: Record<string, unknown>) {
    const pending: Promise<unknown>[] = [];
    const evt = { ...event, waitUntil: (p: Promise<unknown>) => pending.push(p) };
    for (const fn of listeners.get(type) ?? []) fn(evt);
    await Promise.all(pending);
  }

  return { listeners, shown, opened, dispatch, self };
}

interface FakeClient {
  url: string;
  focus: () => Promise<FakeClient>;
  navigate: (url: string) => Promise<FakeClient>;
  navigatedTo?: string;
}

function makeClient(url: string, opts: { navigateThrows?: boolean } = {}): FakeClient {
  const client: FakeClient = {
    url,
    focus: vi.fn(async () => client),
    navigate: vi.fn(async (to: string) => {
      if (opts.navigateThrows) throw new TypeError("not controlled");
      client.navigatedTo = to;
      return client;
    }),
  };
  return client;
}

const pushEvent = (payload: unknown) => ({
  data: {
    json: () => payload,
    text: () => JSON.stringify(payload),
  },
});

describe("service worker: push", () => {
  it("registers a push handler (the bug: there was none)", () => {
    const w = makeWorker();
    expect(w.listeners.get("push")?.length).toBe(1);
    expect(w.listeners.get("notificationclick")?.length).toBe(1);
  });

  it("renders an FCM data-only message", async () => {
    const w = makeWorker();
    await w.dispatch(
      "push",
      pushEvent({
        from: "123",
        fcmMessageId: "abc",
        data: {
          title: "Goa Trip",
          body: "Ganesh added Dinner · ₹1200",
          link: "/groups/g1?expense=e1",
          tag: "Goa Trip|Ganesh added Dinner",
        },
      })
    );
    expect(w.shown).toHaveLength(1);
    expect(w.shown[0].title).toBe("Goa Trip");
    expect(w.shown[0].options).toMatchObject({
      body: "Ganesh added Dinner · ₹1200",
      tag: "Goa Trip|Ganesh added Dinner",
      icon: "/icon-192.png",
      data: { link: "/groups/g1?expense=e1" },
    });
  });

  it("still shows something for an older notification-block payload", async () => {
    const w = makeWorker();
    await w.dispatch("push", pushEvent({ notification: { title: "Hi", body: "There" } }));
    expect(w.shown[0]).toMatchObject({ title: "Hi", options: { body: "There" } });
  });

  it("never stays silent, even with no payload (iOS revokes silent pushes)", async () => {
    const w = makeWorker();
    await w.dispatch("push", {});
    expect(w.shown).toHaveLength(1);
    expect(w.shown[0].title).toBe("SplitIt");
  });

  it("survives a non-JSON payload", async () => {
    const w = makeWorker();
    await w.dispatch("push", {
      data: {
        json: () => {
          throw new SyntaxError("bad json");
        },
        text: () => "plain text body",
      },
    });
    expect(w.shown[0].options).toMatchObject({ body: "plain text body" });
  });

  it("refuses off-site links in the payload", async () => {
    const w = makeWorker();
    for (const link of ["https://evil.example/phish", "//evil.example", "javascript:alert(1)"]) {
      await w.dispatch("push", pushEvent({ data: { title: "x", body: "y", link } }));
    }
    // Without this the loop below passes vacuously when nothing is shown.
    expect(w.shown).toHaveLength(3);
    for (const n of w.shown) {
      expect((n.options.data as { link: string }).link).toBe("/");
    }
  });
});

describe("service worker: notificationclick", () => {
  const clickEvent = (link: string | undefined) => ({
    notification: { close: vi.fn(), data: link === undefined ? undefined : { link } },
  });

  it("focuses an open window and navigates it to the link", async () => {
    const client = makeClient(`${ORIGIN}/pay`);
    const w = makeWorker({ clients: [client] });
    await w.dispatch("notificationclick", clickEvent("/groups/g1?settlement=s9"));
    expect(client.focus).toHaveBeenCalled();
    expect(client.navigatedTo).toBe(`${ORIGIN}/groups/g1?settlement=s9`);
    expect(w.opened).toEqual([]);
  });

  it("opens a new window when none is open", async () => {
    const w = makeWorker({ clients: [] });
    await w.dispatch("notificationclick", clickEvent("/chat/u2"));
    expect(w.opened).toEqual([`${ORIGIN}/chat/u2`]);
  });

  it("falls back to a new window when the open one can't be navigated", async () => {
    const client = makeClient(`${ORIGIN}/`, { navigateThrows: true });
    const w = makeWorker({ clients: [client] });
    await w.dispatch("notificationclick", clickEvent("/activity"));
    expect(w.opened).toEqual([`${ORIGIN}/activity`]);
  });

  it("ignores windows from other origins and goes home for a missing link", async () => {
    const foreign = makeClient("https://other.example/");
    const w = makeWorker({ clients: [foreign] });
    await w.dispatch("notificationclick", clickEvent(undefined));
    expect(foreign.focus).not.toHaveBeenCalled();
    expect(w.opened).toEqual([`${ORIGIN}/`]);
  });
});

describe("retired firebase-messaging-sw.js shim", () => {
  it("imports the real worker, so an old client registering it still gets push", async () => {
    const w = makeWorker({ source: SHIM_SOURCE });
    expect(w.listeners.get("push")?.length).toBe(1);
    await w.dispatch("push", pushEvent({ data: { title: "Still works", body: "via shim" } }));
    expect(w.shown[0].title).toBe("Still works");
  });
});
