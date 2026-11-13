import { h } from '../core/dom';
import { lang } from '../core/i18n';
import { tier, reducedMotion } from '../core/perf';
import { ji } from '../art/games';
import blank from '../assets/mascot-blank.webp';

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

const FACE = `<svg class="pc-face" viewBox="0 0 512 512" aria-hidden="true">
  <defs><radialGradient id="pcEye" cx=".38" cy=".3" r=".75"><stop offset="0" stop-color="#2c3274"/><stop offset=".6" stop-color="#151a46"/><stop offset="1" stop-color="#0a0c26"/></radialGradient></defs>
  <g class="pc-blush"><ellipse cx="163" cy="218" rx="25" ry="13"/><ellipse cx="343" cy="218" rx="25" ry="13"/></g>
  <g class="pc-look">
    <g class="pc-eyes">
      <g class="pc-eo">
        <ellipse cx="200.6" cy="188" rx="20.5" ry="27.5" fill="url(#pcEye)"/><ellipse cx="306.7" cy="188" rx="20.5" ry="27.5" fill="url(#pcEye)"/>
        <circle cx="193" cy="175" r="7.5" fill="#fff"/><circle cx="299" cy="175" r="7.5" fill="#fff"/>
        <circle cx="208" cy="199" r="3.4" fill="#fff" opacity=".85"/><circle cx="314" cy="199" r="3.4" fill="#fff" opacity=".85"/>
      </g>
      <g class="pc-eh" fill="none" stroke="#151a46" stroke-width="10" stroke-linecap="round">
        <path d="M180 194 Q200.6 166 221 194"/><path d="M286 194 Q306.7 166 327 194"/>
      </g>
    </g>
    <g class="pc-mouths" fill="#171a48">
      <g class="pc-m m-open"><path d="M232 209 Q252 214 272 209 Q270 237 252 238 Q234 237 232 209Z"/><ellipse cx="252" cy="230" rx="10" ry="5" fill="#ff8fd0" opacity=".75"/></g>
      <g class="pc-m m-o"><ellipse cx="252" cy="224" rx="10" ry="12.5"/></g>
      <g class="pc-m m-flat"><path d="M236 223 Q244 216 252 222 T268 220" fill="none" stroke="#171a48" stroke-width="7" stroke-linecap="round"/></g>
      <g class="pc-m m-grin"><path d="M220 206 Q252 216 284 206 Q280 249 252 250 Q224 249 220 206Z"/><ellipse cx="252" cy="240" rx="14" ry="6.5" fill="#ff8fd0" opacity=".8"/><path d="M228 210 Q252 216 276 210 L274 216 Q252 221 230 216Z" fill="#fff" opacity=".9"/></g>
    </g>
  </g>
  <path class="pc-sweat" d="M372 120 Q384 140 380 150 A11 11 0 1 1 362 146 Q362 136 372 120Z"/>
</svg>`;

