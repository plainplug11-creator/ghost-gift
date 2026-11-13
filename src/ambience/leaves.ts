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

/** 4-point glint (cyan/white/pink) for the occasional sparkle in empty space. */
function glintSprite(rgb: string, size = 40) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d')!, m = size / 2;
  const r = g.createRadialGradient(m, m, 0, m, m, m);
  r.addColorStop(0, `rgba(${rgb},.55)`); r.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = r; g.fillRect(0, 0, size, size);
  g.fillStyle = '#fff'; g.beginPath();
  g.moveTo(m, 2); g.quadraticCurveTo(m + 2.2, m - 2.2, size - 2, m); g.quadraticCurveTo(m + 2.2, m + 2.2, m, size - 2);
  g.quadraticCurveTo(m - 2.2, m + 2.2, 2, m); g.quadraticCurveTo(m - 2.2, m - 2.2, m, 2); g.fill();
  return c;
}
interface Fly { x: number; y: number; ax: number; ay: number; fx: number; fy: number; p: number; blink: number; vb: number; s: number; img: HTMLCanvasElement }
interface Glint { x: number; y: number; t: number; dur: number; s: number; img: HTMLCanvasElement }

interface Leaf { x: number; y: number; z: number; s: number; rot: number; vr: number; phase: number; vp: number; vy: number; sway: number; img: HTMLCanvasElement }
interface Ember { x: number; y: number; z: number; vy: number; phase: number; life: number; img: HTMLCanvasElement }

export function mountLeaves(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d', { alpha: true })!;
  const sprites = LEAF_COLORS.map((c) => leafSprite(c));
  const motes = ['63,227,255', '157,107,255', '255,79,200'].map((c) => emberSprite(c));
  const N = tier === 'low' ? 4 : tier === 'mid' ? 7 : 9;
  const E = tier === 'low' ? 3 : 6;
  // ~30 fps for the whole ambient layer: motion here is slow drift (≤ 1 px per frame), so half the frames look the
  // same — and every rAF tick also makes the browser service all running CSS animations on the main thread.
  const frameMin = 1000 / 31;
  // fireflies + glints fill the empty space on rich tiers only
  const F = tier === 'high' ? 12 : tier === 'mid' ? 8 : 0;
  const glints = tier === 'low' ? [] : ['159,243,255', '255,158,224', '201,166,255'].map((c) => glintSprite(c));
  let flies: Fly[] = [], gl: Glint[] = [], nextGlint = 1.2;
  let W = 0, H = 0, dpr = 1, raf = 0, last = 0;

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
    if (!flies.length && F) flies = Array.from({ length: F }, () => ({
      x: rnd(0.04, 0.96), y: rnd(0.08, 0.95), ax: rnd(18, 46), ay: rnd(14, 34), fx: rnd(0.08, 0.2), fy: rnd(0.07, 0.17), p: rnd(0, 6.3),
      blink: rnd(0, 6.3), vb: rnd(0.5, 1.1), s: rnd(12, 24), img: motes[(Math.random() * motes.length) | 0] }));
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
    if (flies.length) {
      ctx.globalCompositeOperation = 'lighter';
      for (const f of flies) {
        f.p += dt; f.blink += f.vb * dt;
        const x = f.x * W + Math.sin(f.p * f.fx * 6.28) * f.ax, y = f.y * H + Math.cos(f.p * f.fy * 6.28 + 1) * f.ay;
        const b = Math.max(0, Math.sin(f.blink)), a = 0.12 + 0.6 * b * b;
        const s = f.s * (0.8 + 0.3 * b) * dpr;
        ctx.globalAlpha = a; ctx.drawImage(f.img, x * dpr - s / 2, y * dpr - s / 2, s, s);
        ctx.globalAlpha = a * 0.9; const c = s * 0.28; ctx.drawImage(f.img, x * dpr - c / 2, y * dpr - c / 2, c, c);
      }
      nextGlint -= dt;
      if (glints.length && nextGlint <= 0 && gl.length < 3) {
        gl.push({ x: rnd(0.05, 0.95) * W, y: rnd(0.06, 0.94) * H, t: 0, dur: rnd(1, 1.6), s: rnd(14, 26), img: glints[(Math.random() * glints.length) | 0] });
        nextGlint = rnd(0.7, 1.8);
      }
      gl = gl.filter((g) => (g.t += dt) < g.dur);
      for (const g of gl) {
        const k = Math.sin((g.t / g.dur) * Math.PI), s = g.s * k * dpr;
        ctx.globalAlpha = k * 0.85;
        ctx.setTransform(Math.cos(g.t * 1.5), Math.sin(g.t * 1.5), -Math.sin(g.t * 1.5), Math.cos(g.t * 1.5), g.x * dpr, g.y * dpr);
        ctx.drawImage(g.img, -s / 2, -s / 2, s, s);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
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

  // timer-paced: request a frame only when one is due (a rAF loop that skips frames still costs a main frame each vsync)
  let tmo = 0;
  const frame = (now: number) => {
    raf = 0;
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    draw(dt);
    tmo = window.setTimeout(() => { tmo = 0; raf = requestAnimationFrame(frame); }, Math.max(0, frameMin - (performance.now() - now) - 4));
  };
  const start = () => { if (!raf && !tmo && !reducedMotion && isRunning()) { last = performance.now(); raf = requestAnimationFrame(frame); } };
  const stop = () => { cancelAnimationFrame(raf); clearTimeout(tmo); raf = 0; tmo = 0; };

  addEventListener('resize', resize, { passive: true });
  onRunningChange((r) => (r ? start() : stop()));
  resize(); start();
  requestAnimationFrame(() => canvas.classList.add('is-ready'));
  return { stop, start };
}
