import { h } from '../core/dom';

/** Shimmering placeholder block (opacity/transform-only shimmer, compositor-friendly). */
export function skeleton(height: number, cls = '') {
  return h('div', { class: `skel ${cls}`, style: `height:${height}px`, 'aria-hidden': 'true' }, h('i'));
}
/** N placeholder rows. */
export function skeletonRows(n: number, height = 56) {
  return Array.from({ length: n }, () => skeleton(height, 'skel-row'));
}
