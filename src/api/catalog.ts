import type { CaseDef, CaseDrop, Prize } from './types';

/**
 * Single source of truth for prizes, drop tables and economy — imported by the
 * client (display, mock) AND by the Cloudflare worker (real RNG). Odds shown to
 * players are computed from exactly these weights.
 *
 * Economy (verified by `cd worker && npm run sim`):
 *   - RTP 85–88% on every paid case: base tables 85.2–85.5% (cheap) / 86.5%, NFT tiers add ≤ 1.4 pp
 *     only while real NFTs are in stock, luck card adds ≤ 10% weight to winning drops on cheap cases only.
 *   - Daily free case EV ≈ 2.6 Stars. Cases: 0 / 5 / 15 / 25 / 50 / 100 / 250 / 500 / 1000 / 2000 / 3500 / 5000.
 *   - Bank protection: see bankFilter() — the project's bank can't go negative.
 *   - Values = real Telegram prices in Stars (gift star_count, Premium 1000/1500/2500), buyback = value.
 */
const P = (id: string, kind: Prize['kind'], icon: Prize['icon'], value: number, rarity: Prize['rarity'], months?: 3 | 6 | 12): Prize =>
  ({ id, kind, icon, value, rarity, months });

export const PRIZES: Record<string, Prize> = Object.fromEntries([
  P('stars1', 'stars', 'stars', 1, 'common'),
  P('stars2', 'stars', 'stars', 2, 'common'),
  P('stars3', 'stars', 'stars', 3, 'common'),
  P('stars5', 'stars', 'stars', 5, 'common'),
  P('stars10', 'stars', 'stars', 10, 'common'),
  P('stars25', 'stars', 'stars', 25, 'rare'),
  P('stars50', 'stars', 'stars', 50, 'epic'),
  P('stars100', 'stars', 'stars', 100, 'epic'),
  P('stars250', 'stars', 'stars', 250, 'legendary'),
  P('stars500', 'stars', 'stars', 500, 'legendary'),
  P('stars1000', 'stars', 'stars', 1000, 'legendary'),
  P('stars2500', 'stars', 'stars', 2500, 'mythic'),
  P('stars5000', 'stars', 'stars', 5000, 'mythic'),
  P('stars10000', 'stars', 'stars', 10000, 'mythic'),
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
  P('prem12', 'premium', 'crown', 2500, 'mythic', 12),
  // NFT tiers: nominal value used for odds/RTP; the concrete NFT (and its exact value) comes from stock
  P('nft_s', 'nft', 'diamond', 1500, 'mythic'),
  P('nft_m', 'nft', 'diamond', 4000, 'mythic'),
  P('nft_l', 'nft', 'diamond', 10000, 'mythic'),
  P('nft_xl', 'nft', 'diamond', 25000, 'mythic'),
].map((p) => [p.id, p]));

/** Emoji of the matching regular Telegram gift (resolved to gift_id via getAvailableGifts). */
export const GIFT_EMOJI: Record<string, string> = {
  heart: '💝', bear: '🧸', rose: '🌹', gift: '🎁', cake: '🎂', rocket: '🚀', cup: '🏆', ring: '💍', diamond: '💎',
};

/** NFT tiers: admin-stocked unique gifts are assigned to a tier by their value (Stars). */
export const NFT_TIERS = {
  nft_s: { min: 800, max: 2500 },
  nft_m: { min: 2501, max: 6000 },
  nft_l: { min: 6001, max: 15000 },
  nft_xl: { min: 15001, max: 40000 },
} as const;
export type NftTier = keyof typeof NFT_TIERS;
export const nftTierFor = (value: number): NftTier | null =>
  (Object.keys(NFT_TIERS) as NftTier[]).find((k) => value >= NFT_TIERS[k].min && value <= NFT_TIERS[k].max) ?? null;

/** Luck card: up to +10% weight on drops worth ≥ the case price, only on cheap paid cases. */
export const LUCK = { maxPct: 10, maxCasePrice: 50 } as const;

const d = (o: Record<string, number>): CaseDrop[] => Object.entries(o).map(([prize, weight]) => ({ prize, weight }));

