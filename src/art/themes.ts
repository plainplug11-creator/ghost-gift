import type { CaseDef } from '../api/types';

/**
 * Per-case identity: every case gets its own palette, particles, hero decor, reel accent and
 * result flavour. Applied as `data-theme` + CSS vars on the case page, the opening show and the
 * result sheet (styles/themes.css). Keyed by case id; the backend's `theme` key (e.g. "king-royal")
 * and the price are fallbacks so a new server-side case never renders unthemed.
 */
export type Fx = 'ribbon' | 'firefly' | 'leaf' | 'ember' | 'bolt' | 'wisp' | 'star' | 'shard' | 'gold' | 'aurora' | 'void' | 'crown';
export type Deco = 'bokeh' | 'vines' | 'rays' | 'grid' | 'fog' | 'burst' | 'prism' | 'halo' | 'bands' | 'eclipse' | 'royal';
export interface Theme {
  key: string;
  /** neon colours "r,g,b": main, second, accent */
  c: [string, string, string];
  fx: Fx;
  deco: Deco;
  /** tier label in the grid: start / classic / high */
  tier: 'start' | 'classic' | 'high';
}

const T = (key: string, c: Theme['c'], fx: Fx, deco: Deco, tier: Theme['tier']): Theme => ({ key, c, fx, deco, tier });

export const THEMES: Record<string, Theme> = {
  daily:   T('daily',   ['157,107,255', '255,79,200', '120,230,255'], 'ribbon', 'rays', 'start'),
  spark:   T('spark',   ['80,255,214', '63,227,255', '200,255,236'], 'firefly', 'bokeh', 'start'),
  lantern: T('lantern', ['36,214,214', '60,130,255', '255,122,44'], 'leaf', 'vines', 'start'),
  autumn:  T('autumn',  ['255,138,60', '157,107,255', '255,92,200'], 'ember', 'vines', 'start'),
  neon:    T('neon',    ['63,227,255', '90,125,255', '230,250,255'], 'bolt', 'grid', 'start'),
  ghost:   T('ghost',   ['205,184,255', '157,107,255', '235,230,255'], 'wisp', 'fog', 'classic'),
  star:    T('star',    ['255,79,200', '157,107,255', '255,200,240'], 'star', 'burst', 'classic'),
  diamond: T('diamond', ['63,227,255', '255,79,200', '220,250,255'], 'shard', 'prism', 'classic'),
  legend:  T('legend',  ['255,214,110', '166,92,255', '255,240,200'], 'gold', 'halo', 'classic'),
  aurora:  T('aurora',  ['64,255,200', '120,90,255', '255,120,220'], 'aurora', 'bands', 'high'),
  phantom: T('phantom', ['170,80,255', '20,240,255', '255,40,180'], 'void', 'eclipse', 'high'),
  king:    T('king',    ['255,214,110', '255,60,200', '63,227,255'], 'crown', 'royal', 'high'),
};
const BY_PRICE: [number, string][] = [[0, 'daily'], [5, 'spark'], [15, 'lantern'], [25, 'autumn'], [50, 'neon'], [100, 'ghost'], [250, 'star'], [500, 'diamond'], [1000, 'legend'], [2000, 'aurora'], [3500, 'phantom'], [5000, 'king']];

export function themeOf(c: CaseDef): Theme {
  const k = (c as CaseDef & { theme?: string }).theme?.split('-')[0];
  if (THEMES[c.id]) return THEMES[c.id];
  if (k && THEMES[k]) return THEMES[k];
  let best = BY_PRICE[0];
  for (const p of BY_PRICE) if (c.price >= p[0]) best = p;
  return THEMES[best[1]];
}

/** CSS vars for a themed element (also feeds the legacy --glow/--glow2 used across cases.css). */
export const themeVars = (th: Theme) => `--glow:${th.c[0]};--glow2:${th.c[1]};--t1:${th.c[0]};--t2:${th.c[1]};--t3:${th.c[2]}`;

/** Particle layer markup: n pre-seeded particles (deterministic per index, transform/opacity only). */
export function fxHtml(th: Theme, n = 14, cls = '') {
  let s = '';
  for (let i = 0; i < n; i++) {
    const x = ((i * 37 + 11) % 97) + 1.5;                 // spread 0..100%
    const d = 5 + ((i * 53) % 7);                          // duration 5..11s
    const dl = -((i * 1.7) % d).toFixed(2);                // negative delay → already mid-flight
    const sc = (0.55 + ((i * 29) % 10) / 20).toFixed(2);   // scale .55..1
    const y = ((i * 61 + 7) % 90) + 5;
    s += `<i style="--x:${x}%;--y:${y}%;--d:${d}s;--dl:${dl}s;--s:${sc};--k:${i % 3};--a:${(i * 137.5) % 360}deg"></i>`;
  }
  return `<span class="th-fx fx-${th.fx} ${cls}" aria-hidden="true">${s}</span>`;
}

/** Hero decor layer (behind the case art). */
export const decoHtml = (th: Theme) => `<span class="th-deco dc-${th.deco}" aria-hidden="true"><i></i><i></i><i></i></span>`;
