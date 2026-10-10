// Synthetisierte Sounds für Shisha Diamonds (WebAudio, keine Audiodateien). Respektiert die Ton-Einstellung.
import { loadPreferences } from '../../../lib/preferences';

let ctx: AudioContext | null = null;
function ac(): AudioContext | null {
  if (!loadPreferences().sound) return null;
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = ctx ?? new AC();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, at: number, dur: number, type: OscillatorType, vol: number, slideTo?: number) {
  const c = ac();
  if (!c) return;
  const t = c.currentTime + at;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(at: number, dur: number, vol: number, from: number, to: number) {
  const c = ac();
  if (!c) return;
  const t = c.currentTime + at;
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.Q.value = 1.2;
  f.frequency.setValueAtTime(from, t);
  f.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.03);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(c.destination);
  src.start(t);
}

export const sd = {
  /** Walzen laufen an */
  spin: () => noise(0, 0.45, 0.05, 300, 1400),
  /** Walze stoppt: dumpfes Klacken */
  stop: (col: number) => {
    tone(150 - col * 6, 0, 0.12, 'sine', 0.12, 70);
    noise(0, 0.05, 0.04, 2500, 1800);
  },
  /** Stern (Scatter) gelandet: Glocke, je Stern höher */
  star: (n: number) => [0, 0.06].forEach((d, i) => tone(988 * Math.pow(1.26, n - 1) * (i ? 1.5 : 1), d, 0.5, 'triangle', 0.06)),
  /** Spannung auf den letzten Walzen */
  tension: () => tone(220, 0, 1.1, 'sawtooth', 0.02, 660),
  /** Gewinnlinie */
  win: (big: boolean) =>
    (big ? [523, 659, 784, 1047, 1319] : [659, 784, 988]).forEach((f, i) => tone(f, i * 0.08, 0.28, 'triangle', 0.07)),
  /** Diamant klebt fest */
  sticky: () => {
    tone(1568, 0, 0.35, 'sine', 0.06);
    tone(2349, 0.03, 0.4, 'sine', 0.04);
  },
  /** Freispiele starten: Fanfare */
  fanfare: () => {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.13, 0.35, 'square', 0.035));
    [1047, 1319, 1568].forEach((f) => tone(f, 0.6, 0.9, 'triangle', 0.05));
  },
  /** Karte wird aufgedeckt */
  flip: () => noise(0, 0.12, 0.06, 4000, 1200),
  gambleWin: () => [784, 1175].forEach((f, i) => tone(f, i * 0.1, 0.25, 'triangle', 0.08)),
  gambleLose: () => tone(330, 0, 0.5, 'sawtooth', 0.04, 110),
  /** Gewinn einsammeln: Münzregen */
  collect: () => Array.from({ length: 8 }, (_, i) => tone(1800 + (i % 3) * 400, i * 0.055, 0.12, 'square', 0.025)),
};