/** Base tables (no NFT). Filler weights solved by worker/scripts/sim.ts for the target RTP. */
export const CASES: CaseDef[] = [
  { id: 'daily', name: { ru: 'Ежедневный', en: 'Daily', uk: 'Щоденний' }, theme: 'daily-violet', price: 0, art: 'gift', glow: ['157,107,255', '255,79,200'],
    drops: d({ stars1: 400, stars2: 300, stars3: 150, stars5: 100, stars10: 40, heart: 8, bear: 5, rose: 1.5 }) },
  { id: 'spark', name: { ru: 'Искра', en: 'Spark', uk: 'Іскра' }, theme: 'spark-mint', price: 5, art: 'star', glow: ['80,255,214', '63,227,255'],
    drops: d({ stars3: 124, stars1: 150, stars2: 250, stars5: 220, stars10: 90, heart: 22, bear: 14, rose: 5, cake: 0.8 }) },
  { id: 'lantern', name: { ru: 'Фонарь', en: 'Lantern', uk: 'Ліхтар' }, theme: 'lantern-violet', price: 15, art: 'ghost', glow: ['186,120,255', '255,92,214'],
    drops: d({ stars5: 665.6, stars10: 300, heart: 200, bear: 180, rose: 110, gift: 90, cake: 30, rocket: 20, cup: 5, diamond: 3, stars250: 0.6 }) },
  { id: 'autumn', name: { ru: 'Осенний', en: 'Autumn', uk: 'Осінній' }, theme: 'autumn-ember', price: 25, art: 'autumn', glow: ['255,138,60', '157,107,255'],
    drops: d({ stars10: 374.4, heart: 220, bear: 220, rose: 200, gift: 180, cake: 70, rocket: 45, cup: 12, diamond: 6, prem3: 1 }) },
  { id: 'neon', name: { ru: 'Неон', en: 'Neon', uk: 'Неон' }, theme: 'neon-cyan', price: 50, art: 'neon', glow: ['63,227,255', '90,125,255'],
    drops: d({ stars25: 363.6, heart: 260, bear: 200, rose: 120, gift: 100, cake: 280, rocket: 220, cup: 90, ring: 65, stars250: 20, prem3: 6.5 }) },
  { id: 'ghost', name: { ru: 'Призрачный', en: 'Ghostly', uk: 'Примарний' }, theme: 'ghost-lilac', price: 100, art: 'ghost', glow: ['205,184,255', '157,107,255'],
    drops: d({ stars50: 470.3, bear: 150, rose: 150, gift: 120, cake: 110, rocket: 90, cup: 390, ring: 320, diamond: 210, stars500: 40, prem3: 25 }) },
  { id: 'star', name: { ru: 'Звёздный', en: 'Starry', uk: 'Зоряний' }, theme: 'star-magenta', price: 250, art: 'star', glow: ['255,79,200', '157,107,255'],
    drops: d({ stars100: 238.2, rose: 120, gift: 110, cake: 150, rocket: 120, cup: 120, ring: 90, diamond: 70, stars500: 160, prem3: 75, prem6: 35 }) },
  { id: 'diamond', name: { ru: 'Алмазный', en: 'Diamond', uk: 'Діамантовий' }, theme: 'diamond-ice', price: 500, art: 'diamond', glow: ['63,227,255', '255,79,200'],
    drops: d({ stars250: 294.5, cake: 150, rocket: 130, cup: 150, ring: 130, diamond: 120, stars500: 210, prem3: 210, prem6: 100, stars2500: 26 }) },
  { id: 'legend', name: { ru: 'Легенда', en: 'Legend', uk: 'Легенда' }, theme: 'legend-gold', price: 1000, art: 'legend', glow: ['255,214,110', '166,92,255'],
    drops: d({ stars500: 369, cup: 140, ring: 130, diamond: 120, stars250: 100, prem3: 550, prem6: 340, stars2500: 125 }) },
  { id: 'aurora', name: { ru: 'Аврора', en: 'Aurora', uk: 'Аврора' }, theme: 'aurora-teal', price: 2000, art: 'diamond', glow: ['64,255,200', '120,90,255'],
    drops: d({ stars500: 60.4, stars1000: 300, prem3: 250, prem6: 220, prem12: 120, stars2500: 180, stars5000: 60, stars10000: 12 }) },
  { id: 'phantom', name: { ru: 'Фантом', en: 'Phantom', uk: 'Фантом' }, theme: 'phantom-void', price: 3500, art: 'ghost', glow: ['140,70,255', '20,240,255'],
    drops: d({ stars1000: 50.1, prem6: 150, prem12: 250, stars2500: 250, stars5000: 160, stars10000: 40 }) },
  { id: 'king', name: { ru: 'Король призраков', en: 'Ghost King', uk: 'Король привидів' }, theme: 'king-royal', price: 5000, art: 'legend', glow: ['255,214,110', '255,60,200'],
    drops: d({ stars1000: 56.3, prem6: 60, stars2500: 150, prem12: 300, stars5000: 400, stars10000: 160 }) },
];

