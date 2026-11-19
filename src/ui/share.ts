import { h, html } from '../core/dom';
import { t } from '../core/i18n';
import { store } from '../core/store';
import { tg } from '../core/telegram';
import { refLink } from '../api/games';
import { openSheet, toast } from './sheet';

export const STORY_URL = () => new URL(`${import.meta.env.BASE_URL}share/story.jpg`, location.origin).href;
export const myRefLink = () => store.progress.get()?.ref?.link || refLink(tg.user.id);

export async function copyText(s: string) {
  try { await navigator.clipboard.writeText(s); }
  catch {
    const ta = Object.assign(document.createElement('textarea'), { value: s }); ta.style.cssText = 'position:fixed;opacity:0';
    document.body.append(ta); ta.select(); try { document.execCommand('copy'); } catch { /* */ } ta.remove();
  }
  tg.haptic.success(); toast(t('share.copied'), 'ok');
}

/** Share sheet: Telegram chat picker (ref link) · story (Bot API 7.8+) · copy. */
export function openShare(text: string, title = t('share.title')) {
  const link = myRefLink();
  const opt = (ico: string, label: string, fn: () => void) => {
    const b = h('button', { class: 'shr-opt', 'data-press': '' }, html(`<span class="shr-ico">${ico}</span>`), h('span', null, label));
    b.addEventListener('click', () => { fn(); void s.close(); });
    return b;
  };
  const opts = [
    opt('✈️', t('share.chat'), () => tg.share.link(link, text)),
    tg.share.canStory() ? opt('◎', t('share.story'), () => tg.share.story(STORY_URL(), `${text}\n${link}`, link)) : null,
    opt('⧉', t('share.copy'), () => void copyText(link)),
  ].filter(Boolean) as HTMLElement[];
  const s = openSheet([
    h('div', { class: 'sh-title' }, title),
    h('p', { class: 'shr-text' }, text),
    h('div', { class: 'shr-link' }, link),
    h('div', { class: 'shr-opts' }, ...opts),
  ], { cls: 'sh shr-sheet' });
}
