import { flyReward } from '../ui/reward';
import '../styles/cases.css';
import '../styles/play.css';
import '../styles/meta.css';
import { h, html, starIcon, starText } from '../core/dom';
import { t } from '../core/i18n';
import { store } from '../core/store';
import { tg } from '../core/telegram';
import { sfx, unlockAudio } from '../core/sound';
import { api } from '../api';
import { apiErrorText } from '../api/errors';
import { ACHIEVEMENTS, QUESTS, STREAK_REWARDS, questProgress, type QuestId } from '../api/games';
import type { JellyIcon } from '../art/icon-names';
import { ji } from '../art/games';
import { navBar } from '../ui/nav';
import { toast } from '../ui/sheet';
import { navigate, type Page, type PushId } from '../ui/router';
import { skeleton } from '../ui/skeleton';

const GO: Partial<Record<QuestId, PushId>> = { daily: 'daily', open3: 'cases', wheel3: 'wheel', slots3: 'slots', wager100: 'cases' };
const Q_ICON: Record<QuestId, JellyIcon> = { daily: 'gift', open3: 'spins', wheel3: 'luck', slots3: 'seven', wager100: 'bolt', all: 'crown' };

/** Streak calendar + daily quests + achievements. Rewards are granted server-side (bank-safe). */
export function createQuests(): Page {
  const streak = h('section', { class: 'mt-card mt-streak glass' });
  const quests = h('section', { class: 'mt-card glass' });
  const achs = h('section', { class: 'mt-card glass' });
  const page = h('div', { class: 'pg pg-meta pg-quests' },
    navBar(t('quests.title')),
    h('div', { class: 'pg-scroll mt-scroll' }, streak, quests, achs, h('p', { class: 'gk-foot' }, t('quests.foot'))));
  let busy = false;

  function renderStreak() {
    const p = store.progress.get();
    if (!p) { streak.replaceChildren(skeleton(150)); return; }
    const { count, claimedToday } = p.streak;
    // today's position in the 7-day cycle (count already includes today when claimed)
    const pos = claimedToday ? ((count - 1) % 7) : (count % 7);
    const days = STREAK_REWARDS.map((r, i) => {
      const done = i < pos || (claimedToday && i === pos);
      const today = i === pos;
      return h('div', { class: `mt-day${done ? ' is-done' : ''}${today ? ' is-today' : ''}${i === 6 ? ' is-big' : ''}` },
        h('span', { class: 'mt-day-n' }, t('quests.day', { n: i + 1 })),
        html(i === 6 ? ji('gift', 'mt-day-ji') : `<span class="mt-day-dot">${done ? '✓' : ''}</span>`),
        h('span', { class: 'mt-day-r' }, html(`+${r}${starIcon('star-ico')}`)));
    });
    const btn = h('button', { class: 'btn-primary mt-claim', 'data-press': '' }, claimedToday ? t('quests.streakDone') : starText(t('quests.streakClaim', { r: STREAK_REWARDS[pos] })));
    btn.disabled = claimedToday;
    btn.addEventListener('click', async () => {
      if (busy) return; busy = true; unlockAudio(); btn.disabled = true;
      try {
        const from = btn.getBoundingClientRect();
        const r = await api.streakClaim();
        sfx.claim(); tg.haptic.success();
        flyReward(from, r.reward);
        toast(r.reward > 0 ? t('quests.streakGot', { r: r.reward, n: r.count }) : t('quests.streakGot0', { n: r.count }), 'ok');
      } catch (e) { toast(apiErrorText(e), 'err'); btn.disabled = false; }
      finally { busy = false; }
    });
    streak.replaceChildren(
      h('div', { class: 'mt-head' },
        h('div', null, h('div', { class: 'mt-title' }, t('quests.streak')), h('div', { class: 'mt-sub' }, t('quests.streakSub'))),
        h('div', { class: 'mt-flame' }, html('<span class="mt-flame-ico">🔥</span>'), h('b', null, String(count)))),
      h('div', { class: 'mt-days' }, ...days), btn);
  }

  function renderQuests() {
    const p = store.progress.get();
    if (!p) { quests.replaceChildren(skeleton(260)); return; }
    const q = p.quests;
    const rows = QUESTS.map((d) => {
      const prog = Math.min(d.goal, questProgress(q, d));
      const claimed = q.claimed.includes(d.id);
      const ready = !claimed && prog >= d.goal;
      const go = GO[d.id];
      const act = h('button', { class: `mt-q-btn${ready ? ' is-ready' : ''}${claimed ? ' is-done' : ''}`, 'data-press': '' },
        claimed ? '✓' : ready ? t('quests.claim') : go ? t('quests.go') : `${prog}/${d.goal}`);
      if (!go && !ready && !claimed) act.disabled = true;
      act.addEventListener('click', async () => {
        if (claimed) return;
        if (!ready) { if (go) navigate.push(go); return; }
        if (busy) return; busy = true; unlockAudio(); act.disabled = true;
        try {
          const from = act.getBoundingClientRect();
          const r = await api.questClaim(d.id);
          sfx.claim(); tg.haptic.success();
          flyReward(from, r.stars, r.stars > 0 ? undefined : `+${r.xp} XP`);
          toast(r.stars > 0 ? t('quests.got', { s: r.stars, x: r.xp }) : t('quests.gotXp', { x: r.xp }), 'ok');
        } catch (e) { toast(apiErrorText(e), 'err'); act.disabled = false; }
        finally { busy = false; }
      });
      const rew = [d.stars ? `+${d.stars}${starIcon('star-ico')}` : '', `+${d.xp} XP`].filter(Boolean).join(' · ');
      return h('div', { class: `mt-q${claimed ? ' is-claimed' : ''}${ready ? ' is-ready' : ''}` },
        html(`<span class="mt-q-ico">${ji(Q_ICON[d.id])}</span>`),
        h('div', { class: 'mt-q-body' },
          h('div', { class: 'mt-q-t' }, starText(t(`quest.${d.id}` as never, { n: d.goal }))),
          h('div', { class: 'mt-q-bar' }, h('i', { style: `transform:scaleX(${prog / d.goal})` })),
          h('div', { class: 'mt-q-r' }, html(rew))),
        act);
    });
    const done = q.claimed.length;
    quests.replaceChildren(
      h('div', { class: 'mt-head' }, h('div', null, h('div', { class: 'mt-title' }, t('quests.daily')), h('div', { class: 'mt-sub' }, t('quests.dailySub'))),
        h('span', { class: 'mt-count' }, `${done}/${QUESTS.length}`)),
      ...rows);
  }

  function renderAch() {
    const p = store.progress.get();
    if (!p) { achs.replaceChildren(skeleton(200)); return; }
    const have = new Set(p.ach);
    const grid = h('div', { class: 'mt-ach-grid' }, ...ACHIEVEMENTS.map((a) => {
      const on = have.has(a.id);
      const b = h('button', { class: `mt-ach${on ? ' is-on' : ''}`, 'data-press': '', 'aria-label': t(`ach.${a.id}` as never) },
        html(`<span class="mt-ach-ico">${ji(a.icon as JellyIcon)}</span>`), h('span', { class: 'mt-ach-t' }, t(`ach.${a.id}` as never)));
      b.addEventListener('click', () => toast(`${t(`ach.${a.id}` as never)} — ${t(`ach.${a.id}.d` as never)} · +${a.xp} XP${on ? ' ✓' : ''}`, 'info'));
      return b;
    }));
    achs.replaceChildren(
      h('div', { class: 'mt-head' }, h('div', null, h('div', { class: 'mt-title' }, t('quests.ach')), h('div', { class: 'mt-sub' }, t('quests.achSub'))),
        h('span', { class: 'mt-count' }, `${have.size}/${ACHIEVEMENTS.length}`)),
      grid);
  }

  const render = () => { renderStreak(); renderQuests(); renderAch(); };
  const un = store.progress.sub(render);
  render();
  void api.progress().catch(() => {});
  return { el: page, destroy: un, onShow: () => void api.progress().catch(() => {}) };
}
