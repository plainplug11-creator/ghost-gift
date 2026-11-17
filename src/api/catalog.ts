import type { CaseDef, CaseDrop, Prize } from './types';

/**
 * Single source of truth for prizes, drop tables and economy — imported by the
 * client (display, mock) AND by the Cloudflare worker (real RNG). Odds shown to
 * players are computed from exactly these weights.
 *
 * Economy (verified by `cd worker && npm run sim`):
 *   - RTP 85–88% on every paid case: base tables 85.2–85.5% (cheap) / 86.5%, NFT collections add ≤ 1.3 pp
 *     only while in stock, luck card adds ≤ 10% weight to winning non-NFT drops on cheap cases only.
 *   - Daily free case EV ≈ 2.6 Stars. Cases: 0 / 5 / 15 / 25 / 50 / 100 / 250 / 500 / 1000 / 2000 / 3500 / 5000.
 *   - Bank protection: see bankFilter() — the project's bank can't go negative.
 *   - Values = real Telegram prices in Stars (gift star_count, Premium 1000/1500/2500), buyback = value.
 */
const P = (id: string, kind: Prize['kind'], icon: Prize['icon'], value: number, rarity: Prize['rarity'], months?: 3 | 6 | 12): Prize =>
  ({ id, kind, icon, value, rarity, months });

/**
 * NFT prizes = real Telegram collectible (upgraded) gift collections. A win gives one gift of that collection
 * (any model — the cheapest lot on the market, bought and sent by the admin while auto-transfer is unavailable).
 * value (Stars) = max(cheapest floor across markets × 1.10, Fragment floor) × $1.063/TON ÷ $0.013/Star
 * (Telegram's developer payout rate), rounded up to 10. Floors checked 17 Nov 2026 ~22:00–23:00 UTC:
 * cross-market floor — salestracker.tg/gifts (Portals, MRKT, Tonnel, Getgems, Fragment, Market App);
 * Fragment floor — tggifts.com/floors. Re-check before raising stock; update value + art here only.
 */
export interface NftCollection { id: string; title: string; slug: string; art: string; value: number; floorTon: number; fragmentTon: number }
export const NFT_COLLECTIONS: NftCollection[] = [
  { id: 'nft_hypno', title: 'Hypno Lollipop', slug: 'hypnolollipop', art: 'hypnolollipop-7', value: 490, floorTon: 5.14, fragmentTon: 6 },
  { id: 'nft_jackbox', title: 'Jack-in-the-Box', slug: 'jackinthebox', art: 'jackinthebox-5', value: 490, floorTon: 5.25, fragmentTon: 6 },
  { id: 'nft_hexpot', title: 'Hex Pot', slug: 'hexpot', art: 'hexpot-1', value: 660, floorTon: 5.61, fragmentTon: 8 },
  { id: 'nft_witchhat', title: 'Witch Hat', slug: 'witchhat', art: 'witchhat-7', value: 660, floorTon: 6.36, fragmentTon: 8 },
  { id: 'nft_candle', title: 'Eternal Candle', slug: 'eternalcandle', art: 'eternalcandle-6', value: 660, floorTon: 6.78, fragmentTon: 8 },
  { id: 'nft_evileye', title: 'Evil Eye', slug: 'evileye', art: 'evileye-10', value: 900, floorTon: 9.28, fragmentTon: 11 },
  { id: 'nft_skullflower', title: 'Skull Flower', slug: 'skullflower', art: 'skullflower-1', value: 1230, floorTon: 13, fragmentTon: 15 },
  { id: 'nft_crystal', title: 'Crystal Ball', slug: 'crystalball', art: 'crystalball-2', value: 1400, floorTon: 14.5, fragmentTon: 17 },
  { id: 'nft_pumpkin', title: 'Mad Pumpkin', slug: 'madpumpkin', art: 'madpumpkin-8', value: 1560, floorTon: 13.6, fragmentTon: 19 },
  { id: 'nft_eskull', title: 'Electric Skull', slug: 'electricskull', art: 'electricskull-2', value: 2870, floorTon: 30.6, fragmentTon: 35 },
  { id: 'nft_voodoo', title: 'Voodoo Doll', slug: 'voodoodoll', art: 'voodoodoll-3', value: 4010, floorTon: 42.2, fragmentTon: 49 },
  { id: 'nft_potion', title: 'Magic Potion', slug: 'magicpotion', art: 'magicpotion-4', value: 5970, floorTon: 66.3, fragmentTon: 70 },
  { id: 'nft_astral', title: 'Astral Shard', slug: 'astralshard', art: 'astralshard-2', value: 13660, floorTon: 131.6, fragmentTon: 167 },
  { id: 'nft_scaredcat', title: 'Scared Cat', slug: 'scaredcat', art: 'scaredcat-1', value: 26090, floorTon: 285, fragmentTon: 319 },
  { id: 'nft_durovcap', title: "Durov's Cap", slug: 'durovscap', art: 'durovscap-2', value: 38540, floorTon: 428.4, fragmentTon: 470 },
];
export const NFT_PRIZES: Prize[] = NFT_COLLECTIONS.map((n) => ({
  id: n.id, kind: 'nft', icon: 'diamond', value: n.value, rarity: n.value >= 2500 ? 'mythic' : 'legendary',
  nft: { title: n.title, name: '', link: `https://fragment.com/gifts/${n.slug}`, art: n.art },
}));
export const nftCollection = (prizeId: string) => NFT_COLLECTIONS.find((n) => n.id === prizeId);
/** Collection of an owned unique gift by its t.me/nft name, e.g. "WitchHat-123" → nft_witchhat. */
export const nftCollectionByName = (name: string) => {
  const slug = name.toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/-\d+$/, '');
  return NFT_COLLECTIONS.find((n) => n.slug === slug);
};

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
  ...NFT_PRIZES,
].map((p) => [p.id, p]));

