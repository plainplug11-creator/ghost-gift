import { store } from './store';
import { tg } from './telegram';

/**
 * Synthesized SFX (WebAudio, zero downloads). Muted by default; the toggle
 * persists in Telegram CloudStorage + localStorage.
 *
 * Sound design for the case reel:
 *  - tick:   soft "glass/toy" bell (two inharmonic sine partials, 3 ms attack,
 *            short exp decay) — pitch & volume follow reel speed; rate-capped,
 *            scheduled on the audio clock (no main-thread jitter, no clicks)
 *  - whoosh: band-passed noise sweep when the reel launches
 *  - riser:  gentle ascending glide + airy noise during the last ~1.6 s
 *  - land:   chime/sparkle scaled by rarity; legendary/mythic get a shimmer chord
 * iOS (Telegram WebView): the AudioContext must be created/resumed inside a user
 * gesture → unlock() runs on every touch until the context is 'running'.
 */
const KEY = 'gg_sound';
let ctx: AudioContext | null = null;
let out: GainNode | null = null;   // master
let verb: GainNode | null = null;  // send to a tiny glassy reverb
let noise: AudioBuffer | null = null;

function build() {
  const C = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!C) return null;
  const c = new C();
  const comp = c.createDynamicsCompressor();
  comp.threshold.value = -16; comp.ratio.value = 4; comp.attack.value = 0.002; comp.release.value = 0.15;
  out = c.createGain(); out.gain.value = 0.9;
  out.connect(comp).connect(c.destination);
  // short sparkly reverb (generated impulse, 1.1 s)
  const len = Math.floor(c.sampleRate * 1.1), ir = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
  const conv = c.createConvolver(); conv.buffer = ir;
  verb = c.createGain(); verb.gain.value = 0.28;
  verb.connect(conv).connect(out);
  noise = c.createBuffer(1, c.sampleRate, c.sampleRate);
  const nd = noise.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  return c;
}
const ac = () => { if (!ctx) ctx = build(); return ctx; };

/** Must run inside a user gesture on iOS. Plays a 1-sample silent buffer to unlock output. */
export function unlockAudio() {
  const c = ac(); if (!c) return;
  if (c.state !== 'running') void c.resume();
  const b = c.createBufferSource(); b.buffer = c.createBuffer(1, 1, 22050); b.connect(c.destination); b.start(0);
}

export async function initSound() {
  store.sound.set((await tg.cloud.get(KEY)) === '1');
  const onGesture = () => {
    if (!store.sound.get()) return;
    unlockAudio();
    if (ctx?.state === 'running') { removeEventListener('pointerdown', onGesture, true); removeEventListener('touchend', onGesture, true); }
  };
  addEventListener('pointerdown', onGesture, true);
  addEventListener('touchend', onGesture, true);
}
export function setSound(on: boolean) { store.sound.set(on); tg.cloud.set(KEY, on ? '1' : '0'); if (on) unlockAudio(); }

const live = () => store.sound.get() && !!ac() && ctx!.state === 'running';

/** Enveloped sine/triangle voice → master (+ optional reverb send). */
function voice(freq: number, at: number, dur: number, gain: number, type: OscillatorType = 'sine', send = 0, glideTo?: number) {
  const c = ctx!, o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, at);
  if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, at + dur);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.003);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g); g.connect(out!);
  if (send && verb) { const s = c.createGain(); s.gain.value = send; g.connect(s).connect(verb); }
  o.start(at); o.stop(at + dur + 0.03);
}
function noiseBurst(at: number, dur: number, gain: number, f0: number, f1: number, q = 1.2) {
  const c = ctx!, src = c.createBufferSource(), bp = c.createBiquadFilter(), g = c.createGain();
  src.buffer = noise; src.loop = true;
  bp.type = 'bandpass'; bp.Q.value = q; bp.frequency.setValueAtTime(f0, at); bp.frequency.exponentialRampToValueAtTime(f1, at + dur);
  g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(gain, at + dur * 0.35); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(bp).connect(g).connect(out!);
  src.start(at); src.stop(at + dur + 0.05);
  return { src, g };
}

