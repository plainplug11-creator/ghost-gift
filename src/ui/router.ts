import { h } from '../core/dom';
import { reducedMotion } from '../core/perf';
import { tg } from '../core/telegram';

/**
 * Minimal in-memory router (no hash routing — Telegram uses the URL hash for
 * launch params). Two tabs + an iOS-style push STACK for detail pages
 * (cases → case → …). Pages are lazy-loaded modules → the main bundle stays tiny.
 *
 * One back-handler stack serves Telegram's BackButton, the in-app back arrows
 * and bottom sheets: the top-most handler wins (sheet → page → nothing).
 */
export type Tab = 'games' | 'profile';
export type PushId = 'cases' | 'case' | 'daily' | 'inventory' | 'wheel' | 'slots' | 'luck' | 'topup';

export interface Page { el: HTMLElement; onShow?(): void; onHide?(): void; destroy?(): void; /** return false to veto back (e.g. mid-opening) */ onBack?(): boolean | void; /** @internal */ backFn?: () => void }
type TabScreen = { el: HTMLElement; onShow?(): void; onHide?(): void };
type Listener = (tab: Tab, covered: boolean) => void;

const tabs = new Map<Tab, TabScreen>();
const lazyTabs = new Map<Tab, () => Promise<TabScreen>>();
const listeners = new Set<Listener>();
let current: Tab = 'games';
let screensEl!: HTMLElement;
let appEl!: HTMLElement;
const stack: { page: Page; wrap: HTMLElement }[] = [];

// ── back-handler stack (BackButton + sheets + pages) ──
const backs: (() => void)[] = [];
const onTgBack = () => backs[backs.length - 1]?.();
let tgBackShown = false;
const syncTgBack = () => {
  const want = backs.length > 0;
  if (want === tgBackShown) return;
  tgBackShown = want;
  want ? tg.backButton.show(onTgBack) : tg.backButton.hide(onTgBack);
};
export function pushBack(fn: () => void) { backs.push(fn); syncTgBack(); }
export function removeBack(fn: () => void) { const i = backs.lastIndexOf(fn); if (i >= 0) backs.splice(i, 1); syncTgBack(); }

export function initRouter(app: HTMLElement, screens: HTMLElement) { appEl = app; screensEl = screens; }
export function registerTab(id: Tab, s: TabScreen) { tabs.set(id, s); screensEl.append(s.el); }
export function registerLazyTab(id: Tab, loader: () => Promise<TabScreen>) { lazyTabs.set(id, loader); }
export function onRoute(l: Listener) { listeners.add(l); }
const emit = () => listeners.forEach((l) => l(current, stack.length > 0));

async function ensure(id: Tab) {
  if (tabs.has(id)) return tabs.get(id)!;
  const s = await lazyTabs.get(id)!();
  registerTab(id, s);
  void s.el.offsetWidth; // commit initial style before transition
  return s;
}

type Params = Record<string, string>;
const PAGES: Partial<Record<PushId, (p: Params) => Promise<Page>>> = {
  cases: () => import('../screens/cases').then((m) => m.createCases()),
  case: (p) => import('../screens/case').then((m) => m.createCase(p.id)),
  daily: () => import('../screens/case').then((m) => m.createCase('daily')),
  inventory: () => import('../screens/inventory').then((m) => m.createInventory()),
};

/** Warm lazy modules when the main thread is idle. */
export function prefetch() {
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 1200));
  idle(() => { lazyTabs.forEach((_, id) => ensure(id)); import('../screens/cases'); import('../screens/soon'); });
}

let busy = false;
export const navigate = {
  current: () => current,
  depth: () => stack.length,
  async tab(id: Tab) {
    while (stack.length) navigate.back(true);
    if (id === current) { tabs.get(id)?.el.querySelector('.screen-scroll')?.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    const prev = tabs.get(current)!;
    const next = await ensure(id);
    const dir = id === 'profile' ? 1 : -1;
    screensEl.style.setProperty('--dir', String(dir));
    prev.el.classList.remove('is-active'); prev.el.classList.add('is-leaving'); prev.el.inert = true;
    next.el.classList.remove('is-leaving'); next.el.classList.add('is-active'); next.el.inert = false;
    prev.onHide?.(); next.onShow?.();
    current = id; emit();
    setTimeout(() => prev.el.classList.remove('is-leaving'), reducedMotion ? 0 : 420);
  },
  async push(id: PushId, params: Params = {}) {
    if (busy) return;
    busy = true;
    try {
      const loader = PAGES[id];
      const page: Page = loader ? await loader(params) : await import('../screens/soon').then((m) => ({ el: m.createSoon(id, () => navigate.back()) }));
      const wrap = h('div', { class: 'sheet', role: 'dialog' }, page.el);
      wrap.style.zIndex = String(40 + stack.length * 2);
      const under = stack[stack.length - 1];
      appEl.parentElement!.append(wrap);
      void wrap.offsetWidth;
      wrap.classList.add('is-open');
      if (under) { under.wrap.classList.add('is-covered'); under.wrap.inert = true; under.page.onHide?.(); }
      else { appEl.classList.add('is-covered'); appEl.inert = true; }
      stack.push({ page, wrap });
      pushBack(page.backFn = () => navigate.back());
      page.onShow?.();
      emit();
    } finally { busy = false; }
  },
  back(force = false) {
    const top = stack[stack.length - 1];
    if (!top) return;
    if (!force && top.page.onBack?.() === false) return;
    stack.pop();
    removeBack(top.page.backFn!);
    top.page.onHide?.();
    const s = top.wrap;
    s.classList.remove('is-open');
    const under = stack[stack.length - 1];
    if (under) { under.wrap.classList.remove('is-covered'); under.wrap.inert = false; under.page.onShow?.(); }
    else { appEl.classList.remove('is-covered'); appEl.inert = false; }
    emit();
    let gone = false;
    const done = () => { if (gone) return; gone = true; s.remove(); top.page.destroy?.(); };
    reducedMotion ? done() : s.addEventListener('transitionend', (e) => e.target === s && done());
    setTimeout(done, 700);
  },
};

