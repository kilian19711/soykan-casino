// Live-Aktivitätsstatus über Supabase Realtime Presence (flüchtig, keine Speicherung in der Datenbank).
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../features/auth/AuthProvider';

export type ActivityState = 'playing' | 'online' | 'away';

export interface PresenceEntry {
  user_id: string;
  display_name: string;
  avatar_seed: string | null;
  state: ActivityState;
  game: string | null;
  since: string;
}

const PresenceContext = createContext<PresenceEntry[]>([]);

/** Leitet aus dem aktuellen Pfad das gespielte Spiel ab (/casino/roulette -> roulette). */
export function gameFromPath(path: string): string | null {
  const m = /^\/casino\/([a-z0-9_]+)/.exec(path);
  return m ? m[1] : null;
}

export function PresenceProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const location = useLocation();
  const [entries, setEntries] = useState<PresenceEntry[]>([]);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const [visible, setVisible] = useState(typeof document === 'undefined' || document.visibilityState === 'visible');
  const game = gameFromPath(location.pathname);
  const sinceRef = useRef<{ key: string; at: string }>({ key: '', at: new Date().toISOString() });
  const payloadRef = useRef<PresenceEntry | null>(null);

  useEffect(() => {
    const onVis = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  useEffect(() => {
    if (!profile) return;
    const channel = supabase.channel('presence:casino', { config: { presence: { key: profile.id } } });
    channelRef.current = channel;
    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState<PresenceEntry>();
      const list = Object.values(state)
        .map((metas) => metas[metas.length - 1])
        .filter((e): e is PresenceEntry & { presence_ref: string } => !!e?.user_id);
      setEntries(list);
    });
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED' && payloadRef.current) void channel.track(payloadRef.current);
    });
    return () => {
      channelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [profile]);

  useEffect(() => {
    if (!profile) return;
    const state: ActivityState = !visible ? 'away' : game ? 'playing' : 'online';
    const key = `${state}:${game ?? ''}`;
    if (sinceRef.current.key !== key) sinceRef.current = { key, at: new Date().toISOString() };
    const payload: PresenceEntry = {
      user_id: profile.id,
      display_name: profile.display_name,
      avatar_seed: profile.avatar_seed,
      state,
      game,
      since: sinceRef.current.at,
    };
    payloadRef.current = payload;
    // Ist der Kanal noch nicht verbunden, sendet der subscribe-Callback den Status
    const channel = channelRef.current;
    if (channel?.state === 'joined') void channel.track(payload);
  }, [profile, game, visible]);

  const sorted = useMemo(
    () => [...entries].sort((a, b) => rank(a.state) - rank(b.state) || a.display_name.localeCompare(b.display_name)),
    [entries],
  );
  return <PresenceContext.Provider value={sorted}>{children}</PresenceContext.Provider>;
}

function rank(s: ActivityState) {
  return s === 'playing' ? 0 : s === 'online' ? 1 : 2;
}

export function usePresence() {
  return useContext(PresenceContext);
}

export function usePresenceOf(userId: string | null | undefined) {
  return usePresence().find((p) => p.user_id === userId) ?? null;
}

export function StatusDot({ state, size = 10 }: { state: ActivityState | null; size?: number }) {
  const color = state === 'playing' ? 'var(--gold-bright)' : state === 'online' ? 'var(--success)' : state === 'away' ? 'var(--warn)' : 'var(--muted)';
  const label = state === 'playing' ? 'spielt gerade' : state === 'online' ? 'online' : state === 'away' ? 'abwesend' : 'offline';
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: '50%',
        background: color,
        boxShadow: state === 'playing' ? '0 0 8px rgba(243,201,105,.7)' : undefined,
        flex: 'none',
      }}
    />
  );
}
