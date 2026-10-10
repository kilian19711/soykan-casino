import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppData } from '../../app/AppData';
import { useAuth } from '../auth/AuthProvider';
import { api } from '../../lib/api';
import { formatCredits, formatDateTime, formatPlaytime, formatSigned, formatWeekKey, relativeTime } from '../../lib/format';
import { newIdempotencyKey, playTone, haptic } from '../../lib/misc';
import { toAppError } from '../../lib/errors';
import { Button, useAction } from '../../components/Button';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Avatar, Countdown, Credits, EmptyState, ErrorState, PageLoading } from '../../components/ui';
import { IconBox, IconClock, IconDice, IconGift, IconHistory, IconTrophy, IconWallet } from '../../components/Icons';
import { GameTile } from '../games/LobbyPage';
import { useGameConfigs } from '../games/shared';
import { ACTIVE_GAMES } from '../games/catalog';
import { ENTRY_LABELS } from '../wallet/WalletPage';
import type { GameRoundRow, LedgerEntry } from '../../types';
import { StatusDot, usePresence } from '../../app/Presence';
import { BigWinsFeed, WeekRecap } from '../social/Social';
import { useLeaderboard } from '../leaderboard/LeaderboardPage';
import { GameArt } from '../games/catalog';
import './dashboard.css';

function greeting() {
  // formatToParts: format() liefert auf Deutsch "14 Uhr" -> Number() wäre NaN
  const h = Number(
    new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Berlin' })
      .formatToParts(new Date())
      .find((p) => p.type === 'hour')?.value,
  );
  if (h >= 4 && h < 12) return 'Guten Morgen';
  if (h >= 12 && h < 18) return 'Guten Mittag';
  return 'Guten Abend';
}

export function WeeklyBonusModal({ open, amount, balance, nextAt, onClose }: { open: boolean; amount: number; balance: number; nextAt: string; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Tagesbonus abgeholt" className="win" footer={<Button variant="gold" onClick={onClose}>Super!</Button>}>
      <div className="stack center">
        <div className="result-amount gold">+{formatCredits(amount)} Credits</div>
        <p className="subtle">Dein neuer Kontostand: <strong className="mono">{formatCredits(balance)} Credits</strong></p>
        <p className="small muted">Nächster Bonus ab {formatDateTime(nextAt)}</p>
      </div>
    </Modal>
  );
}

