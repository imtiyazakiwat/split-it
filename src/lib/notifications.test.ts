import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Client push logic, run against a fake browser. Two regressions are pinned
 * here specifically:
 *
 *  - "Off" was silently undone on the next launch (the old NotificationSetup
 *    re-saved the token whenever permission was granted).
 *  - The switch showed "on" on every device once any one of them had a token,
 *    and even when saving this device's token had failed.
 */

const registerPushDevice = vi.fn(async () => "device" as const);
const disablePushDevice = vi.fn(async () => {});
const getToken = vi.fn(async () => "token-A");
const deleteToken = vi.fn(async () => true);

vi.mock("./firebase", () => ({ app: {} }));
vi.mock("./sw-registration", () => ({ getAppServiceWorker: vi.fn(async () => ({ scope: "/" })) }));
vi.mock("firebase/messaging", () => ({
  getMessaging: vi.fn(() => ({})),
  getToken: (...args: unknown[]) => getToken(...(args as [])),
  deleteToken: (...args: unknown[]) => deleteToken(...(args as [])),
  isSupported: vi.fn(async () => true),
}));
vi.mock("./firestore", () => ({
  registerPushDevice: (...args: unknown[]) => registerPushDevice(...(args as [])),
  disablePushDevice: (...args: unknown[]) => disablePushDevice(...(args as [])),
}));

const VALID_VAPID = `B${"x".repeat(86)}`;
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";

interface FakeBrowser {
  permission: NotificationPermission;
  requestPermission: ReturnType<typeof vi.fn>;
  storage: Map<string, string>;
}

/** Installs a minimal browser: storage, Notification, push APIs, UA. */
function installBrowser(opts: {
  permission?: NotificationPermission;
  grantOnRequest?: NotificationPermission;
  userAgent?: string;
  pushApis?: boolean;
  standalone?: boolean;
}): FakeBrowser {
  const storage = new Map<string, string>();
  const state: FakeBrowser = {
    permission: opts.permission ?? "default",
    requestPermission: vi.fn(async () => {
      state.permission = opts.grantOnRequest ?? "granted";
      return state.permission;
    }),
    storage,
  };
  const NotificationStub = {
    get permission() {
      return state.permission;
    },
    requestPermission: state.requestPermission,
  };
  const win: Record<string, unknown> = {
    localStorage: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, v),
      removeItem: (k: string) => void storage.delete(k),
    },
    matchMedia: () => ({ matches: !!opts.standalone }),
    dispatchEvent: () => true,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  const pushApis = opts.pushApis ?? true;
  if (pushApis) {
    win.Notification = NotificationStub;
    win.PushManager = function PushManager() {};
  }
  vi.stubGlobal("window", win);
  vi.stubGlobal("Notification", pushApis ? NotificationStub : undefined);
  vi.stubGlobal("document", { addEventListener: () => {}, removeEventListener: () => {} });
  vi.stubGlobal("navigator", {
    userAgent: opts.userAgent ?? ANDROID_UA,
    maxTouchPoints: 0,
    ...(pushApis ? { serviceWorker: {} } : {}),
  });
  return state;
}

async function loadModule(vapid = VALID_VAPID) {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_FIREBASE_VAPID_KEY", vapid);
  return import("./notifications");
}

