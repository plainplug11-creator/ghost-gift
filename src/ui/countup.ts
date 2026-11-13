import { reducedMotion } from '../core/perf';

const running = new WeakMap<HTMLElement, { raf: number; cur: number }>();

/** Smoothly tween a number displayed in `el` (rAF, ease-out-expo). Restarts from the on-screen value if interrupted. */
export function countTo(el: HTMLElement, from: number, to: number, format: (n: number) => string, ms = 700) {
  const prev = running.get(el);
  if (prev) { cancelAnimationFrame(prev.raf); from = prev.cur; }
  if (reducedMotion || from === to) { el.textContent = format(to); running.delete(el); return; }
  const t0 = performance.now();
  const st = { raf: 0, cur: from };
  running.set(el, st);
  const step = (now: number) => {
    const p = Math.min(1, (now - t0) / ms);
    const e = p === 1 ? 1 : 1 - Math.pow(2, -10 * p);
    st.cur = from + (to - from) * e;
    el.textContent = format(st.cur);
    if (p < 1) st.raf = requestAnimationFrame(step); else running.delete(el);
  };
  st.raf = requestAnimationFrame(step);
}
