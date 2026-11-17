import '../styles/prizes.css';
import '../styles/cases.css';
import { h, html, starIcon } from '../core/dom';
import { fmt, t } from '../core/i18n';
import { store } from '../core/store';
import { tg } from '../core/telegram';
import { api } from '../api';
import { apiErrorText } from '../api/errors';
import { PREMIUM_TIERS, PRIZES } from '../api/catalog';
import type { InvItem, Prize } from '../api/types';
import { RARITY_RGB, prizeIcon, prizeName, rarityName } from '../art/cases';
import { MASCOT_URL } from '../ui/header';
import { openSheet, toast } from '../ui/sheet';
import prizesUrl from '../assets/prizes.webp';

const ATLAS = ['stars', 'heart', 'bear', 'rose', 'gift', 'cake', 'rocket', 'cup', 'ring', 'diamond', 'crown'];
const img = (src: string) => new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });

/**
 * Neon-framed share card (canvas → PNG). For Stories Telegram needs a PUBLIC
 * https URL, so in production the server renders/uploads this same card and
 * returns `mediaUrl` (TODO(server): POST /api/share-card → { mediaUrl, preparedMessageId }).
 */
async function renderCard(p: Prize) {
  const W = 540, H = 960, cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const x = cv.getContext('2d')!;
  const bg = x.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#05060f'); bg.addColorStop(0.6, '#0d0b2a'); bg.addColorStop(1, '#1a0b33');
  x.fillStyle = bg; x.fillRect(0, 0, W, H);
  const rc = RARITY_RGB[p.rarity];
  const halo = x.createRadialGradient(W / 2, 400, 10, W / 2, 400, 300);
  halo.addColorStop(0, `rgba(${rc},.55)`); halo.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = halo; x.fillRect(0, 0, W, H);
  // neon iridescent frame
  const fr = x.createLinearGradient(0, 0, W, H);
  fr.addColorStop(0, '#46e6ff'); fr.addColorStop(0.35, '#6d86ff'); fr.addColorStop(0.66, '#a65cff'); fr.addColorStop(1, '#ff5ccc');
  x.strokeStyle = fr; x.lineWidth = 6; x.shadowColor = '#a65cff'; x.shadowBlur = 28;
  x.beginPath(); x.roundRect(24, 24, W - 48, H - 48, 44); x.stroke(); x.shadowBlur = 0;
  try {
    const [atlas, mascot] = await Promise.all([img(prizesUrl), img(MASCOT_URL)]);
    const i = ATLAS.indexOf(p.icon), c = atlas.naturalWidth / 4;
    x.drawImage(atlas, (i % 4) * c, ((i / 4) | 0) * c, c, c, W / 2 - 150, 250, 300, 300);
    x.drawImage(mascot, 52, 56, 84, 84);
  } catch { /* draw without art */ }
  x.textAlign = 'center'; x.fillStyle = '#fff';
  x.font = '800 30px -apple-system, system-ui, sans-serif'; x.textAlign = 'left'; x.fillText('Ghost Gift', 146, 110);
  x.textAlign = 'center';
  x.fillStyle = `rgb(${rc})`; x.font = '800 30px -apple-system, system-ui, sans-serif'; x.fillText(rarityName(p).toUpperCase(), W / 2, 620);
  x.fillStyle = '#fff'; x.font = '800 54px -apple-system, system-ui, sans-serif'; x.fillText(prizeName(p), W / 2, 690);
  x.fillStyle = 'rgba(230,234,255,.75)'; x.font = '600 30px -apple-system, system-ui, sans-serif'; x.fillText(`${fmt(p.value)} ★`, W / 2, 745);
  x.fillStyle = 'rgba(230,234,255,.5)'; x.font = '600 24px -apple-system, system-ui, sans-serif'; x.fillText(`@${tg.user.username ?? tg.user.first_name}`, W / 2, 870);
  return cv.toDataURL('image/png');
}

/** TODO(config): real bot username / direct Mini App link. */
const APP_LINK = 'https://t.me/GhostGiftBot/app';

export async function openShare(p: Prize) {
  const preview = h('img', { class: 'sh-img', alt: '' });
  const story = h('button', { class: 'btn-primary', 'data-press': '' }, t('share.story'));
  const chat = h('button', { class: 'btn-ghost', 'data-press': '' }, t('share.chat'));
  const s = openSheet([h('div', { class: 'sh-title' }, t('share.title')), h('div', { class: 'sh-prev' }, preview), h('div', { class: 'rs-actions n2' }, story, chat)], { cls: 'sh' });
  renderCard(p).then((u) => { preview.src = u; preview.classList.add('is-ready'); });
  const text = t('share.text', { item: prizeName(p) });
  story.addEventListener('click', () => {
    // shareToStory needs a hosted https image — available once the server renders the card.
    const mediaUrl = ''; // TODO(server): from POST /api/share-card
    if (tg.share.canStory() && mediaUrl) tg.share.story(mediaUrl, text, APP_LINK);
    else toast(t('share.soon'), 'info');
  });
  chat.addEventListener('click', () => {
    const preparedId = ''; // TODO(server): savePreparedInlineMessage → id
    if (tg.share.canMessage() && preparedId) tg.share.message(preparedId);
    else { tg.share.link(APP_LINK, text); s.close(); }
  });
}

