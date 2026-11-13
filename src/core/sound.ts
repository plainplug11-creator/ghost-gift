import { store } from './store';
import { tg } from './telegram';

/**
 * Tiny synthesized SFX (WebAudio, no files → zero bytes to download).
 * Muted by default; the toggle persists in Telegram CloudStorage + localStorage.
 * Hooks: tick (reel), charge, burst, reveal(rarity rank 0..4).
 * TODO(audio): swap synth for designed samples later — keep the same API.
 */
const KEY = 'gg_sound';
let ctx: AudioContext | null = null;
const ac = () => {
  if (!ctx) { const C = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext; if (!C) return null; ctx = new C(); }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
};

export async function initSound() {
  store.sound.set((await tg.cloud.get(KEY)) === '1');
}
export function setSound(on: boolean) { store.sound.set(on); tg.cloud.set(KEY, on ? '1' : '0'); if (on) ac(); }

function tone(freq: number, dur: number, type: OscillatorType = 'sine', gain = 0.06, at = 0, slideTo?: number) {
  const c = ac(); if (!c) return;
  const t = c.currentTime + at;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination); o.start(t); o.stop(t + dur + 0.02);
}

export const sfx = {
  tick(pitch = 1) { if (store.sound.get()) tone(1500 * pitch, 0.035, 'triangle', 0.035); },
  charge(ms: number) { if (store.sound.get()) tone(140, ms / 1000, 'sawtooth', 0.025, 0, 520); },
  burst() { if (!store.sound.get()) return; tone(90, 0.35, 'sine', 0.12, 0, 40); tone(900, 0.25, 'triangle', 0.04, 0, 2400); },
  reveal(rank: number) {
    if (!store.sound.get()) return;
    const base = [523, 587, 659, 784, 880][rank] ?? 523;
    [1, 1.25, 1.5, 2].slice(0, 2 + Math.min(2, rank)).forEach((m, i) => tone(base * m, 0.5 + rank * 0.1, 'triangle', 0.05, i * 0.08));
  },
};
