// Gemeinsame Bausteine für die generischen Spiele (play_game / step_*).
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '../../lib/api';
import { newIdempotencyKey } from '../../lib/misc';
import { formatCredits, formatMultiplier } from '../../lib/format';
import { prefersReducedMotion } from '../../lib/preferences';
import { useAppData } from '../../app/AppData';
import { Button } from '../../components/Button';
import { useHotkey } from '../../hooks/useHotkey';
import { BetControls, GameFrame, RecentRounds, limitsOf, useBet, useRoundRunner } from './shared';
import { validateBet } from './logic';
import type { GameConfig, GameRoundRow, RoundResponse } from '../../types';

export type R = Record<string, unknown>;

export interface SimpleGameProps<P extends R> {
  config: GameConfig;
  subtitle: string;
  rules: ReactNode;
  /** Zusätzliche Spielparameter (Auswahl). Gibt null zurück, wenn die Auswahl noch unvollständig ist. */
  params: () => P | null;
  paramsHint?: string;
  controls?: (disabled: boolean) => ReactNode;
  /** Spielfeld; `result` ist null vor der ersten Runde, `animating` während der Ergebnisanimation */
  stage: (result: R | null, animating: boolean) => ReactNode;
  /** Dauer der Ergebnisanimation (ms) */
  animationMs?: number | ((result: R) => number);
  describe: (result: R) => string;
  recentLabel?: (r: GameRoundRow) => string;
  playLabel?: string;
  /** Gesamteinsatz weicht vom Einsatzfeld ab (z. B. Sic Bo) */
  totalBet?: () => number;
  hideBet?: boolean;
  onResult?: (result: R) => void;
  /** Eigener Server-Aufruf statt play_game (neue Spiele) */
  playFn?: (bet: number, params: P, key: string) => Promise<RoundResponse>;
}

export function SimpleGame<P extends R>(props: SimpleGameProps<P>) {
  const { config } = props;
  const limits = limitsOf(config);
  const [bet, setBet] = useBet(limits);
  const [result, setResult] = useState<R | null>(null);
  const [animating, setAnimating] = useState(false);
  const runner = useRoundRunner(config.game_key, config.display_name);
  const { balance } = useAppData();
  const total = props.totalBet ? props.totalBet() : bet;
  const betError = props.totalBet
    ? total < limits.min
      ? `Mindesteinsatz gesamt: ${limits.min}`
      : total > limits.max
        ? `Höchsteinsatz gesamt: ${formatCredits(limits.max)}`
        : balance !== null && total > balance
          ? 'Nicht genug Credits.'
          : null
    : validateBet(bet, limits, balance);
  const params = props.params();

  const play = async () => {
    if (betError || !params || animating) return;
    const key = newIdempotencyKey(config.game_key);
    const res = await runner.run(() => (props.playFn ? props.playFn(total, params, key) : api.playGame(config.game_key, total, params, key)));
    if (!res) return;
    const r = (res.result ?? {}) as R;
    const dur = prefersReducedMotion() ? 0 : typeof props.animationMs === 'function' ? props.animationMs(r) : (props.animationMs ?? 600);
    setResult(r);
    setAnimating(dur > 0);
    window.setTimeout(() => {
      setAnimating(false);
      props.onResult?.(r);
      runner.announce(res, props.describe(r), Number(r.mult) > 0 ? Number(r.mult) : null);
    }, dur);
  };

  useHotkey([' ', 'Enter'], () => void play(), !runner.busy && !animating);
  const busy = runner.busy || animating;

  return (
    <GameFrame
      title={config.display_name}
      subtitle={props.subtitle}
      runner={runner}
      onPlayAgain={() => void play()}
      rules={props.rules}
      controls={
        <>
          {!props.hideBet && <BetControls value={bet} onChange={setBet} limits={limits} disabled={busy} />}
          {props.controls?.(busy)}
          {props.totalBet && (
            <dl className="kv">
              <dt>Gesamteinsatz</dt>
              <dd className="gold">{formatCredits(total)}</dd>
            </dl>
          )}
          {props.paramsHint && !params && <p className="small muted">{props.paramsHint}</p>}
          {props.totalBet && betError && total > 0 && <span className="field-error">{betError}</span>}
          <Button variant="primary" size="lg" block loading={busy} disabled={!!betError || !params} onClick={() => void play()}>
            {props.playLabel ?? 'Spielen'}
          </Button>
        </>
      }
      stage={props.stage(result, animating)}
      recent={
        <RecentRounds
          rounds={runner.recent}
          label={props.recentLabel ?? ((r) => (r.payout_amount > 0 ? formatMultiplier(r.payout_amount / r.bet_amount) : '0×'))}
        />
      }
    />
  );
}

