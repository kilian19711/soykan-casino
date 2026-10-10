import { useEffect, useRef } from 'react';
import { api } from '../../lib/api';
import { SIGN_OUT_EVENT } from '../auth/AuthProvider';

export const HEARTBEAT_MS = 30_000;
export const HIDDEN_END_MS = 60_000;
export const IDLE_END_MS = 10 * 60_000;

/** Nicht umkehrbarer Kurz-Hash des User-Agents (datenschutzfreundlich, kein Klartext). */
export function uaHash(ua = typeof navigator === 'undefined' ? '' : navigator.userAgent): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < ua.length; i++) {
    const c = ua.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

/**
 * Spielzeit-Tracking:
 * - Session beim authentifizierten Öffnen starten, Heartbeat alle ~30 s.
 * - Tab verborgen: Heartbeats pausieren; nach 60 s im Hintergrund Session beenden.
 * - Keine Eingabe für 10 min: Session beenden, bei nächster Interaktion neu starten.
 * - Server zählt pro Heartbeat max. 45 s und teilt eine offene Session über alle Tabs.
 */
export function usePlaytimeTracker(enabled: boolean) {
  const sessionId = useRef<string | null>(null);
  const interval = useRef<number | undefined>(undefined);
  const hiddenTimer = useRef<number | undefined>(undefined);
  const lastInput = useRef(Date.now());
  const starting = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;

    const stopInterval = () => {
      window.clearInterval(interval.current);
      interval.current = undefined;
    };

    const end = async () => {
      stopInterval();
      const id = sessionId.current;
      sessionId.current = null;
      if (id) await api.endSession(id).catch(() => undefined);
    };

    const beat = async () => {
      if (disposed) return;
      if (Date.now() - lastInput.current > IDLE_END_MS) {
        await end();
        return;
      }
      const id = sessionId.current;
      if (!id) return;
      const res = await api.heartbeat(id).catch(() => null);
      if (res && !res.ok) {
        sessionId.current = null;
        await start();
      }
    };

    const start = async () => {
      if (disposed || starting.current || sessionId.current || document.visibilityState !== 'visible') return;
      starting.current = true;
      try {
        sessionId.current = await api.startSession(uaHash());
        stopInterval();
        interval.current = window.setInterval(() => void beat(), HEARTBEAT_MS);
      } catch {
        sessionId.current = null;
      } finally {
        starting.current = false;
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        stopInterval();
        window.clearTimeout(hiddenTimer.current);
        hiddenTimer.current = window.setTimeout(() => void end(), HIDDEN_END_MS);
      } else {
        window.clearTimeout(hiddenTimer.current);
        lastInput.current = Date.now();
        if (sessionId.current) {
          void beat();
          stopInterval();
          interval.current = window.setInterval(() => void beat(), HEARTBEAT_MS);
        } else {
          void start();
        }
      }
    };

    const onInput = () => {
      const wasIdle = !sessionId.current;
      lastInput.current = Date.now();
      if (wasIdle && document.visibilityState === 'visible') void start();
    };

    const onSignOut = () => void end();

    void start();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener(SIGN_OUT_EVENT, onSignOut);
    const inputs: (keyof WindowEventMap)[] = ['pointerdown', 'keydown', 'touchstart', 'wheel'];
    inputs.forEach((e) => window.addEventListener(e, onInput, { passive: true }));

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener(SIGN_OUT_EVENT, onSignOut);
      inputs.forEach((e) => window.removeEventListener(e, onInput));
      window.clearTimeout(hiddenTimer.current);
      void end();
    };
  }, [enabled]);
}