// branch: thick dark-navy bough spanning the full width (left → right), subtle neon rim; orange only on leaves
const NS = 'vector-effect="non-scaling-stroke"';
const BRANCH = `<svg class="pc-branch" viewBox="0 0 400 80" preserveAspectRatio="none" aria-hidden="true">
  <defs>
    <linearGradient id="pcBark" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#262a66"/><stop offset=".4" stop-color="#14163c"/><stop offset="1" stop-color="#05061a"/></linearGradient>
    <linearGradient id="pcRim" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#46e6ff" stop-opacity=".95"/><stop offset=".5" stop-color="#a65cff" stop-opacity=".8"/><stop offset="1" stop-color="#ff5ccc" stop-opacity=".7"/></linearGradient>
  </defs>
  <g fill="none" stroke-linecap="round">
    <path d="M70 30 C64 18 66 8 78 2" stroke="#17194a" stroke-width="7" ${NS}/><path d="M70 30 C64 18 66 8 78 2" stroke="url(#pcRim)" stroke-width="1.2" ${NS} opacity=".7"/>
    <path d="M296 32 C304 20 314 13 330 10" stroke="#17194a" stroke-width="6" ${NS}/><path d="M296 32 C304 20 314 13 330 10" stroke="url(#pcRim)" stroke-width="1.1" ${NS} opacity=".7"/>
    <path d="M150 48 C156 60 152 70 162 78" stroke="#111338" stroke-width="6" ${NS}/>
    <path d="M360 40 C368 50 366 58 374 66" stroke="#111338" stroke-width="5" ${NS}/>
  </g>
  <path d="M-6 10 C70 18 150 32 222 30 C290 28 340 22 406 24 L406 48 C340 46 290 54 222 56 C150 58 70 64 -6 70 Z" fill="url(#pcBark)"/>
  <path d="M-6 10 C70 18 150 32 222 30 C290 28 340 22 406 24" fill="none" stroke="url(#pcRim)" stroke-width="2.4" ${NS}/>
  <path d="M-6 70 C70 64 150 58 222 56 C290 54 340 46 406 48" fill="none" stroke="#a65cff" stroke-opacity=".35" stroke-width="1.2" ${NS}/>
  <g stroke="#04050f" stroke-width="1.6" stroke-linecap="round" opacity=".7" fill="none"><path d="M24 38 l14 1" ${NS}/><path d="M96 41 l12 0" ${NS}/><path d="M190 42 l10 0" ${NS}/><path d="M262 38 l12 -1" ${NS}/><path d="M340 34 l10 0" ${NS}/></g>
  <ellipse cx="120" cy="42" rx="5" ry="3.4" fill="#04050f" opacity=".7"/><ellipse cx="250" cy="40" rx="4" ry="3" fill="#04050f" opacity=".6"/>
</svg>`;
// leaf spots along the bough: x%, bottom px (within the 80px branch box), rotation, scale, sway period
const LEAVES: [number, number, number, number, number][] = [
  [3, 46, -30, 1.05, 4.2], [9, 22, 160, 0.9, 5.1], [17.5, 70, -20, 1.1, 3.8], [21, 58, 30, 0.85, 4.6], [34, 20, 190, 0.95, 5.4],
  [38, 1, 200, 1, 4.4], [47, 42, -50, 0.8, 3.9], [56, 22, 170, 0.9, 5.0], [80, 70, 10, 1.05, 4.1], [83.5, 58, 60, 0.85, 4.8], [92, 10, 195, 0.95, 4.5], [97, 44, -35, 0.9, 5.2],
];

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
  destroy(): void;
}

