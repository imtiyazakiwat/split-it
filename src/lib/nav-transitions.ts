"use client";

/**
 * iOS navigation motion for a route-per-screen App Router app.
 *
 * ── Why this is hand-rolled (and not React's <ViewTransition>) ──────────────
 * Checked against this exact Next (16.2.10) before writing it:
 *
 * - A back/forward traversal is dispatched as ACTION_RESTORE, whose setState
 *   lands in a microtask outside `startTransition`, during a `popstate` event —
 *   a SyncLane update. React only runs view transitions for transition lanes,
 *   so every Back (browser, Android, a chevron using history.back) would swap
 *   with no animation at all.
 * - An interactive edge-swipe needs the previous screen visible under the
 *   finger before the navigation commits. View transitions can't scrub that.
 *
 * So: just before a navigation, the departing screen's DOM is cloned into a
 * static, inert "ghost" pinned exactly where it was on screen. When the
 * arriving screen commits (its layout effect, before first paint) the two are
 * animated against each other — push: the new screen slides in from the
 * trailing edge over the ghost, which parallaxes to −30% and dims; pop: the
 * exact reverse. The old React tree is unmounted the moment the new one
 * commits; nothing is kept alive, and no wrapper is keyed on the route
 * (steering §4).
 *
 * The ghost of a screen you push away from is kept, detached, on a small
 * stack: it is what the edge-swipe shows underneath the finger.
 */

export type NavKind = "push" | "pop" | "tab" | "none" | "swap";

export type TabId = "groups" | "pay" | "activity" | "reports" | "settings";

/** Screens that are the root of a tab. Reaching one is a tab switch. */
const TAB_ROOTS = new Map<string, TabId>([
  ["/", "groups"],
  ["/pay", "pay"],
  ["/activity", "activity"],
  ["/reports", "reports"],
  ["/settings", "settings"],
]);

/**
 * The tab a path belongs to on its own — a deep link, a reload. Once the app
 * is running, a pushed screen instead stays in the tab it was pushed from
 * (each tab owns its own stack, as in UITabBarController): a statement opened
 * from Groups is still in Groups, and Back returns there.
 */
export function tabOfPath(pathname: string): TabId | null {
  if (pathname === "/" || pathname.startsWith("/groups") || pathname === "/notifications") return "groups";
  if (pathname.startsWith("/pay") || pathname.startsWith("/chat")) return "pay";
  if (pathname.startsWith("/activity")) return "activity";
  if (pathname.startsWith("/reports")) return "reports";
  if (pathname.startsWith("/settings")) return "settings";
  return null;
}

const pathOf = (key: string) => key.split("?")[0];

interface StackEntry {
  key: string;
  /** How this entry was reached, so popping back off a tab switch fades. */
  via: "push" | "tab" | "root";
  /** Snapshot of this screen as it was left, for the swipe-back underlay. */
  ghost: HTMLElement | null;
  /** The tab whose stack this screen is in. */
  tab: TabId | null;
}

interface Pending {
  /** The motion. */
  kind: NavKind;
  /** The history direction: a back pops the stack even when it fades. */
  back: boolean;
  /** Where it was asked to go, when known (history traversals don't say). */
  target: string | null;
  /** A history traversal: the browser restores the scroll position. */
  traversal: boolean;
  fromKey: string | null;
  ghost: HTMLElement | null;
  at: number;
}

interface Active {
  id: number;
  kind: NavKind;
  start: number;
  finish: () => void;
}

const MAX_GHOSTS = 4;
const PENDING_TTL = 2500;

let pending: Pending | null = null;
let active: Active | null = null;
let activeSeq = 0;
/** Key of the screen on display. Persists across the unmount/mount gap. */
let currentKey: string | null = null;
let currentEl: HTMLElement | null = null;
/** Where Back goes from the current screen when there is no in-app history. */
let currentBack: string | null = null;
let stack: StackEntry[] = [];
let lastScrollY = 0;
let swipeUnderlay: HTMLElement | null = null;
let swipeDim: HTMLElement | null = null;
let swapCleanup: (() => void) | null = null;

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

// ── Selected tab (read by the tab bar via useSyncExternalStore) ────────────

export interface TabSnapshot {
  /** The path this answer is for; anything else falls back to tabOfPath. */
  path: string;
  tab: TabId | null;
}

