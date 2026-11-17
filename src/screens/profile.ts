import { h, html, starIcon } from '../core/dom';
import { fmt, t } from '../core/i18n';
import { store } from '../core/store';
import { tg } from '../core/telegram';
import { setSound } from '../core/sound';
import { ji } from '../art/games';
import { avatar, MASCOT_URL } from '../ui/header';
import { navigate } from '../ui/router';
import { itemPrize } from '../art/cases';

/** Profile tab: stats, inventory entry, withdrawal rules, sound, ghost collection. Lazy-loaded. */
export function createProfile() {
  const u = tg.user;
  const name = [u.first_name, u.last_name].filter(Boolean).join(' ');
  const statV = { spins: h('span', { class: 'stat-v' }), cup: h('span', { class: 'stat-v' }), bolt: h('span', { class: 'stat-v' }) };
  const stats = h('div', { class: 'stats' },
    ...([['spins', 'profile.spins'], ['cup', 'profile.wins'], ['bolt', 'profile.best']] as const).map(([ic, k]) =>
      h('div', { class: 'stat glass' }, html(ji(ic, 'stat-ico')), statV[ic], h('span', { class: 'stat-k' }, t(k)))),
  );
  const renderStats = () => {
    const s = store.stats.get();
    statV.spins.textContent = fmt(s.opens); statV.cup.textContent = fmt(s.wins); statV.bolt.textContent = s.best ? `×${s.best}` : '—';
  };

  // menu rows
  const invSub = h('span', { class: 'row-sub' });
  const invRow = h('button', { class: 'row', 'data-press': '' },
    html(`<span class="row-ico">${ji('gift')}</span>`),
    h('span', { class: 'row-t' }, h('span', { class: 'row-title' }, t('profile.inventory')), invSub),
    html('<span class="row-chev">›</span>'));
  invRow.addEventListener('click', () => navigate.push('inventory'));
  const renderInv = () => {
    const items = store.inventory.get();
    const v = items.reduce((s, i) => s + itemPrize(i).value, 0);
    invSub.innerHTML = `${t('profile.inventorySub', { n: items.length, v: fmt(v) })}${starIcon('star-ico star-inline')}`;
  };
  const rulesRow = h('button', { class: 'row', 'data-press': '' },
    html(`<span class="row-ico">${ji('crown')}</span>`),
    h('span', { class: 'row-t' }, h('span', { class: 'row-title' }, t('profile.rules'))),
    html('<span class="row-chev">›</span>'));
  rulesRow.addEventListener('click', () => import('./sheets').then((m) => m.openRules()));
  const sw = h('span', { class: 'switch' });
  const sndRow = h('button', { class: 'row', 'data-press': '', 'data-haptic': 'select', role: 'switch' },
    html(`<span class="row-ico">${ji('bolt')}</span>`),
    h('span', { class: 'row-t' }, h('span', { class: 'row-title' }, t('profile.sound'))), sw);
  const renderSnd = () => { sw.classList.toggle('is-on', store.sound.get()); sndRow.setAttribute('aria-checked', String(store.sound.get())); };
  sndRow.addEventListener('click', () => setSound(!store.sound.get()));
  const link = (ico: string, title: Parameters<typeof t>[0], sub: Parameters<typeof t>[0] | null, go: () => void, cls = '') => {
    const b = h('button', { class: `row ${cls}`, 'data-press': '' },
      html(`<span class="row-ico">${ico}</span>`),
      h('span', { class: 'row-t' }, h('span', { class: 'row-title' }, t(title)), sub ? h('span', { class: 'row-sub' }, t(sub)) : null),
      html('<span class="row-chev">›</span>'));
    b.addEventListener('click', go);
    return b;
  };
  const topRow = link(starIcon('star-ico row-star'), 'profile.topup', null, () => navigate.push('topup'), 'row-topup');
  const menu = h('div', { class: 'menu glass' }, topRow, invRow, rulesRow, sndRow);
  const docs = h('div', { class: 'menu glass' },
    link('<span class="row-glyph">✓</span>', 'profile.fair', 'profile.fairSub', () => navigate.push('legal', { id: 'fair' })),
    link('<span class="row-glyph">§</span>', 'profile.docs', 'profile.docsSub', () => navigate.push('legal', { id: 'terms' })),
    link('<span class="row-glyph">i</span>', 'profile.about', null, () => navigate.push('legal', { id: 'about' })));
  const foot = h('footer', { class: 'pf-foot' },
    h('div', { class: 'pf-brand' }, 'Ghost Gift'),
    h('div', null, t('about.rights')),
    h('div', null, t('about.version', { v: `${__APP_VERSION__} (${__APP_BUILD__})` })),
    h('div', { class: 'pf-age' }, t('about.age')),
    h('div', null, t('about.tg')));

  const ghosts = h('div', { class: 'ghost-row' });
  for (let i = 0; i < 5; i++) ghosts.append(html(`<span class="mini-ghost${i ? ' is-locked' : ''}"><img src="${MASCOT_URL}" alt="" loading="lazy" decoding="async" draggable="false"></span>`));
  const collection = h('div', { class: 'collection glass' },
    h('div', { class: 'collection-head' },
      h('span', { class: 'collection-title' }, t('profile.collection')),
      h('span', { class: 'collection-count' }, '1 / 5')),
    h('span', { class: 'collection-sub' }, t('profile.collection.sub')),
    ghosts,
  );
  const head = h('div', { class: 'profile-head' },
    h('div', { class: 'profile-avatar' }, avatar('lg')),
    h('div', { class: 'profile-name' }, name),
    u.username ? h('div', { class: 'profile-user' }, `@${u.username}`) : null,
  );
  renderStats(); renderInv(); renderSnd();
  store.stats.sub(renderStats); store.inventory.sub(renderInv); store.sound.sub(renderSnd);
  const el = h('section', { class: 'screen screen-profile', 'data-screen': 'profile' },
    h('div', { class: 'screen-scroll' }, head, stats, menu, collection, docs, foot));
  el.inert = true;
  return { el };
}
