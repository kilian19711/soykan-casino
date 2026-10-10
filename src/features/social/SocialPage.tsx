// Soziales: Duelle (Casino → Duelle), Credits verschenken (Wallet → Geschenk), Kasten-Tipp (Dashboard → Tippen).
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LIVE_GAMES, liveName } from './LiveDuel';
import { api, type DuelItem, type GiftItem, type PredictionState } from '../../lib/api';
import { useAuth } from '../auth/AuthProvider';
import { useAppData } from '../../app/AppData';
import { useLeaderboard } from '../leaderboard/LeaderboardPage';
import { useGameConfigs } from '../games/shared';
import { formatCredits, formatDateTime, relativeTime } from '../../lib/format';
import { newIdempotencyKey, haptic, playTone } from '../../lib/misc';
import { toAppError } from '../../lib/errors';
import { Button } from '../../components/Button';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Avatar, Countdown, EmptyState } from '../../components/ui';
import { IconArrowLeft, IconGift } from '../../components/Icons';
import { Card, Die } from '../games/visuals';
import { Choice } from '../games/engine';
import { GameArt } from '../games/catalog';
import './social.css';

const QUICK_LABEL: Record<string, string> = { coinflip: 'Münzwurf', dice: 'Würfel', highcard: 'Höchste Karte' };
/** Casino-Spiele, die sich für Spiel-Duelle eignen */
const MATCH_GAMES = ['dice', 'limbo', 'plinko', 'mines', 'crash', 'towers', 'blackjack', 'roulette', 'slots', 'shisha_diamonds', 'keno', 'wheel', 'hilo', 'pump', 'jackpot_slot'];

const duelTitle = (d: DuelItem) =>
  d.game === 'live' ? `Live: ${liveName(d.game_key)} · ${d.rounds} Runde${d.rounds === 1 ? '' : 'n'}` : d.game === 'match' ? `${d.game_name ?? d.game_key} · ${d.rounds} Runden` : QUICK_LABEL[d.game];

/** Auswahl eines Mitspielers */
function PlayerPicker({ value, onChange, disabled, includeSelf }: { value: string | null; onChange: (id: string) => void; disabled?: boolean; includeSelf?: boolean }) {
  const { session } = useAuth();
  const { rows } = useLeaderboard();
  if (!rows) return <div className="skeleton" style={{ height: 60 }} />;
  const players = rows.filter((r) => includeSelf || r.user_id !== session?.user.id);
  return (
    <div className="player-picker" role="radiogroup" aria-label="Spieler wählen">
      {players.map((p) => (
        <button key={p.user_id} type="button" role="radio" aria-checked={value === p.user_id} disabled={disabled} onClick={() => onChange(p.user_id)}>
          <Avatar name={p.display_name} seed={p.avatar_seed} size={40} />
          <span className="truncate small">{p.user_id === session?.user.id ? 'Ich' : p.display_name}</span>
        </button>
      ))}
    </div>
  );
}

function AmountInput({ value, onChange, presets, max, id, label = 'Einsatz (Credits)' }: { value: number; onChange: (v: number) => void; presets: number[]; max: number; id: string; label?: string }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} className="input mono" inputMode="numeric" value={value || ''} onChange={(e) => onChange(Math.min(max, Number(e.target.value.replace(/\D/g, '').slice(0, 7)) || 0))} />
      <div className="chip-group">
        {presets.filter((p) => p <= max).map((p) => (
          <button key={p} type="button" className="chip" aria-pressed={value === p} onClick={() => onChange(p)}>
            {formatCredits(p)}
          </button>
        ))}
      </div>
    </div>
  );
}

// ================================================================ Duelle
export function useMyDuels() {
  const { notificationsVersion } = useAppData();
  const [data, setData] = useState<{ max_stake: number; items: DuelItem[] } | null>(null);
  const load = useCallback(() => api.getMyDuels().then(setData).catch(() => setData({ max_stake: 5000, items: [] })), []);
  useEffect(() => {
    void load();
  }, [load, notificationsVersion]);
  return { data, reload: load };
}

