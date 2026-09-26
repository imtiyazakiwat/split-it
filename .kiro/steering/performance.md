# Client performance & code quality standards

Rules for all work in `src/`. Written from measurements taken against this
codebase and this exact dependency set (`next@16.2.10`, `react@19.2.4`), not from
general advice. Re-measure before trusting any number here.

---

## 0. The prime rule: measure, then change

No optimisation without a measurement that justifies it, and a re-measurement
that confirms it. "This looks slow" is a hypothesis, not a finding.

If a change cannot be tied to a number that moved, it is not a performance
change — it is a refactor, and it should be judged as one.

This applies to the agent as much as anyone: during the ledger investigation
there was a confident, well-argued theory that partially-loaded Firestore data
caused a mis-booked transfer. A replay script disproved it in one run. Write the
probe before writing the fix.

---

## 1. Budgets

These are the pass/fail lines. A change that crosses one is not done.

| Budget | Limit | Why |
|---|---|---|
| INP (p75) | ≤ 200 ms | Google's "good" threshold; ~43% of sites fail it |
| Single main-thread task | ≤ 50 ms | Longer blocks input. 100 ms feels instant to a human, so a 50 ms task leaves 50 ms for input + paint |
| Tap → visible feedback | ≤ 100 ms | Below this the UI feels connected to the finger |
| Local read (IndexedDB → render) | ≤ 50 ms | The network cannot meet this; mobile RTT in India is 40–80 ms. Reads serve locally or they miss |
| First Load JS per route | ≤ 300 kB | Current largest chunk is 656 kB (Firestore SDK) |

Do not use `next dev` to judge any of these. Dev builds are not representative
and **automatic prefetching does not run in development**. Measure against
`next build && next start`.

---

## 2. Memoization: the compiler decides, not you

React Compiler reached stable 1.0 in October 2025. The React team's own estimate
is that **60–70% of manual `useMemo`/`useCallback` in production codebases were
unnecessary or actively harmful**. It inserts cache boundaries per *reactive
scope* rather than per hook call, which is more granular than hand-written memos
can be.

**Default: let the compiler do it.** Do not hand-write `useMemo`/`useCallback`
to fix a render cost. The compiler preserves existing calls as an escape hatch,
so leaving one in is a deliberate claim that the compiler got it wrong.

Manual memoization is justified only in these cases, and the reason goes in a
comment:

1. A third-party hook returns a fresh object every call and a stable reference
   must be passed onward.
2. An effect dependency must be referentially stable to avoid re-subscribing.
3. A profiled bottleneck where the compiled output was measured and found
   insufficient.

**What the compiler cannot fix — do not expect it to:**

- A context Provider whose `value` is genuinely a new object. The compiler
  memoizes *within* a component; it cannot make new state look like old state.
  That is an architecture problem (§3).
- Work that shouldn't run at all. Memoizing a wasteful computation makes it run
  less often; deleting it makes it never run.
- Network waterfalls, route-level caching, bundle size.

---

## 3. State that many screens read

The failure mode this codebase actually has: a provider stores a record keyed by
id, every update writes `{...prev, [id]: next}`, so the whole object gets a new
identity, so every derived array gets a new identity, so **every consumer on
every screen recomputes** — including ones reading an unrelated key.

Any new context value re-renders all consumers regardless of which field they
read. That is documented React behaviour, not a local bug to patch.

Rules:

- **Never** put a broad mutable collection behind a single context value that
  many screens consume.
- Prefer an external store read through `useSyncExternalStore` with a selector,
  so a component re-renders only when the slice it selected actually changed.
- If a context must stay, split it: stable identity (actions, ids) in one
  provider, volatile data in another, so consumers of the stable half don't
  re-render.
- A provider's value must be stable across updates that don't affect it. Assert
  this; don't assume it.

---

## 4. Navigation (Next 16 App Router)

From the official prefetching guide for this version:

| | Static route | Dynamic route |
|---|---|---|
| Prefetched | Yes, full route | **No — unless `loading.tsx` exists** |
| Client cache TTL | 5 min | **Off — unless `staleTimes` is set** |
| Server round trip on click | No | Yes |

`/groups/[id]`, `/chat/[uid]` and `/join/[code]` are dynamic (confirmed by
`next build`). Untreated they get no prefetch and no client cache. That is the
documented mechanism behind a tap that hangs.

