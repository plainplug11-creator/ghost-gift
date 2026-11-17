import { h, starIcon } from '../core/dom';
import { fmt, t, type I18nKey } from '../core/i18n';
import { fxHtml, themeOf, themeVars } from '../art/themes';
import { reducedMotion, setFocus, tier } from '../core/perf';
import { tg } from '../core/telegram';
import { sfx } from '../core/sound';
import { PRIZES, caseStats } from '../api/catalog';
import { countTo } from '../ui/countup';
import { RARITY_RANK, type CaseDef, type OpenResult, type Prize } from '../api/types';
import { RARITY_RGB, caseArt, caseName, isNft, isPremium, kindCls, prizeIcon, prizeName, rarityName } from '../art/cases';
import { confetti } from '../ui/confetti';
import { createPerch } from '../ui/perch';
import '../styles/perch.css';

/**
 * The case-opening show. Pure presentation: the outcome (`res.prize`) is
 * decided BEFORE this runs (server in production) — the reel is built around it.
 *
 * Timeline (normal):  charge 1.25s → burst 0.4s → reel 5.2s (legendary 6.4s) →
 *                     settle/near-miss 0.6s → [legendary slow-mo 1s] → reveal.
 * Everything animates transform/opacity only (WAAPI + one rAF for the reel,
 * one canvas for confetti). Skip fast-forwards any phase.
 */

const GAP = 8;              // classic continuous strip (tile size is responsive, see run())
const N = 58;              // tiles in the strip
const WIN = 50;            // winner index

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const anim = (el: Element, kf: Keyframe[], o: KeyframeAnimationOptions) => el.animate(kf, { fill: 'both', ...o });

function weightedPick(c: CaseDef) {
  // flatten weights (^0.55) so the reel shows variety, not 60% of the same filler
  const ws = c.drops.map((d) => Math.pow(d.weight, 0.55));
  const tot = ws.reduce((a, b) => a + b, 0);
  let r = Math.random() * tot;
  for (let i = 0; i < ws.length; i++) if ((r -= ws[i]) < 0) return PRIZES[c.drops[i].prize];
  return PRIZES[c.drops[0].prize];
}

/* ── the "deck": fills the empty stage under the reel while it spins ──
 * centre: neon portal with the case's top prize + odds by rarity; sides: neon vines with
 * twinkling bulbs and slow spotlight sweeps. All CSS transform/opacity loops; static on tier-low. */