export function DashboardPage() {
  const { profile, session, refreshProfile } = useAuth();
  const [feedBusy, setFeedBusy] = useState(false);
  const showFeed = profile?.preferences?.show_feed === true;
  const toggleFeed = async (on: boolean) => {
    setFeedBusy(true);
    try {
      await api.updatePreferences({ show_feed: on });
      await refreshProfile();
    } catch (e) {
      toast.error('Nicht gespeichert', toAppError(e).message);
    } finally {
      setFeedBusy(false);
    }
  };
  const { dashboard, dashboardError, refreshDashboard, balance, applyServerBalance, ledgerVersion } = useAppData();
  const toast = useToast();
  const { configs } = useGameConfigs();
  const [ledger, setLedger] = useState<LedgerEntry[] | null>(null);
  const [rounds, setRounds] = useState<GameRoundRow[] | null>(null);
  const [bonusModal, setBonusModal] = useState<{ amount: number; balance: number; next: string } | null>(null);
  const uid = session?.user.id;
  const presence = usePresence();
  const leaderboard = useLeaderboard();

  useEffect(() => {
    if (!uid) return;
    api.getLedger(uid, 6).then(setLedger).catch(() => setLedger([]));
    api.getMyRounds(uid, undefined, 40).then(setRounds).catch(() => setRounds([]));
  }, [uid, ledgerVersion]);

  const claim = useAction(async () => {
    try {
      const r = await api.claimWeeklyBonus(newIdempotencyKey('bonus'));
      applyServerBalance(r.balance);
      setBonusModal({ amount: r.amount, balance: r.balance, next: r.next_available_at });
      playTone('win');
      haptic(20);
      await refreshDashboard();
    } catch (e) {
      const err = toAppError(e);
      toast.error('Bonus nicht abgeholt', err.message);
      await refreshDashboard();
      throw err;
    }
  });

  if (dashboardError && !dashboard) return <ErrorState message={dashboardError} onRetry={() => void refreshDashboard()} />;
  if (!dashboard || !profile) return <PageLoading />;

  const d = dashboard;
  const last = d.last_weekly_result;
  const recentGames: { key: string; name: string; at: string }[] = [];
  for (const r of rounds ?? []) {
    const cfg = configs?.find((c) => c.game_key === r.game_key);
    if (!cfg?.enabled || recentGames.some((g) => g.key === r.game_key)) continue;
    recentGames.push({ key: r.game_key, name: cfg.display_name, at: r.started_at });
    if (recentGames.length === 3) break;
  }
  const popular = (configs ?? [])
    .filter((c) => c.enabled && c.config.implemented)
    .sort((a, b) => ACTIVE_GAMES.indexOf(a.game_key as never) - ACTIVE_GAMES.indexOf(b.game_key as never))
    .slice(0, 4);

  return (
    <div className="stack-lg">
      <section className="dash-head">
        <div className="row" style={{ gap: 14, minWidth: 0 }}>
          <Link to="/profil" aria-label="Profil öffnen" style={{ borderRadius: '50%', flex: 'none' }}>
            <Avatar name={profile.display_name} seed={profile.avatar_seed} size={52} />
          </Link>
          <div style={{ minWidth: 0 }}>
            <p className="subtle small">{greeting()},</p>
            <h1 className="truncate">{profile.display_name}</h1>
          </div>
        </div>
        <div className="dash-period" title={`Abrechnung am ${formatDateTime(d.week_end)}`}>
          <span className="label row" style={{ gap: 4 }}>
            <IconClock size={12} /> Abrechnung
          </span>
          <Countdown target={d.week_end} onDone={() => void refreshDashboard()} className="gold mono" />
        </div>
      </section>

      {recentGames.length > 0 && (
        <section aria-labelledby="recent-h">
          <div className="row-between" style={{ marginBottom: 8 }}>
            <h2 id="recent-h" className="label">
              Zuletzt gespielt
            </h2>
          </div>
          <div className="recent-games">
            {recentGames.map((g) => (
              <Link key={g.key} to={`/casino/${g.key}`} className="recent-game" aria-label={`${g.name} weiterspielen`}>
                <span className="art">
                  <GameArt gameKey={g.key} />
                </span>
                <span className="meta">
                  <strong className="truncate">{g.name}</strong>
                  <span className="small muted">{relativeTime(g.at)}</span>
                </span>
                <span className="play" aria-hidden="true">
                  ▶
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="grid-3">
        {/* 1. Kontostand */}
        <section className="card card-gold" aria-labelledby="bal-h">
          <div className="card-head">
            <span id="bal-h" className="label">
              Kontostand
            </span>
            <IconWallet size={18} />
          </div>
          <div className="stat-value xl gold">
            <Credits value={balance} />
          </div>
          <div className="row" style={{ marginTop: 14 }}>
            <Link to="/casino" className="btn btn-primary btn-sm">
              Spielen
            </Link>
            <Link to="/anfragen" className="btn btn-sm">
              Credits anfragen
            </Link>
          </div>
        </section>

        {/* 2. Tagesbonus */}
        <section className="card" aria-labelledby="bonus-h">
          <div className="card-head">
            <span id="bonus-h" className="label">
              Tagesbonus
            </span>
            <IconGift size={18} />
          </div>
          {d.bonus.claimed ? (
            <>
              <div className="row" style={{ gap: 8 }}>
                <span className="badge badge-success">Bonus bereits abgeholt</span>
              </div>
              <p className="subtle" style={{ marginTop: 10 }}>
                Nächster Bonus in{' '}
                <Countdown target={d.bonus.next_available_at} onDone={() => void refreshDashboard()} className="gold" />
              </p>
              <p className="small muted">ab {formatDateTime(d.bonus.next_available_at)}</p>
            </>
          ) : (
            <>
              <span className="badge badge-gold">Tagesbonus verfügbar</span>
              <div className="stat-value gold" style={{ marginTop: 10 }}>
                +{formatCredits(d.bonus.amount)} Credits
              </div>
              <Button
                variant="gold"
                block
                style={{ marginTop: 12 }}
                loading={claim.busy}
                feedback={claim.feedback}
                onClick={() => void claim.run().catch(() => undefined)}
              >
                +{formatCredits(d.bonus.amount)} Credits abholen
              </Button>
              <p className="small muted" style={{ marginTop: 6 }}>
                Einmal pro Tag · verfällt um Mitternacht
              </p>
            </>
          )}
        </section>

        {/* 3. Spielzeit */}
        <section className="card" aria-labelledby="play-h">
          <div className="card-head">
            <span id="play-h" className="label">
              Spielzeit
            </span>
            <IconClock size={18} />
          </div>
          <div className="stat-value">{formatPlaytime(d.playtime_week)}</div>
          <p className="small subtle">diese Woche</p>
          <p className="small muted" style={{ marginTop: 8 }}>
            Gesamt: <span className="mono">{formatPlaytime(d.playtime_total)}</span>
          </p>
        </section>

        {/* 4. Platzierung + Live-Leaderboard */}
        <section className="card" aria-labelledby="rank-h">
          <div className="card-head">
            <span id="rank-h" className="label">
              Deine Platzierung
            </span>
            <Link to="/leaderboard" className="small row" style={{ gap: 4 }}>
              <IconTrophy size={16} /> Alle
            </Link>
          </div>
          <div className="row" style={{ alignItems: 'baseline', gap: 8 }}>
            <div className="stat-value">{d.rank ? `#${d.rank}` : '–'}</div>
            <span className="small subtle">von {leaderboard.rows?.length ?? '…'} nach Kontostand</span>
          </div>
          <ol className="mini-board" aria-label="Leaderboard">
            {!leaderboard.rows
              ? [0, 1, 2].map((i) => <li key={i} className="skeleton" style={{ height: 34 }} />)
              : leaderboard.rows.map((row, i) => {
                  const p = presence.find((x) => x.user_id === row.user_id);
                  const lowest = i === leaderboard.rows!.length - 1 && leaderboard.rows!.length > 1;
                  return (
                    <li key={row.user_id} className={`${row.user_id === uid ? 'me' : ''} ${lowest ? 'lowest' : ''}`}>
                      <span className={`pos ${i < 3 ? `top${i + 1}` : ''}`}>{row.rank}</span>
                      <span className="who">
                        <Avatar name={row.display_name} seed={row.avatar_seed} size={26} />
                        {p && <StatusDot state={p.state} size={8} />}
                        <span className="truncate">{row.display_name}</span>
                        {lowest && <IconBox size={14} className="lowest-icon" role="img" aria-hidden={false} aria-label="trägt aktuell den Kasten" />}
                      </span>
                      <span className="mono bal">{formatCredits(row.balance)}</span>
                    </li>
                  );
                })}
          </ol>
        </section>

        {/* 5. Wochenaufgabe */}
        <section className="card task-card" aria-labelledby="loser-h">
          <div className="card-head">
            <span id="loser-h" className="label">
              Kasten-Aufgabe
            </span>
            <span className="small subtle row" style={{ gap: 4 }}>
              <IconClock size={14} /> <Countdown target={d.week_end} onDone={() => void refreshDashboard()} />
            </span>
          </div>
          <div className="task-hero">
            <span className="task-icon" aria-hidden="true">
              <IconBox size={30} />
            </span>
            <div>
              <div className="small">Am {formatDateTime(new Date(new Date(d.week_end).getTime() - 60000).toISOString())} muss der Letzte</div>
              <strong className="task-title">{d.task_label}</strong>
            </div>
          </div>
          {d.current_lowest ? (
            <div className="task-lowest">
              <Avatar name={d.current_lowest.display_name} seed={leaderboard.rows?.find((r) => r.user_id === d.current_lowest?.user_id)?.avatar_seed} size={38} />
              <div className="grow">
                <div className="label">Aktuell auf dem letzten Platz</div>
                <strong>{d.current_lowest.user_id === uid ? 'Du' : d.current_lowest.display_name}</strong>
              </div>
              <span className="mono">{formatCredits(d.current_lowest.balance)}</span>
            </div>
          ) : null}
          <div className="row wrap" style={{ marginTop: 12, gap: 8 }}>
            <Link to="/tipp" className="btn btn-sm btn-gold">
              Wer bringt ihn? Tippen
            </Link>
          </div>
          {last && (
            <p className="small muted" style={{ marginTop: 10 }}>
              {formatWeekKey(last.week_key)}: <strong className="subtle">{last.loser_display_name ?? 'Niemand'}</strong> ({formatCredits(last.loser_balance)} Credits) –{' '}
              {last.task_label}
            </p>
          )}
        </section>

        {/* 6. Letzte Transaktionen */}
        <section className="card" aria-labelledby="tx-h">
          <div className="card-head">
            <span id="tx-h" className="label">
              Letzte Transaktionen
            </span>
            <Link to="/wallet" className="small">
              Alle
            </Link>
          </div>
          {!ledger ? (
            <div className="skeleton" style={{ height: 120 }} />
          ) : ledger.length ? (
            <ul className="list">
              {ledger.map((e) => (
                <li key={e.id} className="list-item" style={{ padding: '8px 0' }}>
                  <div className="grow">
                    <div className="small truncate">{ENTRY_LABELS[e.entry_type] ?? e.entry_type}</div>
                    <div className="small muted">{relativeTime(e.created_at)}</div>
                  </div>
                  <span className={`mono ${e.amount > 0 ? 'success' : 'subtle'}`}>{formatSigned(e.amount)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="Noch keine Buchungen" text="Hol dir deinen Tagesbonus, um loszulegen." />
          )}
        </section>
      </div>

      {/* Live-Aktivität */}
      <section className="card" aria-labelledby="live-h">
        <div className="card-head">
          <h2 id="live-h" className="row" style={{ gap: 8 }}>
            <span className="live-dot" aria-hidden="true" /> Gerade aktiv
          </h2>
          <span className="small muted">{presence.length} online</span>
        </div>
        {presence.length ? (
          <ul className="list">
            {presence.map((p) => {
              const gameName = p.game ? (configs?.find((c) => c.game_key === p.game)?.display_name ?? p.game) : null;
              return (
                <li key={p.user_id} className="list-item">
                  <Avatar name={p.display_name} seed={p.avatar_seed} size={32} />
                  <div className="grow">
                    <strong className="small">
                      {p.display_name}
                      {p.user_id === uid && <span className="muted"> (du)</span>}
                    </strong>
                    <div className="small subtle row" style={{ gap: 6 }}>
                      <StatusDot state={p.state} size={8} />
                      {p.state === 'playing' ? `spielt ${gameName}` : p.state === 'away' ? 'abwesend' : 'online'}
                      <span className="muted">· seit {relativeTime(p.since).replace('vor ', '')}</span>
                    </div>
                  </div>
                  {p.state === 'playing' && p.game && p.user_id !== uid && (
                    <Link to={`/casino/${p.game}`} className="btn btn-sm">
                      Mitspielen
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState title="Gerade ist niemand online" />
        )}
      </section>

      {/* Live-Feed: nur wenn eingeschaltet */}
      {showFeed ? (
        <section className="card" aria-labelledby="feed-h">
          <div className="card-head">
            <h2 id="feed-h" className="row" style={{ gap: 8 }}>
              <span className="live-dot" aria-hidden="true" /> Große Gewinne (24 h)
            </h2>
            <Button size="sm" variant="ghost" loading={feedBusy} onClick={() => void toggleFeed(false)}>
              Ausblenden
            </Button>
          </div>
          <BigWinsFeed />
        </section>
      ) : (
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Button size="sm" variant="ghost" loading={feedBusy} onClick={() => void toggleFeed(true)}>
            Live-Feed großer Gewinne einblenden
          </Button>
        </div>
      )}

      {/* Wochen-Rückblick */}
      <section className="card" aria-labelledby="recap-h">
        <div className="card-head">
          <h2 id="recap-h">Wochen-Rückblick</h2>
        </div>
        <WeekRecap />
      </section>

      {/* 7. Beliebte Spiele */}
      <section className="stack">
        <div className="row-between">
          <h2>Beliebte Spiele</h2>
          <Link to="/casino" className="small">
            Zur Lobby
          </Link>
        </div>
        {popular.length ? (
          <div className="game-grid">
            {popular.map((g) => (
              <GameTile key={g.game_key} game={g} />
            ))}
          </div>
        ) : (
          <EmptyState icon={<IconDice size={28} />} title="Keine aktiven Spiele" />
        )}
      </section>

      {/* 8. Letzte Spielrunden */}
      <section className="card" aria-labelledby="rounds-h">
        <div className="card-head">
          <h2 id="rounds-h">Letzte Spielrunden</h2>
          <Link to="/historie" className="small">
            Spielhistorie
          </Link>
        </div>
        {!rounds ? (
          <div className="skeleton" style={{ height: 120 }} />
        ) : rounds.length ? (
          <ul className="list">
            {rounds.slice(0, 6).map((r) => (
              <li key={r.id} className="list-item">
                <div className="grow">
                  <strong className="small" style={{ textTransform: 'capitalize' }}>
                    {configs?.find((c) => c.game_key === r.game_key)?.display_name ?? r.game_key}
                  </strong>
                  <div className="small muted">{relativeTime(r.started_at)}</div>
                </div>
                <span className="small muted mono">{formatCredits(r.bet_amount)}</span>
                <span className={`mono ${r.profit_amount > 0 ? 'success' : 'subtle'}`} style={{ minWidth: 70, textAlign: 'right' }}>
                  {r.status === 'active' ? 'offen' : formatSigned(r.profit_amount)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={<IconHistory size={28} />}
            title="Noch keine Runden gespielt"
            action={
              <Link to="/casino" className="btn btn-primary btn-sm">
                Erstes Spiel starten
              </Link>
            }
          />
        )}
      </section>
      {bonusModal && (
        <WeeklyBonusModal open amount={bonusModal.amount} balance={bonusModal.balance} nextAt={bonusModal.next} onClose={() => setBonusModal(null)} />
      )}
    </div>
  );
}