let tabSnap: TabSnapshot | null = null;
const tabListeners = new Set<() => void>();

function publishTab(path: string, tab: TabId | null) {
  if (tabSnap && tabSnap.path === path && tabSnap.tab === tab) return;
  tabSnap = { path, tab };
  tabListeners.forEach((l) => l());
}

export function subscribeTab(listener: () => void): () => void {
  tabListeners.add(listener);
  return () => {
    tabListeners.delete(listener);
  };
}

export function getTabSnapshot(): TabSnapshot | null {
  return tabSnap;
}

/** The tab a screen belongs to with no stack to inherit from. */
function ownTab(key: string): TabId | null {
  return TAB_ROOTS.get(key) ?? tabOfPath(pathOf(key));
}

/** Which tab's stack a screen arriving by `kind` lands in. */
function tabForArrival(kind: NavKind, key: string): TabId | null {
  if (TAB_ROOTS.has(key)) return ownTab(key);
  if (kind === "push" || kind === "none") return stack[stack.length - 1]?.tab ?? ownTab(key);
  return ownTab(key);
}

/**
 * Tell the tab bar where a navigation is headed as it starts, so the
 * selection is already right on the frame the new screen first paints.
 */
function predictTab(kind: NavKind, back: boolean, targetKey: string) {
  if (back) {
    const prev = previousEntry();
    publishTab(pathOf(targetKey), prev && prev.key === targetKey ? prev.tab : ownTab(targetKey));
    return;
  }
  publishTab(pathOf(targetKey), tabForArrival(kind, targetKey));
}

function reducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * The push duration token in ms. The production CSS minifier rewrites
 * `562ms` as `.562s`, so the unit has to be read, not assumed.
 */
function durationMs(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--dur-push").trim();
  const n = parseFloat(raw);
  if (!Number.isFinite(n) || n <= 0) return 560;
  return raw.endsWith("ms") ? n : raw.endsWith("s") ? n * 1000 : n;
}

/**
 * The identity of a *screen*, which is not the same as a URL: `?expense=`
 * opens a sheet over the group screen, so it is not part of the key;
 * `?person=` on Reports drills into a different screen, so it is.
 */
export function screenKeyFromUrl(href: string): string {
  try {
    const u = new URL(href, typeof window !== "undefined" ? window.location.href : "http://x");
    const person = u.pathname === "/reports" ? u.searchParams.get("person") : null;
    return person ? `${u.pathname}?person=${person}` : u.pathname;
  } catch {
    return href;
  }
}

/**
 * The pieces of a screen that move. A scrolling screen moves its bar and its
 * body separately (the bar is fixed); a fixed, full-height screen (the
 * conversation) moves as one, so its root carries the marker itself —
 * querySelectorAll alone never returns the element it's called on.
 */
function parts(el: HTMLElement): HTMLElement[] {
  const inner = Array.from(el.querySelectorAll<HTMLElement>("[data-screen-part]"));
  return el.hasAttribute("data-screen-part") ? [el, ...inner] : inner;
}

const ANIM_CLASSES = [
  "nt-push-in",
  "nt-pop-in",
  "nt-part-elevated",
  "nt-push-out",
  "nt-pop-out",
  "nt-tab-out",
  "is-under",
  "is-over",
];

function clearAnim(el: HTMLElement) {
  el.classList.remove(...ANIM_CLASSES);
  el.style.animationDelay = "";
}

/** A static, inert copy of the current screen, pinned where it is on screen. */
function captureGhost(): HTMLElement | null {
  const screen = currentEl;
  if (!screen || !screen.isConnected) return null;
  const rect = screen.getBoundingClientRect();
  // On popstate the browser may already have restored the *destination's*
  // scroll position onto the departing page; lastScrollY is where the user
  // actually was.
  const top = rect.top + (window.scrollY - lastScrollY);
  const clone = screen.cloneNode(true) as HTMLElement;
  clone.removeAttribute("data-screen");
  parts(clone).forEach((p) => {
    clearAnim(p);
    p.style.transform = "";
    p.style.transition = "";
  });
  // Live form values aren't attributes, so cloneNode doesn't carry them.
  const live = screen.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea");
  const copies = clone.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea");
  live.forEach((f, i) => {
    const c = copies[i];
    if (c && f.type !== "file") c.value = f.value;
  });

  const ghost = document.createElement("div");
  ghost.className = "nt-ghost";
  ghost.setAttribute("aria-hidden", "true");
  ghost.inert = true;
  const content = document.createElement("div");
  content.className = "nt-ghost-content";
  content.style.top = `${top}px`;
  content.style.height = `${rect.height}px`;
  content.appendChild(clone);
  ghost.appendChild(content);
  const dim = document.createElement("div");
  dim.className = "nt-dim";
  ghost.appendChild(dim);
  return ghost;
}