Rules:

- Navigate with `<Link>`. `router.push` inside `onClick` gets **zero** prefetch;
  it is only correct after a write, or when the target is computed at click time.
- Every route segment that can wait on data has a `loading.tsx`. Without one the
  router keeps the previous screen on screen, frozen — which reads to a user as
  "the tap did nothing".
- Configure `experimental.staleTimes.dynamic`, or accept zero client caching on
  dynamic routes.
- Never key a wrapper on `pathname` (`<div key={pathname}>`). It unmounts the
  whole tree on every navigation and discards all derived state, guaranteeing a
  full recompute on arrival.
- A tap must never `await` before navigating. Navigate, then load.

---

## 5. Render bodies

- No ledger/aggregate computation in a component body that isn't the component's
  own reason to exist. Derive it once, above, from a stable source.
- Never call an aggregate inside `.map()` over a collection. That is O(n·m) per
  render and it hides well.
- Watch for the same work done twice via different call paths — e.g. a progress
  helper that internally recomputes balances the caller already holds.
- A component holding text-input state must not also host expensive derived
  work: every keystroke pays for it.
- Split components at the boundary where state changes. A 1000-line component
  with 20 `useState` hooks re-renders everything for any one of them.

---

## 6. Loading states

- Gate on the data a screen actually needs, never on "everything has loaded".
  One slow collection must not blank a number that is already known.
- Render progressively: each row appears when its own data lands.
- Prefer a known-stale value with a refresh hint over a skeleton. A skeleton
  where a number used to be reads as data loss.
- Every listener/fetch error must settle its loading flag. An unsettled flag
  pins a skeleton for the rest of the session.

---

## 7. Bundle

- Anything behind a conditional (modals, sheets, QR generators, chart libs) is
  `next/dynamic`. A statically imported sheet ships on every visit to a route
  where it is usually closed.
- No heavy SDK at module scope in a file the root layout imports. That puts it
  on the critical path of every route, including ones that never use it.
- Check `First Load JS` after any dependency change.

---

## 8. The review loop

Run this on every diff before presenting it. Answer in order; stop early if an
answer says stop.

1. **Does this code need to exist?** Deleting beats optimising. Is there a
   simpler structure where the slow thing never happens? Prefer that.
2. **What number justified it?** Name the measurement. If there isn't one, this
   is a refactor — say so and justify it as one.
3. **What number moved?** Re-measure. Unverified, it isn't a perf fix.
4. **What did I make worse?** Bundle size, first paint, memory, a new
   subscription, a new failure mode, correctness under concurrency.
5. **Is this the framework's job?** Check `node_modules/next/dist/docs/` before
   hand-rolling. Hand-rolled caching, prefetching or memoization is usually a bug
   with extra steps.
6. **Would a reviewer reach for this pattern?** Novel is a smell. Boring is fast.
7. **Does it survive the edges?** Empty, one item, thousands, offline, mid-flight
   auth change, backgrounded tab, slow 3G.
8. **Is the money still exactly right?** See §9. Non-negotiable.

Then loop once: re-read the new code as if reviewing someone else's, and ask what
can now be removed. Optimisation usually ends in deletion, not addition.

---

## 9. Correctness gates (hard stop)

The money arithmetic in `src/lib/money.ts` and `src/lib/balance.ts` is correct —
a full replay of live data found zero discrepancies. Performance work must not
change its results.

Before presenting any change:

- `npx tsc --noEmit` clean
- `npx eslint` — no new warnings (2 pre-existing in `storage.ts`)
- `npm run build` succeeds; compare `First Load JS`
- If ledger/balance/statement code was touched, `node scripts/audit-balances.mjs`
  must still report zero CRITICAL findings, and `scripts/replay-pair.mjs` must
  produce figures identical to before the change.
- All amounts stay integer paise end to end. Never introduce a float rupee
  intermediate, and never reintroduce an epsilon comparison like `< 0.01`.

Delete temporary probe scripts once the number is recorded.

---

## 10. Honesty

- State what was measured and what was assumed. Never present an assumption as a
  finding.
- If a change doesn't help, say so and revert it. A null result is information.
- If the user's stated cause is wrong, say so with the evidence. "Firestore is
  slow at aggregating" was not what made this app slow — navigation and render
  cost were. Getting that wrong would have meant weeks aimed at the wrong layer.
