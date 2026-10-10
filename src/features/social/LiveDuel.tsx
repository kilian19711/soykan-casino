// Live-Duell-Raum: beide Spieler sehen dieselben Runden im Gleichtakt (Startzeit vom Server, Uhrzeit-Abgleich über serverNow).
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type LiveDuel } from '../../lib/api';
import { supabase } from '../../lib/supabase';
import { useAppData } from '../../app/AppData';
import { formatCredits } from '../../lib/format';
import { haptic, newIdempotencyKey, playTone, serverNow } from '../../lib/misc';
import { toAppError } from '../../lib/errors';
import { Button } from '../../components/Button';
import { useToast } from '../../components/Toast';
import { Avatar, ErrorState, PageLoading } from '../../components/ui';
import { IconArrowLeft } from '../../components/Icons';
import { Card, Die } from '../games/visuals';
import './social.css';

export const LIVE_GAMES: [string, string, string][] = [
  ['live_dice', 'Würfel', 'Beide würfeln mit 2 Würfeln – die höhere Summe gewinnt die Runde.'],
  ['live_card', 'Karten', 'Jeder zieht eine Karte – die höhere gewinnt (Ass ist hoch).'],
  ['live_plinko', 'Plinko', 'Beide Kugeln fallen gleichzeitig – der höhere Multiplikator gewinnt.'],
  ['live_coin', 'Münzwurf', 'Kopf für den Herausforderer, Zahl für den Gegner.'],
];
export const liveName = (k: string | null | undefined) => LIVE_GAMES.find((g) => g[0] === k)?.[1] ?? 'Live-Duell';

const ROUND_MS: Record<string, number> = { live_dice: 3200, live_card: 3200, live_coin: 3000, live_plinko: 4200 };
const REVEAL_AT = 0.55; // Anteil der Runde, ab dem das Ergebnis sichtbar ist
const PLINKO_TABLE = [16, 6, 3, 1.6, 1.2, 1, 0.5, 1, 1.2, 1.6, 3, 6, 16];

type Round = { c: unknown; o: unknown; winner: 'c' | 'o' };

/** Mini-Plinko: Kugel läuft den Pfad Reihe für Reihe ab */
function MiniPlinko({ path, progress, color }: { path: number[]; progress: number; color: string }) {
  const rows = 12;
  const step = Math.min(rows, Math.floor((progress / REVEAL_AT) * rows));
  const done = progress >= REVEAL_AT;
  let x = 0;
  for (let i = 0; i < step; i++) x += path[i] ? 1 : 0;
  const bucket = path.reduce((a, b) => a + b, 0);
  const W = 130;
  const H = 150;
  const px = (r: number, k: number) => W / 2 + (k - r / 2) * (W / 14);
  const ballX = done ? px(rows, bucket) : px(step, x);
  const ballY = done ? H - 18 : 10 + step * ((H - 30) / rows);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mini-plinko" aria-hidden="true">
      {Array.from({ length: rows }).map((_, r) =>
        Array.from({ length: r + 1 }).map((__, k) => <circle key={`${r}-${k}`} cx={px(r, k)} cy={14 + r * ((H - 30) / rows)} r="1.6" fill="#64748b" />),
      )}
      {PLINKO_TABLE.map((m, i) => (
        <g key={i}>
          <rect x={px(rows, i) - 4.5} y={H - 12} width="9" height="10" rx="2" fill={done && i === bucket ? color : m >= 3 ? '#b45309' : m >= 1 ? '#1d4ed8' : '#334155'} />
        </g>
      ))}
      <circle cx={ballX} cy={ballY} r="4.2" fill={color} style={{ transition: 'cx .12s linear, cy .12s linear' }} />
    </svg>
  );
}

function RoundView({ game, round, progress, side, color }: { game: string; round: Round; progress: number; side: 'c' | 'o'; color: string }) {
  const v = round[side] as unknown;
  const shown = progress >= REVEAL_AT;
  const win = shown && round.winner === side;
  return (
    <div className={`live-play ${win ? 'win' : shown ? 'lose' : ''}`}>
      {game === 'live_dice' && (
        <div className="row" style={{ gap: 6, justifyContent: 'center' }}>
          {((v as number[]) ?? [1, 1]).map((n, i) => (
            <Die key={i} value={n} rolling={!shown} size={46} />
          ))}
        </div>
      )}
      {game === 'live_card' && (
        <div className="center">
          <Card card={shown ? Number(v) : null} hidden={!shown} />
        </div>
      )}
      {game === 'live_coin' && (
        <div className="center">
          <div className={`duel-coin small ${shown ? '' : 'spin'}`}>{shown ? (v ? '★' : '–') : ''}</div>
        </div>
      )}
      {game === 'live_plinko' && <MiniPlinko path={((v as { path: number[] })?.path ?? [])} progress={progress} color={color} />}
      <div className="live-val mono">
        {shown
          ? game === 'live_dice'
            ? `= ${((v as number[]) ?? []).reduce((a, b) => a + b, 0)}`
            : game === 'live_plinko'
              ? `${(v as { mult: number }).mult}×`
              : game === 'live_coin'
                ? v
                  ? 'Treffer'
                  : ''
                : ''
          : '…'}
      </div>
    </div>
  );
}