export function openRules() {
  const items = (['rules.1', 'rules.2', 'rules.3', 'rules.4', 'rules.5'] as const).map((k, i) => h('li', null, h('span', { class: 'rl-n' }, String(i + 1)), h('span', null, t(k))));
  const ok = h('button', { class: 'btn-primary', 'data-press': '' }, t('rules.ok'));
  const s = openSheet([h('div', { class: 'sh-title' }, t('rules.title')), h('ol', { class: 'rl' }, ...items), h('p', { class: 'rl-note' }, t('inv.note')), ok], { cls: 'rules' });
  ok.addEventListener('click', () => s.close());
}

export function openPremium() {
  const balEl = h('span', { class: 'pm-bal-v' });
  const rows = h('div', { class: 'pm-rows' });
  const render = () => {
    const b = store.balance.get();
    balEl.innerHTML = `${fmt(b)}${starIcon('star-ico')}`;
    rows.replaceChildren(...PREMIUM_TIERS.map((tier) => {
      const ok = b >= tier.price;
      const btn = h('button', { class: ok ? 'btn-primary pm-go' : 'btn-ghost pm-go', 'data-press': '' }, ok ? t('prem.get') : t('prem.need', { n: fmt(tier.price - b) }));
      btn.disabled = !ok;
      btn.addEventListener('click', async () => {
        try { await api.buyPremium(tier.months); tg.haptic.success(); toast(t('prem.done')); s.close(); }
        catch (e) { tg.haptic.error(); toast(apiErrorText(e), 'err'); }
      });
      return h('div', { class: `pm-row glass m${tier.months}` },
        html(`<span class="pm-ico">${prizeIcon(PRIZES.prem3)}</span>`),
        h('div', { class: 'pm-t' }, h('div', { class: 'pm-m' }, t('prem.months', { n: tier.months })), html(`<div class="pm-p">${fmt(tier.price)}${starIcon('star-ico')}</div>`)),
        btn);
    }));
  };
  render();
  const un = store.balance.sub(render);
  const s = openSheet([
    h('div', { class: 'sh-title' }, t('prem.title')),
    h('p', { class: 'sh-sub' }, t('prem.sub')),
    h('div', { class: 'pm-bal' }, h('span', null, t('prem.balance')), balEl),
    rows,
    h('p', { class: 'rl-note' }, t('prem.note')),
  ], { cls: 'pm', onClose: () => { un(); } });
}

/** Action sheet for one inventory item: keep / withdraw / sell / → Premium. */
export function openItem(it: InvItem) {
  const p = PRIZES[it.prizeId];
  const pending = it.status === 'withdrawing';
  const btn = (label: Node[] | string, cls: string, fn: () => void, disabled = false) => {
    const b = h('button', { class: cls, 'data-press': '' });
    typeof label === 'string' ? (b.textContent = label) : b.append(...label);
    b.disabled = disabled;
    b.addEventListener('click', fn);
    return b;
  };
  const sellLabel = [h('span', null, t('inv.sell')), html(`<span class="cd-price">${fmt(p.value)}${starIcon('star-ico')}</span>`)];
  const s = openSheet([
    h('div', { class: 'it-head', style: `--rc:${RARITY_RGB[p.rarity]}` },
      html(`<span class="it-ico">${prizeIcon(p)}</span>`),
      h('div', { class: 'it-n' }, prizeName(p)),
      html(`<div class="rs-meta"><span class="rs-r">${rarityName(p)}</span><span class="rs-v">${fmt(p.value)}${starIcon('star-ico')}</span></div>`),
      pending ? h('span', { class: 'inv-pending' }, t('inv.pending')) : null),
    h('div', { class: 'it-actions' },
      btn(p.kind === 'premium' ? t('inv.withdrawPremium') : t('inv.withdraw'), 'btn-primary', async () => {
        try { await api.withdraw(it.uid); tg.haptic.success(); toast(t('inv.queued')); s.close(); }
        catch (e) { tg.haptic.error(); toast(apiErrorText(e), 'err'); }
      }, pending),
      btn(sellLabel, 'btn-ghost', async () => {
        try { const r = await api.sell(it.uid); tg.haptic.success(); toast(t('result.sold', { n: fmt(r.credited) })); s.close(); }
        catch (e) { tg.haptic.error(); toast(apiErrorText(e), 'err'); }
      }, pending),
      btn(t('inv.premium'), 'btn-ghost', () => { s.close().then(openPremium); }),
      btn(t('inv.keep'), 'btn-text', () => s.close()),
    ),
    h('p', { class: 'rl-note' }, t('inv.note')),
  ], { cls: `it r-${p.rarity}` });
  s.el.style.setProperty('--rc', RARITY_RGB[p.rarity]);
}

