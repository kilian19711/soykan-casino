import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../auth/AuthProvider';
import { formatCredits, formatDateTime, formatSigned, shortId } from '../../lib/format';
import { toAppError } from '../../lib/errors';
import { Button } from '../../components/Button';
import { Modal } from '../../components/Modal';
import { EmptyState, ErrorState, PageLoading, StatusBadge } from '../../components/ui';
import { IconHistory } from '../../components/Icons';
import { useGameConfigs } from '../games/shared';
import type { GameRoundRow } from '../../types';

const PAGE = 30;

export function RoundDetailModal({ round, gameName, onClose }: { round: GameRoundRow | null; gameName: string; onClose: () => void }) {
  if (!round) return null;
  const seed = (round.result as { server_seed?: string }).server_seed;
  const publicResult = { ...round.result };
  delete (publicResult as Record<string, unknown>).server_seed;
  return (
    <Modal open onClose={onClose} title={`${gameName} · Runde ${shortId(round.id)}`}>
      <dl className="kv">
        <dt>Status</dt>
        <dd>
          <StatusBadge status={round.status} />
        </dd>
        <dt>Gestartet</dt>
        <dd>{formatDateTime(round.started_at)}</dd>
        <dt>Abgeschlossen</dt>
        <dd>{formatDateTime(round.completed_at)}</dd>
        <dt>Einsatz</dt>
        <dd>{formatCredits(round.bet_amount)} Credits</dd>
        <dt>Auszahlung</dt>
        <dd>{formatCredits(round.payout_amount)} Credits</dd>
        <dt>Ergebnis</dt>
        <dd className={round.profit_amount > 0 ? 'success' : ''}>{formatSigned(round.profit_amount)} Credits</dd>
        <dt>Runden-ID</dt>
        <dd className="small">{round.id}</dd>
      </dl>
      <details style={{ marginTop: 14 }}>
        <summary className="small subtle" style={{ cursor: 'pointer' }}>
          Fairness-Nachweis
        </summary>
        <div className="stack small" style={{ marginTop: 8 }}>
          <p className="muted">
            Das Ergebnis stand schon vor deinem Einsatz fest und konnte danach nicht mehr verändert werden. Mit den beiden Codes unten lässt sich das
            jederzeit nachprüfen.
          </p>
          <div>
            <span className="muted">Code vor der Runde:</span> <code style={{ overflowWrap: 'anywhere' }}>{round.server_seed_hash}</code>
          </div>
          {seed && (
            <div>
              <span className="muted">Code nach der Runde:</span> <code style={{ overflowWrap: 'anywhere' }}>{seed}</code>
            </div>
          )}
          <pre className="card-flat mono" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 11, maxHeight: 220, overflow: 'auto' }}>
            {JSON.stringify(publicResult, null, 2)}
          </pre>
        </div>
      </details>
    </Modal>
  );
}

