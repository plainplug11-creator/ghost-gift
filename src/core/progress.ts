import type { AchId, LevelDelta, ProgressInfo } from '../api/types';
import { store } from './store';

type Celebrate = { levelUp?: (level: number, bonus: number) => void; achievements?: (ids: AchId[]) => void };
const hooks: Celebrate = {};
/** UI registers the celebration effects (lazy module) once. */
export function onCelebrate(h: Celebrate) { Object.assign(hooks, h); }

let pendingLevel: { level: number; bonus: number } | null = null;
let pendingAch: AchId[] = [];

/** Merge a server progress delta (after a round / claim). Celebrations wait for flush() (after the reveal animation). */
export function applyProgress(delta?: LevelDelta, unlocked?: AchId[], deferred = false) {
  const cur = store.progress.get();
  if (delta && cur) {
    store.progress.set({ ...cur, xp: delta.xp, level: delta.level, into: delta.into, need: delta.need, quests: delta.quests, ach: [...new Set([...cur.ach, ...(unlocked ?? [])])] });
  } else if (unlocked?.length && cur) {
    store.progress.set({ ...cur, ach: [...new Set([...cur.ach, ...unlocked])] });
  }
  if (delta?.levelUp) pendingLevel = { level: delta.levelUp, bonus: delta.levelBonus };
  if (unlocked?.length) pendingAch.push(...unlocked);
  if (!deferred) flushCelebrations();
}
export function flushCelebrations() {
  if (pendingAch.length) { const a = pendingAch; pendingAch = []; hooks.achievements?.(a); }
  if (pendingLevel) { const l = pendingLevel; pendingLevel = null; setTimeout(() => hooks.levelUp?.(l.level, l.bonus), 1700); }
}
export function setProgress(p: ProgressInfo) { store.progress.set(p); }
export function patchProgress(fn: (p: ProgressInfo) => ProgressInfo) { const cur = store.progress.get(); if (cur) store.progress.set(fn(cur)); }