/** Emoji of the matching regular Telegram gift (resolved to gift_id via getAvailableGifts). */
export const GIFT_EMOJI: Record<string, string> = {
  heart: '💝', bear: '🧸', rose: '🌹', gift: '🎁', cake: '🎂', rocket: '🚀', cup: '🏆', ring: '💍', diamond: '💎',
};

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

/**
 * NFT collection weights per case — a drop is live only while that collection is in stock (admin-controlled).
 * Every NFT sits only where case price < value ≤ 10× price; weights ∝ 1/value (each NFT adds the same EV) and
 * scaled by worker/scripts/solve-nft.ts so the case RTP with all NFTs in stock stays ≤ 87.8% (base 85.2–86.5%).
 */
export const NFT_DROPS: Record<string, Record<string, number>> = {
  neon: { nft_hypno: 0.145, nft_jackbox: 0.145 },
  ghost: { nft_hypno: 0.988, nft_jackbox: 0.988, nft_hexpot: 0.733, nft_witchhat: 0.733, nft_candle: 0.733, nft_evileye: 0.538 },
  star: { nft_hexpot: 1.11, nft_witchhat: 1.11, nft_candle: 1.11, nft_evileye: 0.813, nft_skullflower: 0.595, nft_crystal: 0.522, nft_pumpkin: 0.469 },
  diamond: { nft_evileye: 2.56, nft_skullflower: 1.87, nft_crystal: 1.64, nft_pumpkin: 1.47, nft_eskull: 0.801, nft_voodoo: 0.573 },
  legend: { nft_skullflower: 5.78, nft_crystal: 5.08, nft_pumpkin: 4.56, nft_eskull: 2.48, nft_voodoo: 1.77, nft_potion: 1.19 },
  aurora: { nft_eskull: 3.98, nft_voodoo: 2.85, nft_potion: 1.91, nft_astral: 0.835 },
  phantom: { nft_voodoo: 3.96, nft_potion: 2.66, nft_astral: 1.16, nft_scaredcat: 0.609 },
  king: { nft_potion: 4.61, nft_astral: 2.01, nft_scaredcat: 1.05, nft_durovcap: 0.714 },
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
  // luck never touches NFT drops (stock-limited, admin-bought)
  return luck ? drops.map((x) => (PRIZES[x.prize].value >= c.price && PRIZES[x.prize].kind !== 'nft' ? { prize: x.prize, weight: +(x.weight * (1 + luck)).toFixed(4) } : x)) : drops;
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
