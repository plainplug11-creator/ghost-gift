import '../styles/cases.css';
import '../styles/meta.css';
import { h, html } from '../core/dom';
import { fmt, t } from '../core/i18n';
import { tg } from '../core/telegram';
import { api } from '../api';
import { apiErrorText } from '../api/errors';
import type { Leaderboard, LeaderRow } from '../api/types';
import { ghostFilter } from '../api/games';
import { GHOST_FLAT } from '../ui/ghost';
import { navBar } from '../ui/nav';
import { skeleton, skeletonRows } from '../ui/skeleton';
import type { Page } from '../ui/router';

const nameOf = (r: { name: string | null; me?: boolean }) => (r.me ? t('leaders.you') : r.name || t('leaders.hidden'));
const ghostImg = (level: number, cls = 'ld-gh') => `<img class="${cls}" src="${GHOST_FLAT}" alt="" draggable="false" style="filter:${ghostFilter(level) || 'none'}">`;

/** Weekly XP leaderboard (resets Monday 00:00 Kyiv). Names are public only if the player didn't hide them. */
export function createLeaders(): Page {
  const body = h('div', { class: 'ld-body' }, skeleton(170), ...skeletonRows(6));
  const reset = h('div', { class: 'ld-reset' });
  const me = h('div', { class: 'ld-me glass', hidden: '' });
  const page = h('div', { class: 'pg pg-meta pg-leaders' },
    navBar(t('leaders.title')),
    h('div', { class: 'pg-scroll mt-scroll' },
      h('div', { class: 'ld-intro' }, h('div', { class: 'mt-title' }, t('leaders.week')), reset, h('div', { class: 'mt-sub' }, t('leaders.sub'))),
      body, h('p', { class: 'gk-foot' }, t('leaders.foot'))),
    me);

  const row = (r: LeaderRow) => h('div', { class: `ld-row${r.me ? ' is-me' : ''}` },
    h('span', { class: 'ld-rank' }, String(r.rank)),
    html(ghostImg(r.level)),
    h('span', { class: 'ld-name' }, nameOf(r), h('small', null, t('leaders.level', { n: r.level }))),
    h('b', { class: 'ld-score' }, `${fmt(r.score)} XP`));

  function render(lb: Leaderboard) {
    const [a, b, c] = lb.top;
    const pod = (r: LeaderRow | undefined, place: 1 | 2 | 3) => h('div', { class: `ld-pod p${place}${r?.me ? ' is-me' : ''}` },
      html(`<span class="ld-crown">${place === 1 ? '👑' : ''}</span>${r ? ghostImg(r.level, 'ld-pod-gh') : '<span class="ld-pod-empty"></span>'}`),
      h('span', { class: 'ld-pod-n' }, r ? nameOf(r) : '—'),
      h('span', { class: 'ld-pod-s' }, r ? `${fmt(r.score)} XP` : ''),
      h('span', { class: 'ld-pod-b' }, String(place)));
    if (!lb.top.length) {
      body.replaceChildren(h('div', { class: 'mt-empty glass' }, html(ghostImg(1, 'mt-empty-gh')), h('div', null, t('leaders.empty'))));
    } else {
      body.replaceChildren(h('div', { class: 'ld-podium' }, pod(b, 2), pod(a, 1), pod(c, 3)), h('div', { class: 'ld-list glass' }, ...lb.top.slice(3).map(row)));
      if (lb.top.length <= 3) body.lastElementChild!.remove();
    }
    const inTop = lb.top.some((r) => r.me);
    me.hidden = inTop;
    if (!inTop) me.replaceChildren(row({ rank: lb.me.rank, name: null, level: lb.me.level, score: lb.me.score, me: true }));
  }

  // countdown to Monday 00:00 Kyiv
  let timer = 0;
  const tick = () => {
    const now = new Date();
    const kyiv = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Kyiv' }));
    const dow = (kyiv.getDay() + 6) % 7; // Mon=0
    const next = new Date(kyiv); next.setHours(24 * (7 - dow), 0, 0, 0);
    const s = Math.max(0, Math.floor((next.getTime() - kyiv.getTime()) / 1000));
    const d = Math.floor(s / 86400), hh = Math.floor((s % 86400) / 3600), mm = Math.floor((s % 3600) / 60);
    reset.textContent = t('leaders.resets', { t: d ? `${d}${t('time.d')} ${hh}${t('time.h')}` : `${hh}${t('time.h')} ${mm}${t('time.m')}` });
  };
  tick(); timer = window.setInterval(tick, 30_000);

  const load = () => api.leaderboard().then(render).catch((e) => {
    body.replaceChildren(h('div', { class: 'mt-empty glass' }, h('div', null, apiErrorText(e)),
      Object.assign(h('button', { class: 'btn-ghost', 'data-press': '' }, t('common.retry')), { onclick: () => { tg.haptic.tap(); void load(); } })));
  });
  void load();
  return { el: page, destroy: () => clearInterval(timer) };
}
