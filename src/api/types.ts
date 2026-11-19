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

/** name = t.me/nft slug of a concrete gift ('' for a collection prize), art = Fragment preview slug (collection sample) */
export interface NftInfo { title: string; name: string; link: string; art?: string }

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
  progress?: LevelDelta;
  unlocked?: AchId[];
}

export interface InvItem {
  uid: string; prizeId: string; caseId: string; wonAt: number; status: 'owned' | 'withdrawing';
  /** server: sell-back value when it differs from PRIZES[prizeId].value (NFTs) */
  value?: number;
  /** server: the concrete NFT for nft items */
  nft?: NftInfo;
}

export interface PremiumTier { months: 3 | 6 | 12; price: number; base: number }

export type ApiCode = 'NO_BALANCE' | 'DAILY_COOLDOWN' | 'NOT_FOUND' | 'BUSY' | 'OFFLINE' | 'AUTH' | 'NFT_PENDING' | 'CANCELLED' | 'LIMIT';
export class ApiError extends Error {
  constructor(public code: ApiCode, msg = code) { super(msg); }
}

// ───────── progression layer (games.ts has the rules) ─────────
import type { QuestState, QuestId, AchId, GameId, SlotSym } from './games';
export type { QuestState, QuestId, AchId, GameId, SlotSym };
export interface LevelDelta { xp: number; level: number; into: number; need: number; levelUp: number; levelBonus: number; quests: QuestState }
export interface ProgressInfo {
  xp: number; level: number; into: number; need: number;
  streak: { count: number; claimedToday: boolean };
  quests: QuestState;
  ach: AchId[];
  luck: { pct: number; until: number; drawnToday: boolean };
  settings: { hideFeed: boolean; notify: boolean };
  limits?: { wheel: number; slots: number };
  ref?: { link: string; friends: number; earned: number };
  botStarted?: boolean;
}
export interface SpinResult {
  roundId: string; game: GameId; bet: number; mult: number; payout: number; outcome: string;
  index?: number; faces?: SlotSym[]; balance: number; fairness: Fairness;
  progress?: LevelDelta; unlocked?: AchId[];
}
export interface FeedStats { plays24h: number; players24h: number; best24h: number }
export interface FeedItem { id: number; game: string; prizeId: string; payout: number; rarity: Rarity; at: number; mult: number; name: string | null }
export interface LeaderRow { rank: number; name: string | null; level: number; score: number; me?: boolean }
export interface Leaderboard { week: string; top: LeaderRow[]; me: { rank: number; score: number; level: number } }
export interface Rewarded { balance: number; unlocked?: AchId[]; progress?: LevelDelta }