beforeEach(() => {
  registerPushDevice.mockClear();
  disablePushDevice.mockClear();
  getToken.mockClear();
  deleteToken.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("support detection", () => {
  it("reports needs-install for iPhone Safari tabs, not 'denied'", async () => {
    installBrowser({ userAgent: IPHONE_UA, pushApis: false, standalone: false });
    const m = await loadModule();
    expect(m.getPushSupport()).toBe("needs-install");
    expect(m.readPushStatus("u1")).toBe("needs-install");
    expect(await m.enablePushForUser("u1")).toEqual({ ok: false, reason: "needs-install" });
  });

  it("reports unavailable when the build has no usable VAPID key", async () => {
    installBrowser({});
    const m = await loadModule("");
    expect(m.readPushStatus("u1")).toBe("unavailable");
    expect(await m.enablePushForUser("u1")).toEqual({ ok: false, reason: "unavailable" });
  });
});

describe("enable", () => {
  it("prompts, mints a token against the app's worker, and registers this device", async () => {
    const b = installBrowser({ permission: "default", grantOnRequest: "granted" });
    const m = await loadModule();
    expect(m.readPushStatus("u1")).toBe("off");

    const result = await m.enablePushForUser("u1");
    expect(result).toEqual({ ok: true });
    expect(b.requestPermission).toHaveBeenCalledOnce();
    expect(registerPushDevice).toHaveBeenCalledWith("u1", m.getDeviceId(), "token-A", "android");
    expect(m.readPushStatus("u1")).toBe("on");
  });

  it("stops at denied without acquiring a token", async () => {
    installBrowser({ permission: "default", grantOnRequest: "denied" });
    const m = await loadModule();
    expect(await m.enablePushForUser("u1")).toEqual({ ok: false, reason: "denied" });
    expect(getToken).not.toHaveBeenCalled();
  });

  it("never reports 'on' when saving the device failed", async () => {
    installBrowser({ permission: "granted" });
    const m = await loadModule();
    registerPushDevice.mockRejectedValueOnce(new Error("offline"));
    expect(await m.enablePushForUser("u1")).toEqual({ ok: false, reason: "failed" });
    expect(m.readPushStatus("u1")).toBe("off");
  });
});

describe("status is per device and per account", () => {
  it("shows off for a different account signed in on the same device", async () => {
    installBrowser({ permission: "granted" });
    const m = await loadModule();
    await m.enablePushForUser("u1");
    expect(m.readPushStatus("u1")).toBe("on");
    expect(m.readPushStatus("u2")).toBe("off");
  });

  it("keeps the same device id across calls", async () => {
    installBrowser({});
    const m = await loadModule();
    expect(m.getDeviceId()).toBe(m.getDeviceId());
  });
});

describe("disable sticks (the regression)", () => {
  it("does not re-register on the next launch after the user turned it off", async () => {
    installBrowser({ permission: "granted" });
    const m = await loadModule();
    await m.enablePushForUser("u1");
    registerPushDevice.mockClear();

    await m.disablePushForUser("u1");
    expect(disablePushDevice).toHaveBeenCalledWith("u1", m.getDeviceId());
    expect(m.readPushStatus("u1")).toBe("off");

    // Next launch: NotificationSetup calls refresh. It must do nothing.
    expect(await m.refreshPushForUser("u1")).toBeNull();
    expect(getToken).toHaveBeenCalledTimes(1); // only the original enable
    expect(registerPushDevice).not.toHaveBeenCalled();
  });

  it("turning it back on clears the opt-out", async () => {
    installBrowser({ permission: "granted" });
    const m = await loadModule();
    await m.disablePushForUser("u1");
    expect(await m.enablePushForUser("u1")).toEqual({ ok: true });
    expect(m.readPushStatus("u1")).toBe("on");
  });
});

describe("refresh on launch", () => {
  it("never prompts", async () => {
    const b = installBrowser({ permission: "default" });
    const m = await loadModule();
    expect(await m.refreshPushForUser("u1")).toBeNull();
    expect(b.requestPermission).not.toHaveBeenCalled();
  });

  it("skips the write when the token is unchanged and recent", async () => {
    installBrowser({ permission: "granted" });
    const m = await loadModule();
    await m.refreshPushForUser("u1");
    await m.refreshPushForUser("u1");
    expect(registerPushDevice).toHaveBeenCalledTimes(1);
  });

  it("re-registers when the token rotates", async () => {
    installBrowser({ permission: "granted" });
    const m = await loadModule();
    await m.refreshPushForUser("u1");
    getToken.mockResolvedValueOnce("token-B");
    await m.refreshPushForUser("u1");
    expect(registerPushDevice).toHaveBeenLastCalledWith("u1", m.getDeviceId(), "token-B", "android");
  });
});

describe("copy", () => {
  it("never shows developer terms to users", async () => {
    installBrowser({});
    const m = await loadModule();
    const reasons = ["unsupported", "needs-install", "unavailable", "denied", "dismissed", "failed"] as const;
    for (const r of reasons) {
      const text = m.describePushFailure(r);
      expect(text.length).toBeGreaterThan(10);
      expect(text).not.toMatch(/vapid|fcm|token|config/i);
    }
  });
});
