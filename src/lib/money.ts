/**
 * Money as integer paise.
 *
 * Every amount in Firestore is a float number of rupees, which is fine for
 * storage but not for arithmetic: accumulating a group's ledger in floats
 * reached `5.309999999999917` before being rounded for display, and
 * `1.15 * 100` is `114.99999999999999`, so the obvious `Math.floor(x * 100)`
 * loses a paise at random. Every calculation in the app therefore converts to
 * integer paise first, does exact integer arithmetic, and converts back only to
 * display. Two screens computing the same figure can then never disagree.
 *
 * The old code instead sprinkled `round2` at different points in different
 * files — once at the end in `computeBalances`, at every step in
 * `buildPairStatement` — which is why the same pair could read differently
 * depending on which screen you were looking at.
 */

export const PAISE_PER_RUPEE = 100;

/**
 * Rupees (possibly a float with binary representation error) to exact paise.
 *
 * `toPrecision(15)` collapses the representation error before rounding: the
 * double nearest to 1.15 is 1.14999…, and `1.15 * 100` is 114.99999999999999,
 * which naive rounding turns into 114 paise. 15 significant digits is well
 * inside a double's ~15.95 and far beyond any real rupee amount.
 *
 * Halves round away from zero so that -0.005 and 0.005 are treated
 * symmetrically; `Math.round` alone biases towards +∞.
 */
export function toPaise(rupees: number): number {
  const n = Number(rupees);
  if (!Number.isFinite(n)) return 0;
  const scaled = Number((n * PAISE_PER_RUPEE).toPrecision(15));
  return scaled < 0 ? -Math.round(-scaled) : Math.round(scaled);
}

/** Exact paise back to rupees, for display and for storage. */
export function fromPaise(paise: number): number {
  return paise / PAISE_PER_RUPEE;
}

/** Snaps a rupee amount to whole paise. Use on every value entering Firestore. */
export function roundMoney(rupees: number): number {
  return fromPaise(toPaise(rupees));
}

/** Sums rupee amounts without float drift. */
export function sumMoney(values: number[]): number {
  return fromPaise(values.reduce((total, v) => total + toPaise(v), 0));
}

/**
 * A balance is settled when it is exactly zero paise.
 *
 * The old code compared against a hardcoded `0.01` in eighteen places, which
 * both hid genuine one-paise debts and, because the threshold was applied
 * inconsistently, let a group render "Settled up" next to a non-zero figure.
 * With exact paise there is no dust to tolerate: if every split sums to its
 * expense total, paying your share lands you on exactly zero.
 */
export function isSettled(rupees: number): boolean {
  return toPaise(rupees) === 0;
}

/**
 * Splits `totalPaise` into `parts` shares that sum back to it exactly.
 *
 * The remainder is handed out one paise at a time to the earliest shares
 * (largest-remainder). `splitEqually` used to floor every share and then dump
 * the whole remainder onto `splits[0]`, so with an n-way split one person
 * absorbed up to n-1 paise — and because that was always `memberIds[0]`, the
 * same person absorbed it on every single expense. In the live "ETL CKD" group
 * that had quietly cost one member an extra ₹0.33.
 */
export function dividePaise(totalPaise: number, parts: number): number[] {
  if (parts <= 0) return [];
  const sign = totalPaise < 0 ? -1 : 1;
  const abs = Math.abs(totalPaise);
  const base = Math.floor(abs / parts);
  const remainder = abs - base * parts;
  return Array.from({ length: parts }, (_, i) => sign * (base + (i < remainder ? 1 : 0)));
}

/**
 * Distributes `totalPaise` across `weights` in proportion, summing back to it
 * exactly. Used to rescale an uneven split when an expense's total is edited.
 *
 * Shares are floored and the leftover paise go to the entries whose fractional
 * part was largest, so the result is the closest integer-paise approximation of
 * the requested proportions rather than one entry silently absorbing the lot.
 */
export function allocatePaise(totalPaise: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  const totalWeight = weights.reduce((t, w) => t + w, 0);
  if (totalWeight <= 0) return dividePaise(totalPaise, weights.length);

  const exact = weights.map((w) => (totalPaise * w) / totalWeight);
  const floored = exact.map((v) => Math.floor(v));
  let leftover = totalPaise - floored.reduce((t, v) => t + v, 0);

  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  const result = [...floored];
  for (let k = 0; leftover > 0 && k < order.length; k++, leftover--) {
    result[order[k].i] += 1;
  }
  // A negative total leaves `leftover` negative; take paise back the same way.
  for (let k = 0; leftover < 0 && k < order.length; k++, leftover++) {
    result[order[order.length - 1 - k].i] -= 1;
  }
  return result;
}