function finishActive() {
  const a = active;
  active = null;
  a?.finish();
}

/**
 * Call immediately before a navigation starts: a tap, a back, a popstate.
 * `targetHref` is where it's going, when that's known up front; `back` is the
 * history direction when it differs from what the motion implies (a Back
 * that fades because it undoes a tab switch).
 */
export function prepareTransition(kind: NavKind, targetHref?: string, back?: boolean, traversal = false) {
  if (typeof window === "undefined") return;
  finishActive();
  const targetKey = targetHref ? screenKeyFromUrl(targetHref) : null;
  if (targetKey && currentKey && targetKey === currentKey) return;
  const isBack = back ?? (kind === "pop" || kind === "swap");
  // Opening another tab's root from inside content (a notification, a
  // "Set up in Settings" link) is a tab switch, not a push into this stack.
  if (kind === "push" && targetKey && TAB_ROOTS.has(targetKey)) kind = "tab";
  const ghost =
    kind === "none" || kind === "swap" || reducedMotion() ? null : captureGhost();
  pending = {
    kind,
    back: isBack,
    target: targetHref ?? null,
    traversal,
    fromKey: currentKey,
    ghost,
    at: now(),
  };
  if (targetKey) predictTab(kind, isBack, targetKey);
}

function rememberGhost(ghost: HTMLElement | null) {
  const top = stack[stack.length - 1];
  if (top) top.ghost = ghost;
  // Snapshots are only useful a level or two down; cap the memory they hold.
  let kept = 0;
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].ghost && ++kept > MAX_GHOSTS) stack[i].ghost = null;
  }
}

function updateStack(kind: NavKind, back: boolean, key: string, ghost: HTMLElement | null) {
  if (!back && (kind === "push" || kind === "tab")) {
    const tab = tabForArrival(kind, key);
    rememberGhost(ghost);
    stack.push({ key, via: kind, ghost: null, tab });
    if (stack.length > 30) stack = stack.slice(-30);
    return;
  }
  if (back) {
    stack.pop();
    const top = stack[stack.length - 1];
    if (!top || top.key !== key) {
      stack = [{ key, via: "root", ghost: null, tab: ownTab(key) }];
    } else top.ghost = null;
    return;
  }
  // "none": an in-place replacement (a redirect, a replace()).
  const tab = tabForArrival("none", key);
  if (stack.length === 0) stack.push({ key, via: "root", ghost: null, tab });
  else stack[stack.length - 1] = { key, via: stack[stack.length - 1].via, ghost: null, tab };
}

function run(kind: NavKind, ghost: HTMLElement, screen: HTMLElement) {
  const ps = parts(screen);
  const dim = ghost.querySelector<HTMLElement>(".nt-dim");
  let dimLayer: HTMLElement | null = null;
  clearAnim(ghost);
  if (kind === "push") {
    ghost.classList.add("is-under", "nt-push-out");
    dim?.classList.add("nt-dim-in");
    ps.forEach((p) => p.classList.add("nt-push-in"));
    ps[ps.length - 1]?.classList.add("nt-part-elevated");
  } else if (kind === "pop") {
    ghost.classList.add("is-over", "nt-pop-out");
    dimLayer = document.createElement("div");
    dimLayer.className = "nt-dim-layer nt-dim-out";
    document.body.appendChild(dimLayer);
    ps.forEach((p) => p.classList.add("nt-pop-in"));
  } else {
    ghost.classList.add("is-over", "nt-tab-out");
  }
  document.body.appendChild(ghost);

  const id = ++activeSeq;
  const joined: HTMLElement[] = [];
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    ghost.remove();
    clearAnim(ghost);
    dim?.classList.remove("nt-dim-in");
    dimLayer?.remove();
    ps.forEach(clearAnim);
    joined.forEach(clearAnim);
    if (active?.id === id) active = null;
  };
  // Land exactly: a safety timer, not only animationend, so a backgrounded tab
  // or an interrupted animation can never leave a sliver of a screen behind.
  const timer = setTimeout(finish, (kind === "tab" ? 160 : durationMs()) + 80);
  ghost.addEventListener("animationend", (e) => {
    if (e.target === ghost) finish();
  });
  active = {
    id,
    kind,
    start: now(),
    finish,
  };
  activeJoined = joined;
}

