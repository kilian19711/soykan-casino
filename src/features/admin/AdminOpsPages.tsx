import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { toAppError } from '../../lib/errors';
import { formatCredits, formatDateTime, formatPlaytime, formatSigned, formatWeekKey, relativeTime, shortId } from '../../lib/format';
import { useAppData } from '../../app/AppData';
import { Button } from '../../components/Button';
import { useToast } from '../../components/Toast';
import { Avatar, Countdown, EmptyState, ErrorState, PageLoading, StatusBadge } from '../../components/ui';
import { AdjustCreditsForm, ReasonDialog, useAdminUsers } from './adminShared';
import { LedgerTable } from '../wallet/WalletPage';
import { RoundDetailModal } from '../history/HistoryPage';
import { invalidateGameConfigs, useGameConfigs } from '../games/shared';
import { useLeaderboard } from '../leaderboard/LeaderboardPage';
import type { AuditLog, CreditRequest, GameConfig, GameRoundRow, LedgerEntry } from '../../types';

// ---------------------------------------------------------------------------
export function AdminRequests() {
  const { requestsVersion } = useAppData();
  const { nameOf, reload: reloadUsers } = useAdminUsers();
  const toast = useToast();
  const [items, setItems] = useState<CreditRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'pending' | 'all'>('pending');
  const [reject, setReject] = useState<CreditRequest | null>(null);
  const [approving, setApproving] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await api.admin.creditRequests(tab === 'pending' ? 'pending' : undefined));
      setError(null);
    } catch (e) {
      setError(toAppError(e).message);
    }
  }, [tab]);
  useEffect(() => {
    void load();
  }, [load, requestsVersion]);

  const approve = async (r: CreditRequest) => {
    setApproving(r.id);
    try {
      await api.admin.reviewRequest(r.id, true, null);
      toast.success('Anfrage genehmigt', `+${formatCredits(r.amount)} Credits für ${nameOf(r.user_id)}`);
      await Promise.all([load(), reloadUsers()]);
    } catch (e) {
      toast.error('Genehmigung fehlgeschlagen', toAppError(e).message);
    } finally {
      setApproving(null);
    }
  };

  return (
    <div className="stack-lg">
      <div className="page-head">
        <h1>Credit-Anfragen</h1>
        <div className="segmented" role="group" aria-label="Filter">
          <button type="button" aria-pressed={tab === 'pending'} onClick={() => setTab('pending')}>
            Offen
          </button>
          <button type="button" aria-pressed={tab === 'all'} onClick={() => setTab('all')}>
            Alle
          </button>
        </div>
      </div>
      {error && <ErrorState message={error} onRetry={() => void load()} />}
      {!items && !error && <PageLoading />}
      {items &&
        (items.length ? (
          <div className="stack">
            {items.map((r) => (
              <article key={r.id} className="card stack" style={{ gap: 8 }}>
                <div className="row-between wrap">
                  <div className="row">
                    <Avatar name={nameOf(r.user_id)} size={32} />
                    <strong>{nameOf(r.user_id)}</strong>
                    <span className="stat-value" style={{ fontSize: 20 }}>
                      {formatCredits(r.amount)} Credits
                    </span>
                    <StatusBadge status={r.status} />
                  </div>
                  <span className="small muted">{formatDateTime(r.created_at)}</span>
                </div>
                <p className="subtle" style={{ overflowWrap: 'anywhere' }}>
                  {r.message}
                </p>
                {r.review_message && <p className="small muted">Antwort: {r.review_message}</p>}
                {r.status === 'pending' && (
                  <div className="row">
                    <Button variant="success" size="sm" loading={approving === r.id} onClick={() => void approve(r)}>
                      Genehmigen
                    </Button>
                    <Button variant="danger" size="sm" onClick={() => setReject(r)} disabled={approving === r.id}>
                      Ablehnen
                    </Button>
                  </div>
                )}
              </article>
            ))}
          </div>
        ) : (
          <div className="card">
            <EmptyState title={tab === 'pending' ? 'Keine offenen Anfragen' : 'Keine Anfragen'} />
          </div>
        ))}
      <ReasonDialog
        open={!!reject}
        title="Anfrage ablehnen"
        description={reject ? `${nameOf(reject.user_id)} · ${formatCredits(reject.amount)} Credits. Der Grund wird dem Benutzer angezeigt.` : ''}
        variant="danger"
        confirmLabel="Ablehnen"
        onClose={() => setReject(null)}
        onConfirm={async (reason) => {
          if (!reject) return;
          await api.admin.reviewRequest(reject.id, false, reason);
          toast.info('Anfrage abgelehnt');
          await load();
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
export function AdminAdjustments() {
  const { users, nameOf, reload } = useAdminUsers();
  const [entries, setEntries] = useState<LedgerEntry[] | null>(null);
  const load = useCallback(() => {
    api.admin.ledger(undefined, ['admin_credit', 'admin_debit', 'credit_request'], 100).then(setEntries).catch(() => setEntries([]));
  }, []);
  useEffect(() => load(), [load]);
  return (
    <div className="stack-lg">
      <h1>Credit-Anpassungen</h1>
      <div className="grid-2">
        <section className="card stack">
          <h2>Neue Buchung</h2>
          {users ? (
            <AdjustCreditsForm
              users={users.filter((u) => u.status !== 'deleted')}
              onDone={() => {
                void reload();
                load();
              }}
            />
          ) : (
            <PageLoading />
          )}
        </section>
        <section className="card stack">
          <h2>Hinweise</h2>
          <ul className="subtle small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.8 }}>
            <li>Jede Buchung erzeugt einen Ledger-Eintrag und einen Audit-Log-Eintrag.</li>
            <li>Der Kontostand kann nicht unter 0 fallen.</li>
            <li>Doppelte Absendungen werden über eine Idempotency-ID verhindert.</li>
            <li>Der Benutzer erhält eine Benachrichtigung.</li>
          </ul>
        </section>
      </div>
      <section className="stack">
        <h2>Letzte Admin-Buchungen</h2>
        {entries ? (
          entries.length ? (
            <LedgerTable entries={entries} showUser={nameOf} />
          ) : (
            <div className="card">
              <EmptyState title="Noch keine Admin-Buchungen" />
            </div>
          )
        ) : (
          <PageLoading />
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
export function AdminRounds() {
  const { users, nameOf } = useAdminUsers();
  const { configs } = useGameConfigs();
  const [userId, setUserId] = useState('');
  const [game, setGame] = useState('');
  const [rounds, setRounds] = useState<GameRoundRow[] | null>(null);
  const [detail, setDetail] = useState<GameRoundRow | null>(null);
  useEffect(() => {
    setRounds(null);
    api.admin
      .rounds({ userId: userId || undefined, gameKey: game || undefined, limit: 150 })
      .then(setRounds)
      .catch(() => setRounds([]));
  }, [userId, game]);

  const totals = useMemo(() => {
    const s = (rounds ?? []).filter((r) => r.status === 'settled');
    return { bets: s.reduce((a, r) => a + r.bet_amount, 0), payouts: s.reduce((a, r) => a + r.payout_amount, 0) };
  }, [rounds]);

  return (
    <div className="stack-lg">
      <h1>Spielverläufe</h1>
      <div className="row wrap">
        <select className="select" style={{ width: 'auto' }} value={userId} onChange={(e) => setUserId(e.target.value)} aria-label="Benutzer filtern">
          <option value="">Alle Benutzer</option>
          {users?.map((u) => (
            <option key={u.id} value={u.id}>
              {u.display_name}
            </option>
          ))}
        </select>
        <select className="select" style={{ width: 'auto' }} value={game} onChange={(e) => setGame(e.target.value)} aria-label="Spiel filtern">
          <option value="">Alle Spiele</option>
          {configs
            ?.filter((c) => c.config.implemented)
            .map((c) => (
              <option key={c.game_key} value={c.game_key}>
                {c.display_name}
              </option>
            ))}
        </select>
      </div>
      <div className="grid-4">
        <div className="card-flat">
          <div className="label">Runden</div>
          <div className="stat-value" style={{ fontSize: 20 }}>{rounds?.length ?? '–'}</div>
        </div>
        <div className="card-flat">
          <div className="label">Einsätze</div>
          <div className="stat-value" style={{ fontSize: 20 }}>{formatCredits(totals.bets)}</div>
        </div>
        <div className="card-flat">
          <div className="label">Auszahlungen</div>
          <div className="stat-value" style={{ fontSize: 20 }}>{formatCredits(totals.payouts)}</div>
        </div>
        <div className="card-flat">
          <div className="label">Effektive Quote</div>
          <div className="stat-value" style={{ fontSize: 20 }}>{totals.bets ? `${((totals.payouts / totals.bets) * 100).toFixed(1)} %` : '–'}</div>
        </div>
      </div>
      {!rounds ? (
        <PageLoading />
      ) : rounds.length ? (
        <div className="table-wrap">
          <table className="table responsive">
            <thead>
              <tr>
                <th>Zeit</th>
                <th>Benutzer</th>
                <th>Spiel</th>
                <th>Runde</th>
                <th className="num">Einsatz</th>
                <th className="num">Ergebnis</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rounds.map((r) => (
                <tr key={r.id}>
                  <td data-label="Zeit" className="small">{formatDateTime(r.started_at)}</td>
                  <td data-label="Benutzer">{nameOf(r.user_id)}</td>
                  <td data-label="Spiel">{r.game_key}</td>
                  <td data-label="Runde" className="mono small">{shortId(r.id)}</td>
                  <td data-label="Einsatz" className="num">{formatCredits(r.bet_amount)}</td>
                  <td data-label="Ergebnis" className={`num ${r.profit_amount > 0 ? 'success' : ''}`}>
                    {r.status === 'active' ? 'offen' : formatSigned(r.profit_amount)}
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
          <EmptyState title="Keine Runden gefunden" />
        </div>
      )}
      <RoundDetailModal round={detail} gameName={detail?.game_key ?? ''} onClose={() => setDetail(null)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
export function AdminPlaytime() {
  const { users, nameOf } = useAdminUsers();
  const [sessions, setSessions] = useState<Awaited<ReturnType<typeof api.admin.sessions>> | null>(null);
  useEffect(() => {
    api.admin.sessions(150).then(setSessions).catch(() => setSessions([]));
  }, []);
  const sorted = [...(users ?? [])].sort((a, b) => b.playtime_seconds - a.playtime_seconds);
  return (
    <div className="stack-lg">
      <h1>Spielzeitübersicht</h1>
      <div className="table-wrap">
        <table className="table responsive">
          <thead>
            <tr>
              <th>Benutzer</th>
              <th className="num">Spielzeit gesamt</th>
              <th className="num">Runden</th>
              <th>Zuletzt aktiv</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((u) => (
              <tr key={u.id}>
                <td data-label="Benutzer">{u.display_name}</td>
                <td data-label="Spielzeit gesamt" className="num">{formatPlaytime(u.playtime_seconds)}</td>
                <td data-label="Runden" className="num">{u.rounds_count}</td>
                <td data-label="Zuletzt aktiv" className="small">{relativeTime(u.last_seen_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2>Letzte Sessions</h2>
      {!sessions ? (
        <PageLoading />
      ) : sessions.length ? (
        <div className="table-wrap">
          <table className="table responsive">
            <thead>
              <tr>
                <th>Benutzer</th>
                <th>Start</th>
                <th>Letzter Heartbeat</th>
                <th>Status</th>
                <th className="num">Dauer</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id}>
                  <td data-label="Benutzer">{nameOf(s.user_id)}</td>
                  <td data-label="Start" className="small">{formatDateTime(s.started_at)}</td>
                  <td data-label="Letzter Heartbeat" className="small">{relativeTime(s.last_heartbeat_at)}</td>
                  <td data-label="Status">
                    {s.ended_at ? <span className="badge">Beendet</span> : <span className="badge badge-success">Läuft</span>}
                  </td>
                  <td data-label="Dauer" className="num">{formatPlaytime(s.duration_seconds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card">
          <EmptyState title="Noch keine Sessions" />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
export function AdminWeek() {
  const { dashboard, refreshDashboard } = useAppData();
  const { nameOf } = useAdminUsers();
  const toast = useToast();
  const [results, setResults] = useState<Awaited<ReturnType<typeof api.getWeeklyResults>> | null>(null);
  const [snapshots, setSnapshots] = useState<Awaited<ReturnType<typeof api.admin.snapshots>> | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | 'previous' | 'current'>(null);

  const load = useCallback(async () => {
    const r = await api.getWeeklyResults(20).catch(() => []);
    setResults(r);
    if (r[0] && !selected) setSelected(r[0].week_key);
  }, [selected]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!selected) return;
    api.admin.snapshots(selected).then(setSnapshots).catch(() => setSnapshots([]));
  }, [selected]);

  return (
    <div className="stack-lg">
      <h1>Abrechnung (alle 3 Wochen)</h1>
      <div className="grid-2">
        <section className="card stack">
          <div className="label">Aktuelle {formatWeekKey(dashboard?.week_key)}</div>
          {dashboard && <Countdown target={dashboard.week_end} className="stat-value gold" />}
          <p className="small subtle">
            Der Abschluss läuft automatisch per <strong>pg_cron</strong> (stündliche, idempotente Prüfung nach Rundenende). Die Schaltflächen sind ein manueller
            Fallback und ebenfalls idempotent – eine Runde kann nie doppelt abgerechnet werden.
          </p>
          <div className="row wrap">
            <Button onClick={() => setDialog('previous')}>Vorherige Runde abrechnen</Button>
            <Button variant="danger" onClick={() => setDialog('current')}>
              Aktuelle Runde vorzeitig abrechnen
            </Button>
          </div>
        </section>
        <section className="card stack">
          <div className="label">Gleichstandsregel</div>
          <ol className="small subtle" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.8 }}>
            <li>niedrigster Kontostand</li>
            <li>längere aktive Spielzeit der Runde</li>
            <li>frühester Zeitpunkt des Erreichens dieses Kontostands</li>
            <li>alphabetischer Benutzername</li>
          </ol>
          <p className="small muted">Der Rundenverlierer wird nicht finanziell bestraft – reine, private Kasten-Aufgabe.</p>
        </section>
      </div>
      <section className="stack">
        <h2>Abgerechnete Runden</h2>
        {!results ? (
          <PageLoading />
        ) : results.length ? (
          <div className="table-wrap">
            <table className="table responsive">
              <thead>
                <tr>
                  <th>Runde</th>
                  <th>Verlierer</th>
                  <th className="num">Kontostand</th>
                  <th>Aufgabe</th>
                  <th>Festgestellt</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.id} style={selected === r.week_key ? { background: 'rgba(243,201,105,.06)' } : undefined}>
                    <td data-label="Runde">{formatWeekKey(r.week_key)}</td>
                    <td data-label="Verlierer">{nameOf(r.loser_user_id)}</td>
                    <td data-label="Kontostand" className="num">{formatCredits(r.loser_balance)}</td>
                    <td data-label="Aufgabe">{r.task_label}</td>
                    <td data-label="Festgestellt" className="small">{formatDateTime(r.finalized_at)}</td>
                    <td>
                      <Button size="sm" variant="ghost" onClick={() => setSelected(r.week_key)}>
                        Snapshot
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="card">
            <EmptyState title="Noch keine Abrechnung" />
          </div>
        )}
      </section>
      {selected && snapshots && (
        <section className="stack">
          <h2>Snapshot {formatWeekKey(selected)}</h2>
          <div className="table-wrap">
            <table className="table responsive">
              <thead>
                <tr>
                  <th>Benutzer</th>
                  <th className="num">Kontostand</th>
                  <th className="num">Spielzeit (Runde)</th>
                </tr>
              </thead>
              <tbody>
                {snapshots.map((s) => (
                  <tr key={s.user_id}>
                    <td data-label="Benutzer">{nameOf(s.user_id)}</td>
                    <td data-label="Kontostand" className="num">{formatCredits(s.balance)}</td>
                    <td data-label="Spielzeit" className="num">{formatPlaytime(s.playtime_seconds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <ReasonDialog
        open={!!dialog}
        title={dialog === 'current' ? 'Aktuelle Runde vorzeitig abrechnen?' : 'Vorherige Runde abrechnen'}
        description={
          dialog === 'current'
            ? 'Achtung: Die laufende Runde wird jetzt abgerechnet und der Verlierer ermittelt. Die automatische Abrechnung dieser Runde entfällt dann.'
            : 'Rechnet die zuletzt beendete Runde ab, falls noch nicht geschehen.'
        }
        variant={dialog === 'current' ? 'danger' : 'primary'}
        confirmLabel="Abschließen"
        onClose={() => setDialog(null)}
        onConfirm={async (reason) => {
          const r = await api.admin.finalizeWeek(dialog === 'current', reason);
          if (r.already_finalized) toast.info('Bereits abgeschlossen', `${formatWeekKey(r.week_key)} war schon abgeschlossen.`);
          else toast.success('Runde abgerechnet', `${formatWeekKey(r.week_key)} · Verlierer: ${nameOf(r.loser_user_id)}`);
          setSelected(r.week_key);
          await load();
          await refreshDashboard();
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
export function AdminLeaderboard() {
  const { rows } = useLeaderboard();
  const { users } = useAdminUsers();
  if (!rows || !users) return <PageLoading />;
  return (
    <div className="stack-lg">
      <h1>Leaderboard-Details</h1>
      <div className="table-wrap">
        <table className="table responsive">
          <thead>
            <tr>
              <th>Rang</th>
              <th>Benutzer</th>
              <th className="num">Kontostand</th>
              <th className="num">Seit Abrechnung</th>
              <th className="num">Spielzeit</th>
              <th className="num">Runden</th>
              <th>Bonus</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.user_id}>
                <td data-label="Rang" className="mono">#{r.rank}</td>
                <td data-label="Benutzer">{r.display_name}</td>
                <td data-label="Kontostand" className="num gold">{formatCredits(r.balance)}</td>
                <td data-label="Seit Abrechnung" className="num">{r.week_change === null ? '–' : formatSigned(Number(r.week_change))}</td>
                <td data-label="Spielzeit" className="num">{formatPlaytime(r.playtime_seconds)}</td>
                <td data-label="Runden" className="num">{r.rounds_count}</td>
                <td data-label="Bonus">{r.bonus_claimed ? 'abgeholt' : 'offen'}</td>
                <td data-label="Status">
                  <StatusBadge status={users.find((u) => u.id === r.user_id)?.status ?? 'active'} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted">Eingeladene und gesperrte Benutzer erscheinen nicht im öffentlichen Leaderboard.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
export function AdminAudit() {
  const { nameOf } = useAdminUsers();
  const [logs, setLogs] = useState<AuditLog[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const load = useCallback(async () => {
    try {
      setLogs(await api.admin.audit(300));
    } catch (e) {
      setError(toAppError(e).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  if (error) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!logs) return <PageLoading />;
  const actions = Array.from(new Set(logs.map((l) => l.action))).sort();
  const shown = logs.filter((l) => !filter || l.action === filter);
  return (
    <div className="stack-lg">
      <div className="page-head">
        <h1>Audit-Log</h1>
        <select className="select" style={{ width: 'auto' }} value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Aktion filtern">
          <option value="">Alle Aktionen</option>
          {actions.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </div>
      {shown.length ? (
        <div className="table-wrap">
          <table className="table responsive">
            <thead>
              <tr>
                <th>Zeit</th>
                <th>Admin</th>
                <th>Aktion</th>
                <th>Ziel</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((l) => (
                <tr key={l.id}>
                  <td data-label="Zeit" className="small">{formatDateTime(l.created_at)}</td>
                  <td data-label="Admin">{nameOf(l.actor_id)}</td>
                  <td data-label="Aktion">
                    <span className="badge">{l.action}</span>
                  </td>
                  <td data-label="Ziel">{l.target_user_id ? nameOf(l.target_user_id) : '–'}</td>
                  <td data-label="Details" className="mono small subtle" style={{ overflowWrap: 'anywhere', maxWidth: 420 }}>
                    {JSON.stringify(l.metadata)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card">
          <EmptyState title="Keine Einträge" />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
function GameConfigRow({ game, onSaved }: { game: GameConfig; onSaved: () => void }) {
  const toast = useToast();
  const [min, setMin] = useState(String(game.config.min_bet));
  const [max, setMax] = useState(String(game.config.max_bet));
  const [pending, setPending] = useState<null | { enabled: boolean }>(null);
  const implemented = game.config.implemented === true;
  return (
    <tr>
      <td data-label="Spiel">
        <strong>{game.display_name}</strong>
        <br />
        <span className="small muted mono">{game.game_key}</span>
      </td>
      <td data-label="Status">
        {implemented ? (
          game.enabled ? <span className="badge badge-success">Aktiv</span> : <span className="badge">Deaktiviert</span>
        ) : (
          <span className="badge badge-warn">In Entwicklung</span>
        )}
      </td>
      <td data-label="Min">
        <input className="input mono" style={{ width: 100, minHeight: 36 }} value={min} onChange={(e) => setMin(e.target.value.replace(/\D/g, ''))} aria-label={`Mindesteinsatz ${game.display_name}`} />
      </td>
      <td data-label="Max">
        <input className="input mono" style={{ width: 110, minHeight: 36 }} value={max} onChange={(e) => setMax(e.target.value.replace(/\D/g, ''))} aria-label={`Höchsteinsatz ${game.display_name}`} />
      </td>
      <td>
        <div className="row">
          <Button size="sm" onClick={() => setPending({ enabled: game.enabled })}>
            Limits speichern
          </Button>
          {implemented && (
            <Button size="sm" variant={game.enabled ? 'danger' : 'success'} onClick={() => setPending({ enabled: !game.enabled })}>
              {game.enabled ? 'Deaktivieren' : 'Aktivieren'}
            </Button>
          )}
        </div>
        <ReasonDialog
          open={!!pending}
          title={`${game.display_name} ändern`}
          description={`Status: ${pending?.enabled ? 'aktiv' : 'deaktiviert'} · Limits ${min}–${max} Credits`}
          onClose={() => setPending(null)}
          onConfirm={async (reason) => {
            await api.admin.updateGameConfig(game.game_key, pending!.enabled, { ...game.config, min_bet: Number(min), max_bet: Number(max) }, reason);
            toast.success('Spiel aktualisiert');
            invalidateGameConfigs();
            onSaved();
          }}
        />
      </td>
    </tr>
  );
}

export function AdminGames() {
  const { configs, error, reload } = useGameConfigs();
  if (error) return <ErrorState message={error} onRetry={() => void reload()} />;
  if (!configs) return <PageLoading />;
  const sorted = [...configs].sort((a, b) => Number(b.config.implemented === true) - Number(a.config.implemented === true) || a.display_name.localeCompare(b.display_name));
  return (
    <div className="stack-lg">
      <h1>Spielverwaltung</h1>
      <p className="subtle small">Nur vollständig implementierte und getestete Spiele können aktiviert werden. Spiele „In Entwicklung" sind serverseitig gesperrt.</p>
      <div className="table-wrap">
        <table className="table responsive">
          <thead>
            <tr>
              <th>Spiel</th>
              <th>Status</th>
              <th>Min. Einsatz</th>
              <th>Max. Einsatz</th>
              <th>Aktionen</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((g) => (
              <GameConfigRow key={g.game_key} game={g} onSaved={() => void reload()} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
export function AdminSettings() {
  const toast = useToast();
  const { refreshDashboard } = useAppData();
  const [settings, setSettings] = useState<Record<string, unknown> | null>(null);
  const [bonus, setBonus] = useState('');
  const [maxWin, setMaxWin] = useState('');
  const [label, setLabel] = useState('');
  const [pending, setPending] = useState<null | { key: string; value: unknown; label: string }>(null);

  const load = useCallback(async () => {
    const list = await api.admin.settings();
    const map = Object.fromEntries(list.map((s) => [s.key, s.value]));
    setSettings(map);
    setBonus(String(map.daily_bonus_amount ?? 250));
    setMaxWin(String(map.max_win_per_round ?? 100000));
    setLabel(String(map.weekly_task_label ?? 'Kasten mitbringen'));
  }, []);
  useEffect(() => {
    void load().catch(() => setSettings({}));
  }, [load]);

  if (!settings) return <PageLoading />;
  return (
    <div className="stack-lg" style={{ maxWidth: 760 }}>
      <h1>Systemeinstellungen</h1>
      <section className="card stack">
        <h2>Tagesbonus</h2>
        <div className="field">
          <label htmlFor="set-bonus">Bonusbetrag pro Tag (Credits)</label>
          <input id="set-bonus" className="input mono" value={bonus} onChange={(e) => setBonus(e.target.value.replace(/\D/g, '').slice(0, 7))} />
          <span className="field-hint">0 deaktiviert den Bonus. Regel: einmal pro Kalendertag (00:00–23:59 Uhr, Europe/Berlin), nicht abgeholte Boni verfallen. Ankündigung um 0, 10 und 18 Uhr.</span>
        </div>
        <Button onClick={() => setPending({ key: 'daily_bonus_amount', value: Number(bonus), label: `Tagesbonus: ${formatCredits(Number(bonus))} Credits` })}>Speichern</Button>
      </section>
      <section className="card stack">
        <h2>Maximalgewinn</h2>
        <div className="field">
          <label htmlFor="set-maxwin">Maximaler Gewinn pro Runde (Credits)</label>
          <input id="set-maxwin" className="input mono" value={maxWin} onChange={(e) => setMaxWin(e.target.value.replace(/\D/g, '').slice(0, 9))} />
          <span className="field-hint">Wie bei echten Casinos: Mehr als Einsatz + dieser Betrag wird pro Runde nie ausgezahlt (gilt für alle Spiele). Höchsteinsätze pro Spiel unter „Spiele“.</span>
        </div>
        <Button onClick={() => setPending({ key: 'max_win_per_round', value: Number(maxWin), label: `Maximalgewinn: ${formatCredits(Number(maxWin))} Credits pro Runde` })}>Speichern</Button>
      </section>
      <section className="card stack">
        <h2>Kasten-Aufgabe</h2>
        <div className="field">
          <label htmlFor="set-label">Text der Aufgabe für den Letzten</label>
          <input id="set-label" className="input" maxLength={60} value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        <Button onClick={() => setPending({ key: 'weekly_task_label', value: label.trim(), label: `Kasten-Aufgabe: ${label.trim()}` })}>Speichern</Button>
      </section>
      <section className="card stack">
        <h2>Admin-Konto</h2>
        <p className="small subtle">
          Admin-E-Mail (Bootstrap): <span className="mono">{String(settings.admin_email ?? '–')}</span>. Es gibt genau einen Admin; die Rolle kann nicht über die
          Oberfläche vergeben werden.
        </p>
      </section>
      <ReasonDialog
        open={!!pending}
        title="Einstellung ändern"
        description={pending?.label}
        onClose={() => setPending(null)}
        onConfirm={async (reason) => {
          await api.admin.updateSetting(pending!.key, pending!.value, reason);
          toast.success('Einstellung gespeichert');
          await load();
          await refreshDashboard();
        }}
      />
    </div>
  );
}
