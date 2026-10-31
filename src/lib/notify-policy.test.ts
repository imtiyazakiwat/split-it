import { describe, expect, it } from "vitest";
import {
  LIMITS,
  cleanText,
  collectTargets,
  consumeRate,
  dedupeTag,
  isDeadTokenError,
  parseNotifyRequest,
  resolveGroupRecipients,
  safeLink,
} from "./notify-policy";

describe("parseNotifyRequest", () => {
  it("accepts the legacy shape unchanged, for phones on a cached bundle", () => {
    const r = parseNotifyRequest({ uids: ["a", "b"], title: "T", body: "B", link: "/x" });
    expect(r).toEqual({
      ok: true,
      request: { uids: ["a", "b"], groupId: null, title: "T", body: "B", link: "/x", test: false },
    });
  });

  it("accepts group mode without a title (the server uses the group name)", () => {
    const r = parseNotifyRequest({ groupId: "g1", body: "Asha added Lunch" });
    expect(r.ok && r.request.groupId).toBe("g1");
  });

  it("rejects requests with nobody to notify, no body, or no title outside group mode", () => {
    expect(parseNotifyRequest({ body: "x" })).toMatchObject({ ok: false });
    expect(parseNotifyRequest({ uids: ["a"], title: "t" })).toMatchObject({ ok: false });
    expect(parseNotifyRequest({ uids: ["a"], body: "b" })).toMatchObject({ ok: false });
    expect(parseNotifyRequest(null)).toMatchObject({ ok: false });
    expect(parseNotifyRequest("nope")).toMatchObject({ ok: false });
  });

  it("dedupes, caps and sanitises recipient ids", () => {
    const many = Array.from({ length: 80 }, (_, i) => `u${i}`);
    const r = parseNotifyRequest({ uids: [...many, "u1", "", 7, "a/b"], title: "t", body: "b" });
    expect(r.ok && r.request.uids.length).toBe(LIMITS.MAX_RECIPIENTS);
    expect(r.ok && r.request.uids).not.toContain("a/b");
  });

  it("drops off-site links rather than rejecting the push", () => {
    const r = parseNotifyRequest({ uids: ["a"], title: "t", body: "b", link: "https://evil.example" });
    expect(r.ok && r.request.link).toBeNull();
  });

  it("test mode ignores caller-supplied text", () => {
    const r = parseNotifyRequest({ test: true, title: "phish", body: "phish" });
    expect(r).toEqual({
      ok: true,
      request: { uids: [], groupId: null, title: "", body: "", link: null, test: true },
    });
  });
});

describe("text and links", () => {
  it("safeLink accepts only same-origin absolute paths", () => {
    expect(safeLink("/groups/g1?expense=e1")).toBe("/groups/g1?expense=e1");
    expect(safeLink("//evil.example")).toBeNull();
    expect(safeLink("javascript:alert(1)")).toBeNull();
    expect(safeLink(42)).toBeNull();
  });

  it("cleanText strips control characters and caps length", () => {
    expect(cleanText("  hi\u0000\nthere\u0007 ", 50)).toBe("hi there");
    expect(cleanText("x".repeat(500), 10)).toHaveLength(10);
    expect(cleanText(undefined, 10)).toBe("");
  });

  it("dedupeTag distinguishes the same text going to different places", () => {
    expect(dedupeTag("G", "Asha added", "/groups/a")).not.toBe(dedupeTag("G", "Asha added", "/groups/b"));
    expect(dedupeTag("G", "x".repeat(300), "/l").length).toBeLessThanOrEqual(LIMITS.MAX_TAG);
  });
});

describe("resolveGroupRecipients", () => {
  it("is every other member by default", () => {
    expect(resolveGroupRecipients("me", ["me", "a", "b"], []).sort()).toEqual(["a", "b"]);
  });

  it("narrows to requested members and drops non-members", () => {
    expect(resolveGroupRecipients("me", ["me", "a", "b"], ["b", "stranger", "me"])).toEqual(["b"]);
  });
});

describe("collectTargets", () => {
  it("sends to every enabled device once, skipping disabled and empty ones", () => {
    const t = collectTargets([
      {
        uid: "a",
        legacyToken: "",
        devices: [
          { id: "phone", token: "t1", enabled: true },
          { id: "laptop", token: "t2", enabled: true },
          { id: "old", token: "t3", enabled: false },
          { id: "blank", token: "", enabled: true },
        ],
      },
    ]);
    expect(t.map((x) => x.token).sort()).toEqual(["t1", "t2"]);
  });

  it("still reaches a user who only has the legacy field", () => {
    const t = collectTargets([{ uid: "a", devices: [], legacyToken: "legacy-1" }]);
    expect(t).toEqual([{ uid: "a", token: "legacy-1", deviceId: null, legacy: true }]);
  });

  it("sends once when the legacy field and a device hold the same token", () => {
    const t = collectTargets([
      { uid: "a", devices: [{ id: "phone", token: "same", enabled: true }], legacyToken: "same" },
    ]);
    expect(t).toEqual([{ uid: "a", token: "same", deviceId: "phone", legacy: true }]);
  });
});

describe("dead tokens", () => {
  it("recognises the codes that mean a token will never work again", () => {
    expect(isDeadTokenError("messaging/registration-token-not-registered")).toBe(true);
    expect(isDeadTokenError("messaging/internal-error")).toBe(false);
    expect(isDeadTokenError(undefined)).toBe(false);
  });
});

describe("consumeRate", () => {
  const W = 1000;

  it("allows up to the limit within a window, then refuses", () => {
    let state = undefined as ReturnType<typeof consumeRate>["next"] | undefined;
    for (let i = 0; i < 3; i++) {
      const r = consumeRate(state, 100 + i, 3, W);
      expect(r.allowed).toBe(true);
      state = r.next;
    }
    expect(consumeRate(state, 200, 3, W).allowed).toBe(false);
  });

  it("opens a fresh window once the old one has passed", () => {
    const full = { windowStart: 0, count: 3 };
    expect(consumeRate(full, W, 3, W)).toEqual({ allowed: true, next: { windowStart: W, count: 1 } });
  });

  it("recovers from a clock that jumped backwards instead of locking the user out", () => {
    expect(consumeRate({ windowStart: 5000, count: 99 }, 10, 3, W).allowed).toBe(true);
  });
});
