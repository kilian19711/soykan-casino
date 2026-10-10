import { loadPreferences } from './preferences';

/** Erzeugt eine eindeutige Idempotency-ID für genau eine Benutzeraktion. */
export function newIdempotencyKey(prefix = 'shb'): string {
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${id}`;
}

// ---------------------------------------------------------------------------
// Serverzeit: Countdowns basieren auf der Supabase-Serverzeit, nicht auf der Geräteuhr.
// ---------------------------------------------------------------------------
let offsetMs = 0;

/** Übernimmt einen Serverzeitpunkt; berücksichtigt die halbe Round-Trip-Zeit, falls bekannt. */
export function syncServerTime(serverIso: string, requestStartedAt?: number) {
  const now = Date.now();
  const latency = requestStartedAt ? (now - requestStartedAt) / 2 : 0;
  const parsed = new Date(serverIso).getTime();
  if (!Number.isNaN(parsed)) offsetMs = parsed + latency - now;
}

export function serverNow(): number {
  return Date.now() + offsetMs;
}

// ---------------------------------------------------------------------------
// Sound & Haptik (optional, abschaltbar, nur nach Benutzeraktion)
// ---------------------------------------------------------------------------
let audioCtx: AudioContext | null = null;

export function playTone(kind: 'win' | 'loss' | 'click' | 'bigwin') {
  if (!loadPreferences().sound) return;
  try {
    const AC =
      window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    audioCtx = audioCtx ?? new AC();
    const ctx = audioCtx;
    const notes =
      kind === 'bigwin' ? [523, 659, 784, 1046] : kind === 'win' ? [659, 880] : kind === 'loss' ? [220] : [440];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = kind === 'loss' ? 'sine' : 'triangle';
      osc.frequency.value = freq;
      const t = ctx.currentTime + i * 0.09;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.05, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.25);
    });
  } catch {
    /* Audio ist optional */
  }
}

export function haptic(pattern: number | number[] = 12) {
  if (!loadPreferences().haptics) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* optional */
  }
}

export function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
