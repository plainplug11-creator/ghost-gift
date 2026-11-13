/**
 * Game-card hero art — one cohesive "jelly" cartoon set (rendered cut-outs,
 * 240w/480w srcset). Motion lives in CSS on HTML wrappers (transform/opacity
 * only → compositor). Wheel spins as an image with a static jelly pointer +
 * currency hub on top.
 */
import chest240 from '../assets/chest-240.webp';
import chest480 from '../assets/chest-480.webp';
import gift240 from '../assets/gift-240.webp';
import gift480 from '../assets/gift-480.webp';
import wheel240 from '../assets/wheel-240.webp';
import wheel480 from '../assets/wheel-480.webp';
import slots240 from '../assets/slots-240.webp';
import slots480 from '../assets/slots-480.webp';
import { CURRENCY_URL } from '../core/dom';
import type { JellyIcon } from './icon-names';

const img = (a: string, b: string) =>
  `<img srcset="${a} 240w, ${b} 480w" sizes="(min-width: 600px) 220px, 140px" src="${a}" alt="" decoding="async" draggable="false">`;
const sparkles = `<span class="spk spk1"></span><span class="spk spk2"></span><span class="spk spk3"></span>`;
const hero = (cls: string, inner: string) =>
  `<div class="art art-img ${cls}" aria-hidden="true"><span class="art-floor"></span><span class="art-float">${inner}</span>${sparkles}</div>`;

export const casesArt = hero('art-cases', img(chest240, chest480));
export const dailyArt = hero('art-daily', img(gift240, gift480));
export const slotsArt = hero('art-slots', img(slots240, slots480));
export const wheelArt = hero('art-wheel', `
  <span class="wh-rotor">${img(wheel240, wheel480)}</span>
  <img class="wh-hub" src="${CURRENCY_URL}" alt="" draggable="false">
  <svg class="wh-pointer" viewBox="0 0 24 30">
    <defs>
      <linearGradient id="whp-f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff9ee0"/><stop offset="1" stop-color="#e83aa8"/></linearGradient>
      <linearGradient id="whp-h" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".9"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
    </defs>
    <path d="M12 28.5c-1 0-1.7-.6-2.2-1.5L3.4 14.6A9.5 9.5 0 1 1 20.6 14.6L14.2 27c-.5.9-1.2 1.5-2.2 1.5z" fill="url(#whp-f)" stroke="#ffd6f2" stroke-width="1.2"/>
    <ellipse cx="9.2" cy="7.2" rx="3.6" ry="2.4" transform="rotate(-28 9.2 7.2)" fill="url(#whp-h)"/>
    <circle cx="12" cy="10.5" r="2.6" fill="#fff4fc" opacity=".95"/>
  </svg>`);

/** Jelly icon from the atlas (src/assets/icons.webp, see styles/icons.css). */
export const ji = (name: JellyIcon, cls = '') => `<span class="ji ji-${name} ${cls}" aria-hidden="true"></span>`;
export const luckArt = ji('luck', 'art-luck');

/**
 * Small UI glyphs drawn as SVG in the same jelly language (crisp at any size):
 * soft drop layer → glossy gradient stroke → bright top-left highlight.
 */
const glyph = (d: string, w = 3.4) => `
<svg class="jg" viewBox="0 0 16 16" aria-hidden="true">
  <path d="${d}" fill="none" stroke="rgba(30,20,90,.35)" stroke-width="${w + 1.6}" stroke-linecap="round" stroke-linejoin="round" transform="translate(0 .7)"/>
  <path d="${d}" fill="none" stroke="url(#jg-fill)" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="${d}" fill="none" stroke="#fff" stroke-opacity=".85" stroke-width="${(w * 0.32).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round" transform="translate(-.35 -.55)"/>
</svg>`;
export const glyphPlus = glyph('M8 3.6v8.8M3.6 8h8.8');
export const glyphChevron = glyph('M6.3 4.2L10.1 8l-3.8 3.8', 3);
export const glyphBack = glyph('M9.7 4.2L5.9 8l3.8 3.8', 3);
