import { h, html, starIcon } from '../core/dom';
import { fmt, greeting, t, type I18nKey } from '../core/i18n';
import { store } from '../core/store';
import { tg } from '../core/telegram';
import { casesArt, dailyArt, glyphChevron, ji, luckArt, slotsArt, wheelArt } from '../art/games';
import { createFeed, type Win } from '../ui/feed';
import { api } from '../api';
import { CASES, PRIZES } from '../api/catalog';
import { QUESTS, questProgress } from '../api/games';
import type { FeedItem } from '../api/types';
import type { JellyIcon } from '../art/icon-names';
import { isRunning } from '../core/perf';
import { navigate, onRoute, type PushId } from '../ui/router';


function card(id: PushId, title: I18nKey, sub: string, art: string, extra?: HTMLElement) {
  const el = h('button', { class: `game-card gc-${id}`, 'data-press': '', 'data-game': id });
  el.append(
    h('span', { class: 'gc-bg' }),
    html(`<span class="gc-art">${art}</span>`),
    h('span', { class: 'gc-meta' }, h('span', { class: 'gc-title' }, t(title)), h('span', { class: 'gc-sub' }, ...(subNodes(sub)))),
    html(`<span class="gc-go">${glyphChevron}</span>`),
    html('<span class="gc-shine" aria-hidden="true"></span>'),
    html('<span class="gc-tw" aria-hidden="true"><i></i><i></i><i></i></span>'),
  );
  if (extra) el.append(extra);
  el.addEventListener('click', () => navigate.push(id));
  return el;
}
const subNodes = (s: string) => {
  // "{star}" token → inline currency icon
  const parts = s.split('{star}');
  return parts.flatMap((p, i) => (i ? [html(starIcon('star-ico star-inline')), p] : [p]));
};

