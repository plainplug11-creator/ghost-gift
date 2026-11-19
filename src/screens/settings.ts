import '../styles/cases.css';
import '../styles/meta.css';
import { h, html } from '../core/dom';
import { lang, setLang, t, type Lang } from '../core/i18n';
import { store } from '../core/store';
import { setHapticsEnabled, tg } from '../core/telegram';
import { reducedMotion, setCalm } from '../core/perf';
import { setSound } from '../core/sound';
import { api } from '../api';
import { apiErrorText } from '../api/errors';
import { BOT_USERNAME } from '../api/games';
import { navBar } from '../ui/nav';
import { toast } from '../ui/sheet';
import { navigate, type Page } from '../ui/router';

type Sw = { el: HTMLElement; set(on: boolean): void };
function switchRow(icon: string, title: string, sub: string | null, get: () => boolean, onToggle: (next: boolean) => void | Promise<void>): Sw {
  const sw = h('span', { class: 'switch' });
  const el = h('button', { class: 'row', 'data-press': '', 'data-haptic': 'select', role: 'switch' },
    html(`<span class="row-ico"><span class="row-glyph">${icon}</span></span>`),
    h('span', { class: 'row-t' }, h('span', { class: 'row-title' }, title), sub ? h('span', { class: 'row-sub' }, sub) : null), sw);
  const set = (on: boolean) => { sw.classList.toggle('is-on', on); el.setAttribute('aria-checked', String(on)); };
  el.addEventListener('click', () => void onToggle(!get()));
  set(get());
  return { el, set };
}

/** Settings: sound, haptics, calm motion, language, privacy (feed/leaderboard), opt-in bot reminders. */
export function createSettings(): Page {
  let haptics = (() => { try { return localStorage.getItem('gg.haptics') !== '0'; } catch { return true; } })();
  const snd = switchRow('♪', t('settings.sound'), null, () => store.sound.get(), (v) => setSound(v));
  const hap = switchRow('〰', t('settings.haptics'), t('settings.hapticsSub'), () => haptics, (v) => { haptics = v; setHapticsEnabled(v); hap.set(v); if (v) tg.haptic.medium(); });
  let calm = reducedMotion;
  const calmRow = switchRow('◐', t('settings.calm'), t('settings.calmSub'), () => calm, (v) => { calm = v; setCalm(v); calmRow.set(v); });

  const server = async (patch: { hideFeed?: boolean; notify?: boolean }, row: Sw, key: 'hideFeed' | 'notify') => {
    row.set(!!patch[key]);
    try {
      const r = await api.saveSettings(patch);
      row.set(r[key]);
      if (key === 'notify' && r.notify && r.botStarted === false) askStartBot();
    } catch (e) { row.set(!patch[key]); toast(apiErrorText(e), 'err'); }
  };
  const p = () => store.progress.get();
  const hide = switchRow('👁', t('settings.hide'), t('settings.hideSub'), () => !!p()?.settings.hideFeed, (v) => server({ hideFeed: v }, hide, 'hideFeed'));
  const notify = switchRow('🔔', t('settings.notify'), t('settings.notifySub'), () => !!p()?.settings.notify, (v) => server({ notify: v }, notify, 'notify'));
  const startHint = h('button', { class: 'st-hint', 'data-press': '', hidden: '' }, t('settings.startBot'));
  function askStartBot() { startHint.hidden = false; }
  startHint.addEventListener('click', () => tg.open(`https://t.me/${BOT_USERNAME}?start=notify`));

  const langs: [Lang, string][] = [['ru', 'Русский'], ['uk', 'Українська'], ['en', 'English']];
  const seg = h('div', { class: 'st-seg', role: 'radiogroup' }, ...langs.map(([l, label]) => {
    const b = h('button', { class: `st-seg-b${l === lang ? ' is-on' : ''}`, 'data-press': '', role: 'radio', 'aria-checked': String(l === lang) }, label);
    b.addEventListener('click', () => { if (l !== lang) { tg.haptic.select(); setLang(l); } });
    return b;
  }));

  const intro = h('button', { class: 'row', 'data-press': '' }, html('<span class="row-ico"><span class="row-glyph">👻</span></span>'),
    h('span', { class: 'row-t' }, h('span', { class: 'row-title' }, t('settings.intro'))), html('<span class="row-chev">›</span>'));
  intro.addEventListener('click', () => { navigate.back(); void import('../ui/onboarding').then((m) => m.showOnboarding(true)); });
  const fair = h('button', { class: 'row', 'data-press': '' }, html('<span class="row-ico"><span class="row-glyph">✓</span></span>'),
    h('span', { class: 'row-t' }, h('span', { class: 'row-title' }, t('profile.fair'))), html('<span class="row-chev">›</span>'));
  fair.addEventListener('click', () => navigate.push('legal', { id: 'fair' }));
  const support = h('button', { class: 'row', 'data-press': '' }, html('<span class="row-ico"><span class="row-glyph">?</span></span>'),
    h('span', { class: 'row-t' }, h('span', { class: 'row-title' }, t('settings.support')), h('span', { class: 'row-sub' }, `@${BOT_USERNAME}`)), html('<span class="row-chev">›</span>'));
  support.addEventListener('click', () => tg.open(`https://t.me/${BOT_USERNAME}?start=help`));

  const page = h('div', { class: 'pg pg-meta pg-settings' },
    navBar(t('settings.title')),
    h('div', { class: 'pg-scroll mt-scroll' },
      h('div', { class: 'gk-label' }, t('settings.feel')),
      h('div', { class: 'menu glass' }, snd.el, hap.el, calmRow.el),
      h('div', { class: 'gk-label' }, t('settings.lang')), seg,
      h('div', { class: 'gk-label' }, t('settings.privacy')),
      h('div', { class: 'menu glass' }, hide.el, notify.el), startHint,
      h('div', { class: 'menu glass' }, intro, fair, support),
      h('p', { class: 'gk-foot' }, t('about.version', { v: `${__APP_VERSION__} (${__APP_BUILD__})` }))));
  const unS = store.sound.sub(() => snd.set(store.sound.get()));
  const unP = store.progress.sub(() => { hide.set(!!p()?.settings.hideFeed); notify.set(!!p()?.settings.notify); });
  if (!p()) void api.progress().catch(() => {});
  return { el: page, destroy() { unS(); unP(); } };
}