export function HistoryPage() {
  const { session } = useAuth();
  const { configs } = useGameConfigs();
  const [params, setParams] = useSearchParams();
  const [game, setGame] = useState('');
  const [rounds, setRounds] = useState<GameRoundRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [detail, setDetail] = useState<GameRoundRow | null>(null);
  const uid = session?.user.id;
  const nameOf = (key: string) => configs?.find((c) => c.game_key === key)?.display_name ?? key;

  const load = useCallback(async () => {
    if (!uid) return;
    try {
      const list = await api.getMyRounds(uid, game || undefined, PAGE, 0);
      setRounds(list);
      setHasMore(list.length === PAGE);
      setError(null);
    } catch (e) {
      setError(toAppError(e).message);
    }
  }, [uid, game]);

  useEffect(() => {
    void load();
  }, [load]);

  // Direkter Link auf eine Runde (aus dem Gewinn-Pop-up)
  useEffect(() => {
    const id = params.get('runde');
    if (!id) return;
    api
      .getRound(id)
      .then((r) => r && setDetail(r))
      .catch(() => undefined);
  }, [params]);

  const more = async () => {
    if (!uid || !rounds) return;
    setLoadingMore(true);
    try {
      const list = await api.getMyRounds(uid, game || undefined, PAGE, rounds.length);
      setRounds([...rounds, ...list]);
      setHasMore(list.length === PAGE);
    } finally {
      setLoadingMore(false);
    }
  };

  const played = (configs ?? []).filter((c) => c.config.implemented);
  const sumBet = (rounds ?? []).reduce((s, r) => s + r.bet_amount, 0);
  const sumProfit = (rounds ?? []).reduce((s, r) => s + (r.status === 'settled' ? r.profit_amount : 0), 0);

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <h1>Spielhistorie</h1>
          <p>Deine eigenen Spielrunden – nur für dich sichtbar.</p>
        </div>
        <div className="field" style={{ minWidth: 200 }}>
          <label htmlFor="hist-game">Spiel</label>
          <select id="hist-game" className="select" value={game} onChange={(e) => setGame(e.target.value)}>
            <option value="">Alle Spiele</option>
            {played.map((c) => (
              <option key={c.game_key} value={c.game_key}>
                {c.display_name}
              </option>
            ))}
          </select>
        </div>
      </div>
      {rounds && rounds.length > 0 && (
        <div className="grid-4">
          <div className="card-flat">
            <div className="label">Runden (geladen)</div>
            <div className="stat-value" style={{ fontSize: 20 }}>{rounds.length}</div>
          </div>
          <div className="card-flat">
            <div className="label">Einsätze</div>
            <div className="stat-value" style={{ fontSize: 20 }}>{formatCredits(sumBet)}</div>
          </div>
          <div className="card-flat">
            <div className="label">Ergebnis</div>
            <div className={`stat-value ${sumProfit >= 0 ? 'success' : 'danger'}`} style={{ fontSize: 20 }}>
              {formatSigned(sumProfit)}
            </div>
          </div>
          <div className="card-flat">
            <div className="label">Gewonnen</div>
            <div className="stat-value" style={{ fontSize: 20 }}>
              {rounds.filter((r) => r.profit_amount > 0).length}
            </div>
          </div>
        </div>
      )}
      {error && <ErrorState message={error} onRetry={() => void load()} />}
      {!rounds && !error && <PageLoading />}
      {rounds &&
        (rounds.length ? (
          <div className="table-wrap">
            <table className="table responsive">
              <thead>
                <tr>
                  <th>Zeitpunkt</th>
                  <th>Spiel</th>
                  <th>Runde</th>
                  <th className="num">Einsatz</th>
                  <th className="num">Auszahlung</th>
                  <th className="num">Ergebnis</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rounds.map((r) => (
                  <tr key={r.id}>
                    <td data-label="Zeitpunkt" className="small">
                      {formatDateTime(r.started_at)}
                    </td>
                    <td data-label="Spiel">{nameOf(r.game_key)}</td>
                    <td data-label="Runde" className="mono small">
                      {shortId(r.id)}
                    </td>
                    <td data-label="Einsatz" className="num">
                      {formatCredits(r.bet_amount)}
                    </td>
                    <td data-label="Auszahlung" className="num">
                      {r.status === 'active' ? '–' : formatCredits(r.payout_amount)}
                    </td>
                    <td data-label="Ergebnis" className={`num ${r.profit_amount > 0 ? 'success' : ''}`}>
                      {r.status === 'active' ? <StatusBadge status="active" /> : formatSigned(r.profit_amount)}
                    </td>
                    <td>
                      <Button size="sm" variant="ghost" onClick={() => setDetail(r)}>
                        Details
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="card">
            <EmptyState icon={<IconHistory size={30} />} title="Keine Runden gefunden" text="Gespielte Runden erscheinen hier mit Einsatz, Auszahlung und Runden-ID." />
          </div>
        ))}
      {hasMore && (
        <Button onClick={() => void more()} loading={loadingMore}>
          Mehr laden
        </Button>
      )}
      <RoundDetailModal
        round={detail}
        gameName={detail ? nameOf(detail.game_key) : ''}
        onClose={() => {
          setDetail(null);
          if (params.get('runde')) setParams({}, { replace: true });
        }}
      />
    </div>
  );
}
