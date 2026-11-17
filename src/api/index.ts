/**
 * API layer. Screens talk ONLY to `api` — never to the RNG or storage.
 *
 * When VITE_API_URL is set, `httpApi` is used (header `Authorization: tma <initData>`).
 * Otherwise the existing mock stays in place and the app behaves as before. The backend:
 *   - verifies initData HMAC with the bot token, rejects stale auth_date
 *   - decides every outcome with server-side RNG (provably fair:
 *     publish sha256(serverSeed) before the round, reveal serverSeed after,
 *     roll = HMAC_SHA256(serverSeed, `${clientSeed}:${nonce}`))
 *   - holds balance / inventory / daily cooldown in the DB (transactions + row locks)
 *   - rate-limits and makes openCase idempotent by a client-generated request id
 * The client must not decide real outcomes in production.
 */
import type { CaseDef, Fairness, InvItem, OpenResult } from './types';
export { ApiError } from './types';
import { mockApi, mockNftStock } from './mock';
import { httpApi } from './http';

export interface GameApi {
  bootstrap(): Promise<{ balance: number }>;
  /** Hash of the NEXT round's server seed (shown before opening). */
  nextRoundHash(): Promise<Pick<Fairness, 'serverSeedHash' | 'clientSeed' | 'nonce'>>;
  openCase(caseId: string, opts: { demo: boolean }): Promise<OpenResult>;
  /** Apply the last result to visible state (after the reveal animation). */
  commit(): void;
  sell(uid: string): Promise<{ balance: number; credited: number }>;
  /** review=true: a moderator checks it first (large / NFT / new account). Throws NFT_PENDING while NFT delivery is unavailable. */
  withdraw(uid: string): Promise<{ status: 'queued'; review?: boolean; manual?: boolean }>;
  buyPremium(months: 3 | 6 | 12): Promise<{ status: 'queued'; balance: number }>;
  /**
   * Buy Ghost Stars with Telegram Stars (XTR invoice inside Telegram).
   * Resolves after the invoice closes: 'paid' (balance already synced), 'pending' (paid, credit still on its way),
   * 'cancelled' or 'failed'. Suggested pack sizes: TOPUP_PACKS in catalog.
   */
  topUp(stars: number): Promise<{ status: 'paid' | 'pending' | 'cancelled' | 'failed'; balance: number }>;
  inventory(): InvItem[];
  cases(): CaseDef[];
}

export const api: GameApi = import.meta.env.VITE_API_URL ? httpApi : mockApi;
if (!import.meta.env.VITE_API_URL) mockNftStock();
