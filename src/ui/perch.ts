import { h } from '../core/dom';
import { lang } from '../core/i18n';
import { tier, reducedMotion } from '../core/perf';
import { ji } from '../art/games';
import { createGhost } from './ghost';

/**
 * Ghost mascot perched on an autumn branch. Reuses the jelly mascot art (face
 * inpainted out, see ghost-gift-media/jelly/blankface.py) with a live SVG face on
 * top, so eyes can follow the reel and emotions change without new raster art.
 * Everything animates with transform/opacity only.
 */
export type Mood = 'idle' | 'watch' | 'lean' | 'gasp' | 'meh' | 'happy' | 'ecstatic';
export type Line = 'start' | 'slow' | 'near' | 'common' | 'good' | 'epic';

const LINES: Record<'ru' | 'en' | 'uk', Record<Line, string[]>> = {
  ru: {
    start: ['Давай-давай…', 'Чую удачу!', 'Ну-ка, ну-ка…', 'Только не моргай!'],
    slow: ['Стоп… стоп…', 'Ещё чуть-чуть!', 'Тише, тише…'],
    near: ['Ну почти!', 'Эээ, было же рядом!', 'Ай! На волоске!', 'Да ладно?!'],
    common: ['Ну, тоже приз', 'В следующий раз точно!', 'Сойдёт!', 'Разминка!'],
    good: ['О, неплохо!', 'Вот это я понимаю!', 'Красота!', 'Так-так, а это неплохо!'],
    epic: ['ОГО!', 'Мне бы так везло!', 'АААА! Ты видел?!', 'Легенда!'],
  },
  en: {
    start: ['Come on, come on…', 'I can smell luck!', 'Here we go…', "Don't blink!"],
    slow: ['Easy… easy…', 'Just a bit more!', 'Slooowly…'],
    near: ['Sooo close!', 'Nooo, it was right there!', 'By a hair!', 'No way?!'],
    common: ['Hey, still a prize', "Next one's the one!", 'Not bad, not bad', 'Warm-up!'],
    good: ['Ooh, nice!', "Now we're talking!", 'Pretty!', "Oh, that one's good!"],
    epic: ['WHOA!', 'I wish I had your luck!', 'DID YOU SEE THAT?!', 'Legendary!'],
  },
  uk: {
    start: ['Давай-давай…', 'Чую удачу!', 'Ну-мо, ну-мо…', 'Тільки не кліпай!'],
    slow: ['Стоп… стоп…', 'Ще трішки!', 'Тихіше, тихіше…'],
    near: ['Ну майже!', 'Ееей, було ж поруч!', 'Ой! На волосинку!', 'Та ну?!'],
    common: ['Ну, теж приз', 'Наступного разу точно!', 'Згодиться!', 'Розминка!'],
    good: ['О, непогано!', 'Оце я розумію!', 'Краса!', 'Так-так, а це непогано!'],
    epic: ['ОГО!', 'Мені б так щастило!', 'АААА! Ти бачив?!', 'Легенда!'],
  },
};

const TALK = new URLSearchParams(location.search).has('talk'); // QA: always speak


// branch: a thick, curvy dark-navy bough across the whole header with curling tendrils and a neon rim
// (cyan → violet → magenta); leaves are neon outlines that glow and sway, a few orange maple leaves as accents
const NS = 'vector-effect="non-scaling-stroke"';
const TOP = 'M-6 12 C40 13 78 30 140 38 S 240 29 290 32 S 362 34 406 21';
const BOT = 'L406 36 C362 46 330 45 290 46 S 200 57 140 58 S 30 51 -6 53 Z';
const CURLS = ['M58 21 C55 7 72 -2 84 5 C93 11 86 21 77 16', 'M200 35 C203 19 222 12 231 21 C237 29 226 35 220 28', 'M108 57 C110 70 126 76 133 67',
  'M330 45 C334 59 350 63 355 54', 'M248 31 C262 13 284 7 302 10', 'M372 30 C380 18 394 14 404 16'];
