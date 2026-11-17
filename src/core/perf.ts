/**
 * Performance tiering + global animation pausing.
 *
 *  - Telegram for Android appends a performance class to the UA:
 *    "Telegram-Android/11.x (...; Android 14; SDK 34; LOW|AVERAGE|HIGH)".
 *    We trust that first, then fall back to hardware hints.
 *  - 'low' tier: no backdrop-filter on cards, fewer ambient particles, DPR 1.
 *  - prefers-reduced-motion: decorative loops stop, transitions become fades.
 */
import { tg } from './telegram';

export type Tier = 'low' | 'mid' | 'high';

function detectTier(): Tier {
  const ua = navigator.userAgent;
  const m = ua.match(/Telegram-Android\/[^\s]+ \(.*;\s*(LOW|AVERAGE|HIGH)\)/i);
  if (m) return m[1].toUpperCase() === 'LOW' ? 'low' : m[1].toUpperCase() === 'HIGH' ? 'high' : 'mid';
  // iOS/macOS WebKit hides real core counts but always composites blur well.
  if (/iPhone|iPad|Macintosh/.test(ua) || tg.platform === 'ios' || tg.platform === 'macos') return 'high';
  const cores = navigator.hardwareConcurrency || 4;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
  if (cores <= 4 || mem <= 2) return 'low';
  return cores >= 8 && mem >= 6 ? 'high' : 'mid';
}

const forced = new URLSearchParams(location.search).get('tier') as Tier | null;
export const tier: Tier = forced ?? detectTier();
export const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Visible + app active. Ambient loops subscribe to this. */
type Listener = (running: boolean) => void;
const listeners = new Set<Listener>();
let tgActive = true;
export const isRunning = () => !document.hidden && tgActive;
const emit = () => {
  const r = isRunning();
  document.documentElement.classList.toggle('is-paused', !r);
  listeners.forEach((l) => l(r));
};
export function onRunningChange(l: Listener) { listeners.add(l); return () => listeners.delete(l); }

/**
 * Focus mode: a heavy foreground animation (case opening) asks the ambient
 * layers to freeze in place — the video holds its current frame and the leaves
 * canvas stops redrawing — so every frame budget goes to the reel. Unlike
 * `is-paused` this does NOT stop CSS animations of the opening itself.
 */
let focus = 0;
const focusL = new Set<Listener>();
export const inFocus = () => focus > 0;
export function setFocus(on: boolean) {
  const was = focus > 0;
  focus = Math.max(0, focus + (on ? 1 : -1));
  if (was !== focus > 0) focusL.forEach((l) => l(focus > 0));
}
export function onFocusChange(l: Listener) { focusL.add(l); return () => focusL.delete(l); }

export function initPerf() {
  const html = document.documentElement;
  html.dataset.tier = tier;
  if (reducedMotion) html.classList.add('reduce-motion');
  // backdrop-filter support check (some old Android WebViews lack it)
  if (!CSS.supports('backdrop-filter', 'blur(1px)') && !CSS.supports('-webkit-backdrop-filter', 'blur(1px)')) {
    html.classList.add('no-blur');
  }
  document.addEventListener('visibilitychange', emit);
  tg.onActiveChange((a) => { tgActive = a; emit(); });
}

/** Max device-pixel-ratio for canvases per tier. */
export const maxDpr = tier === 'low' ? 1 : tier === 'mid' ? 1.5 : 2;
