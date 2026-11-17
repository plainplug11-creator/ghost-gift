/**
 * Shared API types. In production these are the JSON shapes returned by the
 * Ghost Gift backend; the client only renders them.
 */
export type Rarity = 'common' | 'rare' | 'epic' | 'legendary' | 'mythic';
export const RARITY_RANK: Record<Rarity, number> = { common: 0, rare: 1, epic: 2, legendary: 3, mythic: 4 };

/** Icon names in the prize atlas (src/styles/prizes.css). */
export type PrizeIcon = 'stars' | 'heart' | 'bear' | 'rose' | 'gift' | 'cake' | 'rocket' | 'cup' | 'ring' | 'diamond' | 'crown';

export interface Prize {
  id: string;
  /** gift = Telegram gift (withdrawable via bot), stars = credited to balance, premium = gift subscription,
   *  nft = a real unique (upgraded) Telegram gift from the admin-stocked pool, transferred by the bot */
  kind: 'gift' | 'stars' | 'premium' | 'nft';
  icon: PrizeIcon;
  /** value in Stars (buyback price = value) */
  value: number;
  rarity: Rarity;
  /** premium months, for kind=premium */
  months?: 3 | 6 | 12;
  /** concrete NFT for kind=nft results/items (tier prizes in tables don't have it) */
  nft?: NftInfo;
}

export interface NftInfo { title: string; name: string; link: string }

export interface CaseDrop { prize: string; weight: number }
export interface CaseDef {
  id: string;
  /** display name per language (frontend may override via i18n `case.<id>`) */
  name: { ru: string; en: string; uk: string };
  /** visual theme key — each case gets its own interface/style in the frontend */
  theme: string;
  price: number; // 0 = daily free case
  art: string;   // key in art map (screens/case-art.ts)
  /** two-tone neon glow (r,g,b) */
  glow: [string, string];
  drops: CaseDrop[];
}

export interface Fairness {
  /** sha256(serverSeed) — published BEFORE the round */
  serverSeedHash: string;
  /** revealed AFTER the round (rotated) so the player can verify */
  serverSeed?: string;
  clientSeed: string;
  nonce: number;
}

export interface OpenResult {
  roundId: string;
  caseId: string;
  demo: boolean;
  prize: Prize;
  /** inventory uid if the prize went to the inventory (gift/premium, non-demo) */
  itemUid?: string;
  /** stars prizes are credited instantly */
  credited?: number;
  balance: number;
  fairness: Fairness;
}

export interface InvItem {
  uid: string; prizeId: string; caseId: string; wonAt: number; status: 'owned' | 'withdrawing';
  /** server: sell-back value when it differs from PRIZES[prizeId].value (NFTs) */
  value?: number;
  /** server: the concrete NFT for nft items */
  nft?: NftInfo;
}

export interface PremiumTier { months: 3 | 6 | 12; price: number; base: number }

export class ApiError extends Error {
  constructor(public code: 'NO_BALANCE' | 'DAILY_COOLDOWN' | 'NOT_FOUND' | 'BUSY' | 'OFFLINE' | 'AUTH' | 'NFT_PENDING' | 'CANCELLED', msg = code) { super(msg); }
}