const BRANCH = `<svg class="pc-branch" viewBox="0 0 400 80" preserveAspectRatio="none" aria-hidden="true">
  <defs>
    <linearGradient id="pcBark" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a2d70"/><stop offset=".35" stop-color="#16184a"/><stop offset="1" stop-color="#05061a"/></linearGradient>
    <linearGradient id="pcRim" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#46e6ff"/><stop offset=".5" stop-color="#a65cff"/><stop offset="1" stop-color="#ff5ccc"/></linearGradient>
  </defs>
  <g fill="none" stroke-linecap="round">
    ${CURLS.map((d) => `<path d="${d}" stroke="#15174a" stroke-width="6" ${NS}/><path d="${d}" stroke="url(#pcRim)" stroke-width="5" stroke-opacity=".18" ${NS}/><path d="${d}" stroke="url(#pcRim)" stroke-width="1.3" ${NS}/>`).join('')}
  </g>
  <path d="${TOP} ${BOT}" fill="url(#pcBark)"/>
  <path d="${TOP}" fill="none" stroke="url(#pcRim)" stroke-width="7" stroke-opacity=".2" ${NS}/>
  <path d="${TOP}" fill="none" stroke="url(#pcRim)" stroke-width="2.2" ${NS}/>
  <path d="M-6 53 C30 51 140 58 140 58 S 200 57 290 46 S 362 46 406 36" fill="none" stroke="#a65cff" stroke-opacity=".4" stroke-width="1.2" ${NS}/>
  <path d="M10 30 C60 34 110 46 160 47 S 250 40 300 39" fill="none" stroke="#46e6ff" stroke-opacity=".22" stroke-width="1" ${NS}/>
  <g stroke="#04050f" stroke-width="1.5" stroke-linecap="round" opacity=".65" fill="none"><path d="M24 34 l14 1" ${NS}/><path d="M96 44 l12 1" ${NS}/><path d="M190 46 l10 0" ${NS}/><path d="M262 40 l12 -1" ${NS}/><path d="M340 40 l10 -1" ${NS}/></g>
</svg>`;
const NEON_LEAF = `<svg class="lf-svg" viewBox="0 0 24 30" aria-hidden="true"><path d="M12 29.5 L12 24" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
  <path d="M12 24.5 C2.5 18 3 7.5 12 1 C21 7.5 21.5 18 12 24.5Z" fill="currentColor" fill-opacity=".3" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
  <path d="M12 22 L12 5.5 M12 15 L7.6 10.6 M12 15 L16.4 10.6 M12 19.4 L8.2 16 M12 19.4 L15.8 16" stroke="#fff" stroke-opacity=".8" stroke-width=".85" stroke-linecap="round" fill="none"/></svg>`;
const LC: Record<string, string> = { c: '#46e6ff', v: '#b07bff', m: '#ff5ccc' };
// leaves along the bough: x%, bottom px (80px box), rotation, scale, sway s, colour (c/v/m neon, o = orange maple)
const LEAVES: [number, number, number, number, number, string][] = [
  [2, 67, -22, 1, 4.2, 'c'], [5.5, 28, 168, 0.95, 5.1, 'o'], [12.5, 62, 24, 0.9, 3.9, 'm'], [21, 74, -38, 0.85, 4.6, 'v'], [19, 27, 196, 0.9, 4.4, 'c'],
  [28.5, 45, -30, 1, 5.3, 'o'], [33, 14, 186, 0.85, 4.0, 'm'], [41, 42, 34, 0.95, 4.8, 'c'], [47.5, 24, 162, 0.9, 5.2, 'v'], [55.5, 61, -14, 0.9, 4.1, 'm'],
  [60, 28, 196, 0.95, 4.7, 'o'], [65.5, 66, -48, 0.85, 3.8, 'c'], [75.5, 70, 28, 0.85, 4.5, 'v'], [79, 34, 176, 0.9, 5.0, 'm'], [88.5, 25, 200, 0.85, 4.3, 'c'],
  [93, 51, -24, 0.95, 4.9, 'o'], [98.5, 63, 22, 0.85, 4.2, 'm'], [96, 42, 160, 0.8, 4.6, 'v'],
];
const leafHtml = ([x, b, r, sc, d, c]: (typeof LEAVES)[number], i: number) =>
  `<span class="pc-leaf${c === 'o' ? ' is-maple' : ''}${i === 9 ? ' l2' : ''}" data-r="${r}" data-s="${sc}" style="left:${x}%;bottom:${b}px;--r:${r}deg;--s:${sc};--d:${d}s;--dl:${(-i * 0.61).toFixed(2)}s${c === 'o' ? '' : `;color:${LC[c]}`}"><span class="lf">${c === 'o' ? '' : '<i class="lf-glow"></i>'}${c === 'o' ? ji('leaf') : NEON_LEAF}</span></span>`;

