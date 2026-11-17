import '../styles/legal.css';
import { h, html } from '../core/dom';
import { t, type I18nKey } from '../core/i18n';
import { tg } from '../core/telegram';
import { casesArt, dailyArt, glyphBack, luckArt, slotsArt, wheelArt } from '../art/games';
import type { PushId } from '../ui/router';

/** Teaser for games in development (wheel, slots, luck card): animated preview + "notify me". */
const META: Partial<Record<PushId, { title: I18nKey; art: string; text?: I18nKey }>> = {
  cases: { title: 'games.cases', art: casesArt },
  daily: { title: 'games.daily', art: dailyArt },
  wheel: { title: 'games.wheel', art: wheelArt, text: 'soon.wheel.text' },
  slots: { title: 'games.slots', art: slotsArt, text: 'soon.slots.text' },
  luck: { title: 'games.luck', art: luckArt, text: 'soon.luck.text' },
};

export function createSoon(id: PushId, onBack: () => void) {
  const m = META[id] ?? META.cases!;
  const back = h('button', { class: 'nav-back', 'data-press': '', 'aria-label': t('soon.back') });
  back.append(html(glyphBack));
  back.addEventListener('click', onBack);
  const key = `gg.notify.${id}`;
  const notify = h('button', { class: 'btn-primary soon-cta', 'data-press': '' }, t('soon.notify'));
  const done = () => { notify.classList.add('is-done'); notify.textContent = '✓ ' + t('soon.notified'); notify.disabled = true; };
  tg.cloud.get(key).then((v) => { if (v) done(); });
  // TODO(server): POST /v1/notify {game} so the bot can ping at launch; stored in CloudStorage for now.
  notify.addEventListener('click', () => { tg.cloud.set(key, '1'); tg.haptic.success(); done(); });
  const later = h('button', { class: 'btn-text', 'data-press': '' }, t('soon.back'));
  later.addEventListener('click', onBack);
  return h('div', { class: `soon soon-${id}` },
    h('div', { class: 'soon-nav' }, back, h('span', { class: 'soon-nav-title' }, t(m.title))),
    h('div', { class: 'soon-body' },
      html(`<div class="soon-stage"><span class="soon-ring"></span><span class="soon-ring r2"></span><div class="soon-art gc-${id}">${m.art}</div><span class="soon-floor"></span></div>`),
      h('span', { class: 'soon-badge' }, t('soon.badge')),
      h('h2', { class: 'soon-title' }, t(m.title)),
      h('p', { class: 'soon-text' }, t(m.text ?? 'soon.text')),
      notify, later,
    ),
  );
}