let activeJoined: HTMLElement[] = [];

/** A replacement screen mounting mid-move (skeleton → content) joins in step. */
function joinActive(screen: HTMLElement) {
  if (!active || (active.kind !== "push" && active.kind !== "pop")) return;
  const elapsed = now() - active.start;
  const cls = active.kind === "push" ? "nt-push-in" : "nt-pop-in";
  parts(screen).forEach((p) => {
    p.style.animationDelay = `-${Math.round(elapsed)}ms`;
    p.classList.add(cls);
    activeJoined.push(p);
  });
}

/**
 * Called by <Screen> from a layout effect: the new screen is in the DOM but
 * not yet painted, so the first frame the user sees is already mid-motion.
 */
export function registerScreen(el: HTMLElement, backHref: string | null): () => void {
  const key = screenKeyFromUrl(window.location.href);
  const prevKey = currentKey;
  currentKey = key;
  currentEl = el;
  currentBack = backHref;

  if (swapCleanup) {
    swapCleanup();
    swapCleanup = null;
  }

  const p = pending && now() - pending.at < PENDING_TTL ? pending : null;
  if (p && p.fromKey !== key) {
    pending = null;
    updateStack(p.kind, p.back, key, p.ghost);
    // A screen you arrive at starts at its top. Next's own scroll-to-top
    // can't be relied on here: it runs for the page segment, which mounts
    // after the loading skeleton, by which time the browser has clamped the
    // old offset and then re-applied it as the content grew — landing the
    // new screen scrolled to wherever the old one was. A history traversal
    // (Back with history behind it) is left to the browser's restoration,
    // which returns you to where you were.
    if (!p.traversal && window.scrollY !== 0) window.scrollTo(0, 0);
    repairColdStartQuery(p.target);
    if (p.ghost && (p.kind === "push" || p.kind === "pop" || p.kind === "tab")) {
      run(p.kind, p.ghost, el);
    }
  } else if (active && prevKey === key) {
    joinActive(el);
  } else if (prevKey !== key) {
    updateStack("none", false, key, null);
  }
  const top = stack[stack.length - 1];
  if (top) publishTab(pathOf(top.key), top.tab);

  return () => {
    if (currentEl === el) currentEl = null;
  };
}

export function canSwipeBack(): boolean {
  return !!currentEl && !!currentBack && !reducedMotion();
}

/** The in-app entry we would go back to, if we know of one. */
function previousEntry(): StackEntry | undefined {
  return stack.length >= 2 ? stack[stack.length - 2] : undefined;
}

/**
 * Back, the iOS way: pop the real history entry when we know it's ours, so
 * Android's back button, the browser and the chevron all agree. With no in-app
 * history (a deep link, a reload) replace with the parent rather than leave.
 */
export function navigateBack(replace: (href: string) => void, fallbackHref: string) {
  const prev = previousEntry();
  const top = stack[stack.length - 1];
  if (prev) {
    prepareTransition(top?.via === "tab" ? "tab" : "pop", undefined, true, true);
    publishTab(pathOf(prev.key), prev.tab);
    window.history.back();
    return;
  }
  // Replacing: this entry becomes the parent, which starts its own stack.
  prepareTransition("pop", fallbackHref, true);
  if (!replaceSamePath(fallbackHref)) replace(fallbackHref);
}

/** Pops to `rootHref` if it is the screen directly beneath; else pushes it as a pop. */
export function navigateToRoot(
  rootHref: string,
  push: (href: string) => void
) {
  const prev = previousEntry();
  if (prev && prev.key === screenKeyFromUrl(rootHref)) {
    navigateBack(push, rootHref);
    return;
  }
  prepareTransition("pop", rootHref);
  if (!replaceSamePath(rootHref)) push(rootHref);
}

