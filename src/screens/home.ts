import { h, html, starIcon } from '../core/dom';
import { greeting, t, type I18nKey } from '../core/i18n';
import { store } from '../core/store';
import { tg } from '../core/telegram';
import { casesArt, dailyArt, glyphChevron, ji, luckArt, slotsArt, wheelArt } from '../art/games';
import { createFeed } from '../ui/feed';
import { navigate, onRoute, type PushId } from '../ui/router';


function card(id: PushId, title: I18nKey, sub: string, art: string, extra?: HTMLElement) {
  const el = h('button', { class: `game-card gc-${id}`, 'data-press': '', 'data-game': id });
  el.append(
    h('span', { class: 'gc-bg' }),
    html(`<span class="gc-art">${art}</span>`),
    h('span', { class: 'gc-meta' }, h('span', { class: 'gc-title' }, t(title)), h('span', { class: 'gc-sub' }, ...(subNodes(sub)))),
    html(`<span class="gc-go">${glyphChevron}</span>`),
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

export function createHome() {
  const feed = createFeed();
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
    ),
    html(`<span class="season-chip">${ji('leaf')}${t('home.season')}</span>`),
  );

  const grid = h('div', { class: 'game-grid' },
    card('cases', 'games.cases', `${t('games.cases.sub')} {star}`, casesArt),
    dailyCard,
    card('wheel', 'games.wheel', t('games.wheel.sub'), wheelArt),
    card('slots', 'games.slots', t('games.slots.sub'), slotsArt),
  );

  // Stage-3 hook: daily luck card teaser (opens placeholder for now)
  const luck = h('button', { class: 'luck-banner enter', 'data-press': '' },
    html(`<span class="lb-art">${luckArt}</span>`),
    h('span', { class: 'lb-text' }, h('span', { class: 'lb-title' }, t('games.luck')), h('span', { class: 'lb-sub' }, t('games.luck.sub'))),
    h('span', { class: 'lb-pill' }, t('games.luck.soon')),
  );
  luck.addEventListener('click', () => navigate.push('luck'));

  const scroll = h('div', { class: 'screen-scroll' }, hero, grid, luck);
  const el = h('section', { class: 'screen screen-home is-active', 'data-screen': 'games' }, feed.el, scroll);

  // Pause decorative work when this screen isn't visible.
  const setActive = (a: boolean) => { el.classList.toggle('is-idle', !a); feed.setActive(a); a ? daily.start() : daily.stop(); };
  onRoute((tab, covered) => setActive(tab === 'games' && !covered));

  return {
    el,
    mount() { feed.mount(); daily.start(); },
  };
}