type Pt = [number, number];
const VINE: [Pt, Pt, Pt, Pt][] = [
  [[30, 0], [54, 34], [8, 70], [30, 108]],
  [[30, 108], [52, 146], [10, 180], [30, 216]],
  [[30, 216], [50, 250], [14, 284], [28, 320]],
];
const bez = (s: [Pt, Pt, Pt, Pt], t: number): Pt => {
  const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return [a * s[0][0] + b * s[1][0] + c * s[2][0] + d * s[3][0], a * s[0][1] + b * s[1][1] + c * s[2][1] + d * s[3][1]];
};
const VINE_D = 'M30 0' + VINE.map((s) => ` C${s[1].join(' ')} ${s[2].join(' ')} ${s[3].join(' ')}`).join('');
const BULBS: Pt[] = VINE.flatMap((s) => [0.18, 0.5, 0.82].map((t) => bez(s, t)));
const VLEAVES: { p: Pt; r: number; c: string }[] = [
  { p: bez(VINE[0], 0.32), r: -40, c: '#3fe3ff' }, { p: bez(VINE[0], 0.7), r: 140, c: '#c86bff' },
  { p: bez(VINE[1], 0.3), r: -30, c: '#ff5ccc' }, { p: bez(VINE[1], 0.68), r: 150, c: '#ff9a3c' },
  { p: bez(VINE[2], 0.35), r: -45, c: '#8f7bff' }, { p: bez(VINE[2], 0.72), r: 135, c: '#3fe3ff' },
];
const BULB_C = ['#3fe3ff', '#ff5ccc', '#a77dff'];
function vineHtml(side: 'l' | 'r') {
  const leaf = (l: (typeof VLEAVES)[number]) =>
    `<g transform="translate(${l.p[0].toFixed(1)} ${l.p[1].toFixed(1)}) rotate(${l.r})"><path d="M0 0 C4 -5 12 -5 16 0 C12 5 4 5 0 0Z M2 0 H13" fill="${l.c}22" stroke="${l.c}" stroke-width="1.3" stroke-linejoin="round"/></g>`;
  const bulbs = (k: number) => BULBS.map((b, i) => (i % 2 === k ? `<i style="left:${(b[0] / 60 * 100).toFixed(2)}%;top:${(b[1] / 320 * 100).toFixed(2)}%;--bc:${BULB_C[i % 3]}"></i>` : '')).join('');
  return `<div class="dk-vine ${side}"><svg viewBox="0 0 60 320" preserveAspectRatio="xMidYMin meet" aria-hidden="true">
    <path d="${VINE_D}" fill="none" stroke="url(#dkv)" stroke-width="5" stroke-linecap="round" opacity=".28"/>
    <path d="${VINE_D}" fill="none" stroke="url(#dkv)" stroke-width="1.8" stroke-linecap="round"/>
    ${VLEAVES.map(leaf).join('')}</svg>
    <div class="dk-bulbs b0">${bulbs(0)}</div><div class="dk-bulbs b1">${bulbs(1)}</div></div>`;
}
function deckHtml(c: CaseDef, best: Prize) {
  const byR = new Map<Prize['rarity'], number>();
  for (const r of caseStats(c).rows) byR.set(r.prize.rarity, (byR.get(r.prize.rarity) ?? 0) + r.chance);
  const odds = [...byR.entries()].sort((a, b) => RARITY_RANK[a[0]] - RARITY_RANK[b[0]]).map(([r, ch]) => {
    const v = ch * 100, txt = v >= 10 ? v.toFixed(0) : v >= 1 ? v.toFixed(1) : v.toFixed(2);
    return `<span class="dk-odd" style="--oc:${RARITY_RGB[r]}" title="${t(`rarity.${r}` as Parameters<typeof t>[0])}"><i></i>${txt}%</span>`;
  }).join('');
  return `<div class="op-deck" aria-hidden="true">
    <svg width="0" height="0" style="position:absolute"><defs><linearGradient id="dkv" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3fe3ff"/><stop offset=".55" stop-color="#a77dff"/><stop offset="1" stop-color="#ff5ccc" stop-opacity=".2"/></linearGradient></defs></svg>
    <i class="dk-beam l"></i><i class="dk-beam r"></i>
    ${vineHtml('l')}${vineHtml('r')}
    <div class="dk-mid">
      <div class="dk-label">${t('deck.top')}</div>
      <div class="dk-portal" style="--bc:${RARITY_RGB[best.rarity]}">
        <i class="dk-halo"></i><i class="dk-ring"></i><i class="dk-ring dk-ring-rc"></i>
        <i class="dk-dial"></i>
        <div class="dk-orbit"><i></i><i></i><i></i></div>
        <div class="dk-motes">${Array.from({ length: 6 }, (_, i) => `<i style="--i:${i}"></i>`).join('')}</div>
        <div class="dk-prize">${prizeIcon(best)}</div>
      </div>
      <div class="dk-name"><b>${prizeName(best)}</b><span>${fmt(best.value)}${starIcon('star-ico')}</span></div>
    </div>
    <div class="dk-odds"><span class="dk-odds-l">${t('deck.odds')}</span>${odds}</div>
    <i class="dk-floor"></i>
  </div>`;
}

function tileHtml(p: Prize, blur = false) {
  return blur
    ? `<div class="tile r-${p.rarity}${kindCls(p)}" style="--rc:${RARITY_RGB[p.rarity]}">${prizeIcon(p)}</div>`
    : `<div class="tile r-${p.rarity}${kindCls(p)}" style="--rc:${RARITY_RGB[p.rarity]}"><i class="tile-glow"></i>${prizeIcon(p)}<span class="tile-v">${fmt(p.value)}${starIcon('star-ico')}</span><i class="tile-strip"></i></div>`;
}

export interface Opening { el: HTMLElement; run(): Promise<void>; skip(): void; reveal: HTMLElement; destroy(): Promise<void> }