export interface Perch {
  el: HTMLElement;
  setMood(m: Mood): void;
  /** gaze in face units (≈ -10..10) */
  lookAt(x: number, y: number): void;
  /** eyes track a passing item; speed 0..1 */
  flick(speed: number): void;
  /** maybe say a random line from the pool (chance 0..1); returns whether it spoke */
  say(line: Line, chance?: number): boolean;
  hop(): void;
  /** wind gust (spin start): leaves shiver, a couple tear off and fly away */
  gust(): void;
  destroy(): void;
}

export function createPerch(opts: { cls?: string; size?: number; bubble?: boolean; pos?: number; antics?: boolean } = {}): Perch {
  const lite = tier === 'low' || reducedMotion;
  const el = h('div', { class: `perch ${opts.cls ?? ''}${lite ? ' is-lite' : ''}`, 'data-mood': 'idle' });
  if (opts.size) el.style.setProperty('--pm', `${opts.size}px`);
  if (opts.pos) el.style.setProperty('--gpos', String(opts.pos));
  el.innerHTML = `<div class="pc-bough">${BRANCH}
    ${LEAVES.map(leafHtml).join('')}</div>
    <div class="pc-falls"><span class="pc-fall">${ji('leaf')}</span><span class="pc-fall">${ji('leaf')}</span></div>
    <div class="pc-actor">    <div class="pc-ghost"><i class="pc-shadow"></i><div class="pc-body"><div class="pc-inner"></div></div></div>
    <div class="pc-sparks">${Array.from({ length: 7 }, (_, i) => `<i style="--k:${i}"></i>`).join('')}</div>
    ${opts.bubble === false ? '' : '<div class="pc-bubble glass"><span></span></div>'}</div>`;
  const $ = (s: string) => el.querySelector(s) as HTMLElement;
  const ghost = $('.pc-ghost');
  const gh = createGhost();
  if (opts.antics === false) gh.antics(false);
  $('.pc-inner').append(gh.el);
  const bubble = el.querySelector<HTMLElement>('.pc-bubble'), btext = bubble?.querySelector('span');
  let mood: Mood = 'idle', spoken = 0, bubbleT = 0;
  const timers: number[] = [];
  const later = (fn: () => void, ms: number) => { timers.push(window.setTimeout(fn, ms)); };
  const anim = (t: Element, k: Keyframe[], o: KeyframeAnimationOptions) => { if (!reducedMotion) t.animate(k, o); };

    function lookAt(x: number, y: number) { gh.lookAt(x, y); }

  function sparks(n: number) {
    if (lite) return;
    el.querySelectorAll<HTMLElement>('.pc-sparks i').forEach((s, i) => {
      if (i >= n) return;
      const a = (-160 + (i / Math.max(1, n - 1)) * 140) * (Math.PI / 180), d = 34 + Math.random() * 22;
      s.animate([{ transform: 'translate(0,0) scale(.2) rotate(0deg)', opacity: 0 }, { opacity: 1, offset: 0.25 },
        { transform: `translate(${Math.cos(a) * d}px,${Math.sin(a) * d}px) scale(${0.8 + Math.random() * 0.6}) rotate(90deg)`, opacity: 0 }],
        { duration: 900 + Math.random() * 300, delay: i * 50, easing: 'cubic-bezier(.2,.8,.3,1)' });
    });
  }

  function setMood(m: Mood) {
    if (m === mood && m !== 'happy' && m !== 'ecstatic') return;
    mood = m; el.dataset.mood = m; gh.setMood(m);
    switch (m) {
      case 'idle': lookAt(6, 5); break;
      case 'watch': lookAt(8, 8); break;
      case 'lean': lookAt(9, 9); break;
      case 'gasp':
        lookAt(6, 4);
        break;
      case 'meh':
        lookAt(2, 3);
        break;
      case 'happy':
        lookAt(3, 2);
        sparks(3);
        break;
      case 'ecstatic': {
        lookAt(0, -2);
        anim(el.querySelector('.pc-bough')!, [{ transform: 'none' }, { transform: 'rotate(1.6deg)', offset: 0.36 }, { transform: 'rotate(-1deg)', offset: 0.6 }, { transform: 'none' }], { duration: 1300, easing: 'ease-in-out' });
        sparks(7); later(() => sparks(5), 650);
        if (!lite) { const l2 = $('.pc-leaf.l2'), b = `rotate(${l2.dataset.r}deg) scale(${l2.dataset.s})`; anim(l2, [{ transform: b, opacity: 1 }, { transform: `translate(-30px,170px) ${b} rotate(260deg)`, opacity: 0 }], { duration: 2200, delay: 250, easing: 'cubic-bezier(.4,.1,.6,1)', fill: 'forwards' }); }
        break;
      }
    }
  }

  function flick(speed: number) {
    if (lite || speed > 0.55) return;
    gh.flick();
  }

  function say(line: Line, chance = 1) {
    if (!bubble || !btext || spoken >= 2 || (!TALK && Math.random() > chance)) return false;
    const pool = LINES[lang as 'ru' | 'en' | 'uk']?.[line] ?? LINES.ru[line];
    btext.textContent = pool[(Math.random() * pool.length) | 0];
    spoken++;
    clearTimeout(bubbleT);
    bubble.classList.remove('is-on'); void bubble.offsetWidth; bubble.classList.add('is-on');
    bubbleT = window.setTimeout(() => bubble.classList.remove('is-on'), line === 'epic' ? 2600 : 2000);
    return true;
  }

  function hop() { gh.hop(); gh.pop(); }

  ghost.addEventListener('click', () => { hop(); });
  // now and then a leaf lets go and drifts down (rich tiers only)
  let fallT = 0, fi = 0;
  const falls = Array.from(el.querySelectorAll<HTMLElement>('.pc-fall'));
  const dropLeaf = () => {
    const f = falls[fi++ % falls.length], x = 6 + Math.random() * 88, dx = (Math.random() - 0.5) * 60;
    f.style.left = `${x}%`;
    f.animate([{ transform: 'translate(0,0) rotate(0deg)', opacity: 0 }, { opacity: 1, offset: 0.1 }, { transform: `translate(${dx * 0.5}px,45px) rotate(120deg)`, offset: 0.45 },
      { transform: `translate(${dx}px,110px) rotate(260deg)`, opacity: 0 }], { duration: 3600, easing: 'ease-in' });
    fallT = window.setTimeout(dropLeaf, 4500 + Math.random() * 4000);
  };
  if (!lite) fallT = window.setTimeout(dropLeaf, 1800 + Math.random() * 2000);
  let gustT = 0;
  function gust() {
    if (lite) return;
    el.classList.remove('is-gust'); void el.offsetWidth; el.classList.add('is-gust');
    clearTimeout(gustT); gustT = window.setTimeout(() => el.classList.remove('is-gust'), 1900);
    anim($('.pc-bough'), [{ transform: 'none' }, { transform: 'rotate(.9deg) translateY(2px)', offset: 0.25 }, { transform: 'rotate(-.5deg)', offset: 0.6 }, { transform: 'none' }], { duration: 1800, easing: 'ease-in-out' });
    // two leaves away from the ghost let go and ride the wind off to the right
    const pool = Array.from(el.querySelectorAll<HTMLElement>('.pc-leaf:not(.l2):not(.is-gone)'));
    for (let k = 0; k < 2 && pool.length; k++) {
      const lf = pool.splice((Math.random() * pool.length) | 0, 1)[0];
      const base = `rotate(${lf.dataset.r}deg) scale(${lf.dataset.s})`, dx = 140 + Math.random() * 120, dy = -20 + Math.random() * 90, spin = 300 + Math.random() * 260;
      lf.classList.add('is-gone');
      lf.animate([{ transform: base, opacity: 1 }, { transform: `translate(${dx * 0.3}px,${dy * 0.2 - 18}px) ${base} rotate(${spin * 0.3}deg)`, opacity: 1, offset: 0.3 },
        { transform: `translate(${dx}px,${dy}px) ${base} rotate(${spin}deg) scale(.6)`, opacity: 0 }], { duration: 1500 + k * 250, delay: 150 + k * 220, easing: 'cubic-bezier(.3,.1,.5,1)', fill: 'forwards' });
      // a new leaf grows back a little later
      later(() => { lf.getAnimations().forEach((a) => a.cancel()); lf.animate([{ transform: `${base} scale(.2)`, opacity: 0 }, { transform: base, opacity: 1 }], { duration: 700, easing: 'cubic-bezier(.34,1.56,.64,1)' }); lf.classList.remove('is-gone'); }, 5200 + k * 400);
    }
  }
  lookAt(6, 5);
  return { el, setMood, lookAt, flick, say, hop, gust, destroy() { gh.destroy(); timers.forEach(clearTimeout); clearTimeout(bubbleT); clearTimeout(fallT); clearTimeout(gustT); } };
}
