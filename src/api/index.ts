/**
 * API layer. Screens talk ONLY to `api` — never to the RNG or storage.
 *
 * TODO(server): replace `mockApi` with `httpApi` (fetch to our backend, header
 * `Authorization: tma <initData>`). The backend:
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
import { mockApi } from './mock';

export interface GameApi {
  bootstrap(): Promise<{ balance: number }>;
  /** Hash of the NEXT round's server seed (shown before opening). */
  nextRoundHash(): Promise<Pick<Fairness, 'serverSeedHash' | 'clientSeed' | 'nonce'>>;
  openCase(caseId: string, opts: { demo: boolean }): Promise<OpenResult>;
  /** Apply the last result to visible state (after the reveal animation). */
  commit(): void;
  sell(uid: string): Promise<{ balance: number; credited: number }>;
  withdraw(uid: string): Promise<{ status: 'queued' }>;
  buyPremium(months: 3 | 6 | 12): Promise<{ status: 'queued'; balance: number }>;
  inventory(): InvItem[];
  cases(): CaseDef[];
}

export const api: GameApi = mockApi;