export function createPerch(opts: { cls?: string; size?: number; bubble?: boolean; pos?: number } = {}): Perch {
  const lite = tier === 'low' || reducedMotion;
  const el = h('div', { class: `perch ${opts.cls ?? ''}${lite ? ' is-lite' : ''}`, 'data-mood': 'idle' });
  if (opts.size) el.style.setProperty('--pm', `${opts.size}px`);
  if (opts.pos) el.style.setProperty('--gpos', String(opts.pos));
  el.innerHTML = `<div class="pc-bough">${BRANCH}
    ${LEAVES.map(([x, b, r, sc, d], i) => `<span class="pc-leaf${i === 6 ? ' l2' : ''}" style="left:${x}%;bottom:${b}px;--r:${r}deg;--s:${sc};--d:${d}s">${ji('leaf')}</span>`).join('')}</div>
    <div class="pc-falls"><span class="pc-fall">${ji('leaf')}</span><span class="pc-fall">${ji('leaf')}</span></div>
    <div class="pc-actor">    <div class="pc-ghost"><i class="pc-shadow"></i><div class="pc-body"><div class="pc-inner"><img class="pc-img" src="${blank}" alt="" draggable="false" decoding="async">${FACE}</div></div></div>
    <div class="pc-sparks">${Array.from({ length: 7 }, (_, i) => `<i style="--k:${i}"></i>`).join('')}</div>
    ${opts.bubble === false ? '' : '<div class="pc-bubble glass"><span></span></div>'}</div>`;
  const $ = (s: string) => el.querySelector(s) as HTMLElement;
  const ghost = $('.pc-ghost'), body = $('.pc-body'), look = el.querySelector('.pc-look') as SVGGElement;
  const bubble = el.querySelector<HTMLElement>('.pc-bubble'), btext = bubble?.querySelector('span');
  let gx = 0, gy = 0, mood: Mood = 'idle', spoken = 0, bubbleT = 0;
  const timers: number[] = [];
  const later = (fn: () => void, ms: number) => { timers.push(window.setTimeout(fn, ms)); };
  const anim = (t: Element, k: Keyframe[], o: KeyframeAnimationOptions) => { if (!reducedMotion) t.animate(k, o); };

  const applyGaze = () => { look.style.transform = `translate(${gx.toFixed(1)}px,${gy.toFixed(1)}px)`; };
  function lookAt(x: number, y: number) { gx = Math.max(-11, Math.min(11, x)); gy = Math.max(-8, Math.min(9, y)); applyGaze(); }

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
    mood = m; el.dataset.mood = m;
    switch (m) {
      case 'idle': lookAt(-6, 5); break;
      case 'watch': lookAt(-8, 8); break;
      case 'lean': lookAt(-9, 9); break;
      case 'gasp':
        lookAt(-6, 4);
        anim(body, [{ transform: 'none' }, { transform: 'translate(3px,-6px) scale(1.06,.95) rotate(4deg)', offset: 0.25 }, { transform: 'translate(2px,-2px) rotate(2deg)' }], { duration: 420, easing: 'cubic-bezier(.3,1.6,.5,1)', fill: 'forwards' });
        break;
      case 'meh':
        lookAt(-2, 3);
        anim(body, [{ transform: 'none' }, { transform: 'translateY(-3px) rotate(-7deg)', offset: 0.3 }, { transform: 'translateY(-3px) rotate(6deg)', offset: 0.65 }, { transform: 'none' }], { duration: 900, easing: 'ease-in-out' });
        break;
      case 'happy':
        lookAt(-3, 2);
        anim(body, [{ transform: 'none' }, { transform: 'translateY(-12px) scale(.96,1.05)', offset: 0.3 }, { transform: 'translateY(0) scale(1.06,.93)', offset: 0.55 }, { transform: 'translateY(-6px)', offset: 0.75 }, { transform: 'none' }], { duration: 800, easing: 'ease-out' });
        sparks(3);
        break;
      case 'ecstatic': {
        lookAt(0, -2);
        const j = (dy: number, r: number) => ({ transform: `translateY(${dy}px) rotate(${r}deg) scale(.95,1.06)` });
        anim(body, [{ transform: 'none' }, j(-18, -8), { transform: 'scale(1.08,.9)', offset: 0.33 }, j(-16, 8), { transform: 'scale(1.06,.92)', offset: 0.66 }, j(-10, 0), { transform: 'none' }],
          { duration: 1300, easing: 'ease-in-out' });
        anim(el.querySelector('.pc-bough')!, [{ transform: 'none' }, { transform: 'rotate(1.6deg)', offset: 0.36 }, { transform: 'rotate(-1deg)', offset: 0.6 }, { transform: 'none' }], { duration: 1300, easing: 'ease-in-out' });
        sparks(7); later(() => sparks(5), 650);
        if (!lite) anim($('.pc-leaf.l2'), [{ transform: 'none', opacity: 1 }, { transform: 'translate(-30px,170px) rotate(260deg)', opacity: 0 }], { duration: 2200, delay: 250, easing: 'cubic-bezier(.4,.1,.6,1)', fill: 'forwards' });
        break;
      }
    }
  }

  let lastFlick = 0;
  function flick(speed: number) {
    if (lite || speed > 0.55) return;
    const now = performance.now(); if (now - lastFlick < 90) return; lastFlick = now;
    look.animate([{ transform: `translate(${gx + 5}px,${gy}px)` }, { transform: `translate(${gx}px,${gy}px)` }], { duration: 110 + (1 - speed) * 120, easing: 'ease-out' });
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

  function hop() { anim(body, [{ transform: 'none' }, { transform: 'translateY(-10px) scale(.96,1.05)', offset: 0.35 }, { transform: 'scale(1.05,.94)', offset: 0.65 }, { transform: 'none' }], { duration: 560, easing: 'ease-out' }); }

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
  lookAt(-6, 5);
  return { el, setMood, lookAt, flick, say, hop, destroy() { timers.forEach(clearTimeout); clearTimeout(bubbleT); clearTimeout(fallT); } };
}