export function createOpening(c: CaseDef, res: OpenResult): Opening {
  const prize = res.prize;
  const rank = RARITY_RANK[prize.rarity];
  const epicMoment = rank >= 3 && !reducedMotion;   // legendary / mythic
  const bigWin = rank >= 4 || isNft(prize) || isPremium(prize); // jackpot celebration on top of epic
  const fx = tier !== 'low' && !reducedMotion;        // streaks, sparks, shock rings, shake
  const rgb = RARITY_RGB[prize.rarity];

  // ── reel content built around the decided winner ──
  const items: Prize[] = Array.from({ length: N }, () => weightedPick(c));
  items[WIN] = prize;
  const best = c.drops.map((d) => PRIZES[d.prize]).sort((a, b) => RARITY_RANK[b.rarity] - RARITY_RANK[a.rarity] || b.value - a.value)[0];
  const nearMiss = rank < 3 && RARITY_RANK[best.rarity] > rank && Math.random() < 0.6;
  if (nearMiss) items[WIN + 1] = best;
  // never put the winner's twin right next to it (reads as a glitch)
  if (items[WIN - 1].id === prize.id) items[WIN - 1] = weightedPick(c);
  const jitterU = nearMiss ? -1 : Math.random() - 0.5; // resolved to px once the tile size is known

  const [, art] = caseArt(c);
  const ch = (caseStats(c).rows.find((r) => r.prize.id === prize.id)?.chance ?? 0) * 100;
  const chanceTxt = `${ch >= 10 ? ch.toFixed(1) : ch >= 1 ? ch.toFixed(2) : ch.toFixed(3)}%`;
  const caseNameTxt = caseName(c);
  const th = themeOf(c);
  const el = h('div', { class: `op r-${prize.rarity}${kindCls(prize)} th-${th.key}${epicMoment ? ' is-epic' : ''}${bigWin ? ' is-big' : ''}${tier === 'low' ? ' tier-low' : ''}`, 'data-theme': th.key, style: `--rc:${rgb};${themeVars(th)}` });
  el.innerHTML = `
    <div class="op-dim"></div>
    <div class="op-tint"></div>
    <div class="op-rtint"></div>
    <div class="op-vignette"></div>
    <div class="op-squeeze"></div>
    ${fxHtml(th, tier === 'low' ? 5 : 16, 'op-fx')}
    <div class="op-stage">
      <div class="op-glow"></div>
      <div class="op-parts">${Array.from({ length: 14 }, () => `<i></i>`).join('')}</div>
      <div class="op-rays"></div>
      <div class="op-case"><img class="op-body" src="${art}" alt=""><img class="op-lid" src="${art}" alt=""></div>
    </div>
    <div class="op-reel">
      <div class="op-track"><i></i></div>
      <div class="op-land"></div>
      <div class="op-win"><div class="op-strip">
        <div class="op-row op-sharp">${items.map((p) => tileHtml(p)).join('')}</div>
        ${tier === 'low' ? '' : `<div class="op-row op-blur" aria-hidden="true">${items.map((p) => tileHtml(p, true)).join('')}</div>`}
      </div>${fx ? `<div class="op-streaks" aria-hidden="true">${Array.from({ length: 7 }, (_, i) => `<i style="--i:${i}"></i>`).join('')}</div>` : ''}</div>
      ${fx ? `<div class="op-shock"><i></i><i></i><i></i></div><div class="op-sparks">${Array.from({ length: 20 }, () => '<i></i>').join('')}</div>` : ''}
      <div class="op-lens"><i class="ln-pulse"></i><i class="ln-glow"></i><i class="ln-c tl"></i><i class="ln-c tr"></i><i class="ln-c bl"></i><i class="ln-c br"></i><i class="ln-chev up"></i><i class="ln-chev dn"></i><i class="ln-hair"></i></div>
      <div class="op-near">${t('case.nearMiss')}</div>
    </div>
    ${deckHtml(c, best)}
    <div class="op-reveal">
      ${bigWin && fx ? '<div class="op-jack"><i></i><i></i><i></i><b></b></div>' : ''}
      <div class="op-burst"></div>
      <div class="op-rays2"></div>
      <div class="op-title">${isNft(prize) ? 'NFT!' : rank === 4 ? t('result.mythic') : t('result.legendary')}</div>
      <div class="op-fl">${t(`fl.${th.key}` as I18nKey) || ''}</div>
      <div class="op-aura"></div>
      <div class="op-twinkle">${Array.from({ length: 10 }, (_, i) => `<i style="--i:${i}"></i>`).join('')}</div>
      <div class="op-card">
        <i class="op-card-frame"></i>
        <div class="op-card-ico">${prizeIcon(prize, 'big')}</div>
        <div class="op-card-r">${isNft(prize) ? t('nft.unique') : isPremium(prize) ? t('prem.kind') : rarityName(prize)}</div>
        <div class="op-card-n">${prizeName(prize)}</div>
        <div class="op-card-v"><span class="op-card-num">0</span>${starIcon('star-ico')}</div>
        <div class="op-chips"><span class="op-chip">${t('result.chance')} <b>${chanceTxt}</b></span><span class="op-chip">${t('result.case')} <b>${caseNameTxt}</b></span></div>
      </div>
    </div>
    <div class="op-flash"></div>
    <canvas class="op-confetti"></canvas>
    ${res.demo ? `<div class="op-demo">${t('case.demoBadge')}</div>` : ''}
    <button class="op-skip" data-press="">${t('case.skip')}</button>`;

  const $ = <T extends Element = HTMLElement>(s: string) => el.querySelector(s) as unknown as T;
  const stage = $('.op-stage'), glow = $('.op-glow'), caseEl = $('.op-case'), lid = $('.op-lid'), body = $('.op-body');
  const rays = $('.op-rays'), flash = $('.op-flash'), reel = $('.op-reel'), win = $('.op-win'), strip = $('.op-strip');
  const sharp = $('.op-sharp'), blur = el.querySelector<HTMLElement>('.op-blur'), lens = $('.op-lens'), near = $('.op-near');
  const tint = $('.op-tint'), land = $('.op-land'), squeeze = $('.op-squeeze');
  const streaks = el.querySelector<HTMLElement>('.op-streaks'), lpulse = $('.ln-pulse'), deck = el.querySelector<HTMLElement>('.op-deck');
  let focused = false;
  const focus = (on: boolean) => { if (focused !== on) { focused = on; setFocus(on); } };
  /** short decaying camera shake (transform only, compositor) */
  const shake = (amp: number, ms: number) => {
    if (!fx) return;
    const kf: Keyframe[] = [];
    for (let i = 0, n = 9; i <= n; i++) { const a = amp * (1 - i / n); kf.push({ transform: i === n ? 'none' : `translate3d(${((Math.random() - 0.5) * 2 * a).toFixed(1)}px,${((Math.random() - 0.5) * 2 * a * 0.7).toFixed(1)}px,0) rotate(${((Math.random() - 0.5) * a * 0.25).toFixed(2)}deg)` }); }
    for (const t of [reel, deck]) t?.animate(kf, { duration: ms, easing: 'linear' });
  };
  /** pooled sparks + shock rings bursting out of the lens in the rarity colour */
  const sparkle = (power: number) => {
    if (!fx) return;
    el.querySelectorAll<HTMLElement>('.op-shock i').forEach((r, i) => {
      if (i >= 1 + Math.min(2, power)) return;
      r.animate([{ transform: 'scale(.35)', opacity: 0.95 }, { transform: `scale(${2.1 + power * 0.35})`, opacity: 0 }], { duration: 650 + i * 120, delay: i * 90, easing: 'cubic-bezier(.15,.75,.3,1)', fill: 'both' });
    });
    const sp = el.querySelectorAll<HTMLElement>('.op-sparks i'), count = Math.min(sp.length, 8 + power * 4);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.5, d = 70 + Math.random() * (60 + power * 35), s = 0.6 + Math.random() * 0.8;
      sp[i].animate([{ transform: `translate3d(0,0,0) scale(${s})`, opacity: 1 }, { opacity: 1, offset: 0.55 }, { transform: `translate3d(${(Math.cos(a) * d).toFixed(0)}px,${(Math.sin(a) * d * 0.8 + 18).toFixed(0)}px,0) scale(0)`, opacity: 0 }],
        { duration: 620 + Math.random() * 380, easing: 'cubic-bezier(.12,.8,.3,1)', fill: 'both' });
    }
  };
  const reveal = $('.op-reveal'), skipBtn = $('.op-skip'), canvas = $<HTMLCanvasElement>('.op-confetti'), vignette = $('.op-vignette');
  const perch = createPerch({ cls: 'op-perch', antics: false });
  vignette.after(perch.el);
  /** point the ghost's eyes at a screen point */
  const aim = (px: number, py: number) => {
    const r = perch.el.querySelector('.pc-ghost')!.getBoundingClientRect(), o = el.getBoundingClientRect();
    const fx = r.left + r.width * 0.5 - o.left, fy = r.top + r.height * 0.36 - o.top;
    const dx = px - fx, dy = py - fy, d = Math.hypot(dx, dy) || 1;
    perch.lookAt((dx / d) * 10, (dy / d) * 9);
  };
  let spoke = false;
  const tiles = sharp.children as HTMLCollectionOf<HTMLElement>;
  const btiles = blur ? (blur.children as HTMLCollectionOf<HTMLElement>) : null;
  const glows = Array.from(tiles, (t) => t.querySelector<HTMLElement>('.tile-glow')!);
  const rich = tier !== 'low' && !reducedMotion;  // depth tilt, glow follow, shine, tint reaction
  let TILE = 132, STEP = TILE + GAP;
  let stopRiser: () => void = () => {};

  let skipped = false;
  let wake: (() => void) | null = null;
  const wait = (ms: number) => (skipped ? Promise.resolve() : new Promise<void>((r) => { const t0 = setTimeout(r, ms); wake = () => { clearTimeout(t0); r(); }; }));
  let stopConfetti: (() => void) | null = null;
  let reelSkip: (() => void) | null = null;

  const skip = () => {
    if (skipped) return;
    skipped = true; tg.haptic.soft();
    skipBtn.classList.add('is-gone');
    wake?.(); reelSkip?.();
    el.getAnimations({ subtree: true }).forEach((a) => { if (a.effect && (a.effect as KeyframeEffect).target?.closest?.('.op-stage')) a.finish(); });
  };
  skipBtn.addEventListener('click', skip);

  // ── phase 1: charge ──
  async function charge() {
    if (reducedMotion || skipped) return;
    el.classList.add('is-charging');
    const D = 1250;
    anim(caseEl, [
      { transform: 'scale(.9) translateY(14px)', opacity: 0, offset: 0 },
      { transform: 'scale(1)', opacity: 1, offset: 0.16 },
      { transform: 'rotate(-2deg) scale(1.01)', offset: 0.3 },
      { transform: 'rotate(2.5deg) scale(1.02)', offset: 0.4 },
      { transform: 'rotate(-4deg) scale(1.03) translateX(-2px)', offset: 0.5 },
      { transform: 'rotate(5deg) scale(1.05) translateX(3px)', offset: 0.6 },
      { transform: 'rotate(-6deg) scale(1.06) translateX(-4px)', offset: 0.68 },
      { transform: 'rotate(7deg) scale(1.08) translateX(4px)', offset: 0.76 },
      { transform: 'rotate(-8deg) scale(1.1) translateX(-5px)', offset: 0.83 },
      { transform: 'rotate(8deg) scale(1.12) translateX(5px)', offset: 0.9 },
      { transform: 'scale(1.18, .9) translateY(6px)', opacity: 1, offset: 1 },
    ], { duration: D, easing: 'linear' });
    anim(glow, [{ opacity: 0.25, transform: 'scale(.75)' }, { opacity: 1, transform: 'scale(1.3)' }], { duration: D, easing: 'cubic-bezier(.3,0,.7,.6)' });
    el.querySelectorAll('.op-parts i').forEach((p, i) =>
      anim(p, [{ transform: `rotate(${(i / 14) * 360}deg) translateY(-150px) scale(.4)`, opacity: 0 }, { opacity: 1, offset: 0.4 }, { transform: `rotate(${(i / 14) * 360}deg) translateY(-20px) scale(1)`, opacity: 0 }],
        { duration: 520, delay: (i % 5) * 90 + Math.floor(i / 5) * 130, iterations: 2, easing: 'cubic-bezier(.55,0,.8,.4)', fill: 'none' }));
    sfx.charge(D);
    // haptic drumroll accelerating into the burst
    for (const at of [160, 420, 620, 780, 910, 1010, 1090, 1160]) setTimeout(() => !skipped && tg.haptic.tap(), at);
    await wait(D);
  }

  // ── phase 2: burst (lid flies, light rays, flash) ──
  async function burst() {
    if (reducedMotion || skipped) { stage.style.opacity = '0'; return; }
    tg.haptic.heavy(); sfx.burst();
    anim(lid, [{ transform: 'none', opacity: 1 }, { transform: 'translate(-26px,-150px) rotate(-32deg) scale(1.05)', opacity: 0 }], { duration: 620, easing: 'cubic-bezier(.2,.7,.3,1)' });
    anim(body, [{ transform: 'none', opacity: 1 }, { transform: 'translateY(26px) scale(.86)', opacity: 0 }], { duration: 520, delay: 120, easing: 'cubic-bezier(.4,0,.6,1)' });
    anim(rays, [{ transform: 'scale(.25) rotate(0deg)', opacity: 0 }, { opacity: 1, offset: 0.25 }, { transform: 'scale(1.7) rotate(40deg)', opacity: 0 }], { duration: 900, easing: 'cubic-bezier(.2,.8,.3,1)' });
    anim(glow, [{ opacity: 1, transform: 'scale(1.25)' }, { opacity: 0, transform: 'scale(2.2)' }], { duration: 700, easing: 'ease-out' });
    anim(flash, [{ opacity: 0 }, { opacity: 0.75, offset: 0.18 }, { opacity: 0 }], { duration: 420, easing: 'ease-out', fill: 'none' });
    await wait(380);
  }

  // ── phase 3: the reel ──
  function spin(): Promise<void> {
    return new Promise((resolve) => {
      const W = win.clientWidth, cx = W / 2;
      const xAt = (i: number) => cx - (i * STEP + TILE / 2);
      const jitter = nearMiss ? -(TILE / 2 - 7 - Math.random() * 6) : jitterU * TILE * 0.5;
      const x0 = xAt(3) + 30, target = xAt(WIN) + jitter;
      const over = reducedMotion ? 0 : TILE * (nearMiss ? 0.16 : 0.12) + Math.random() * 6;
      const D = reducedMotion ? 1400 : epicMoment ? 6400 : 5200;
      const k = epicMoment ? 3.3 : 3; // ease-out power: lower = livelier tail (no dead crawl)
      let t0 = performance.now(), from = x0, dist = target - over - x0, dur = D, mode: 'main' | 'fast' | 'settle' = 'main';
      let x = x0, lastIdx = -1, lastTick = 0, lastBlur = -1, lastTint = -1, raf = 0, riserOn = false;
      const settleFrom = { x: 0, t: 0 };
      const touched = new Set<number>();

      const setBlur = (v: number) => {
        if (!blur) return;
        const b = Math.min(1, Math.abs(v) / 2600);
        if (Math.abs(b - lastBlur) < 0.03 && b !== 0) return;
        lastBlur = b;
        sharp.style.opacity = String(1 - b * 0.7);
        blur.style.opacity = String(b);
        if (streaks) streaks.style.opacity = (b * 0.9).toFixed(2);
      };
      // background reaction: case-tinted glow breathes with speed (never hints the rarity)
      const setTint = (v: number) => {
        if (!rich) return;
        const o = 0.25 + Math.min(1, Math.abs(v) / 3000) * 0.65;
        if (Math.abs(o - lastTint) < 0.04) return;
        lastTint = o; tint.style.opacity = o.toFixed(2);
      };
      // classic flat strip; only the rarity glow under each cell brightens near the lens (opacity only)
      const depth = () => {
        if (!rich) return;
        const c = (cx - x - TILE / 2) / STEP;
        const lo = Math.max(0, Math.floor(c) - 2), hi = Math.min(N - 1, Math.ceil(c) + 2);
        touched.forEach((i) => { if (i < lo || i > hi) { glows[i].style.opacity = ''; touched.delete(i); } });
        for (let i = lo; i <= hi; i++) { glows[i].style.opacity = Math.max(0.25, 1 - Math.abs(i - c) * 1.1).toFixed(2); touched.add(i); }
      };
      let lastBeat = 0;
      const tick = (now: number, v: number, prog: number) => {
        const idx = Math.floor((cx - x + GAP / 2) / STEP);
        if (idx === lastIdx) return;
        lastIdx = idx;
        if (rich && tiles[idx]) tiles[idx].classList.add('is-hit');
        if (now - lastTick < 50) return; // cap haptics/needle at ~20/s
        lastTick = now;
        const sp = Math.min(1, Math.abs(v) / 2800);
        sfx.tick(sp, prog);
        perch.flick(sp);
        // the lens "breathes" on every cell once the reel is slow enough to follow by eye
        if (fx && sp < 0.6) lpulse.animate([{ opacity: 0.9 - sp, transform: 'scale(1.06)' }, { opacity: 0, transform: 'scale(1)' }], { duration: 220, easing: 'ease-out' });
        tg.haptic.select();
      };
      const frame = (now: number) => {
        let p: number, v = 0;
        if (mode === 'settle') {
          p = Math.min(1, (now - settleFrom.t) / 620);
          const e = 1 - Math.pow(1 - p, 3);
          x = settleFrom.x + (target - settleFrom.x) * e;
        } else {
          p = Math.min(1, (now - t0) / dur);
          const kk = mode === 'fast' ? 3 : k;
          const e = 1 - Math.pow(1 - p, kk);
          x = from + dist * e;
          v = (kk * Math.pow(1 - p, kk - 1) * dist) / (dur / 1000);
          if (!riserOn && mode === 'main' && dur - (now - t0) < 1700 && !reducedMotion) { riserOn = true; lastBeat = now - 400; stopRiser = sfx.riser(1.7); perch.setMood('lean'); el.classList.add('is-slow'); if (!spoke) spoke = perch.say('slow', 0.3); }
          // anticipation: heartbeat that speeds up as the reel crawls to a stop
          if (riserOn && mode === 'main' && !reducedMotion) {
            const left = dur - (now - t0), gap = 380 + Math.max(0, left / 1700) * 300;
            if (now - lastBeat > gap && left > 150) {
              lastBeat = now; sfx.heartbeat(0.7 + (1 - left / 1700) * 0.5); tg.haptic.tap();
              if (fx) {
                squeeze.animate([{ opacity: 0.55 }, { opacity: 1, offset: 0.18 }, { opacity: 0.6 }], { duration: 360, easing: 'ease-out' });
                lens.animate([{ transform: 'scale(1.04)' }, { transform: 'scale(1.1)', offset: 0.2 }, { transform: 'scale(1.04)' }], { duration: 340, easing: 'ease-out' });
              }
            }
          }
        }
        strip.style.transform = `translate3d(${x.toFixed(1)}px,0,0)`;
        depth();
        setBlur(v);
        setTint(v);
        tick(now, v, mode === 'settle' ? 1 : p);
        if (p < 1) { raf = requestAnimationFrame(frame); return; }
        if (mode !== 'settle' && over) { mode = 'settle'; settleFrom.x = x; settleFrom.t = now; raf = requestAnimationFrame(frame); return; }
        setBlur(0); setTint(0);
        resolve();
      };
      reelSkip = () => {
        if (mode === 'settle') return;
        stopRiser();
        from = x; dist = target - over - x; t0 = performance.now(); dur = 420; mode = 'fast';
      };
      strip.style.transform = `translate3d(${x0}px,0,0)`;
      el.classList.add('is-reel');
      depth();
      anim(reel, [{ opacity: 0, transform: 'translateY(26px) scale(.96)' }, { opacity: 1, transform: 'none' }], { duration: skipped ? 200 : 420, easing: 'cubic-bezier(.22,1,.36,1)' });
      if (!skipped) { sfx.whoosh(); perch.gust(); spoke = perch.say('start', 0.35); }
      perch.setMood('watch'); aim(cx + win.getBoundingClientRect().left - el.getBoundingClientRect().left, win.getBoundingClientRect().top - el.getBoundingClientRect().top + win.clientHeight / 2);
      if (skipped) reelSkip();
      raf = requestAnimationFrame(frame);
      void raf;
    });
  }

  // ── phase 4: settle, near-miss, legendary slow-mo ──
  async function settle() {
    reelSkip = null;
    stopRiser();
    el.classList.add('is-settled');
    for (let i = Math.max(0, WIN - 5); i <= Math.min(N - 1, WIN + 5); i++) { tiles[i].style.opacity = ''; glows[i].style.opacity = ''; }
    tiles[WIN].style.transform = ''; if (btiles) btiles[WIN].style.transform = '';
    if (nearMiss) tiles[WIN + 1].style.transform = '';
    tiles[WIN].classList.add('is-win');
    tg.haptic.medium();
    sfx.settle();
    // rarity flash under the needle + the room takes the rarity colour
    anim(land, [{ opacity: 0, transform: 'scale(.5)' }, { opacity: 1, transform: 'scale(1.05)', offset: 0.3 }, { opacity: 0.55, transform: 'scale(1.25)' }], { duration: 700, easing: 'cubic-bezier(.2,.8,.3,1)' });
    el.classList.add('is-landed');
    sparkle(rank);
    if (rank >= 2) shake(2 + rank * 1.5, 380 + rank * 60);
    anim(lens, [{ transform: 'scale(1.1)' }, { transform: 'scale(.97)', offset: 0.45 }, { transform: 'scale(1)' }], { duration: 620, easing: 'cubic-bezier(.34,1.56,.64,1)', fill: 'none' });
    if (nearMiss) { perch.setMood('gasp'); perch.say('near', 0.8); }
    else if (!epicMoment) { perch.setMood(rank === 0 ? 'meh' : 'happy'); perch.say(rank === 0 ? 'common' : 'good', rank === 0 ? 0.45 : 0.6); }
    if (nearMiss) {
      tiles[WIN + 1].classList.add('is-near');
      const r = tiles[WIN + 1].getBoundingClientRect(); near.style.left = `${r.left + r.width / 2 - win.getBoundingClientRect().left}px`;
      el.classList.add('is-nearmiss');
      sfx.nearMiss(); tg.haptic.soft();
      // the jackpot cell wobbles "almost!" and tries to slide back in
      if (fx) tiles[WIN + 1].animate([{ translate: '0 0' }, { translate: '-10px 0', offset: 0.35 }, { translate: '3px 0', offset: 0.7 }, { translate: '0 0' }], { duration: 560, delay: 120, easing: 'ease-in-out' });
      await wait(700);
    } else await wait(380);
    if (epicMoment && !skipped) {
      // slow-mo: darken the world, two heartbeats on the winner, then white flash
      anim(vignette, [{ opacity: 0 }, { opacity: 1 }], { duration: 500, easing: 'ease-in' });
      for (let i = 0; i < 2; i++) {
        tiles[WIN].animate([{ transform: 'scale(1.06)' }, { transform: 'scale(1.16)', offset: 0.3 }, { transform: 'scale(1.06)' }], { duration: 480, easing: 'ease-out' });
        tg.haptic.heavy();
        await wait(520);
      }
    }
  }

  // ── phase 5: reveal ──
  async function doReveal() {
    // ghost leaps down to the left of / below the prize card (it sits on the left end of the bough) (card: 34% centre, ~276px tall)
    {
      const H = el.clientHeight, g = perch.el.querySelector('.pc-ghost')!.getBoundingClientRect(), o = el.getBoundingClientRect();
      const targetTop = H * 0.34 + 166, targetLeft = 6;
      perch.el.style.setProperty('--aside', `${Math.round(targetLeft - (g.left - o.left))}px`);
      perch.el.style.setProperty('--drop', `${Math.round(targetTop - (g.top - o.top))}px`);
    }
    el.classList.add('is-reveal');
    anim(reel, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(1.06)' }], { duration: 320, easing: 'ease-in' });
    anim(skipBtn, [{ opacity: 1 }, { opacity: 0 }], { duration: 200 });
    skipBtn.style.pointerEvents = 'none';
    if (epicMoment) {
      anim(flash, [{ opacity: 0 }, { opacity: 0.95, offset: 0.12 }, { opacity: 0 }], { duration: 900, easing: 'ease-out', fill: 'none' });
      anim(el.querySelector('.op-title')!, [{ opacity: 0, transform: 'scale(.4)', letterSpacing: '0.4em' }, { opacity: 1, transform: 'scale(1.08)', offset: 0.6 }, { opacity: 1, transform: 'none', letterSpacing: '0.04em' }], { duration: 900, delay: 160, easing: 'cubic-bezier(.34,1.4,.64,1)' });
      tg.haptic.heavy(); setTimeout(() => tg.haptic.heavy(), 180); setTimeout(() => tg.haptic.success(), 420);
    } else {
      rank >= 2 ? tg.haptic.heavy() : tg.haptic.medium();
      setTimeout(() => tg.haptic.success(), 160);
    }
    sfx.reveal(rank, bigWin);
    if (bigWin && fx) {
      // jackpot: gold/holo shock rings + a light sweep across the card + a heavier shake
      el.querySelectorAll<HTMLElement>('.op-jack i').forEach((r, i) =>
        r.animate([{ transform: 'scale(.2)', opacity: 1 }, { transform: 'scale(3.2)', opacity: 0 }], { duration: 1100, delay: 120 + i * 220, easing: 'cubic-bezier(.1,.7,.3,1)', fill: 'both' }));
      el.querySelector('.op-jack b')?.animate([{ transform: 'translateX(-160%) skewX(-18deg)', opacity: 0 }, { opacity: 1, offset: 0.3 }, { transform: 'translateX(160%) skewX(-18deg)', opacity: 0 }], { duration: 1000, delay: 700, easing: 'ease-in-out', fill: 'both' });
      reveal.animate([{ transform: 'none' }, { transform: 'translate3d(-5px,3px,0)', offset: 0.1 }, { transform: 'translate3d(5px,-3px,0)', offset: 0.25 }, { transform: 'translate3d(-3px,2px,0)', offset: 0.45 }, { transform: 'translate3d(2px,-1px,0)', offset: 0.7 }, { transform: 'none' }], { duration: 520, delay: 140, easing: 'linear' });
    }
    if (rank >= 3) { perch.setMood('ecstatic'); perch.say('epic', 0.9); }
    else if (nearMiss) setTimeout(() => perch.setMood(rank === 0 ? 'meh' : 'happy'), 250);
    anim(el.querySelector('.op-burst')!, [{ transform: 'scale(.2)', opacity: 1 }, { transform: `scale(${epicMoment ? 2.4 : 1.8})`, opacity: 0 }], { duration: epicMoment ? 1100 : 800, easing: 'cubic-bezier(.1,.7,.3,1)' });
    anim(el.querySelector('.op-rays2')!, [{ opacity: 0, transform: 'scale(.5)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 700, easing: 'cubic-bezier(.22,1,.36,1)' });
    anim(el.querySelector('.op-card')!, [{ opacity: 0, transform: 'translateY(40px) scale(.4)' }, { opacity: 1, transform: 'none' }], { duration: 900, delay: epicMoment ? 260 : 80, easing: 'cubic-bezier(.34,1.56,.64,1)' });
    countTo(el.querySelector<HTMLElement>('.op-card-num')!, 0, prize.value, (n) => fmt(n), epicMoment ? 1300 : 900);
    anim(el.querySelector('.op-aura')!, [{ opacity: 0, transform: 'scale(.4)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 900, easing: 'cubic-bezier(.22,1,.36,1)' });
    anim(el.querySelector('.op-chips')!, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 500, delay: epicMoment ? 700 : 450, easing: 'ease-out' });
    anim(el.querySelector('.op-card-ico')!, [{ transform: 'scale(.6) rotate(-12deg)' }, { transform: 'scale(1.12, .9) rotate(4deg)', offset: 0.45 }, { transform: 'none' }], { duration: 1000, delay: epicMoment ? 300 : 120, easing: 'cubic-bezier(.34,1.4,.64,1)' });
    if (!reducedMotion) {
      const palette = ['#3fe3ff', '#9d6bff', '#ff4fc8', '#ffffff', `rgb(${rgb})`];
      if (rank >= 3) palette.push('#ffd66e', '#fff1b8');
      stopConfetti = confetti(canvas, { colors: palette, count: [50, 70, 100, 150, 190][rank], power: 0.8 + rank * 0.12, y: 0.34 });
    }
    await sleep(epicMoment ? 1000 : 650);
  }

  // ghost sits on a branch right above the reel, at the screen edge (never over the reel or case art)
  function layoutPerch() {
    const H = el.clientHeight;
    const probe = h('div', { style: 'position:absolute;top:var(--safe-top);height:0' }); el.append(probe);
    const safe = probe.offsetTop; probe.remove();
    const line = Math.min(H * 0.36 - 103 - 38, H * 0.38 - TILE * 0.56 - 60); // bough top edge: above the case art and the reel
    const pm = Math.round(Math.max(56, Math.min(92, (line - safe - 6) / 0.92)));
    perch.el.style.setProperty('--pm', `${pm}px`);
    perch.el.style.top = `${line - pm + 2}px`;
  }

  return {
    el,
    reveal,
    skip,
    async run() {
      // responsive cells: ~3 visible on 360–430 px screens, centre one dominant
      TILE = Math.round(Math.min(126, Math.max(108, win.clientWidth * 0.295)));
      STEP = TILE + GAP;
      el.style.setProperty('--tile', `${TILE}px`);
      layoutPerch();
      void el.offsetWidth;
      el.classList.add('is-in');
      focus(true); // freeze the background video + leaves (still visible) so the reel gets every frame
      perch.setMood('watch');
      const st = stage.getBoundingClientRect(), o = el.getBoundingClientRect();
      aim(st.left + st.width / 2 - o.left, st.top + st.height / 2 - o.top);
      await charge();
      await burst();
      el.classList.add('is-burst');
      await spin();
      await settle();
      await doReveal();
      focus(false);
    },
    async destroy() {
      stopConfetti?.();
      focus(false);
      perch.destroy();
      await el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 280, easing: 'ease-in', fill: 'forwards' }).finished.catch(() => {});
      el.remove();
    },
  };
}
