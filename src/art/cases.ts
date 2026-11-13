import a240 from '../assets/case-autumn-240.webp';
import a480 from '../assets/case-autumn-480.webp';
import n240 from '../assets/case-neon-240.webp';
import n480 from '../assets/case-neon-480.webp';
import g240 from '../assets/case-ghost-240.webp';
import g480 from '../assets/case-ghost-480.webp';
import s240 from '../assets/case-star-240.webp';
import s480 from '../assets/case-star-480.webp';
import d240 from '../assets/case-diamond-240.webp';
import d480 from '../assets/case-diamond-480.webp';
import l240 from '../assets/case-legend-240.webp';
import l480 from '../assets/case-legend-480.webp';
import gift240 from '../assets/gift-240.webp';
import gift480 from '../assets/gift-480.webp';
import { t, fmt, type I18nKey } from '../core/i18n';
import type { CaseDef, Prize } from '../api/types';

/** Jelly case renders (cut-out WebP, 240 for grid / 480 for hero & opening). */
const ART: Record<string, [string, string]> = {
  autumn: [a240, a480], neon: [n240, n480], ghost: [g240, g480], star: [s240, s480],
  diamond: [d240, d480], legend: [l240, l480], gift: [gift240, gift480],
};
export const caseArt = (c: CaseDef) => ART[c.art] ?? ART.autumn;
export const caseImg = (c: CaseDef, cls = '', sizes = '150px') => {
  const [s, l] = caseArt(c);
  return `<img class="${cls}" srcset="${s} 240w, ${l} 480w" sizes="${sizes}" src="${s}" alt="" decoding="async" draggable="false">`;
};
export const caseName = (c: CaseDef) => t(`case.${c.id}` as I18nKey);

export const prizeIcon = (p: Prize, cls = '') => `<span class="pi pi-${p.icon} ${cls}" aria-hidden="true"></span>`;
export function prizeName(p: Prize) {
  if (p.kind === 'stars') return t('item.stars', { n: fmt(p.value) });
  if (p.kind === 'premium') return t(p.months === 6 ? 'item.premium6' : 'item.premium');
  return t(`item.${p.id}` as I18nKey);
}
export const rarityName = (p: Prize) => t(`rarity.${p.rarity}` as I18nKey);
/** Rarity colours (r,g,b) — shared by CSS (--rc) and canvas confetti. */
export const RARITY_RGB: Record<Prize['rarity'], string> = {
  common: '196,204,236', rare: '63,227,255', epic: '170,125,255', legendary: '255,92,204', mythic: '255,214,110',
};
