import type { CaseDef, Prize } from './types';

/**
 * Display catalog. TODO(server): GET /api/catalog — the server is the source of
 * truth for prizes, weights and prices; this static copy only exists for the
 * mock and for instant first paint (stale-while-revalidate).
 * Values = Telegram gift prices in Stars (heart/bear 15, rose/gift 25,
 * cake/rocket 50, trophy/ring/diamond 100), Premium at official gift price.
 */
const P = (id: string, kind: Prize['kind'], icon: Prize['icon'], value: number, rarity: Prize['rarity'], months?: 3 | 6 | 12): Prize =>
  ({ id, kind, icon, value, rarity, months });

export const PRIZES: Record<string, Prize> = Object.fromEntries([
  P('stars10', 'stars', 'stars', 10, 'common'),
  P('stars25', 'stars', 'stars', 25, 'rare'),
  P('stars50', 'stars', 'stars', 50, 'epic'),
  P('stars100', 'stars', 'stars', 100, 'epic'),
  P('stars250', 'stars', 'stars', 250, 'legendary'),
  P('stars500', 'stars', 'stars', 500, 'legendary'),
  P('stars2500', 'stars', 'stars', 2500, 'mythic'),
  P('heart', 'gift', 'heart', 15, 'common'),
  P('bear', 'gift', 'bear', 15, 'common'),
  P('rose', 'gift', 'rose', 25, 'rare'),
  P('gift', 'gift', 'gift', 25, 'rare'),
  P('cake', 'gift', 'cake', 50, 'epic'),
  P('rocket', 'gift', 'rocket', 50, 'epic'),
  P('cup', 'gift', 'cup', 100, 'legendary'),
  P('ring', 'gift', 'ring', 100, 'legendary'),
  P('diamond', 'gift', 'diamond', 100, 'legendary'),
  P('prem3', 'premium', 'crown', 1000, 'mythic', 3),
  P('prem6', 'premium', 'crown', 1500, 'mythic', 6),
].map((p) => [p.id, p]));

const d = (o: Record<string, number>) => Object.entries(o).map(([prize, weight]) => ({ prize, weight }));

// Weights tuned offline to the published RTP (scripts: ghost-gift-media/rtp).
export const CASES: CaseDef[] = [
  { id: 'daily', price: 0, art: 'gift', glow: ['157,107,255', '255,79,200'],
    drops: d({ stars10: 640, heart: 200, bear: 120, rose: 30, gift: 8, cake: 2 }) },
  { id: 'autumn', price: 25, art: 'autumn', glow: ['255,138,60', '157,107,255'],
    drops: d({ stars10: 300, heart: 210, bear: 210, rose: 212, gift: 183, cake: 73.3, rocket: 46.3, cup: 13.5, diamond: 5.8, prem3: 1.16 }) },
  { id: 'neon', price: 50, art: 'neon', glow: ['63,227,255', '90,125,255'],
    drops: d({ heart: 260, bear: 200, stars25: 150, rose: 120, gift: 100, cake: 281.7, rocket: 221.3, cup: 88.5, ring: 64.4, stars250: 20.1, prem3: 6.44 }) },
  { id: 'ghost', price: 100, art: 'ghost', glow: ['205,184,255', '157,107,255'],
    drops: d({ bear: 200, rose: 200, gift: 150, stars50: 130, cake: 110, rocket: 90, cup: 392.6, ring: 321.3, diamond: 214.2, stars500: 42.8, prem3: 28.6 }) },
  { id: 'star', price: 250, art: 'star', glow: ['255,79,200', '157,107,255'],
    drops: d({ rose: 160, gift: 150, cake: 160, rocket: 130, stars100: 110, cup: 100, ring: 80, diamond: 60, stars500: 170.8, prem3: 79.7, prem6: 39.9 }) },
  { id: 'diamond', price: 500, art: 'diamond', glow: ['63,227,255', '255,79,200'],
    drops: d({ cake: 180, rocket: 150, cup: 150, ring: 130, diamond: 120, stars250: 80, stars500: 215.8, prem3: 215.8, prem6: 107.9, stars2500: 28.8 }) },
  { id: 'legend', price: 1000, art: 'legend', glow: ['255,214,110', '166,92,255'],
    drops: d({ cup: 150, ring: 140, diamond: 120, stars250: 110, stars500: 100, prem3: 550.7, prem6: 347.8, stars2500: 130.4 }) },
];

export const caseById = (id: string) => CASES.find((c) => c.id === id);

/** Chance per drop (0..1) and RTP — computed from the same weights the RNG uses. */
export function caseStats(c: CaseDef) {
  const total = c.drops.reduce((s, x) => s + x.weight, 0);
  const rows = c.drops.map((x) => ({ prize: PRIZES[x.prize], chance: x.weight / total }))
    .sort((a, b) => b.prize.value - a.prize.value || a.chance - b.chance);
  const ev = rows.reduce((s, r) => s + r.prize.value * r.chance, 0);
  return { rows, ev, rtp: c.price ? ev / c.price : 0 };
}

/** Telegram Premium gift prices (Stars) + our max +50 markup. TODO(server): fetch live prices. */
export const PREMIUM_MARKUP = 50;
export const PREMIUM_TIERS = ([[3, 1000], [6, 1500], [12, 2500]] as const).map(([months, base]) => ({ months, base, price: base + PREMIUM_MARKUP }));