/** Animiertes Ergebnis eines Sofort-Duells */
function QuickResult({ d, onClose }: { d: DuelItem; onClose: () => void }) {
  const r = d.result as Record<string, unknown>;
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setShow(true), 1200);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <Modal open onClose={onClose} title={`${QUICK_LABEL[d.game]} · ${formatCredits(d.stake)} Credits`} className={show && d.won ? 'win' : ''}
      footer={<Button variant={d.won ? 'gold' : 'primary'} onClick={onClose}>OK</Button>}>
      <div className="duel-board">
        {(['challenger', 'opponent'] as const).map((side, i) => (
          <div key={side} className="duel-side" style={{ gridColumn: i === 0 ? 1 : 3 }}>
            <Avatar name={side === 'challenger' ? d.challenger_name : d.opponent_name} seed={side === 'challenger' ? d.challenger_seed : d.opponent_seed} size={48} />
            <strong className="small">{side === 'challenger' ? d.challenger_name : d.opponent_name}</strong>
            {d.game === 'dice' && <div className="row">{((r[side] as number[]) ?? [1, 1]).map((v, k) => <Die key={k} value={v} rolling={!show} size={44} />)}</div>}
            {d.game === 'highcard' && <Card card={show ? Number(r[side]) : null} hidden={!show} />}
          </div>
        ))}
        <span className="duel-vs" style={{ gridColumn: 2, gridRow: 1 }}>VS</span>
      </div>
      {d.game === 'coinflip' && (
        <div className="duel-coin-wrap">
          <div className={`duel-coin ${show ? '' : 'spin'}`}>{show ? (r.coin === 'challenger' ? d.challenger_name[0] : d.opponent_name[0]) : ''}</div>
        </div>
      )}
      <div className="center" style={{ minHeight: 56 }}>
        {show && <div className={`stat-value ${d.won ? 'gold' : 'subtle'}`} style={{ fontSize: 30 }}>{d.won ? `Gewonnen! +${formatCredits(d.stake * 2)}` : 'Verloren'}</div>}
      </div>
    </Modal>
  );
}

/** Fortschritt eines laufenden Spiel-Duells */
function MatchProgress({ d }: { d: DuelItem }) {
  const me = d.mine ? 'c' : 'o';
  const rows = [
    { name: d.mine ? 'Du' : d.challenger_name, rounds: d.c_rounds ?? 0, quote: d.c_quote, mine: me === 'c' },
    { name: d.mine ? d.opponent_name : 'Du', rounds: d.o_rounds ?? 0, quote: d.o_quote, mine: me === 'o' },
  ];
  return (
    <div className="match-progress">
      {rows.map((x) => (
        <div key={x.name} className={`match-line ${x.mine ? 'me' : ''}`}>
          <span className="small truncate">{x.name}</span>
          <div className="q-bar">
            <span style={{ width: `${(x.rounds / (d.rounds ?? 1)) * 100}%` }} />
          </div>
          <span className="small mono">
            {x.rounds}/{d.rounds}
          </span>
          <span className="small mono gold">{x.quote != null ? `${x.quote} %` : '–'}</span>
        </div>
      ))}
    </div>
  );
}

