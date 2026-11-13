import { h, html, starIcon } from '../core/dom';
import { t, type I18nKey } from '../core/i18n';
import { casesArt, dailyArt, glyphBack, luckArt, slotsArt, wheelArt } from '../art/games';
import type { PushId } from '../ui/router';

/** Placeholder for later stages. Each game will replace this with its own module. */
const META: Partial<Record<PushId, { title: I18nKey; art: string }>> = {
  cases: { title: 'games.cases', art: casesArt },
  daily: { title: 'games.daily', art: dailyArt },
  wheel: { title: 'games.wheel', art: wheelArt },
  slots: { title: 'games.slots', art: slotsArt },
  luck: { title: 'games.luck', art: luckArt },
  topup: { title: 'topup.title', art: starIcon('art art-currency') },
};

export function createSoon(id: PushId, onBack: () => void) {
  const m = META[id] ?? META.cases!;
  const back = h('button', { class: 'nav-back', 'data-press': '', 'aria-label': t('soon.back') });
  back.append(html(glyphBack));
  back.addEventListener('click', onBack);
  const cta = h('button', { class: 'btn-primary', 'data-press': '' }, t('soon.back'));
  cta.addEventListener('click', onBack);
  return h('div', { class: `soon soon-${id}` },
    h('div', { class: 'soon-nav' }, back, h('span', { class: 'soon-nav-title' }, t(m.title))),
    h('div', { class: 'soon-body' },
      html(`<div class="soon-art gc-${id}">${m.art}</div>`),
      h('h2', { class: 'soon-title' }, t('soon.title')),
      h('p', { class: 'soon-text' }, t('soon.text')),
      cta,
    ),
  );
}
