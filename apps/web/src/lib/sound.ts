import { useSettings } from './settings';

/**
 * All sounds are synthesised with the Web Audio API — no audio files.
 * Dice: bursts of band-passed noise with a resonant "clack".
 * Checkers: a short pitched "tock" (wood) plus a lowpassed thump.
 */
let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;

function ac(): AudioContext | null {
  if (!useSettings.getState().sound) return null;
  if (!ctx) {
    const C = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!C) return null;
    ctx = new C();
    noise = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** Must be called from a user gesture once (iOS unlock). */
export function unlockAudio(): void {
  const c = ac();
  if (!c) return;
  const o = c.createOscillator();
  const g = c.createGain();
  g.gain.value = 0;
  o.connect(g).connect(c.destination);
  o.start();
  o.stop(c.currentTime + 0.01);
}

function noiseBurst(c: AudioContext, at: number, dur: number, freq: number, q: number, gain: number, type: BiquadFilterType = 'bandpass') {
  const src = c.createBufferSource();
  src.buffer = noise;
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(f).connect(g).connect(c.destination);
  src.start(at, Math.random() * 0.3, dur + 0.02);
}

function tone(c: AudioContext, at: number, f0: number, f1: number, dur: number, gain: number, type: OscillatorType = 'sine') {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, at);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), at + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(c.destination);
  o.start(at);
  o.stop(at + dur + 0.02);
}

/** One die hitting another die / the cup wall. */
export function clack(intensity = 1, delay = 0): void {
  const c = ac();
  if (!c) return;
  const at = c.currentTime + delay;
  const f = 2200 + Math.random() * 1800;
  noiseBurst(c, at, 0.035, f, 6, 0.35 * intensity);
  tone(c, at, f * 0.9, f * 0.7, 0.03, 0.06 * intensity, 'triangle');
}

/** Dice rolling across the board and settling. */
export function diceRoll(durationMs = 700): void {
  const c = ac();
  if (!c) return;
  const n = 7 + Math.floor(Math.random() * 4);
  let t = 0;
  const total = durationMs / 1000;
  for (let i = 0; i < n; i++) {
    const k = i / n;
    t += (total / n) * (0.4 + k * 1.2);
    clack(1 - k * 0.6, Math.min(t, total));
  }
  // Rolling texture underneath.
  noiseBurst(c, c.currentTime, total * 0.9, 900, 0.7, 0.05, 'lowpass');
}

/** Rattle inside the cup while the phone is shaken. */
export function cupShake(strength = 1): void {
  const c = ac();
  if (!c) return;
  clack(0.6 * strength);
  clack(0.45 * strength, 0.025 + Math.random() * 0.03);
  noiseBurst(c, c.currentTime, 0.08, 600, 1, 0.08 * strength, 'lowpass');
}

export function checkerPlace(): void {
  const c = ac();
  if (!c) return;
  const at = c.currentTime;
  tone(c, at, 420 + Math.random() * 60, 160, 0.09, 0.32);
  noiseBurst(c, at, 0.05, 700, 1.2, 0.18, 'lowpass');
}

export function checkerHit(): void {
  const c = ac();
  if (!c) return;
  const at = c.currentTime;
  tone(c, at, 520, 140, 0.12, 0.4);
  tone(c, at + 0.06, 380, 120, 0.12, 0.3);
  noiseBurst(c, at, 0.08, 1200, 1.5, 0.25);
}

export function bearOff(): void {
  const c = ac();
  if (!c) return;
  const at = c.currentTime;
  noiseBurst(c, at, 0.18, 3000, 0.8, 0.12, 'highpass');
  tone(c, at + 0.05, 660, 990, 0.12, 0.08, 'triangle');
}

export function chime(): void {
  const c = ac();
  if (!c) return;
  const at = c.currentTime;
  tone(c, at, 880, 880, 0.25, 0.08, 'sine');
  tone(c, at + 0.12, 1320, 1320, 0.35, 0.07, 'sine');
}

export function pop(): void {
  const c = ac();
  if (!c) return;
  tone(c, c.currentTime, 600, 1200, 0.06, 0.12, 'sine');
}

export function fanfare(win: boolean): void {
  const c = ac();
  if (!c) return;
  const at = c.currentTime;
  const notes = win ? [523, 659, 784, 1047] : [440, 392, 349, 294];
  notes.forEach((f, i) => tone(c, at + i * 0.14, f, f, 0.4, 0.12, 'triangle'));
}

export function vibrate(pattern: number | number[]): void {
  if (!useSettings.getState().vibration) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* unsupported */
  }
}