/** NFT tier weights per case — added only while that tier is in stock; a tier is only used where price < nominal ≤ 10× price. */
export const NFT_DROPS: Record<string, Partial<Record<NftTier, number>>> = {
  star: { nft_s: 3.02 },
  aurora: { nft_m: 6.39, nft_l: 1.47 },
  phantom: { nft_m: 13.15, nft_l: 2.3, nft_xl: 0.44 },
  king: { nft_l: 5.99, nft_xl: 1.92 },
  diamond: { nft_s: 5.72, nft_m: 1.29 },
  legend: { nft_s: 11.88, nft_m: 3.02, nft_l: 0.83 },
};

/** Static (base) case — used for first paint and by the mock. */
export const caseById = (id: string) => CASES.find((c) => c.id === id);

/**
 * The live table for one case: base drops + NFT tiers in stock + luck boost (cheap cases only).
 * The worker's RNG and the odds shown in the app both come from this function.
 */
export function liveDrops(c: CaseDef, opts: { nftInStock?: Iterable<string>; luckPct?: number } = {}): CaseDrop[] {
  const base = BASE_DROPS.get(c.id) ?? c.drops;
  const stock = new Set(opts.nftInStock ?? []);
  const nft = Object.entries(NFT_DROPS[c.id] ?? {}).filter(([k]) => stock.has(k)).map(([prize, weight]) => ({ prize, weight: weight as number }));
  const luck = c.price > 0 && c.price <= LUCK.maxCasePrice ? Math.max(0, Math.min(LUCK.maxPct, opts.luckPct ?? 0)) / 100 : 0;
  const drops = [...base, ...nft];
  return luck ? drops.map((x) => (PRIZES[x.prize].value >= c.price ? { prize: x.prize, weight: +(x.weight * (1 + luck)).toFixed(4) } : x)) : drops;
}
const BASE_DROPS = new Map(CASES.map((c) => [c.id, c.drops.slice()]));

/** Chance per drop (0..1) and RTP — computed from the same weights the RNG uses. */
export function caseStats(c: CaseDef, drops: CaseDrop[] = c.drops) {
  const total = drops.reduce((s, x) => s + x.weight, 0);
  const rows = drops.map((x) => ({ prize: PRIZES[x.prize], chance: x.weight / total }))
    .sort((a, b) => b.prize.value - a.prize.value || a.chance - b.chance);
  const ev = rows.reduce((s, r) => s + r.prize.value * r.chance, 0);
  return { rows, ev, rtp: c.price ? ev / c.price : 0 };
}

/**
 * Bank protection (server-side, shared with the simulation). Applied on every real open:
 *  - big prize = value ≥ max(bigMin, BIG_MULT × price); after `dailyBigCap` big prizes (Kyiv day) they are paused;
 *  - while the bank is below `reserve`, only drops worth ≤ the case price remain (no wins);
 *  - a drop is never paid if it would push the bank below `reserve` (bank can't go negative).
 * Every filter only removes winning drops, so the real RTP is ≤ the published one.
 */
export const BIG_MULT = 5;
export const isBigPrize = (value: number, price: number, bigMin: number) => value >= Math.max(bigMin, BIG_MULT * price);
export function bankFilter(c: CaseDef, drops: CaseDrop[], bank: { balance: number; bigToday: number }, rules: { reserve: number; dailyBigCap: number; bigMin: number }): CaseDrop[] {
  const after = bank.balance + c.price; // the price is paid before the prize
  let out = drops.filter((x) => PRIZES[x.prize].value <= Math.max(0, after - rules.reserve));
  if (bank.balance < rules.reserve) out = out.filter((x) => PRIZES[x.prize].value <= Math.max(c.price, 0));
  if (bank.bigToday >= rules.dailyBigCap) out = out.filter((x) => !isBigPrize(PRIZES[x.prize].value, c.price, rules.bigMin));
  if (!out.length) {
    const cheapest = drops.reduce((a, b) => (PRIZES[a.prize].value <= PRIZES[b.prize].value ? a : b));
    out = [cheapest];
  }
  return out;
}

/** Telegram Premium gift prices (Stars, fixed by giftPremiumSubscription) + our markup (max +50). */
export const PREMIUM_MARKUP = 50;
export const PREMIUM_TIERS = ([[3, 1000], [6, 1500], [12, 2500]] as const).map(([months, base]) => ({ months, base, price: base + PREMIUM_MARKUP }));

/** Star top-up packs offered in the app (any integer 1..10000 is accepted by the server). */
export const TOPUP_PACKS = [50, 100, 250, 500, 1000, 2500] as const;
