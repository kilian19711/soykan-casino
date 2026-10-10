// Gemeinsames Spiel-Framework: Konfiguration, Einsatzsteuerung, Rundenausführung, Ergebnis-Pop-ups.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { toAppError } from '../../lib/errors';
import { formatCredits, formatMultiplier, formatSigned, shortId } from '../../lib/format';
import { haptic, playTone } from '../../lib/misc';
import { loadPreferences, prefersReducedMotion } from '../../lib/preferences';
import { useAppData } from '../../app/AppData';
import { useAuth } from '../auth/AuthProvider';
import { useToast } from '../../components/Toast';
import { Button } from '../../components/Button';
import { Modal } from '../../components/Modal';
import { IconArrowLeft, IconBook } from '../../components/Icons';
import { Credits } from '../../components/ui';
import { validateBet, type BetLimits } from './logic';
import type { GameConfig, GameRoundRow, RoundResponse } from '../../types';

// ---------------------------------------------------------------------------
// Konfiguration (einmal laden, im Modul cachen)
// ---------------------------------------------------------------------------
let configCache: GameConfig[] | null = null;
let configPromise: Promise<GameConfig[]> | null = null;

export function invalidateGameConfigs() {
  configCache = null;
  configPromise = null;
}

export function useGameConfigs() {
  const [configs, setConfigs] = useState<GameConfig[] | null>(configCache);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async (force = false) => {
    try {
      if (force) invalidateGameConfigs();
      configPromise = configPromise ?? api.getGameConfigs();
      const list = await configPromise;
      configCache = list;
      setConfigs(list);
      setError(null);
    } catch (e) {
      configPromise = null;
      setError(toAppError(e).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return { configs, error, reload: () => load(true) };
}

export function useGameConfig(gameKey: string) {
  const { configs, error, reload } = useGameConfigs();
  const config = configs?.find((c) => c.game_key === gameKey) ?? null;
  return { config, error, loading: !configs && !error, reload };
}

export function limitsOf(config: GameConfig | null): BetLimits {
  return { min: Number(config?.config.min_bet ?? 10), max: Number(config?.config.max_bet ?? 50000) };
}

// ---------------------------------------------------------------------------
// Einsatzfeld mit Presets
// ---------------------------------------------------------------------------
export function useBet(limits: BetLimits, initial = 100) {
  const storageKey = 'shb.lastBet';
  const [bet, setBet] = useState<number>(() => {
    try {
      const v = Number(sessionStorage.getItem(storageKey));
      return Number.isFinite(v) && v > 0 ? v : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, String(bet));
    } catch {
      /* ignore */
    }
  }, [bet]);
  useEffect(() => {
    setBet((b) => Math.min(Math.max(b, limits.min), limits.max));
  }, [limits.min, limits.max]);
  return [bet, setBet] as const;
}

let maxWinCache: number | null = null;
let maxWinPromise: Promise<number> | null = null;
/** Maximalgewinn pro Runde (Admin-Einstellung), einmal pro Sitzung geladen. */
export function useMaxWin(): number | null {
  const [v, setV] = useState<number | null>(maxWinCache);
  useEffect(() => {
    if (maxWinCache !== null) return;
    maxWinPromise ??= api.getGameLimits().then((r) => (maxWinCache = Number(r?.max_win_per_round ?? 0)));
    void maxWinPromise.then(setV).catch(() => undefined);
  }, []);
  return v;
}

export function BetControls({
  value,
  onChange,
  limits,
  disabled,
  label = 'Einsatz',
  id = 'bet',
}: {
  value: number;
  onChange: (v: number) => void;
  limits: BetLimits;
  disabled?: boolean;
  label?: string;
  id?: string;
}) {
  const { balance } = useAppData();
  const maxWin = useMaxWin();
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const error = validateBet(value, limits, balance);
  const clampSet = (v: number) => onChange(Math.max(limits.min, Math.min(limits.max, Math.floor(v))));
  const presets = [10, 50, 100, 500, 1000, 5000].filter((p) => p >= limits.min && p <= limits.max);

  return (
    <div className="field">
      <label htmlFor={id}>
        {label}{' '}
        <span className="muted" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>
          ({formatCredits(limits.min)}–{formatCredits(limits.max)} Credits)
        </span>
      </label>
      <div className="input-group">
        <span className="addon">CR</span>
        <input
          id={id}
          className="input mono"
          inputMode="numeric"
          pattern="[0-9]*"
          value={text}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={`${id}-hint`}
          onChange={(e) => {
            const raw = e.target.value.replace(/[^0-9]/g, '').slice(0, 9);
            setText(raw);
            if (raw) onChange(Number(raw));
          }}
          onBlur={() => {
            if (!text) setText(String(value));
          }}
        />
        <button type="button" onClick={() => clampSet(value / 2)} disabled={disabled} aria-label="Einsatz halbieren">
          ½
        </button>
        <button type="button" onClick={() => clampSet(value * 2)} disabled={disabled} aria-label="Einsatz verdoppeln">
          2×
        </button>
      </div>
      <div className="chip-group" role="group" aria-label="Einsatz-Presets">
        {presets.map((p) => (
          <button key={p} type="button" className="chip" aria-pressed={value === p} disabled={disabled} onClick={() => onChange(p)}>
            {formatCredits(p)}
          </button>
        ))}
        <button
          type="button"
          className="chip"
          disabled={disabled || !balance}
          onClick={() => clampSet(Math.min(balance ?? limits.max, limits.max))}
        >
          Max
        </button>
      </div>
      <span id={`${id}-hint`} className={error ? 'field-error' : 'field-hint'} aria-live="polite">
        {error ?? `Verfügbar: ${formatCredits(balance)} Credits${maxWin ? ` · max. Gewinn ${formatCredits(maxWin)} pro Runde` : ''}`}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rundenausführung
// ---------------------------------------------------------------------------
export interface Outcome {
  round: RoundResponse;
  gameName: string;
  description: string;
  multiplier?: number | null;
}

export function useRoundRunner(gameKey: string, gameName: string) {
  const { applyServerBalance } = useAppData();
  const { session } = useAuth();
  const toast = useToast();
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [insufficient, setInsufficient] = useState(false);
  const [modal, setModal] = useState<Outcome | null>(null);
  const [lastOutcome, setLastOutcome] = useState<Outcome | null>(null);
  const [recent, setRecent] = useState<GameRoundRow[]>([]);

  useEffect(() => {
    const uid = session?.user.id;
    if (!uid) return;
    api
      .getMyRounds(uid, gameKey, 15)
      .then((rows) => setRecent(rows.filter((r) => r.status === 'settled')))
      .catch(() => undefined);
  }, [gameKey, session?.user.id]);

  /** Führt eine Serveraktion aus – mit Doppelklick-Schutz und einheitlicher Fehlerbehandlung. */
  const run = useCallback(
    async <T extends RoundResponse>(fn: () => Promise<T>): Promise<T | null> => {
      if (busyRef.current) return null;
      busyRef.current = true;
      setBusy(true);
      setError(null);
      try {
        const res = await fn();
        // Einsatz ist abgebucht; Gewinn wird erst nach der Animation (announce) angezeigt
        if (res.status !== 'settled') applyServerBalance(res.balance);
        return res;
      } catch (e) {
        const err = toAppError(e);
        if (err.code === 'INSUFFICIENT_BALANCE') setInsufficient(true);
        else {
          setError(err.message);
          toast.error(err.code === 'NETWORK' ? 'Verbindungsfehler' : 'Aktion fehlgeschlagen', err.message);
        }
        return null;
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [applyServerBalance, toast],
  );

  /** Zeigt das Ergebnis einer abgerechneten Runde an (nach der Animation). */
  const announce = useCallback(
    (round: RoundResponse, description: string, multiplier?: number | null) => {
      applyServerBalance(round.balance);
      if ((round.result as { capped?: boolean } | null)?.capped) {
        description += ' · Maximalgewinn erreicht';
      }
      const outcome: Outcome = { round, gameName, description, multiplier };
      setLastOutcome(outcome);
      setRecent((list) =>
        [
          {
            id: round.round_id,
            user_id: '',
            game_key: round.game_key,
            status: round.status,
            bet_amount: round.bet_amount,
            payout_amount: round.payout_amount,
            profit_amount: round.profit_amount,
            result: (round.result ?? {}) as Record<string, unknown>,
            server_seed_hash: round.server_seed_hash,
            started_at: round.started_at,
            completed_at: round.completed_at,
          },
          ...list.filter((r) => r.id !== round.round_id),
        ].slice(0, 15),
      );
      const ratio = round.bet_amount > 0 ? round.payout_amount / round.bet_amount : 0;
      if (round.payout_amount > round.bet_amount) {
        setModal(outcome);
        playTone(ratio >= 5 ? 'bigwin' : 'win');
        haptic(ratio >= 5 ? [20, 40, 20] : 15);
      } else if (round.payout_amount === round.bet_amount && round.payout_amount > 0) {
        toast.info('Unentschieden', `${gameName} · Einsatz zurück`);
      } else {
        playTone('loss');
      }
    },
    [applyServerBalance, gameName, toast],
  );

  return {
    run,
    announce,
    busy,
    error,
    setError,
    insufficient,
    closeInsufficient: () => setInsufficient(false),
    modal,
    closeModal: () => setModal(null),
    lastOutcome,
    clearOutcome: () => setLastOutcome(null),
    recent,
  };
}

// ---------------------------------------------------------------------------
// Darstellung
// ---------------------------------------------------------------------------
export function GameFrame({
  title,
  subtitle,
  rules,
  controls,
  stage,
  recent,
  runner,
}: {
  title: string;
  subtitle?: string;
  rules: ReactNode;
  controls: ReactNode;
  stage: ReactNode;
  recent?: ReactNode;
  runner: ReturnType<typeof useRoundRunner>;
  onPlayAgain?: () => void;
}) {
  const [rulesOpen, setRulesOpen] = useState(false);
  const { balance } = useAppData();
  return (
    <>
      <div className="page-head">
        <div>
          <Link to="/casino" className="small subtle row" style={{ gap: 6, marginBottom: 6 }}>
            <IconArrowLeft size={16} /> Casino-Lobby
          </Link>
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <div className="row">
          <span className="badge badge-gold" aria-label="Verfügbarer Kontostand">
            <Credits value={balance} />
          </span>
          <Button size="sm" onClick={() => setRulesOpen(true)}>
            <IconBook size={16} /> Regeln
          </Button>
        </div>
      </div>
      <div className="game-layout">
        <section className="card game-controls stack" aria-label="Spielsteuerung">
          {controls}
          {runner.error && (
            <div className="notice notice-danger small" role="alert">
              {runner.error}
            </div>
          )}
        </section>
        <section className="stack" aria-label="Spielfeld">
          <div className="game-stage">
            {stage}
            <WinPop outcome={runner.modal} onDone={runner.closeModal} />
          </div>
          <OutcomePanel outcome={runner.lastOutcome} />
          {recent}
        </section>
      </div>
      <Modal open={rulesOpen} onClose={() => setRulesOpen(false)} title={`Regeln: ${title}`}>
        <div className="stack small subtle">{rules}</div>
      </Modal>
      <InsufficientBalanceModal open={runner.insufficient} onClose={runner.closeInsufficient} />
    </>
  );
}

export function OutcomePanel({ outcome }: { outcome: Outcome | null }) {
  if (!outcome) return null;
  const { round } = outcome;
  const win = round.payout_amount > round.bet_amount;
  const push = round.payout_amount === round.bet_amount && round.payout_amount > 0;
  return (
    <div
      className={`card-flat row-between wrap ${win ? 'card-gold' : ''}`}
      role="status"
      aria-live="polite"
      style={{ animation: 'slideUp .25s ease both' }}
    >
      <div>
        <div className={`stat-value ${win ? 'gold' : push ? '' : 'subtle'}`} style={{ fontSize: 22 }}>
          {win ? `+${formatCredits(round.profit_amount)}` : push ? '±0' : formatSigned(round.profit_amount)} Credits
        </div>
        <div className="small subtle">
          {win ? 'Gewonnen' : push ? 'Unentschieden' : 'Verloren'} · {outcome.description}
        </div>
      </div>
      <div className="small muted mono" style={{ textAlign: 'right' }}>
        Runde {shortId(round.round_id)}
        <br />
        Einsatz {formatCredits(round.bet_amount)} · Auszahlung {formatCredits(round.payout_amount)}
      </div>
    </div>
  );
}

export function RecentRounds({
  rounds,
  label,
}: {
  rounds: GameRoundRow[];
  label: (r: GameRoundRow) => string;
}) {
  if (!rounds.length) return <p className="small muted">Noch keine Runden in diesem Spiel.</p>;
  return (
    <div>
      <div className="label" style={{ marginBottom: 6 }}>
        Letzte Ergebnisse
      </div>
      <div className="recent-results" aria-label="Letzte Ergebnisse">
        {rounds.map((r) => (
          <span
            key={r.id}
            className={`result-chip ${r.payout_amount > r.bet_amount ? 'win' : 'loss'}`}
            title={`Runde ${shortId(r.id)}: Einsatz ${formatCredits(r.bet_amount)}, Auszahlung ${formatCredits(r.payout_amount)}`}
          >
            {label(r)}
          </span>
        ))}
      </div>
    </div>
  );
}

function CoinBurst() {
  const coins = useMemo(
    () =>
      Array.from({ length: 26 }).map((_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * 0.6,
        duration: 1.6 + Math.random() * 1.2,
        dx: `${(Math.random() - 0.5) * 120}px`,
        size: 12 + Math.random() * 10,
        key: i,
      })),
    [],
  );
  return (
    <div className="coin-burst" aria-hidden="true">
      {coins.map((c) => (
        <span
          key={c.key}
          style={
            {
              left: `${c.left}%`,
              width: c.size,
              height: c.size,
              animationDelay: `${c.delay}s`,
              animationDuration: `${c.duration}s`,
              '--dx': c.dx,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}

function AnimatedAmount({ value }: { value: number }) {
  const [shown, setShown] = useState(prefersReducedMotion() ? value : 0);
  useEffect(() => {
    if (prefersReducedMotion()) {
      setShown(value);
      return;
    }
    const start = performance.now();
    const dur = 900;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / dur);
      setShown(Math.round(value * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{formatCredits(shown)}</>;
}

/** Kleines Gewinn-Pop-up im Spielfeld: blockiert nichts, verschwindet von selbst (Münzregen bei großen Gewinnen). */
export function WinPop({ outcome, onDone }: { outcome: Outcome | null; onDone: () => void }) {
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    if (!outcome) return;
    const t = window.setTimeout(() => done.current(), 2600);
    return () => window.clearTimeout(t);
  }, [outcome]);
  if (!outcome) return null;
  const { round } = outcome;
  const ratio = round.payout_amount / Math.max(1, round.bet_amount);
  const big = ratio >= 10;
  const showCoins = big && loadPreferences().confetti && !prefersReducedMotion();
  return (
    <>
      {showCoins && <CoinBurst />}
      <div key={round.round_id} className={`win-pop ${big ? 'big' : ''}`} role="status" aria-live="polite">
        <span className="win-pop-label">{big ? 'Großer Gewinn!' : 'Gewonnen'}</span>
        <span className="win-pop-mult">{formatMultiplier(ratio)}</span>
        <span className="win-pop-amount">
          +<AnimatedAmount value={round.profit_amount} /> CR
        </span>
      </div>
    </>
  );
}

/** Gewinn-Pop-up (ResultModal). Große Gewinne: goldener Glow, Münzregen (abschaltbar). */
export function WinModal({
  outcome,
  onClose,
  onPlayAgain,
}: {
  outcome: Outcome | null;
  onClose: () => void;
  onPlayAgain?: () => void;
}) {
  if (!outcome) return null;
  const { round } = outcome;
  const ratio = round.payout_amount / Math.max(1, round.bet_amount);
  const big = ratio >= 5;
  const showCoins = big && loadPreferences().confetti && !prefersReducedMotion();
  return (
    <>
      {showCoins && <CoinBurst />}
      <Modal
        open
        onClose={onClose}
        title={big ? 'Großer Gewinn!' : 'Gewonnen!'}
        className={`win ${big ? 'big-win' : ''}`}
        footer={
          <>
            <Button onClick={onClose}>Schließen</Button>
            {onPlayAgain && (
              <Button
                variant="gold"
                onClick={() => {
                  onClose();
                  onPlayAgain();
                }}
              >
                Noch einmal spielen
              </Button>
            )}
          </>
        }
      >
        <div className="stack">
          <p className="center subtle">{outcome.gameName}</p>
          <div className="result-amount gold" aria-live="polite">
            +<AnimatedAmount value={round.profit_amount} /> <span style={{ fontSize: 16 }}>Credits</span>
          </div>
          <p className="center">{outcome.description}</p>
          <dl className="kv">
            <dt>Einsatz</dt>
            <dd>{formatCredits(round.bet_amount)} Credits</dd>
            <dt>Auszahlung</dt>
            <dd className="gold">{formatCredits(round.payout_amount)} Credits</dd>
            {outcome.multiplier ? (
              <>
                <dt>Multiplikator</dt>
                <dd>{formatMultiplier(outcome.multiplier)}</dd>
              </>
            ) : null}
            <dt>Neuer Kontostand</dt>
            <dd>{formatCredits(round.balance)} Credits</dd>
            <dt>Runden-ID</dt>
            <dd>
              <Link to={`/historie?runde=${round.round_id}`} onClick={onClose}>
                {shortId(round.round_id)}
              </Link>
            </dd>
          </dl>
        </div>
      </Modal>
    </>
  );
}

/** Verlust-Pop-up: ruhig und sachlich (für Runden mit mehreren Schritten). */
export function LossModal({ outcome, onClose, onPlayAgain }: { outcome: Outcome | null; onClose: () => void; onPlayAgain?: () => void }) {
  if (!outcome) return null;
  return (
    <Modal
      open
      onClose={onClose}
      title="Runde beendet"
      footer={
        <>
          <Button onClick={onClose}>Schließen</Button>
          {onPlayAgain && (
            <Button variant="primary" onClick={() => (onClose(), onPlayAgain())}>
              Noch einmal spielen
            </Button>
          )}
        </>
      }
    >
      <p className="subtle">{outcome.description}</p>
      <dl className="kv" style={{ marginTop: 12 }}>
        <dt>Einsatz</dt>
        <dd>{formatCredits(outcome.round.bet_amount)} Credits</dd>
        <dt>Kontostand</dt>
        <dd>{formatCredits(outcome.round.balance)} Credits</dd>
      </dl>
    </Modal>
  );
}

export function InsufficientBalanceModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const { dashboard } = useAppData();
  const bonusAvailable = dashboard && !dashboard.bonus.claimed;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Zu wenig Credits"
      footer={
        <>
          <Button onClick={onClose}>Schließen</Button>
          <Button
            variant="primary"
            onClick={() => {
              onClose();
              navigate(bonusAvailable ? '/' : '/anfragen');
            }}
          >
            {bonusAvailable ? 'Tagesbonus abholen' : 'Credits anfragen'}
          </Button>
        </>
      }
    >
      <p className="subtle">
        Dein Kontostand reicht für diesen Einsatz nicht aus. Reduziere den Einsatz,
        {bonusAvailable ? ' hole deinen Tagesbonus ab' : ' stelle eine Credit-Anfrage an den Admin'} oder warte auf den
        nächsten Tagesbonus.
      </p>
      <p className="small muted" style={{ marginTop: 10 }}>
      </p>
    </Modal>
  );
}

export function GameUnavailable({ title, reason }: { title: string; reason: string }) {
  return (
    <div className="card stack center" style={{ maxWidth: 520, margin: '40px auto' }}>
      <h1>{title}</h1>
      <p className="subtle">{reason}</p>
      <Link to="/casino" className="btn">
        Zur Casino-Lobby
      </Link>
    </div>
  );
}