export function LiveDuelRoom() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { applyServerBalance, refreshDashboard } = useAppData();
  const [d, setD] = useState<LiveDuel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(serverNow());
  const announced = useRef(false);

  const load = useCallback(async () => {
    try {
      const x = await api.getDuel(id);
      setD(x);
      setError(null);
    } catch (e) {
      setError(toAppError(e).message);
    }
  }, [id]);

  useEffect(() => {
    void load();
    const ch = supabase
      .channel(`duel-${id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'duels', filter: `id=eq.${id}` }, () => void load())
      .subscribe();
    // Fallback, falls Echtzeit kurz hängt
    const poll = window.setInterval(() => void load(), 4000);
    return () => {
      window.clearInterval(poll);
      void supabase.removeChannel(ch);
    };
  }, [id, load]);

  useEffect(() => {
    const t = window.setInterval(() => setNow(serverNow()), 100);
    return () => window.clearInterval(t);
  }, []);

  const act = async (fn: () => Promise<LiveDuel | unknown>) => {
    setBusy(true);
    try {
      const r = await fn();
      if (r && typeof r === 'object' && 'status' in r) setD(r as LiveDuel);
      void refreshDashboard();
    } catch (e) {
      toast.error('Nicht möglich', toAppError(e).message);
      void load();
    } finally {
      setBusy(false);
    }
  };

  if (error) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!d) return <PageLoading />;

  const game = d.game_key ?? 'live_dice';
  const me = d.mine ? 'c' : 'o';
  const them = d.mine ? d.opponent_name : d.challenger_name;
  const rounds = ((d.result as { rounds?: Round[] })?.rounds ?? []) as Round[];
  const R = ROUND_MS[game] ?? 3200;
  const start = d.start_at ? new Date(d.start_at).getTime() : 0;
  const elapsed = start ? now - start : -1;
  const idx = start ? Math.min(rounds.length - 1, Math.max(0, Math.floor(elapsed / R))) : 0;
  const progress = start ? (elapsed < 0 ? 0 : elapsed >= rounds.length * R ? 1 : (elapsed - idx * R) / R) : 0;
  const finished = d.status === 'finished' && start > 0 && elapsed >= rounds.length * R;
  const playing = d.status === 'finished' && start > 0 && elapsed >= 0 && !finished;
  const countdown = d.status === 'finished' && start > 0 && elapsed < 0 ? Math.ceil(-elapsed / 1000) : 0;
  // Punktestand nur über bereits aufgedeckte Runden
  const revealed = rounds.filter((_, i) => elapsed >= i * R + R * REVEAL_AT);
  const score = { c: revealed.filter((r) => r.winner === 'c').length, o: revealed.filter((r) => r.winner === 'o').length };

  if (finished && !announced.current) {
    announced.current = true;
    applyServerBalance(d.balance);
    playTone(d.won ? 'bigwin' : 'loss');
    haptic(d.won ? [30, 40, 60] : [60]);
  }

  // als Funktion aufgerufen (keine eigene Komponente), damit Animationen nicht bei jedem Tick neu starten
  const renderSide = (side: 'c' | 'o') => {
    const name = side === 'c' ? d.challenger_name : d.opponent_name;
    const seed = side === 'c' ? d.challenger_seed : d.opponent_seed;
    const ready = side === 'c' ? d.c_ready : d.o_ready;
    const isMe = side === me;
    const present = side === 'c' || d.status !== 'pending';
    return (
      <div className={`live-side ${isMe ? 'me' : ''} ${finished && ((side === 'c') === (score.c > score.o)) ? 'champ' : ''}`}>
        <Avatar name={name} seed={seed} size={56} />
        <strong className="truncate">{isMe ? 'Du' : name}</strong>
        <span className="live-score mono">{d.status === 'finished' ? score[side] : ''}</span>
        {d.status === 'lobby' && <span className={`live-ready ${ready ? 'on' : ''}`}>{ready ? 'Bereit ✓' : 'nicht bereit'}</span>}
        {d.status === 'pending' && <span className="live-ready">{present ? 'im Raum' : 'eingeladen …'}</span>}
        {playing && rounds[idx] && <RoundView game={game} round={rounds[idx]} progress={progress} side={side} color={side === 'c' ? '#f3c969' : '#38bdf8'} />}
      </div>
    );
  };

  return (
    <div className="stack-lg" style={{ maxWidth: 760 }}>
      <div className="page-head">
        <div>
          <Link to="/casino/duelle" className="small subtle row" style={{ gap: 6, marginBottom: 6 }}>
            <IconArrowLeft size={16} /> Duelle
          </Link>
          <h1>Live-Duell · {liveName(game)}</h1>
          <p>
            {d.rounds} Runde{d.rounds === 1 ? '' : 'n'} · Einsatz {formatCredits(d.stake)} je Spieler · Topf <span className="gold">{formatCredits(d.stake * 2)}</span>
          </p>
        </div>
      </div>

      <section className="card live-arena">
        <div className="live-head">
          {renderSide('c')}
          <div className="live-mid">
            {playing ? (
              <>
                <span className="label">Runde</span>
                <strong className="mono">
                  {idx + 1}/{rounds.length}
                </strong>
              </>
            ) : countdown > 0 ? (
              <strong className="live-countdown mono" key={countdown}>
                {countdown}
              </strong>
            ) : (
              <span className="duel-vs">VS</span>
            )}
          </div>
          {renderSide('o')}
        </div>

        {d.status === 'pending' && (
          <div className="stack center">
            {d.mine ? (
              <>
                <p className="subtle">Warte auf {them} … {them} hat eine Benachrichtigung bekommen und kann unter Casino → Duelle beitreten.</p>
                <div className="live-wait" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
                <Button variant="ghost" loading={busy} onClick={() => void act(() => api.leaveLiveDuel(d.id))}>
                  Duell absagen (Einsatz zurück)
                </Button>
              </>
            ) : (
              <>
                <p>
                  <strong>{d.challenger_name}</strong> wartet auf dich{d.message ? ` – „${d.message}“` : ''}.
                </p>
                <Button variant="gold" size="lg" block loading={busy} onClick={() => void act(() => api.joinLiveDuel(d.id))}>
                  Beitreten · {formatCredits(d.stake)} Credits setzen
                </Button>
                <Button variant="ghost" disabled={busy} onClick={() => void act(async () => { await api.cancelDuel(d.id); navigate('/casino/duelle'); })}>
                  Ablehnen
                </Button>
              </>
            )}
          </div>
        )}

        {d.status === 'lobby' && (
          <div className="stack center">
            <p className="small subtle">{LIVE_GAMES.find((g) => g[0] === game)?.[2]}</p>
            {(me === 'c' ? d.c_ready : d.o_ready) ? (
              <p className="subtle">Du bist bereit – warte auf {them} …</p>
            ) : (
              <Button variant="gold" size="lg" block loading={busy} onClick={() => void act(() => api.readyLiveDuel(d.id))}>
                Bereit!
              </Button>
            )}
            <Button variant="ghost" disabled={busy} onClick={() => void act(() => api.leaveLiveDuel(d.id))}>
              Raum verlassen (beide Einsätze zurück)
            </Button>
          </div>
        )}

        {countdown > 0 && <p className="center subtle">Gleich geht's los …</p>}

        {finished && (
          <div className="stack center live-final">
            <div className={`stat-value ${d.won ? 'gold' : 'subtle'}`} style={{ fontSize: 'clamp(28px, 8vw, 40px)' }}>
              {d.won ? `Gewonnen! +${formatCredits(d.stake * 2)}` : `${them} gewinnt`}
            </div>
            <p className="subtle">
              Endstand {d.mine ? score.c : score.o} : {d.mine ? score.o : score.c}
            </p>
            <div className="live-history">
              {rounds.map((r, i) => (
                <span key={i} className={r.winner === me ? 'w' : 'l'}>
                  {i + 1}
                </span>
              ))}
            </div>
            <div className="row" style={{ gap: 8, justifyContent: 'center' }}>
              <Button variant="primary" loading={busy}
                onClick={() => void act(async () => {
                  const r = await api.createLiveDuel(d.mine ? d.opponent_id : d.challenger_id, game, d.rounds, d.stake, 'Revanche!', newIdempotencyKey('duel'));
                  applyServerBalance(r.balance);
                  navigate(`/casino/duelle/${r.id}`);
                })}>
                Revanche
              </Button>
              <Link to="/casino/duelle" className="btn">
                Zu den Duellen
              </Link>
            </div>
          </div>
        )}

        {(d.status === 'cancelled' || d.status === 'expired' || d.status === 'declined') && (
          <div className="stack center">
            <p className="subtle">
              {d.status === 'declined' ? `${them} hat abgelehnt.` : d.status === 'expired' ? 'Das Duell ist abgelaufen.' : 'Das Duell wurde abgebrochen.'} Einsätze wurden
              zurückgebucht.
            </p>
            <Link to="/casino/duelle" className="btn">
              Zu den Duellen
            </Link>
          </div>
        )}
      </section>
      <p className="small muted center">
        Sobald beide bereit sind, steht das Ergebnis fest und wird sofort gutgeschrieben – auch wenn jemand die App schließt. Startet das Duell nicht innerhalb von 15
        Minuten, gibt es beide Einsätze zurück.
      </p>
    </div>
  );
}
