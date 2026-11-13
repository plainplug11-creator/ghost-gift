import { maxDpr, onRunningChange, isRunning, reducedMotion, tier } from '../core/perf';

/**
 * Ambient background: a handful of slowly drifting autumn leaves + rising embers.
 * GPU/CPU-cheap by design:
 *  - sprites are pre-rendered once to offscreen canvases (drawImage per frame only)
 *  - 4–9 leaves, 3–6 embers; DPR capped per tier; 30fps on low tier
 *  - stops entirely when the app is hidden / deactivated
 *  - reduced motion → one static frame
 * Swap-friendly: the whole background lives behind #app and can be replaced
 * by another module exporting the same mount(canvas) signature.
 */

const LEAF_COLORS = ['#ff6b2c', '#ff9a3c', '#d9541f', '#ffb85c'];

function leafSprite(color: string, size = 44): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.translate(size / 2, size / 2);
  const L = size * 0.42, W = size * 0.2;
  const grad = g.createLinearGradient(0, -L, 0, L);
  grad.addColorStop(0, color); grad.addColorStop(1, shade(color, -0.35));
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(0, -L);
  g.bezierCurveTo(W * 1.6, -L * 0.45, W * 1.3, L * 0.5, 0, L);
  g.bezierCurveTo(-W * 1.3, L * 0.5, -W * 1.6, -L * 0.45, 0, -L);
  g.fill();
  g.strokeStyle = 'rgba(255,240,220,.35)'; g.lineWidth = size / 44;
  g.beginPath(); g.moveTo(0, -L * 0.85); g.lineTo(0, L * 1.12); g.stroke();
  for (const y of [-0.35, 0, 0.35]) {
    g.beginPath(); g.moveTo(0, L * y); g.lineTo(W * 0.9, L * (y - 0.22)); g.moveTo(0, L * y); g.lineTo(-W * 0.9, L * (y - 0.22)); g.stroke();
  }
  return c;
}
function shade(hex: string, k: number) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * (1 + k))));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}
/** Soft neon bokeh mote (cyan / violet / magenta) — rises slowly like city haze. */
function emberSprite(rgb: string, size = 32) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d')!;
  const r = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  r.addColorStop(0, `rgba(${rgb},.9)`); r.addColorStop(0.35, `rgba(${rgb},.35)`); r.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = r; g.fillRect(0, 0, size, size);
  return c;
}

interface Leaf { x: number; y: number; z: number; s: number; rot: number; vr: number; phase: number; vp: number; vy: number; sway: number; img: HTMLCanvasElement }
interface Ember { x: number; y: number; z: number; vy: number; phase: number; life: number; img: HTMLCanvasElement }

export function mountLeaves(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d', { alpha: true })!;
  const sprites = LEAF_COLORS.map((c) => leafSprite(c));
  const motes = ['63,227,255', '157,107,255', '255,79,200'].map((c) => emberSprite(c));
  const N = tier === 'low' ? 4 : tier === 'mid' ? 7 : 9;
  const E = tier === 'low' ? 3 : 6;
  const frameMin = tier === 'low' ? 1000 / 31 : 0;
  let W = 0, H = 0, dpr = 1, raf = 0, last = 0, acc = 0;

  const rnd = (a: number, b: number) => a + Math.random() * (b - a);
  const newLeaf = (initial: boolean): Leaf => {
    const z = rnd(0.35, 1); // depth: far leaves smaller, slower, fainter
    return {
      x: rnd(-0.1, 1.1) * W, y: initial ? rnd(-0.1, 1) * H : rnd(-60, -20), z,
      s: (14 + 14 * z), rot: rnd(0, Math.PI * 2), vr: rnd(-0.5, 0.5),
      phase: rnd(0, Math.PI * 2), vp: rnd(0.6, 1.2), vy: 12 + 16 * z, sway: rnd(14, 30) * z,
      img: sprites[(Math.random() * sprites.length) | 0],
    };
  };
  const newEmber = (initial: boolean): Ember => ({
    x: rnd(0, W), y: initial ? rnd(0.3, 1) * H : H + 10, z: rnd(0.4, 1), vy: rnd(6, 14), phase: rnd(0, 6), life: rnd(0.5, 1),
    img: motes[(Math.random() * motes.length) | 0],
  });

  let leaves: Leaf[] = [], embers: Ember[] = [];
  const resize = () => {
    dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    W = innerWidth; H = innerHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    if (!leaves.length) { leaves = Array.from({ length: N }, () => newLeaf(true)); embers = Array.from({ length: E }, () => newEmber(true)); }
    draw(0);
  };

  const draw = (dt: number) => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const e of embers) {
      e.y -= e.vy * dt; e.phase += dt * 1.3;
      if (e.y < H * 0.25) Object.assign(e, newEmber(false));
      const a = Math.min(1, (e.y - H * 0.25) / (H * 0.3)) * e.life * (0.55 + 0.45 * Math.sin(e.phase * 2));
      const s = 16 * e.z;
      ctx.globalAlpha = Math.max(0, a) * 0.55;
      ctx.drawImage(e.img, (e.x + Math.sin(e.phase) * 8) * dpr - (s * dpr) / 2, e.y * dpr - (s * dpr) / 2, s * dpr, s * dpr);
    }
    for (const l of leaves) {
      l.phase += l.vp * dt; l.rot += l.vr * dt; l.y += l.vy * dt;
      if (l.y > H + 40) Object.assign(l, newLeaf(false));
      const x = l.x + Math.sin(l.phase) * l.sway;
      const flip = Math.cos(l.phase * 0.8); // fake 3D tumble
      const s = l.s * dpr;
      ctx.globalAlpha = 0.3 + 0.5 * l.z;
      const c = Math.cos(l.rot), si = Math.sin(l.rot);
      ctx.setTransform(c * flip, si * flip, -si, c, x * dpr, l.y * dpr);
      ctx.drawImage(l.img, -s / 2, -s / 2, s, s);
    }
    ctx.globalAlpha = 1;
  };

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    acc += now - last; last = now;
    if (acc < frameMin) return;
    draw(frameMin ? acc / 1000 : dt); acc = 0;
  };
  const start = () => { if (!raf && !reducedMotion && isRunning()) { last = performance.now(); raf = requestAnimationFrame(frame); } };
  const stop = () => { cancelAnimationFrame(raf); raf = 0; };

  addEventListener('resize', resize, { passive: true });
  onRunningChange((r) => (r ? start() : stop()));
  resize(); start();
  requestAnimationFrame(() => canvas.classList.add('is-ready'));
  return { stop, start };
}