// pentatonic-ish note set (C major pentatonic, hz)
const N = { C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880, C6: 1046.5, D6: 1174.7, E6: 1318.5, G6: 1568, A6: 1760, C7: 2093 };
let lastTickAt = 0;
// ascending ladder for reel ticks: as the reel slows the ticks climb the scale (tension)
const LADDER = [N.C5, N.D5, N.E5, N.G5, N.A5, N.C6, N.D6, N.E6, N.G6, N.A6, N.C7];

/** Detuned saw "choir/brass" chord through a moving low-pass (cheap: 2 osc per note). */
function pad(freqs: number[], at: number, dur: number, gain: number, cut0 = 600, cut1 = 2600, attack = 0.06, send = 0.5) {
  const c = ctx!, lp = c.createBiquadFilter(), g = c.createGain();
  lp.type = 'lowpass'; lp.Q.value = 2; lp.frequency.setValueAtTime(cut0, at); lp.frequency.exponentialRampToValueAtTime(cut1, at + Math.min(dur, attack + 0.25));
  lp.frequency.exponentialRampToValueAtTime(Math.max(300, cut0 * 0.8), at + dur);
  g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(gain, at + attack); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  lp.connect(g).connect(out!);
  if (send && verb) { const sg = c.createGain(); sg.gain.value = send; g.connect(sg).connect(verb); }
  for (const f of freqs) for (const d of [-7, 7]) {
    const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = d;
    o.connect(lp); o.start(at); o.stop(at + dur + 0.05);
  }
}
/** Sub "drop" + filtered crash — the physical hit under big wins. */
function impact(at: number, gain: number, crash = 0.08) {
  voice(150, at, 0.7, gain, 'sine', 0, 38);
  voice(75, at, 1.1, gain * 0.6, 'sine', 0.1, 42);
  noiseBurst(at, 0.9, crash, 5000, 1400, 0.6);
}
/** Ghostly formant wail (saw → two band-passes) gliding between two pitches, with vibrato. */
function wail(at: number, dur: number, f0: number, f1: number, gain: number) {
  const c = ctx!, o = c.createOscillator(), lfo = c.createOscillator(), lg = c.createGain(), g = c.createGain();
  o.type = 'sawtooth'; o.frequency.setValueAtTime(f0, at); o.frequency.exponentialRampToValueAtTime(f1, at + dur);
  lfo.frequency.value = 5.5; lg.gain.value = 9; lfo.connect(lg).connect(o.frequency);
  g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(gain, at + dur * 0.3); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  for (const [f, q, v] of [[750, 7, 1], [1150, 9, 0.6]] as const) {
    const bp = c.createBiquadFilter(), bg = c.createGain(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q; bg.gain.value = v;
    o.connect(bp).connect(bg).connect(g);
  }
  g.connect(out!); if (verb) { const sg = c.createGain(); sg.gain.value = 0.7; g.connect(sg).connect(verb); }
  o.start(at); lfo.start(at); o.stop(at + dur + 0.05); lfo.stop(at + dur + 0.05);
}

export const sfx = {
  /**
   * speed: 0..1 (normalised reel velocity); progress 0..1 of the spin.
   * Fast = bright glassy clicks; as the reel slows the ticks climb a pentatonic
   * ladder and get a little louder — the "will it stop here?" tension.
   */
  tick(speed = 0.5, progress = 0) {
    if (!live()) return;
    const c = ctx!, at = c.currentTime + 0.012;
    const minGap = 0.045 + (1 - speed) * 0.01;
    if (at - lastTickAt < minGap) return;
    lastTickAt = at;
    const slow = speed < 0.45;
    const step = Math.min(LADDER.length - 1, Math.floor(Math.pow(Math.max(0, progress), 1.6) * LADDER.length));
    const f = slow ? LADDER[step] * 2 : 1500 + speed * 900 + (Math.random() - 0.5) * 40;
    const v = 0.03 + (1 - speed) * 0.035;
    voice(f, at, 0.09 + (1 - speed) * 0.08, v, 'sine', slow ? 0.35 : 0.2);
    voice(f * 2.76, at, 0.05, v * 0.32, 'sine');                       // glassy inharmonic partial
    noiseBurst(at, 0.018, v * 0.5, 6000, 4000, 0.9);                    // tiny mechanical click
  },
  charge(ms: number) {
    if (!live()) return;
    const at = ctx!.currentTime + 0.01, d = ms / 1000;
    voice(220, at, d, 0.035, 'triangle', 0.3, 660);
    voice(55, at, d + 0.1, 0.06, 'sine', 0, 82);                       // sub rumble building up
    noiseBurst(at, d, 0.03, 600, 3200, 2);
    wail(at + d * 0.2, d * 0.9, 330, 520, 0.018);                       // distant ghost "oooh"
  },
  burst() {
    if (!live()) return;
    const at = ctx!.currentTime + 0.005;
    voice(110, at, 0.45, 0.16, 'sine', 0, 48);                         // soft thump
    noiseBurst(at, 0.5, 0.07, 3500, 900, 0.8);                         // airy pop
    [N.C6, N.G6, N.C7].forEach((f, i) => voice(f, at + 0.03 + i * 0.03, 0.6, 0.02, 'sine', 0.6));
  },
  /** Spooky-neon launch: noise sweep + ghost wail glide + a zappy neon downsweep. */
  whoosh() {
    if (!live()) return;
    const at = ctx!.currentTime + 0.01;
    noiseBurst(at, 0.6, 0.09, 400, 3200, 1.4);
    wail(at, 0.75, 260, 720, 0.03);
    voice(2400, at + 0.02, 0.28, 0.018, 'square', 0.3, 300);           // neon "zzip"
  },
  /** Gentle ascending riser; returns stop() (called on land/skip). */
  riser(sec: number) {
    if (!live()) return () => {};
    const c = ctx!, at = c.currentTime + 0.01;
    const o = c.createOscillator(), g = c.createGain(), lp = c.createBiquadFilter();
    o.type = 'triangle'; o.frequency.setValueAtTime(N.C5 / 2, at); o.frequency.exponentialRampToValueAtTime(N.G5, at + sec);
    lp.type = 'lowpass'; lp.frequency.setValueAtTime(900, at); lp.frequency.exponentialRampToValueAtTime(4200, at + sec);
    g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.03, at + sec);
    o.connect(lp).connect(g).connect(out!);
    const s = c.createGain(); s.gain.value = 0.4; g.connect(s).connect(verb!);
    o.start(at); o.stop(at + sec + 0.3);
    const n = noiseBurst(at, sec + 0.05, 0.02, 1500, 7000, 3);
    return () => {
      const t = c.currentTime;
      try { g.gain.cancelScheduledValues(t); g.gain.setTargetAtTime(0.0001, t, 0.03); n.g.gain.cancelScheduledValues(t); n.g.gain.setTargetAtTime(0.0001, t, 0.03); } catch { /* ended */ }
    };
  },
  /** "Lub-dub" heartbeat thump used while the reel crawls to a stop. */
  heartbeat(strength = 1) {
    if (!live()) return;
    const at = ctx!.currentTime + 0.005, v = 0.11 * strength;
    voice(70, at, 0.16, v, 'sine', 0, 45);
    voice(62, at + 0.17, 0.2, v * 0.75, 'sine', 0, 40);
  },
  /** Near-miss: a descending "wah-wah" tease (the jackpot was one cell away). */
  nearMiss() {
    if (!live()) return;
    const at = ctx!.currentTime + 0.05;
    voice(N.E5, at, 0.32, 0.04, 'triangle', 0.4, N.D5);
    voice(N.D5 * 0.94, at + 0.3, 0.6, 0.04, 'triangle', 0.5, N.C5 * 0.82);
    wail(at + 0.05, 0.8, 520, 300, 0.012);
  },
  /** Land stinger by rarity rank 0..4 (big = NFT/Premium jackpot on top of mythic). */
  land(rank: number, big = false) {
    if (!live()) return;
    const at = ctx!.currentTime + 0.01;
    if (rank <= 0) {                                                     // common: soft glass pluck
      voice(N.G5, at, 0.4, 0.05, 'triangle', 0.35); voice(N.C6, at + 0.06, 0.5, 0.035, 'sine', 0.45);
      return;
    }
    if (rank === 1) {                                                    // rare: quick neon arp
      [N.C5, N.E5, N.G5, N.C6].forEach((f, i) => voice(f, at + i * 0.06, 0.6, 0.045, 'triangle', 0.45));
      voice(N.G6, at + 0.26, 0.6, 0.02, 'sine', 0.8);
      return;
    }
    const arp = rank === 2 ? [N.D5, N.G5, N.A5, N.D6, N.G6] : [N.C5, N.E5, N.G5, N.C6, N.E6, N.G6, N.C7];
    arp.forEach((f, i) => voice(f, at + 0.05 + i * (rank >= 3 ? 0.05 : 0.065), 0.8 + rank * 0.2, 0.04, 'triangle', 0.5));
    // sparkle shimmer: random high bells
    const count = rank >= 3 ? 16 : 7, span = rank >= 3 ? 1.6 : 0.7;
    const hi = [N.C6, N.D6, N.E6, N.G6, N.A6, N.C7];
    for (let i = 0; i < count; i++) voice(hi[(Math.random() * hi.length) | 0], at + 0.15 + Math.random() * span, 0.35, 0.016, 'sine', 0.8);
    if (rank === 2) { pad([N.D5 / 2, N.A5 / 2, N.D5], at, 1.0, 0.025, 500, 1800); return; }
    // legendary+: physical hit + brassy stab
    impact(at, rank >= 4 ? 0.2 : 0.14, rank >= 4 ? 0.1 : 0.06);
    pad([N.C5 / 2, N.G5 / 2, N.C5, N.E5], at, rank >= 4 ? 1.6 : 1.1, rank >= 4 ? 0.05 : 0.04, 700, 3200, 0.02);
    if (rank >= 4 || big) {
      // mythic / jackpot: ghost choir swell + rising fanfare + bell tail
      pad([N.C5 / 2, N.E5 / 2, N.G5 / 2, N.C5], at + 0.25, 2.6, 0.035, 400, 1500, 0.6, 0.8);
      wail(at + 0.2, 1.8, 390, 520, 0.02);
      [N.G5, N.C6, N.E6, N.G6, N.C7].forEach((f, i) => voice(f, at + 0.55 + i * 0.09, 1.2, 0.04, 'triangle', 0.6));
      [N.C7, N.G6, N.E6].forEach((f, i) => voice(f, at + 1.25 + i * 0.18, 1.6, 0.02, 'sine', 0.9));
      if (big) impact(at + 0.5, 0.12, 0.05);                              // second hit for NFT/Premium
    }
  },
  /** Soft "clack" when the reel locks onto the winner (before the reveal). */
  settle() {
    if (!live()) return;
    const at = ctx!.currentTime + 0.005;
    noiseBurst(at, 0.04, 0.05, 3000, 1500, 1.2);
    voice(N.G6, at, 0.18, 0.04, 'sine', 0.3); voice(N.E6, at + 0.05, 0.25, 0.035, 'sine', 0.4);
  },
  /** Reveal = full stinger scaled by rarity. */
  reveal(rank: number, big = false) { this.land(Math.min(4, rank), big); },
};