/** Zustand einer mehrstufigen Runde inkl. Fortsetzen nach Reload. */
export function useStepRound<T extends R>(gameKey: string) {
  const [round, setRound] = useState<RoundResponse<T> | null>(null);
  useEffect(() => {
    api
      .getActiveRound<T>(gameKey)
      .then((r) => r && setRound(r))
      .catch(() => undefined);
  }, [gameKey]);
  const active = round?.status === 'active';
  const seq = Number((round?.result as R | undefined)?.actions ?? 0);
  return { round, setRound, active, seq };
}

export function useStepActions<T extends R>(gameKey: string, displayName: string, step: ReturnType<typeof useStepRound<T>>) {
  const runner = useRoundRunner(gameKey, displayName);
  const settle = useCallback(
    (r: RoundResponse<T>, describe: (res: T) => string) => {
      step.setRound(r);
      if (r.status === 'settled') {
        const res = r.result as T;
        runner.announce(r, describe(res), r.payout_amount > 0 ? r.payout_amount / r.bet_amount : null);
      }
    },
    [runner, step],
  );
  const start = async (bet: number, params: R, describe: (res: T) => string) => {
    runner.clearOutcome();
    const r = await runner.run(() => api.stepStart(gameKey, bet, params, newIdempotencyKey(gameKey)));
    if (r) settle(r as RoundResponse<T>, describe);
  };
  const act = async (action: R, describe: (res: T) => string) => {
    if (!step.round) return;
    const r = await runner.run(() => api.stepAction(step.round!.round_id, action, step.seq));
    if (r) settle(r as RoundResponse<T>, describe);
  };
  const cashout = async (describe: (res: T) => string) => {
    if (!step.round) return;
    const r = await runner.run(() => api.stepCashout(step.round!.round_id));
    if (r) settle(r as RoundResponse<T>, describe);
  };
  return { runner, start, act, cashout };
}

export function Choice<T extends string | number>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="segmented" role="group" aria-label={label}>
        {options.map(([v, l]) => (
          <button key={String(v)} type="button" aria-pressed={value === v} disabled={disabled} onClick={() => onChange(v)}>
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}

export function PayTable({ rows }: { rows: [string, string][] }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <tbody>
          {rows.map(([a, b]) => (
            <tr key={a}>
              <td>{a}</td>
              <td className="num">{b}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Großes Ergebnis in der Mitte des Spielfelds */
export function BigResult({ text, sub, tone }: { text: string; sub?: string; tone?: 'win' | 'loss' | null }) {
  return (
    <div className="center" style={{ padding: '18px 0' }} aria-live="polite">
      <div className={`stat-value ${tone === 'win' ? 'success' : tone === 'loss' ? 'subtle' : ''}`} style={{ fontSize: 'clamp(34px, 9vw, 54px)' }}>
        {text}
      </div>
      {sub && <div className="small subtle">{sub}</div>}
    </div>
  );
}

export const tone = (r: R | null, animating: boolean): 'win' | 'loss' | null =>
  !r || animating ? null : Number(r.mult) >= 1 ? 'win' : 'loss';
