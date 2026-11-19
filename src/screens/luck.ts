import '../styles/cases.css';
import '../styles/play.css';
import { h, html, starText } from '../core/dom';
import { t } from '../core/i18n';
import { store } from '../core/store';
import { tg } from '../core/telegram';
import { reducedMotion } from '../core/perf';
import { sfx, unlockAudio } from '../core/sound';
import { api } from '../api';
import { apiErrorText } from '../api/errors';
import { LUCK_CARDS, LUCK_HOURS } from '../api/games';
import { LUCK } from '../api/catalog';
import { navBar } from '../ui/nav';
import { toast } from '../ui/sheet';
import { GHOST_FLAT } from '../ui/ghost';
import { ji } from '../art/games';
import { confetti } from '../ui/confetti';
import { navigate, type Page } from '../ui/router';

const pad = (n: number) => String(n).padStart(2, '0');
const hms = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`; };
/** ms until the next Kyiv midnight (draws reset per Kyiv day). */
function untilKyivMidnight(now = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Kyiv', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(now));
  const g = (k: string) => Number(parts.find((p) => p.type === k)?.value ?? 0);
  return ((24 - g('hour')) * 3600 - g('minute') * 60 - g('second')) * 1000;
}
const tierOf = (pct: number) => (pct >= 10 ? 'c-legend' : pct >= 7 ? 'c-epic' : pct >= 5 ? 'c-rare' : 'c-common');

function cardEl(i: number) {
  const back = h('span', { class: 'lk-face lk-back' },
    html(`<span class="lk-moon"></span><img class="lk-ghost" src="${GHOST_FLAT}" alt="" draggable="false"><span class="lk-q">?</span>`));
  const front = h('span', { class: 'lk-face lk-front' });
  const inner = h('span', { class: 'lk-inner' }, back, front);
  const el = h('button', { class: `lk-card lk-${i}`, 'data-press': '', 'aria-label': t('luck.pick') }, inner);
  return { el, front };
}

export function createLuck(): Page {
  const fx = h('canvas', { class: 'gk-fx', 'aria-hidden': 'true' });
  const cards = [0, 1, 2].map(cardEl);
  const deck = h('div', { class: 'lk-deck' }, ...cards.map((c) => c.el));
  const title = h('div', { class: 'lk-head' });
  const status = h('div', { class: 'lk-status glass' });
  const odds = h('div', { class: 'lk-odds' }, ...LUCK_CARDS.map((c) => h('div', { class: `lk-odd ${tierOf(c.pct)}` },
    h('b', null, `+${c.pct}%`), h('span', null, `${Math.round((c.w / LUCK_CARDS.reduce((s, x) => s + x.w, 0)) * 100)}%`))));
  const how = h('div', { class: 'lk-how glass' },
    h('div', { class: 'gk-label' }, t('luck.howTitle')),
    h('p', null, starText(t('luck.how', { max: LUCK.maxCasePrice, h: LUCK_HOURS }))),
    odds);
  const goCases = h('button', { class: 'btn-primary lk-go', 'data-press': '' }, t('luck.toCases'));
  goCases.addEventListener('click', () => navigate.push('cases'));

  const page = h('div', { class: 'pg pg-game pg-luck' },
    navBar(t('games.luck')),
    h('div', { class: 'pg-scroll gk-scroll' }, title, deck, status, how, h('p', { class: 'gk-foot' }, t('luck.foot'))),
    fx,
  );

  let busy = false, timer = 0;
  const frontHtml = (pct: number) => `<span class="lk-burst"></span>${ji('luck', 'lk-ji')}<b class="lk-pct">+${pct}%</b><span class="lk-cap">${t('luck.cap')}</span>`;

  function renderState() {
    const p = store.progress.get();
    const luck = p?.luck;
    clearInterval(timer);
    const active = !!luck && luck.until > Date.now() && luck.pct > 0;
    const drawn = !!luck?.drawnToday;
    page.classList.toggle('is-drawn', drawn);
    if (!drawn) {
      title.replaceChildren(h('div', { class: 'lk-h1' }, t('luck.pickTitle')), h('div', { class: 'lk-h2' }, t('luck.pickSub')));
      status.hidden = !active;
      if (active) status.replaceChildren(h('span', null, t('luck.stillActive', { p: luck!.pct })));
      cards.forEach((c) => { c.el.disabled = false; c.el.classList.remove('is-flip', 'is-out', 'is-chosen'); });
      deck.classList.add('is-ready');
      return;
    }
    deck.classList.remove('is-ready');
    title.replaceChildren(h('div', { class: 'lk-h1' }, active ? t('luck.activeTitle', { p: luck!.pct }) : t('luck.doneTitle')), h('div', { class: 'lk-h2' }, starText(t('luck.activeSub', { max: LUCK.maxCasePrice }))));
    // show the drawn card face-up in the middle
    if (!cards.some((c) => c.el.classList.contains('is-chosen'))) {
      cards.forEach((c, i) => { c.el.disabled = true; c.el.classList.toggle('is-out', i !== 1); c.el.classList.toggle('is-chosen', i === 1); c.el.classList.toggle('is-flip', i === 1); });
      cards[1].front.className = `lk-face lk-front ${tierOf(luck?.pct || 3)}`;
      cards[1].front.innerHTML = frontHtml(luck?.pct || 0);
    }
    status.hidden = false;
    const tick = () => {
      const l = store.progress.get()?.luck;
      const left = (l?.until ?? 0) - Date.now();
      status.replaceChildren(
        h('div', { class: 'lk-row' }, h('span', null, t('luck.left')), h('b', { class: left > 0 ? 'is-on' : '' }, left > 0 ? hms(left) : t('luck.expired'))),
        h('div', { class: 'lk-row' }, h('span', null, t('luck.next')), h('b', null, hms(untilKyivMidnight()))),
        goCases,
      );
    };
    tick();
    timer = window.setInterval(tick, 1000);
  }

  async function pick(i: number) {
    if (busy || page.classList.contains('is-drawn')) return;
    busy = true; unlockAudio();
    tg.haptic.medium();
    deck.classList.remove('is-ready');
    cards.forEach((c, k) => { c.el.disabled = true; if (k !== i) c.el.classList.add('is-out'); });
    const chosen = cards[i];
    chosen.el.classList.add('is-chosen', 'is-lift');
    try {
      const [r] = await Promise.all([api.luckDraw(), new Promise((res) => setTimeout(res, reducedMotion ? 0 : 420))]);
      chosen.front.className = `lk-face lk-front ${tierOf(r.pct)}`;
      chosen.front.innerHTML = frontHtml(r.pct);
      sfx.flip();
      chosen.el.classList.add('is-flip');
      await new Promise((res) => setTimeout(res, reducedMotion ? 0 : 520));
      const rank = r.pct >= 10 ? 4 : r.pct >= 7 ? 3 : r.pct >= 5 ? 2 : 1;
      sfx.land(rank, rank >= 4); tg.haptic.success();
      if (rank >= 2) confetti(fx, { colors: ['#3fe3ff', '#a65cff', '#ff5ccc', '#ffd66e'], count: 50 + rank * 25, y: 0.35 });
      if (r.active > r.pct) toast(t('luck.kept', { p: r.active }), 'info');
      page.classList.add('is-drawn');
      setTimeout(renderState, reducedMotion ? 0 : 900);
    } catch (e) {
      toast(apiErrorText(e), 'err');
      chosen.el.classList.remove('is-chosen', 'is-lift');
      renderState();
    } finally { busy = false; }
  }
  cards.forEach((c, i) => c.el.addEventListener('click', () => void pick(i)));

  const un = store.progress.sub(() => { if (!busy) renderState(); });
  renderState();
  if (!store.progress.get()) void api.progress().catch(() => {});

  return { el: page, onBack: () => !busy, destroy() { un(); clearInterval(timer); } };
}
