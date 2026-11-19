import { todayKyiv, type Tx } from './db.ts';
import { ACHIEVEMENTS, QUESTS, emptyQuests, levelInfo, levelReward, type AchId, type QuestState } from './games-rules.ts';
import type { UserRow } from './users.ts';

export interface ProgressRow extends UserRow {
  xp: number; week_key: string | null; week_xp: number; quests: string | null; ach: string;
  luck_until: number; luck_day: string | null; streak_day: string | null; streak_count: number;
  referred_by: string | null; ref_earned: number; hide_feed: number; notify: number; bot_started: number;
}

/** ISO week of the Kyiv calendar day, e.g. 2026-W47. */
export function weekKey(now = Date.now()) {
  const [y, m, d] = todayKyiv(now).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - dow);
  const y0 = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const wk = Math.ceil(((dt.getTime() - y0.getTime()) / 86400000 + 1) / 7);
  return `${dt.getUTCFullYear()}-W${String(wk).padStart(2, '0')}`;
}
export const yesterdayKyiv = (now = Date.now()) => todayKyiv(now - 86400_000);

export function questsOf(u: Pick<ProgressRow, 'quests'>, now = Date.now()): QuestState {
  const day = todayKyiv(now);
  try {
    const q = JSON.parse(u.quests || '') as QuestState;
    if (q && q.day === day) return { ...emptyQuests(day), ...q, claimed: Array.isArray(q.claimed) ? q.claimed : [] };
  } catch { /* reset */ }
  return emptyQuests(day);
}
export const achOf = (u: Pick<ProgressRow, 'ach'>) => new Set((u.ach || '').split(',').filter(Boolean) as AchId[]);
export const effectiveLuck = (u: Pick<ProgressRow, 'luck_pct' | 'luck_until'>, now = Date.now()) => ((u.luck_until ?? 0) > now ? u.luck_pct ?? 0 : 0);

export interface GameEvent {
  /** Stars wagered (0 for the daily case) */
  wager: number;
  game: 'case' | 'wheel' | 'slots';
  daily?: boolean;
  rarityRank?: number;
  nft?: boolean;
  mult?: number;
  outcome?: string;
  /** extra XP (quests / achievements claimed in this call) */
  bonusXp?: number;
  /** achievements unlocked by a non-game event */
  unlock?: AchId[];
}
export interface ProgressOut {
  xp: number; weekKey: string; weekXp: number; quests: QuestState; ach: string;
  bonus: number; levelFrom: number; levelTo: number; unlocked: AchId[];
}

/**
 * Pure: next progression state after one event. Level-up rewards (1 % rakeback) are returned as `bonus`
 * Stars for the caller to add to the balance in the same batch.
 */
export function nextProgress(u: ProgressRow, ev: GameEvent, now = Date.now()): ProgressOut {
  const q = questsOf(u, now);
  const has = achOf(u);
  const unlocked: AchId[] = [];
  const unlock = (id: AchId, cond = true) => { if (cond && !has.has(id)) { has.add(id); unlocked.push(id); } };
  if (ev.game === 'case' || ev.game === 'wheel' || ev.game === 'slots') {
    if (ev.daily) q.daily += 1;
    if (ev.game === 'case' && !ev.daily && ev.wager > 0) q.opens += 1;
    if (ev.game === 'wheel') q.wheel += 1;
    if (ev.game === 'slots') q.slots += 1;
    q.wager += ev.wager;
    if (ev.wager > 0 || ev.daily) {
      const spins = (u.stats_opens ?? 0) + 1;
      unlock('first_open'); unlock('opens_10', spins >= 10); unlock('opens_100', spins >= 100); unlock('opens_1000', spins >= 1000);
    }
    const r = ev.rarityRank ?? -1;
    unlock('epic', r >= 2); unlock('legend', r >= 3); unlock('mythic', r >= 4); unlock('nft', !!ev.nft);
    unlock('wheel_x10', ev.game === 'wheel' && (ev.mult ?? 0) >= 10);
    unlock('slots_jackpot', ev.game === 'slots' && ev.outcome === 'g3');
  }
  for (const id of ev.unlock ?? []) unlock(id);
  const gain0 = ev.wager + (ev.daily ? 5 : 0) + (ev.bonusXp ?? 0);
  const from = levelInfo(u.xp ?? 0).level;
  let xp = (u.xp ?? 0) + gain0 + unlocked.reduce((s, id) => s + (ACHIEVEMENTS.find((a) => a.id === id)?.xp ?? 0), 0);
  let to = levelInfo(xp).level;
  if (to >= 10 && !has.has('level_10')) { unlock('level_10'); xp += ACHIEVEMENTS.find((a) => a.id === 'level_10')!.xp; to = levelInfo(xp).level; }
  let bonus = 0;
  for (let l = from + 1; l <= to; l++) bonus += levelReward(l);
  const wk = weekKey(now);
  const gained = xp - (u.xp ?? 0);
  return {
    xp, weekKey: wk, weekXp: (u.week_key === wk ? u.week_xp ?? 0 : 0) + gained, quests: q, ach: [...has].join(','),
    bonus, levelFrom: from, levelTo: to, unlocked,
  };
}

/** Write the progression columns (balance handled by the caller). */
export function writeProgress(tx: Tx, userId: string, p: ProgressOut) {
  tx.add('UPDATE users SET xp = ?, week_key = ?, week_xp = ?, quests = ?, ach = ? WHERE id = ?',
    p.xp, p.weekKey, p.weekXp, JSON.stringify(p.quests), p.ach, userId);
}

/** Client view of the progression layer. */
export function progressView(u: ProgressRow, now = Date.now()) {
  const lv = levelInfo(u.xp ?? 0);
  const day = todayKyiv(now);
  const streakAlive = u.streak_day === day || u.streak_day === yesterdayKyiv(now);
  return {
    xp: u.xp ?? 0, level: lv.level, into: lv.into, need: lv.need,
    streak: { count: streakAlive ? u.streak_count ?? 0 : 0, claimedToday: u.streak_day === day },
    quests: questsOf(u, now),
    ach: [...achOf(u)],
    luck: { pct: effectiveLuck(u, now), until: effectiveLuck(u, now) ? u.luck_until : 0, drawnToday: u.luck_day === day },
    settings: { hideFeed: !!u.hide_feed, notify: !!u.notify },
  };
}
export { QUESTS };

/** Append one achievement id to users.ach (no-op if present). Args: id, id, id, userId. */
export const ACH_ADD = "UPDATE users SET ach = CASE WHEN (',' || ach || ',') LIKE ('%,' || ? || ',%') THEN ach WHEN ach = '' THEN ? ELSE ach || ',' || ? END WHERE id = ?";