function NewDuelDialog({ open, onClose, maxStake, onCreated }: { open: boolean; onClose: () => void; maxStake: number; onCreated: () => void }) {
  const toast = useToast();
  const { applyServerBalance } = useAppData();
  const { configs } = useGameConfigs();
  const [opp, setOpp] = useState<string | null>(null);
  const navigate = useNavigate();
  const [mode, setMode] = useState<'live' | 'match'>('live');
  const [liveGame, setLiveGame] = useState('live_dice');
  const [liveRounds, setLiveRounds] = useState(3);
  const [gameKey, setGameKey] = useState('dice');
  const [rounds, setRounds] = useState(5);
  const [stake, setStake] = useState(100);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const games = MATCH_GAMES.map((k) => configs?.find((c) => c.game_key === k && c.enabled)).filter(Boolean) as { game_key: string; display_name: string }[];
  return (
    <Modal open={open} onClose={() => !busy && onClose()} title="Neues Duell">
      <div className="stack">
        <span className="field-label">1. Gegner</span>
        <PlayerPicker value={opp} onChange={setOpp} />
        <Choice label="2. Art" value={mode} onChange={setMode} options={[['live', 'Live-Duell'], ['match', 'Spiel-Duell']]} />
        {mode === 'live' ? (
          <>
            <p className="small subtle">Ihr seid beide gleichzeitig im Duell-Raum und seht live, wie jede Runde rollt. Wer mehr Runden gewinnt, bekommt den Topf.</p>
            <div className="live-games">
              {LIVE_GAMES.map(([k, l, desc]) => (
                <button key={k} type="button" aria-pressed={liveGame === k} onClick={() => setLiveGame(k)}>
                  <strong>{l}</strong>
                  <span className="small muted">{desc}</span>
                </button>
              ))}
            </div>
            <Choice label="Runden" value={liveRounds} onChange={setLiveRounds} options={[[1, '1'], [3, 'Best of 3'], [5, 'Best of 5']]} />
          </>
        ) : (
          <>
            <p className="small subtle">Ihr spielt beide gleich viele Runden im selben Spiel. Wer prozentual mehr zurückholt (Auszahlung ÷ Einsatz), gewinnt den Topf. Einsatzhöhe pro Runde ist egal.</p>
            <div className="match-games">
              {games.map((g) => (
                <button key={g.game_key} type="button" aria-pressed={gameKey === g.game_key} onClick={() => setGameKey(g.game_key)}>
                  <span className="art">
                    <GameArt gameKey={g.game_key} />
                  </span>
                  <span className="small truncate">{g.display_name}</span>
                </button>
              ))}
            </div>
            <Choice label="Runden pro Spieler" value={rounds} onChange={setRounds} options={[[3, '3'], [5, '5'], [10, '10'], [20, '20']]} />
          </>
        )}
        <AmountInput id="duel-stake" label="3. Einsatz pro Spieler" value={stake} onChange={setStake} presets={[50, 100, 250, 500, 1000, 2500]} max={maxStake} />
        <div className="field">
          <label htmlFor="duel-msg">Spruch (optional)</label>
          <input id="duel-msg" className="input" maxLength={140} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Trau dich!" />
        </div>
        <Button variant="primary" size="lg" block disabled={!opp || stake < 10} loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const key = newIdempotencyKey('duel');
              const r = mode === 'match' ? await api.createMatchDuel(opp!, gameKey, rounds, stake, msg, key) : await api.createLiveDuel(opp!, liveGame, liveRounds, stake, msg, key);
              applyServerBalance(r.balance);
              setMsg('');
              onCreated();
              onClose();
              if (mode === 'live') navigate(`/casino/duelle/${r.id}`);
              else toast.success('Herausforderung gesendet', 'Dein Gegner bekommt eine Benachrichtigung.');
            } catch (e) {
              toast.error('Nicht gesendet', toAppError(e).message);
            } finally {
              setBusy(false);
            }
          }}>
          Herausfordern ({formatCredits(stake)} Credits)
        </Button>
        <p className="small muted">Der Einsatz wird reserviert. {mode === 'live' ? 'Kommt kein Duell zustande (30 Min. ohne Beitritt, 15 Min. im Raum ohne Start), gibt es den Einsatz automatisch zurück.' : 'Nicht angenommen oder nicht fertig gespielt nach 24 h = Einsatz automatisch zurück.'}</p>
      </div>
    </Modal>
  );
}

