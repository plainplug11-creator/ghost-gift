import { h } from '../core/dom';
import { reducedMotion } from '../core/perf';
import { pushBack, removeBack } from './router';

/**
 * iOS-style bottom sheet: backdrop fade + spring slide-up, drag-down to dismiss,
 * Telegram BackButton closes it (top of the back stack).
 */
export interface Sheet { el: HTMLElement; body: HTMLElement; close(): Promise<void> }

export function openSheet(content: Node[], opts: { cls?: string; dismissable?: boolean; onClose?: () => void } = {}): Sheet {
  const dismissable = opts.dismissable !== false;
  const body = h('div', { class: 'bs-body' }, ...content);
  const panel = h('div', { class: 'bs-panel' }, h('span', { class: 'bs-grab' }), body);
  const el = h('div', { class: `bs ${opts.cls ?? ''}`, role: 'dialog', 'aria-modal': 'true' }, h('div', { class: 'bs-backdrop' }), panel);
  document.body.append(el);
  void el.offsetWidth;
  el.classList.add('is-open');

  let closed = false;
  const close = () => new Promise<void>((res) => {
    if (closed) return res();
    closed = true;
    removeBack(back);
    el.classList.remove('is-open'); el.classList.add('is-closing');
    panel.style.transform = '';
    const done = () => { el.remove(); opts.onClose?.(); res(); };
    reducedMotion ? done() : setTimeout(done, 380);
  });
  const back = () => { if (dismissable) close(); };
  pushBack(back);
  if (dismissable) el.querySelector('.bs-backdrop')!.addEventListener('click', () => close());

  // drag to dismiss (grab area + body when scrolled to top)
  let y0 = 0, dy = 0, dragging = false;
  panel.addEventListener('pointerdown', (e) => {
    if (!dismissable || body.scrollTop > 0 || (e.target as HTMLElement).closest('button')) return;
    dragging = true; y0 = e.clientY; dy = 0; panel.style.transition = 'none';
  });
  panel.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    dy = Math.max(0, e.clientY - y0);
    panel.style.transform = `translate3d(0, ${dy}px, 0)`;
  });
  const end = () => {
    if (!dragging) return; dragging = false; panel.style.transition = '';
    if (dy > 110) close(); else panel.style.transform = '';
  };
  panel.addEventListener('pointerup', end); panel.addEventListener('pointercancel', end);

  return { el, body, close };
}

/** Lightweight toast at the top (below the Telegram controls). */
export function toast(text: string, kind: 'ok' | 'info' | 'err' = 'ok') {
  const el = h('div', { class: `toast toast-${kind}`, role: 'status' }, text);
  document.body.append(el);
  void el.offsetWidth; el.classList.add('is-in');
  setTimeout(() => { el.classList.remove('is-in'); setTimeout(() => el.remove(), 400); }, 2200);
}
