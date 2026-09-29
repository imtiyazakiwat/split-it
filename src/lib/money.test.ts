import { describe, expect, it } from "vitest";
import {
  allocatePaise,
  dividePaise,
  fromPaise,
  isSettled,
  roundMoney,
  sumMoney,
  toPaise,
} from "./money";

/**
 * The paise layer every ledger figure passes through. These cases are the exact
 * float traps the module's comments describe; if any of them regress, balances
 * start disagreeing between screens by a paise at a time.
 */
describe("toPaise", () => {
  it("collapses binary representation error before rounding", () => {
    // 1.15 * 100 === 114.99999999999999 in IEEE-754.
    expect(toPaise(1.15)).toBe(115);
    expect(toPaise(0.1 + 0.2)).toBe(30);
    expect(toPaise(5.309999999999917)).toBe(531);
  });

  it("rounds halves away from zero, symmetrically", () => {
    expect(toPaise(0.005)).toBe(1);
    expect(toPaise(-0.005)).toBe(-1);
    expect(toPaise(1.005)).toBe(101);
  });

  it("treats non-finite input as zero rather than poisoning a sum", () => {
    expect(toPaise(Number.NaN)).toBe(0);
    expect(toPaise(Number.POSITIVE_INFINITY)).toBe(0);
    expect(toPaise("12.5" as unknown as number)).toBe(1250);
  });
});

describe("round trips and sums", () => {
  it("fromPaise inverts toPaise exactly", () => {
    for (const r of [0, 0.01, 1.15, 80.66, 130, 214.5, 99999.99]) {
      expect(fromPaise(toPaise(r))).toBe(r);
    }
  });

  it("roundMoney snaps to whole paise", () => {
    expect(roundMoney(10.004)).toBe(10);
    expect(roundMoney(10.006)).toBe(10.01);
  });

  it("sumMoney has no float drift", () => {
    expect(sumMoney([0.1, 0.2, 0.3])).toBe(0.6);
    expect(sumMoney([80.66, 49.34])).toBe(130);
  });

  it("isSettled means exactly zero paise, never an epsilon", () => {
    expect(isSettled(0)).toBe(true);
    expect(isSettled(0.004)).toBe(true); // rounds to 0 paise
    expect(isSettled(0.01)).toBe(false); // a genuine one-paise debt
    expect(isSettled(-0.01)).toBe(false);
  });
});

describe("dividePaise", () => {
  it("sums back to the total and spreads the remainder one paise each", () => {
    expect(dividePaise(10000, 3)).toEqual([3334, 3333, 3333]);
    expect(dividePaise(2000, 3)).toEqual([667, 667, 666]);
    const shares = dividePaise(12345, 7);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(12345);
    expect(Math.max(...shares) - Math.min(...shares)).toBeLessThanOrEqual(1);
  });

  it("preserves sign and handles degenerate inputs", () => {
    expect(dividePaise(-100, 3)).toEqual([-34, -33, -33]);
    expect(dividePaise(100, 0)).toEqual([]);
    expect(dividePaise(0, 4)).toEqual([0, 0, 0, 0]);
  });
});

describe("allocatePaise", () => {
  it("allocates in proportion and sums back exactly", () => {
    const out = allocatePaise(60000, [10000, 10000, 10000]);
    expect(out).toEqual([20000, 20000, 20000]);
    const uneven = allocatePaise(1000, [1, 1, 1]);
    expect(uneven.reduce((a, b) => a + b, 0)).toBe(1000);
  });

  it("gives leftover paise to the largest fractional parts", () => {
    // 100 across 1:1:1 -> 33.33 each; one extra paise to the first by tie-break.
    expect(allocatePaise(100, [1, 1, 1])).toEqual([34, 33, 33]);
  });

  it("falls back to an equal split when weights are all zero", () => {
    expect(allocatePaise(90, [0, 0, 0])).toEqual([30, 30, 30]);
  });

  it("sums back exactly for negative totals too", () => {
    const out = allocatePaise(-1001, [1, 2, 3]);
    expect(out.reduce((a, b) => a + b, 0)).toBe(-1001);
  });
});