const pad = (n: number) => String(n).padStart(2, '0');
const hms = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${pad((s / 3600) | 0)}:${pad(((s % 3600) / 60) | 0)}:${pad(s % 60)}`; };
const JELLY = new Set<string>(['bear', 'heart', 'rose', 'cake', 'gift', 'leaf', 'rocket', 'cup', 'ring', 'crown', 'diamond', 'seven', 'acorn', 'luck', 'spins', 'bolt']);

/** Server feed row → marquee chip. Hidden players show as an anonymous ghost. */
function toWin(f: FeedItem): Win {
  const nick = f.name || t('feed.anon');
  if (f.game === 'wheel' || f.game === 'slots') return { id: f.id, at: f.at, nick, item: 'item.stars', stars: f.payout, rarity: f.rarity, note: `×${f.mult} ${t(f.game === 'wheel' ? 'feed.wheel' : 'feed.slots')}` };
  const p = PRIZES[f.prizeId];
  if (!p || p.kind === 'stars') return { id: f.id, at: f.at, nick, item: 'item.stars', stars: f.payout || p?.value, rarity: f.rarity };
  const item = (p.kind === 'premium' ? (p.months === 6 ? 'item.premium6' : 'item.premium') : `item.${p.id}`) as I18nKey;
  return { id: f.id, at: f.at, nick, item, icon: (JELLY.has(p.icon) ? p.icon : 'diamond') as JellyIcon, rarity: f.rarity };
}

function dailyStatus() {
  const pill = h('span', { class: 'daily-pill' });
  const badge = h('span', { class: 'daily-badge' }, t('games.daily.free'));
  let timer = 0;
  const render = () => {
    const left = store.dailyReadyAt.get() - Date.now();
    const ready = left <= 0;
    pill.classList.toggle('is-ready', ready);
    pill.closest('.game-card')?.classList.toggle('is-ready', ready);
    if (ready) {
      if (!pill.dataset.ready) { pill.replaceChildren(h('span', { class: 'dot' }), t('games.daily.ready')); pill.dataset.ready = '1'; }
    } else {
      delete pill.dataset.ready;
      const s = Math.ceil(left / 1000);
      pill.textContent = `${pad((s / 3600) | 0)}:${pad(((s % 3600) / 60) | 0)}:${pad(s % 60)}`;
    }
  };
  const tick = () => { render(); timer = window.setTimeout(tick, 1000 - (Date.now() % 1000) + 5); };
  store.dailyReadyAt.sub(render);
  return {
    nodes: [badge, pill],
    start() { clearTimeout(timer); tick(); },
    stop() { clearTimeout(timer); },
  };
}

/** Level · streak · quests strip under the greeting (opens Quests). */
function progressStrip() {
  const lv = h('span', { class: 'ps-lv' });
  const bar = h('i');
  const xp = h('span', { class: 'ps-xp' });
  const streak = h('span', { class: 'ps-chip ps-streak' });
  const quests = h('span', { class: 'ps-chip ps-q' });
  const el = h('button', { class: 'ps glass enter', 'data-press': '', 'aria-label': t('quests.title') },
    lv, h('span', { class: 'ps-mid' }, h('span', { class: 'ps-top' }, h('b', null, t('home.level')), xp), h('span', { class: 'ps-bar' }, bar)), streak, quests);
  el.addEventListener('click', () => navigate.push('quests'));
  const render = () => {
    const p = store.progress.get();
    el.classList.toggle('is-loading', !p);
    if (!p) return;
    lv.textContent = String(p.level);
    bar.style.transform = `scaleX(${p.need ? Math.min(1, p.into / p.need) : 1})`;
    xp.textContent = p.need ? `${fmt(p.into)} / ${fmt(p.need)} XP` : 'MAX';
    streak.innerHTML = `<span class="ps-fire">🔥</span>${p.streak.count}`;
    streak.classList.toggle('is-hot', !p.streak.claimedToday);
    const ready = QUESTS.filter((d) => !p.quests.claimed.includes(d.id) && questProgress(p.quests, d) >= d.goal).length + (p.streak.claimedToday ? 0 : 1);
    quests.textContent = ready ? String(ready) : '✓';
    quests.classList.toggle('is-ready', ready > 0);
  };
  store.progress.sub(render);
  render();
  return el;
}

/** Small tiles: quests · leaders · friends. */
function tiles() {
  const tile = (id: 'quests' | 'leaders' | 'friends', icon: JellyIcon, title: I18nKey) => {
    const b = h('button', { class: `tile glass t-${id}`, 'data-press': '' }, html(`<span class="tile-ico">${ji(icon)}</span>`), h('span', { class: 'tile-t' }, t(title)));
    b.addEventListener('click', () => navigate.push(id));
    return b;
  };
  return h('div', { class: 'tiles enter' }, tile('quests', 'cup', 'home.quests'), tile('leaders', 'crown', 'home.leaders'), tile('friends', 'heart', 'home.friends'));
}

export function createHome() {
  const demoFeed = !import.meta.env.VITE_API_URL;
  const feed = createFeed({ demo: demoFeed });
  const daily = dailyStatus();
  const extra = h('span', { class: 'gc-extra' }, ...daily.nodes);

  const dailyCard = card('daily', 'games.daily', t('games.daily.sub'), dailyArt, extra);
  dailyCard.prepend(h('span', { class: 'gc-pulse', 'aria-hidden': 'true' }));

  // own real wins jump into the live feed (server stream will do the same for everyone)
  store.lastWin.sub(() => {
    const p = store.lastWin.get();
    if (!p) return;
    const item = (p.kind === 'stars' ? 'item.stars' : p.kind === 'premium' ? (p.months === 6 ? 'item.premium6' : 'item.premium') : `item.${p.id}`) as I18nKey;
    feed.push({ nick: tg.user.first_name, item, icon: p.icon === 'stars' ? undefined : p.icon, stars: p.kind === 'stars' ? p.value : undefined, rarity: p.rarity, me: true });
  });

  const hero = h('div', { class: 'hero enter' },
    h('div', { class: 'hero-text' },
      h('span', { class: 'hero-greet' }, `${greeting()}, ${tg.user.first_name}`),
      h('h1', { class: 'hero-title' }, t('home.title')),
      h('span', { class: 'hero-line', 'aria-hidden': 'true' }),
    ),
    html(`<span class="season-chip">${ji('leaf')}${t('home.season')}</span>`),
  );

  const grid = h('div', { class: 'game-grid' },
    card('cases', 'games.cases', `${t('games.cases.sub', { n: Math.min(...CASES.filter((c) => c.price > 0).map((c) => c.price)) })} {star}`, casesArt),
    dailyCard,
    card('wheel', 'games.wheel', t('games.wheel.sub'), wheelArt),
    card('slots', 'games.slots', t('games.slots.sub'), slotsArt),
  );

  // Daily luck card: live state (draw / active countdown / tomorrow)
  const lbSub = h('span', { class: 'lb-sub' }, t('games.luck.sub'));
  const lbPill = h('span', { class: 'lb-pill' }, t('luck.draw'));
  const luck = h('button', { class: 'luck-banner enter', 'data-press': '' },
    html(`<span class="lb-art">${luckArt}</span>`),
    h('span', { class: 'lb-text' }, h('span', { class: 'lb-title' }, t('games.luck')), lbSub),
    lbPill,
  );
  luck.addEventListener('click', () => navigate.push('luck'));
  const renderLuck = () => {
    const l = store.progress.get()?.luck;
    const on = !!l && l.until > Date.now() && l.pct > 0;
    luck.classList.toggle('is-ready', !!l && !l.drawnToday);
    luck.classList.toggle('is-on', on);
    if (on) { lbSub.textContent = t('luck.bannerOn', { p: l!.pct, t: hms(l!.until - Date.now()) }); lbPill.textContent = `+${l!.pct}%`; }
    else if (l?.drawnToday) { lbSub.textContent = t('luck.bannerDone'); lbPill.textContent = t('luck.tomorrow'); }
    else { lbSub.textContent = t('games.luck.sub'); lbPill.textContent = t('luck.draw'); }
  };
  store.progress.sub(renderLuck);
  renderLuck();

  // Real wins from the server (production). Locally the demo generator runs instead.
  let lastId = 0, feedTimer = 0, feedOn = true;
  const pullFeed = async () => {
    clearTimeout(feedTimer);
    if (demoFeed) return;
    try {
      const r = await api.feed();
      if (r) {
        const list = r.items;
        const wins = list.map(toWin);
        const fresh = lastId ? wins.filter((w) => (w.id ?? 0) > lastId) : [];
        if (r.stats) feed.setStats(r.stats.plays24h, r.stats.players24h);
        if (!lastId) feed.setReal(wins); else if (fresh.length) feed.setReal(wins, fresh);
        lastId = Math.max(lastId, 0, ...list.map((x) => x.id));
      }
    } catch { /* offline: keep what we have */ }
    if (feedOn) feedTimer = window.setTimeout(pullFeed, isRunning() ? 15_000 : 60_000);
  };

  const scroll = h('div', { class: 'screen-scroll' }, hero, progressStrip(), grid, luck, tiles());
  const el = h('section', { class: 'screen screen-home is-active', 'data-screen': 'games' }, feed.el, scroll);

  // Pause decorative work when this screen isn't visible.
  let luckTimer = 0;
  const setActive = (a: boolean) => {
    el.classList.toggle('is-idle', !a); feed.setActive(a); a ? daily.start() : daily.stop();
    clearInterval(luckTimer); if (a) luckTimer = window.setInterval(renderLuck, 1000);
    const was = feedOn; feedOn = a; if (a && !was) void pullFeed();
  };
  onRoute((tab, covered) => setActive(tab === 'games' && !covered));

  return {
    el,
    mount() { feed.mount(); daily.start(); luckTimer = window.setInterval(renderLuck, 1000); void pullFeed(); },
  };
}