// ── Next 16.2 stale-query workaround ───────────────────────────────────────
//
// On a cold start, Next seeds its route cache with the initial URL under the
// *rendered* search — empty for a prerendered page — but keeps the full URL
// as that entry's canonical URL. Every later soft navigation to the same path
// then lands on the cold-start query instead: open the app on
// /reports?person=a and the Reports tab, Back and the segmented control can
// never reach /reports again (vercel/next.js#91658, #92187; dynamic routes
// are unaffected). Two narrow fixes, both through the History API, which the
// App Router integrates with (usePathname/useSearchParams follow it):

/**
 * A same-path URL change (a statement back to its list, a segment) needs no
 * router navigation at all — the page reads its query on the client — so
 * make it with the History API, which the bug can't reach. Returns false
 * when `href` is a different path and needs a real navigation.
 */
export function replaceSamePath(href: string): boolean {
  if (typeof window === "undefined") return false;
  const u = new URL(href, window.location.href);
  if (u.pathname !== window.location.pathname) return false;
  window.history.replaceState(null, "", u.pathname + u.search + u.hash);
  return true;
}

/** The URL the app was opened at; only its query can poison the cache. */
const coldStart =
  typeof window !== "undefined" ? { path: window.location.pathname, search: window.location.search } : null;

/**
 * Arriving on the cold-start path from elsewhere (the Reports tab after
 * opening on a statement): if Next restored the stale query, put the one we
 * asked for back. Deferred a task because Next writes the URL for this
 * navigation in a parent layout effect, after this screen registers.
 */
function repairColdStartQuery(target: string | null) {
  if (!target || !coldStart?.search) return;
  const want = new URL(target, window.location.href);
  if (want.pathname !== coldStart.path || want.search === coldStart.search) return;
  setTimeout(() => {
    if (window.location.pathname === want.pathname && window.location.search === coldStart.search) {
      window.history.replaceState(null, "", want.pathname + want.search + want.hash);
    }
  }, 0);
}

/** Which way the in-flight (or just-started) transition is going. */
export function activeKind(): NavKind | null {
  return active?.kind ?? pending?.kind ?? null;
}

// ── Edge swipe ────────────────────────────────────────────────────────────

/** Puts the previous screen, as it was left, under the one being dragged. */
export function beginSwipe(): void {
  finishActive();
  const prev = previousEntry();
  swipeDim = document.createElement("div");
  swipeDim.className = "nt-dim-layer";
  swipeDim.style.zIndex = "-1";
  swipeDim.style.opacity = "0.12";
  if (prev?.ghost) {
    swipeUnderlay = prev.ghost;
    clearAnim(swipeUnderlay);
    swipeUnderlay.classList.add("is-under");
    swipeUnderlay.style.transform = "translate3d(-30%, 0, 0)";
    document.body.appendChild(swipeUnderlay);
  }
  document.body.appendChild(swipeDim);
  if (currentEl) parts(currentEl).at(-1)?.classList.add("nt-part-elevated");
}

export function updateSwipe(dx: number, width: number): void {
  if (!currentEl) return;
  const p = Math.max(0, Math.min(1, dx / width));
  parts(currentEl).forEach((part) => {
    part.style.transition = "none";
    part.style.transform = `translate3d(${Math.max(0, dx)}px, 0, 0)`;
  });
  if (swipeUnderlay) swipeUnderlay.style.transform = `translate3d(${-30 * (1 - p)}%, 0, 0)`;
  if (swipeDim) swipeDim.style.opacity = String(0.12 * (1 - p));
}

function settleSwipe(
  toX: string,
  underTo: string,
  dimTo: string,
  ms: number,
  ease: string,
  after: () => void
) {
  const ps = currentEl ? parts(currentEl) : [];
  const t = `transform ${ms}ms ${ease}`;
  ps.forEach((part) => {
    part.style.transition = t;
    part.style.transform = toX;
  });
  if (swipeUnderlay) {
    swipeUnderlay.style.transition = t;
    swipeUnderlay.style.transform = underTo;
  }
  if (swipeDim) {
    swipeDim.style.transition = `opacity ${ms}ms ${ease}`;
    swipeDim.style.opacity = dimTo;
  }
  setTimeout(after, ms + 20);
}

function resetParts(el: HTMLElement | null) {
  if (!el) return;
  parts(el).forEach((part) => {
    part.style.transition = "";
    part.style.transform = "";
    part.classList.remove("nt-part-elevated");
  });
}

