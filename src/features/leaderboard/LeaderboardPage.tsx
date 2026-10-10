import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../auth/AuthProvider';
import { useAppData } from '../../app/AppData';
import { formatCredits, formatPlaytime, formatSigned } from '../../lib/format';
import { toAppError } from '../../lib/errors';
import { Avatar, EmptyState, ErrorState, PageLoading } from '../../components/ui';
import { IconTrophy } from '../../components/Icons';
import type { LeaderboardRow } from '../../types';
import { StatusDot, usePresence } from '../../app/Presence';

/** Sortierung wie serverseitig: Kontostand absteigend, dann Benutzername. */
export function sortLeaderboard(rows: LeaderboardRow[]): LeaderboardRow[] {
  return [...rows].sort((a, b) => b.balance - a.balance || a.username.localeCompare(b.username));
}

function Medal({ rank }: { rank: number }) {
  const colors: Record<number, string> = { 1: '#f3c969', 2: '#cbd5e1', 3: '#d97706' };
  if (!colors[rank]) return <span className="mono subtle" style={{ width: 28, textAlign: 'center' }}>{rank}</span>;
  return (
    <span
      className="mono"
      aria-label={`Platz ${rank}`}
      style={{
        width: 28,
        height: 28,
        borderRadius: 14,
        display: 'grid',
        placeItems: 'center',
        fontWeight: 800,
        fontSize: 13,
        background: colors[rank],
        color: '#1a1205',
        flex: 'none',
      }}
    >
      {rank}
    </span>
  );
}

export function useLeaderboard() {
  const { leaderboardVersion } = useAppData();
  const [rows, setRows] = useState<LeaderboardRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      setRows(sortLeaderboard(await api.getLeaderboard()));
      setError(null);
    } catch (e) {
      setError(toAppError(e).message);
    }
  }, []);

  // Realtime-Änderungen bündeln (kein Flackern bei vielen schnellen Updates)
  useEffect(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void load(), leaderboardVersion ? 400 : 0);
    return () => window.clearTimeout(timer.current);
  }, [load, leaderboardVersion]);

  return { rows, error, reload: load };
}

export function LeaderboardPage() {
  const { profile } = useAuth();
  const { rows, error, reload } = useLeaderboard();
  const presence = usePresence();

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <h1>Leaderboard</h1>
          <p className="row" style={{ gap: 8 }}>
            <span className="live-dot" aria-hidden="true" /> Live nach aktuellem Kontostand
          </p>
        </div>
      </div>
      {error && <ErrorState message={error} onRetry={() => void reload()} />}
      {!rows && !error && <PageLoading />}
      {rows &&
        (rows.length ? (
          <div className="table-wrap">
            <table className="table responsive">
              <thead>
                <tr>
                  <th>Rang</th>
                  <th>Spieler</th>
                  <th className="num">Credits</th>
                  <th className="num">Seit Abrechnung</th>
                  <th className="num">Spielzeit</th>
                  <th className="num">Runden</th>
                  <th>Bonus</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const me = r.user_id === profile?.id;
                  return (
                    <tr key={r.user_id} style={me ? { background: 'rgba(79,142,247,.08)' } : undefined} aria-current={me ? 'true' : undefined}>
                      <td data-label="Rang">
                        <Medal rank={Number(r.rank)} />
                      </td>
                      <td data-label="Spieler">
                        <span className="row" style={{ gap: 10 }}>
                          <span style={{ position: 'relative', display: 'inline-flex' }}>
                            <Avatar name={r.display_name} seed={r.avatar_seed} size={32} />
                            <span style={{ position: 'absolute', right: -2, bottom: -2, lineHeight: 0, border: '2px solid var(--bg)', borderRadius: '50%' }}>
                              <StatusDot state={presence.find((p) => p.user_id === r.user_id)?.state ?? null} size={9} />
                            </span>
                          </span>
                          <span>
                            <strong>{r.display_name}</strong>
                            {me && <span className="badge badge-accent" style={{ marginLeft: 6 }}>Du</span>}
                            <br />
                            <span className="small muted">@{r.username}</span>
                          </span>
                        </span>
                      </td>
                      <td data-label="Credits" className="num gold" style={{ fontWeight: 700 }}>
                        {formatCredits(r.balance)}
                      </td>
                      <td data-label="Seit Abrechnung" className={`num ${r.week_change === null ? 'muted' : r.week_change >= 0 ? 'success' : 'danger'}`}>
                        {r.week_change === null ? '–' : formatSigned(Number(r.week_change))}
                      </td>
                      <td data-label="Spielzeit" className="num">
                        {formatPlaytime(r.playtime_seconds)}
                      </td>
                      <td data-label="Runden" className="num">
                        {formatCredits(Number(r.rounds_count))}
                      </td>
                      <td data-label="Bonus">
                        {r.bonus_claimed ? <span className="badge badge-success">Abgeholt</span> : <span className="badge">Offen</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="card">
            <EmptyState icon={<IconTrophy size={30} />} title="Noch keine aktiven Spieler" />
          </div>
        ))}
    </div>
  );
}