export function DuelsPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const { applyServerBalance } = useAppData();
  const { data, reload } = useMyDuels();
  const [busy, setBusy] = useState<string | null>(null);
  const [show, setShow] = useState<DuelItem | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const act = async (id: string, fn: () => Promise<void>) => {
    setBusy(id);
    try {
      await fn();
    } catch (e) {
      toast.error('Nicht möglich', toAppError(e).message);
    } finally {
      setBusy(null);
    }
  };
  const incoming = data?.items.filter((d) => d.status === 'pending' && !d.mine) ?? [];
  const outgoing = data?.items.filter((d) => d.status === 'pending' && d.mine) ?? [];
  const running = data?.items.filter((d) => d.status === 'running') ?? [];
  const lobby = data?.items.filter((d) => d.status === 'lobby') ?? [];
  const history = data?.items.filter((d) => !['pending', 'running', 'lobby'].includes(d.status)) ?? [];

  return (
    <div className="stack-lg" style={{ maxWidth: 760 }}>
      <div className="page-head">
        <div>
          <Link to="/casino" className="small subtle row" style={{ gap: 6, marginBottom: 6 }}>
            <IconArrowLeft size={16} /> Casino
          </Link>
          <h1>Duelle</h1>
          <p>Fordere Freunde heraus – der Gewinner bekommt beide Einsätze.</p>
        </div>
        <Button variant="primary" onClick={() => setNewOpen(true)}>
          Neues Duell
        </Button>
      </div>

      {!data ? (
        <div className="skeleton" style={{ height: 160 }} />
      ) : (
        <>
          {incoming.length > 0 && (
            <section className="stack">
              <h2 className="label">Für dich · {incoming.length}</h2>
              {incoming.map((d) => (
                <article key={d.id} className="duel-card incoming">
                  <div className="row" style={{ gap: 10 }}>
                    <Avatar name={d.challenger_name} seed={d.challenger_seed} size={44} />
                    <div className="grow" style={{ minWidth: 0 }}>
                      <strong>{d.challenger_name}</strong> fordert dich heraus
                      <div className="small subtle">
                        {duelTitle(d)} · Einsatz <b className="gold mono">{formatCredits(d.stake)}</b>
                      </div>
                      {d.message && <div className="small subtle truncate">„{d.message}“</div>}
                    </div>
                  </div>
                  <div className="row" style={{ gap: 8 }}>
                    {d.game === 'live' ? (
                      <Button variant="gold" block onClick={() => navigate(`/casino/duelle/${d.id}`)}>
                        Zum Duell-Raum
                      </Button>
                    ) : (
                    <Button variant="gold" block loading={busy === d.id}
                      onClick={() => void act(d.id, async () => {
                        const r = await api.acceptDuel(d.id);
                        applyServerBalance(r.balance);
                        if ('running' in r && r.running) {
                          toast.success('Duell läuft!', `Spiel jetzt deine ${d.rounds} Runden ${d.game_name ?? ''}.`);
                        } else {
                          playTone(r.won ? 'win' : 'loss');
                          haptic(r.won ? 30 : [20, 20, 40]);
                          setShow({ ...d, status: 'finished', won: r.won ?? false, result: r.result ?? {}, has_winner: true });
                        }
                        void reload();
                      })}>
                      Annehmen
                    </Button>
                    )}
                    <Button variant="ghost" disabled={busy === d.id}
                      onClick={() => void act(d.id, async () => {
                        await api.cancelDuel(d.id);
                        toast.info('Duell abgelehnt');
                        void reload();
                      })}>
                      Ablehnen
                    </Button>
                  </div>
                </article>
              ))}
            </section>
          )}

          {lobby.length > 0 && (
            <section className="stack">
              <h2 className="label">Im Duell-Raum</h2>
              {lobby.map((d) => (
                <div key={d.id} className="duel-row incoming">
                  <Avatar name={d.mine ? d.opponent_name : d.challenger_name} seed={d.mine ? d.opponent_seed : d.challenger_seed} size={36} />
                  <div className="grow small" style={{ minWidth: 0 }}>
                    <strong>{d.mine ? d.opponent_name : d.challenger_name}</strong> · {duelTitle(d)} · <span className="mono gold">{formatCredits(d.stake)}</span>
                  </div>
                  <Button size="sm" variant="gold" onClick={() => navigate(`/casino/duelle/${d.id}`)}>
                    Zum Raum
                  </Button>
                </div>
              ))}
            </section>
          )}

          {running.length > 0 && (
            <section className="stack">
              <h2 className="label">Läuft · {running.length}</h2>
              {running.map((d) => (
                <article key={d.id} className="duel-card running">
                  <div className="row-between wrap" style={{ gap: 8 }}>
                    <strong>
                      {d.mine ? `gegen ${d.opponent_name}` : `gegen ${d.challenger_name}`} · {duelTitle(d)}
                    </strong>
                    <span className="small gold mono">Topf {formatCredits(d.stake * 2)}</span>
                  </div>
                  <MatchProgress d={d} />
                  <div className="row-between wrap" style={{ gap: 8 }}>
                    <span className="small muted">endet spätestens {formatDateTime(d.expires_at)}</span>
                    {((d.mine ? d.c_rounds : d.o_rounds) ?? 0) < (d.rounds ?? 0) && (
                      <Link to={`/casino/${d.game_key}`} className="btn btn-primary btn-sm">
                        Jetzt spielen
                      </Link>
                    )}
                  </div>
                </article>
              ))}
            </section>
          )}

          {outgoing.length > 0 && (
            <section className="stack">
              <h2 className="label">Wartet auf Antwort</h2>
              {outgoing.map((d) => (
                <div key={d.id} className="duel-row">
                  <Avatar name={d.opponent_name} seed={d.opponent_seed} size={36} />
                  <div className="grow small" style={{ minWidth: 0 }}>
                    <strong>{d.opponent_name}</strong> · {duelTitle(d)} · <span className="mono gold">{formatCredits(d.stake)}</span>
                  </div>
                  {d.game === 'live' && (
                    <Button size="sm" onClick={() => navigate(`/casino/duelle/${d.id}`)}>
                      Zum Raum
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" loading={busy === d.id}
                    onClick={() => void act(d.id, async () => {
                      const r = await api.cancelDuel(d.id);
                      applyServerBalance(r.balance);
                      toast.info('Duell zurückgezogen', 'Einsatz ist zurück.');
                      void reload();
                    })}>
                    Zurückziehen
                  </Button>
                </div>
              ))}
            </section>
          )}

          {!incoming.length && !running.length && !outgoing.length && !lobby.length && (
            <EmptyState title="Gerade keine Duelle" text="Fordere einen Freund zu einem Live-Duell oder in deinem Lieblingsspiel heraus." action={<Button variant="primary" onClick={() => setNewOpen(true)}>Neues Duell</Button>} />
          )}

          {history.length > 0 && (
            <details className="notif-past">
              <summary>
                Vergangene Duelle <span className="muted">({history.length})</span>
              </summary>
              <div className="stack" style={{ gap: 6, marginTop: 6 }}>
                {history.map((d) => (
                  <button key={d.id} type="button" className="duel-row hist" onClick={() => (d.game === 'live' ? navigate(`/casino/duelle/${d.id}`) : d.status === 'finished' && d.game !== 'match' && setShow(d))}>
                    <span className={`duel-badge ${d.status === 'finished' ? (d.won ? 'won' : 'lost') : ''}`}>
                      {d.status === 'finished' ? (d.won ? 'Sieg' : 'Niederlage') : d.status === 'declined' ? 'Abgelehnt' : d.status === 'expired' ? 'Abgelaufen' : 'Zurückgezogen'}
                    </span>
                    <span className="grow small truncate">
                      {d.mine ? d.opponent_name : d.challenger_name} · {duelTitle(d)}
                      {d.game === 'match' && d.status === 'finished' && (
                        <span className="muted"> · {String((d.result as Record<string, unknown>)[d.mine ? 'challenger_quote' : 'opponent_quote'])} % zu {String((d.result as Record<string, unknown>)[d.mine ? 'opponent_quote' : 'challenger_quote'])} %</span>
                      )}
                    </span>
                    <span className={`mono small ${d.status === 'finished' ? (d.won ? 'success' : 'subtle') : 'muted'}`}>
                      {d.status === 'finished' ? (d.won ? `+${formatCredits(d.stake)}` : `−${formatCredits(d.stake)}`) : '±0'}
                    </span>
                  </button>
                ))}
              </div>
            </details>
          )}
        </>
      )}
      <NewDuelDialog open={newOpen} onClose={() => setNewOpen(false)} maxStake={data?.max_stake ?? 5000} onCreated={() => void reload()} />
      {show && <QuickResult d={show} onClose={() => setShow(null)} />}
    </div>
  );
}

/** Hinweis im Spiel, wenn ein Spiel-Duell in diesem Spiel läuft */
export function DuelBanner({ gameKey }: { gameKey: string }) {
  const { data } = useMyDuels();
  const d = data?.items.find((x) => x.status === 'running' && x.game_key === gameKey);
  if (!d) return null;
  const mine = (d.mine ? d.c_rounds : d.o_rounds) ?? 0;
  const theirs = (d.mine ? d.o_rounds : d.c_rounds) ?? 0;
  return (
    <Link to="/casino/duelle" className="duel-banner">
      <span className="grow small">
        Duell gegen <b>{d.mine ? d.opponent_name : d.challenger_name}</b>: du {mine}/{d.rounds} · Gegner {theirs}/{d.rounds}
        {mine >= (d.rounds ?? 0) && ' – warte auf Gegner'}
      </span>
      <span className="small gold mono">{(d.mine ? d.c_quote : d.o_quote) ?? '–'} %</span>
    </Link>
  );
}

/** Knopf oben rechts in der Casino-Lobby */
export function DuelsButton() {
  const { data } = useMyDuels();
  const open = data?.items.filter((d) => d.status === 'pending' && !d.mine).length ?? 0;
  return (
    <Link to="/casino/duelle" className="btn duels-btn">
      Duelle
      {open > 0 && <span className="duels-dot">{open}</span>}
    </Link>
  );
}

// ================================================================ Geschenke (Wallet)
export function GiftButton() {
  const toast = useToast();
  const { applyServerBalance, balance } = useAppData();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ limit: number; sent_today: number; items: GiftItem[] } | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [amount, setAmount] = useState(100);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) api.getMyGifts().then(setData).catch(() => undefined);
  }, [open]);
  const left = data ? Math.max(0, data.limit - data.sent_today) : 0;
  return (
    <>
      <button type="button" className="gift-btn" onClick={() => setOpen(true)} aria-label="Credits verschenken">
        <span className="gift-ico" aria-hidden="true">
          <IconGift size={16} />
        </span>
        Schenken
      </button>
      <Modal open={open} onClose={() => !busy && setOpen(false)} title="Credits verschenken">
        <div className="stack">
          <p className="small subtle">
            Heute noch <b className="gold mono">{formatCredits(left)}</b> von {formatCredits(data?.limit ?? 0)} Credits verschenkbar.
          </p>
          <span className="field-label">An</span>
          <PlayerPicker value={to} onChange={setTo} />
          <AmountInput id="gift-amount" label="Betrag (Credits)" value={amount} onChange={setAmount} presets={[50, 100, 250, 500, 1000]} max={Math.min(left, balance ?? 0)} />
          <div className="field">
            <label htmlFor="gift-msg">Nachricht (optional)</label>
            <input id="gift-msg" className="input" maxLength={140} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Für den Kasten 🍻" />
          </div>
          <Button variant="gold" size="lg" block disabled={!to || amount < 10 || amount > left} loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await api.sendCredits(to!, amount, msg, newIdempotencyKey('gift'));
                applyServerBalance(r.balance);
                toast.success('Geschenk gesendet 🎁', `${formatCredits(amount)} Credits`);
                setMsg('');
                setOpen(false);
              } catch (e) {
                toast.error('Nicht gesendet', toAppError(e).message);
              } finally {
                setBusy(false);
              }
            }}>
            {formatCredits(amount)} Credits schenken
          </Button>
          {data && data.items.length > 0 && (
            <details className="notif-past">
              <summary>
                Letzte Geschenke <span className="muted">({data.items.length})</span>
              </summary>
              <div className="stack" style={{ gap: 6, marginTop: 6 }}>
                {data.items.map((g) => (
                  <div key={g.id} className="duel-row">
                    <Avatar name={g.other_name} seed={g.other_seed} size={28} />
                    <div className="grow small" style={{ minWidth: 0 }}>
                      {g.outgoing ? `an ${g.other_name}` : `von ${g.other_name}`} · <span className="muted">{relativeTime(g.created_at)}</span>
                      {g.message && <div className="subtle truncate">„{g.message}“</div>}
                    </div>
                    <span className={`mono small ${g.outgoing ? 'subtle' : 'success'}`}>
                      {g.outgoing ? '−' : '+'}
                      {formatCredits(g.amount)}
                    </span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      </Modal>
    </>
  );
}

// ================================================================ Kasten-Tipp
export function TippPage() {
  const toast = useToast();
  const { dashboard } = useAppData();
  const [state, setState] = useState<PredictionState | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.getPredictionState().then(setState).catch(() => undefined);
  }, []);
  const locked = state ? new Date(state.locks_at).getTime() < Date.now() : false;
  return (
    <div className="stack-lg" style={{ maxWidth: 760 }}>
      <div className="page-head">
        <div>
          <Link to="/" className="small subtle row" style={{ gap: 6, marginBottom: 6 }}>
            <IconArrowLeft size={16} /> Dashboard
          </Link>
          <h1>Wer bringt den Kasten?</h1>
          <p>Richtig getippt = +{formatCredits(state?.reward ?? 0)} Credits.</p>
        </div>
      </div>
      <section className="card stack">
        <p className="small subtle">
          Tippe, wer am Ende der Runde den niedrigsten Kontostand hat. Du kannst deinen Tipp bis 24 Stunden vor der Abrechnung ändern
          {state ? ` (bis ${formatDateTime(state.locks_at)})` : ''}. Die Tipps der anderen siehst du erst nach der Abrechnung.
        </p>
        {state && (
          <div className="row wrap small subtle" style={{ gap: 12 }}>
            <span>
              Tipp-Schluss in <Countdown target={state.locks_at} className="gold" />
            </span>
            <span>{state.tips} Tipp(s) abgegeben</span>
          </div>
        )}
        <PlayerPicker includeSelf value={state?.my_pick ?? null} disabled={locked || busy}
          onChange={async (id) => {
            setBusy(true);
            try {
              setState(await api.setPrediction(id));
              toast.success('Tipp gespeichert');
            } catch (e) {
              toast.error('Nicht gespeichert', toAppError(e).message);
            } finally {
              setBusy(false);
            }
          }} />
        {dashboard?.current_lowest && (
          <p className="small muted">Aktuell Letzter: {dashboard.current_lowest.display_name} ({formatCredits(dashboard.current_lowest.balance)} Credits)</p>
        )}
      </section>
      {state?.last && state.last.tips.length > 0 && (
        <section className="card stack">
          <h2>Letzte Abrechnung</h2>
          <p className="small subtle">
            Kasten: <strong>{state.last.loser ?? '–'}</strong>
          </p>
          {state.last.tips.map((t) => (
            <div key={t.name} className="row-between small">
              <span>
                {t.name} → {t.pick}
              </span>
              <span className={t.correct ? 'success' : 'muted'}>{t.correct ? `✓ +${formatCredits(state.reward)}` : '✗'}</span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