function detachSwipeLayers() {
  if (swipeUnderlay) {
    swipeUnderlay.remove();
    swipeUnderlay.style.transform = "";
    swipeUnderlay.style.transition = "";
    clearAnim(swipeUnderlay);
  }
  swipeDim?.remove();
  swipeUnderlay = null;
  swipeDim = null;
}

export function cancelSwipe(): void {
  const el = currentEl;
  settleSwipe("translate3d(0, 0, 0)", "translate3d(-30%, 0, 0)", "0.12", 320, "var(--spring-snappy)", () => {
    resetParts(el);
    detachSwipeLayers();
  });
}

/**
 * Finishes the slide off-screen, then navigates. The underlay stays in place
 * until the real previous screen commits (registerScreen removes it in that
 * same pre-paint frame), so there's no flash between snapshot and live page.
 */
export function commitSwipe(velocity: number, replace: (href: string) => void): void {
  const fallbackHref = currentBack ?? "/";
  const dragged = currentEl;
  const width = window.innerWidth;
  const first = dragged ? parts(dragged)[0] : null;
  const at = first ? new DOMMatrixReadOnly(getComputedStyle(first).transform).m41 : 0;
  const remaining = Math.max(0, width - at);
  const ms = Math.round(
    Math.max(140, Math.min(320, velocity > 0 ? (remaining / velocity) * 1000 : 260))
  );
  settleSwipe("translate3d(100%, 0, 0)", "translate3d(0, 0, 0)", "0", ms, "var(--ease-ios)", () => {
    const underlay = swipeUnderlay;
    const dim = swipeDim;
    swipeUnderlay = null;
    swipeDim = null;
    let restored = false;
    const restore = () => {
      if (restored) return;
      restored = true;
      if (underlay) {
        underlay.remove();
        underlay.style.transform = "";
        underlay.style.transition = "";
        clearAnim(underlay);
      }
      dim?.remove();
    };
    swapCleanup = restore;
    // If nothing commits (navigation failed or left the app), put it back.
    setTimeout(() => {
      if (restored) return;
      restore();
      swapCleanup = null;
      if (dragged?.isConnected) resetParts(dragged);
    }, 1500);
    const prev = previousEntry();
    pending = {
      kind: "swap",
      back: true,
      target: prev ? null : fallbackHref,
      traversal: !!prev,
      fromKey: currentKey,
      ghost: null,
      at: now(),
    };
    if (prev) {
      publishTab(pathOf(prev.key), prev.tab);
      window.history.back();
    } else {
      const parentKey = screenKeyFromUrl(fallbackHref);
      publishTab(pathOf(parentKey), ownTab(parentKey));
      if (!replaceSamePath(fallbackHref)) replace(fallbackHref);
    }
  });
}

// ── Global listeners (browser only, once, at module load) ──────────────────

if (typeof window !== "undefined") {
  lastScrollY = window.scrollY;
  window.addEventListener(
    "scroll",
    () => {
      lastScrollY = window.scrollY;
    },
    { passive: true }
  );
  // Capture phase: for events targeted at window, capturing listeners run
  // before Next's own (non-capturing) popstate handler, so the departing screen
  // is cloned before React replaces it.
  window.addEventListener(
    "popstate",
    (event: PopStateEvent) => {
      const newKey = screenKeyFromUrl(window.location.href);
      if (newKey === currentKey) {
        // Same screen (a sheet's ?param closing): nothing to animate.
        if (pending && pending.kind !== "swap") pending = null;
        return;
      }
      // Our own back (chevron, swipe) already prepared this navigation.
      if (pending && now() - pending.at < 400) return;
      const prev = previousEntry();
      const top = stack[stack.length - 1];
      const isBack = !!prev && prev.key === newKey;
      // Safari's and Chrome's own swipe-back already animated it.
      if ((event as PopStateEvent & { hasUAVisualTransition?: boolean }).hasUAVisualTransition) {
        const kind: NavKind = isBack ? "pop" : "push";
        pending = { kind, back: isBack, target: null, traversal: true, fromKey: currentKey, ghost: null, at: now() };
        predictTab(kind, isBack, newKey);
        return;
      }
      if (isBack) prepareTransition(top?.via === "tab" ? "tab" : "pop", window.location.href, true, true);
      else prepareTransition("push", window.location.href, false, true);
    },
    { capture: true }
  );
}
