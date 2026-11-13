import { tg } from '../core/telegram';

/**
 * iOS-style press feedback via event delegation (one listener for the app).
 * Any element with [data-press] scales down on pointerdown (fast ease-out)
 * and springs back on release (CSS spring easing, see tokens.css).
 * :active alone is unreliable on iOS WebView and fires late on Android.
 */
export function initPress(root: HTMLElement) {
  let active: HTMLElement | null = null;
  let startX = 0, startY = 0;
  const release = () => { active?.classList.remove('is-pressed'); active = null; };

  root.addEventListener('pointerdown', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-press]');
    if (!el || e.button > 0) return;
    active = el; startX = e.clientX; startY = e.clientY;
    el.classList.add('is-pressed');
  }, { passive: true });

  root.addEventListener('pointermove', (e) => {
    // Cancel the press if the finger starts scrolling.
    if (active && Math.hypot(e.clientX - startX, e.clientY - startY) > 10) release();
  }, { passive: true });

  for (const ev of ['pointerup', 'pointercancel', 'pointerleave'] as const) root.addEventListener(ev, release, { passive: true });

  root.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-press]');
    if (el) el.dataset.haptic === 'select' ? tg.haptic.select() : tg.haptic.tap();
  });
}
