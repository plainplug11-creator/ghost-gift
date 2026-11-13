import { maxDpr, tier } from '../core/perf';

/**
 * Canvas confetti + sparks burst. One canvas, one rAF loop, auto-stops.
 * Particle count scales with perf tier; DPR capped.
 */
type P = { x: number; y: number; vx: number; vy: number; r: number; rot: number; vr: number; c: string; s: 0 | 1 | 2; life: number; ttl: number; flip: number };

export function confetti(canvas: HTMLCanvasElement, opts: { colors: string[]; count?: number; power?: number; y?: number }) {
  const dpr = Math.min(devicePixelRatio || 1, maxDpr);
  const W = canvas.clientWidth, H = canvas.clientHeight;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const mult = tier === 'low' ? 0.35 : tier === 'mid' ? 0.65 : 1;
  const n = Math.round((opts.count ?? 110) * mult);
  const power = opts.power ?? 1;
  const cx = W / 2, cy = H * (opts.y ?? 0.38);
  const ps: P[] = [];
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = (260 + Math.random() * 520) * power;
    ps.push({
      x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 180 * power,
      r: 3 + Math.random() * 4.5, rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 14,
      c: opts.colors[i % opts.colors.length], s: (i % 5 === 0 ? 2 : i % 3 === 0 ? 1 : 0) as 0 | 1 | 2,
      life: 0, ttl: 1.6 + Math.random() * 1.2, flip: Math.random() * 6.28,
    });
  }
  let last = performance.now(), raf = 0;
  const star = (x: number, y: number, r: number) => {
    ctx.beginPath();
    ctx.moveTo(x, y - r * 2); ctx.quadraticCurveTo(x, y, x + r * 2, y); ctx.quadraticCurveTo(x, y, x, y + r * 2);
    ctx.quadraticCurveTo(x, y, x - r * 2, y); ctx.quadraticCurveTo(x, y, x, y - r * 2); ctx.fill();
  };
  const frame = (now: number) => {
    const dt = Math.min(0.033, (now - last) / 1000); last = now;
    ctx.clearRect(0, 0, W, H);
    let alive = 0;
    for (const p of ps) {
      p.life += dt; if (p.life > p.ttl) continue; alive++;
      p.vx *= 1 - 2.2 * dt; p.vy = p.vy * (1 - 2.2 * dt) + 520 * dt; // drag + gravity
      p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt; p.flip += dt * 9;
      ctx.globalAlpha = Math.min(1, (p.ttl - p.life) * 2.2);
      ctx.fillStyle = p.c;
      if (p.s === 2) { star(p.x, p.y, p.r * 0.7); continue; }
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      if (p.s === 1) { ctx.beginPath(); ctx.arc(0, 0, p.r * 0.6, 0, 6.28); ctx.fill(); }
      else ctx.fillRect(-p.r, -p.r * 0.45 * Math.abs(Math.cos(p.flip)) - 0.5, p.r * 2, p.r * 0.9 * Math.abs(Math.cos(p.flip)) + 1);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    if (alive) raf = requestAnimationFrame(frame); else ctx.clearRect(0, 0, W, H);
  };
  raf = requestAnimationFrame(frame);
  return () => { cancelAnimationFrame(raf); ctx.clearRect(0, 0, W, H); };
}
