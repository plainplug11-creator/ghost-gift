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
import sp240 from '../assets/case-spark-240.webp';
import sp480 from '../assets/case-spark-480.webp';
import lf240 from '../assets/case-leaf-240.webp';
import lf480 from '../assets/case-leaf-480.webp';
import au240 from '../assets/case-aurora-240.webp';
import au480 from '../assets/case-aurora-480.webp';
import ec240 from '../assets/case-eclipse-240.webp';
import ec480 from '../assets/case-eclipse-480.webp';
import th240 from '../assets/case-throne-240.webp';
import th480 from '../assets/case-throne-480.webp';
import { t, fmt, lang, type I18nKey } from '../core/i18n';
import type { CaseDef, InvItem, Prize } from '../api/types';
import { PRIZES } from '../api/catalog';

/** Jelly case renders (cut-out WebP, 240 for grid / 480 for hero & opening). */
const ART: Record<string, [string, string]> = {
  autumn: [a240, a480], neon: [n240, n480], ghost: [g240, g480], star: [s240, s480],
  diamond: [d240, d480], legend: [l240, l480], gift: [gift240, gift480],
  // own art per new case (keyed by case id): firefly jar, leaf crate, aurora geode, eclipse obsidian, royal throne chest
  spark: [sp240, sp480], lantern: [lf240, lf480], aurora: [au240, au480], phantom: [ec240, ec480], king: [th240, th480],
};
const ART_BY_ID: Record<string, string> = { daily: 'gift', spark: 'spark', lantern: 'lantern', aurora: 'aurora', phantom: 'phantom', king: 'king' };
export const caseArt = (c: CaseDef) => ART[ART_BY_ID[c.id] ?? c.id] ?? ART[c.art] ?? ART.autumn;
export const caseImg = (c: CaseDef, cls = '', sizes = '150px') => {
  const [s, l] = caseArt(c);
  return `<img class="${cls}" srcset="${s} 240w, ${l} 480w" sizes="${sizes}" src="${s}" alt="" decoding="async" draggable="false">`;
};

/* ───────── Special prize kinds: NFT gifts + Telegram Premium ─────────
 * The backend sends kind:'nft' with an optional concrete `nft` ({ title, name, link }) on results and
 * inventory items; table entries (tiers nft_s/m/l) have no concrete NFT. Everything below degrades
 * gracefully when that data is missing (falls back to the atlas icon + holo frame).
 */
type NftLike = { title?: string; name?: string; link?: string };
const kindOf = (p: Prize) => p.kind as string;
export const isNft = (p: Prize) => kindOf(p) === 'nft';
export const isPremium = (p: Prize) => kindOf(p) === 'premium';
export const nftOf = (p: Prize): NftLike | undefined => (p as Prize & { nft?: NftLike }).nft;
/** CSS modifier for special frames (append to rarity classes). */
export const kindCls = (p: Prize) => (isNft(p) ? ' k-nft' : isPremium(p) ? ' k-prem' : '');
/** server text is used in both innerHTML and textContent → make it safe for both without entities */
const esc = (s: string) => s.replace(/'/g, '’').replace(/[<>&"`]/g, '');
/** Fragment preview of a unique gift: t.me/nft/PlushPepe-123 → nft.fragment.com/gift/plushpepe-123.medium.jpg */
export function nftPreview(n: NftLike | undefined, big = false) {
  const slug = (n?.link?.split('/').filter(Boolean).pop() || n?.name || '').trim().toLowerCase();
  return /^[a-z0-9]+-\d+$/.test(slug) ? `https://nft.fragment.com/gift/${slug}.${big ? 'webp' : 'medium.jpg'}` : '';
}

export const prizeIcon = (p: Prize, cls = '') => {
  if (isNft(p)) {
    const src = nftPreview(nftOf(p), cls.includes('big'));
    return `<span class="pi-x k-nft ${cls}" aria-hidden="true"><span class="pi pi-${p.icon}"></span>${src ? `<img class="pi-img" src="${src}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" draggable="false" onerror="this.remove()">` : ''}<i class="pi-holo"></i><b class="pi-tag">NFT</b></span>`;
  }
  if (isPremium(p)) {
    return `<span class="pi-x k-prem ${cls}" aria-hidden="true"><i class="pi-halo"></i><span class="pi pi-${p.icon}"></span><b class="pi-tag">${t('prem.tag', { n: p.months ?? 3 })}</b></span>`;
  }
  return `<span class="pi pi-${p.icon} ${cls}" aria-hidden="true"></span>`;
};

/** Display prize for an inventory item: catalog entry + server extras (concrete NFT, sell-back value). */
export function itemPrize(it: InvItem): Prize {
  const x = it as InvItem & { value?: number; nft?: NftLike };
  const base = PRIZES[it.prizeId] ?? { id: it.prizeId, kind: 'gift', icon: 'gift', value: x.value ?? 0, rarity: 'rare' } as Prize;
  return { ...base, ...(x.nft ? { nft: x.nft } : {}), value: x.value ?? base.value } as Prize;
}
/** i18n override first (`case.<id>`), then the server-provided name, then the id. */
export const caseName = (c: CaseDef) => {
  const own = t(`case.${c.id}` as I18nKey);
  if (own) return own;
  const n = (c as CaseDef & { name?: Record<string, string> }).name;
  return n?.[lang] || n?.ru || c.id;
};

export function prizeName(p: Prize) {
  if (p.kind === 'stars') return t('item.stars', { n: fmt(p.value) });
  if (isPremium(p)) return t(p.months === 12 ? 'item.premium12' : p.months === 6 ? 'item.premium6' : 'item.premium');
  if (isNft(p)) {
    const n = nftOf(p);
    if (n?.title) { const num = (n.name || n.link || '').match(/-(\d+)$/)?.[1]; return esc(num ? `${n.title} #${num}` : n.title); }
    return t(`item.${p.id}` as I18nKey) || t('item.nft');
  }
  return t(`item.${p.id}` as I18nKey) || t('item.gift');
}
export const rarityName = (p: Prize) => t(`rarity.${p.rarity}` as I18nKey);
/** Rarity colours (r,g,b) — shared by CSS (--rc) and canvas confetti. */
export const RARITY_RGB: Record<Prize['rarity'], string> = {
  common: '196,204,236', rare: '63,227,255', epic: '170,125,255', legendary: '255,92,204', mythic: '255,214,110',
};
