import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../../lib/api';
import { newIdempotencyKey, serverNow } from '../../../lib/misc';
import { formatCredits, formatMultiplierH } from '../../../lib/format';
import { useAppData } from '../../../app/AppData';
import { Button } from '../../../components/Button';
import { useHotkey } from '../../../hooks/useHotkey';
import { BetControls, GameFrame, limitsOf, useBet, useRoundRunner } from '../shared';
import { CRASH_GROWTH, crashMultiplierAt, validateBet } from '../logic';
import type { GameConfig, RoundResponse } from '../../../types';

interface CrashResult {
  phase: 'waiting' | 'running' | 'settled';
  run_start: string;
  auto_cashout: number | null;
  crash_point?: number;
  cashout_multiplier?: number | null;
  win?: boolean;
  auto?: boolean;
}

type Phase = 'idle' | 'waiting' | 'running' | 'crashed' | 'settled';

const PHASE_LABEL: Record<Phase, string> = {
  idle: 'Bereit',
  waiting: 'Wartet',
  running: 'Läuft',
  crashed: 'Gecrasht',
  settled: 'Abgerechnet',
};

export default function CrashGame({ config }: { config: GameConfig }) {
  const limits = limitsOf(config);
  const [bet, setBet] = useBet(limits);
  const [autoText, setAutoText] = useState('');
  const [round, setRound] = useState<RoundResponse<CrashResult> | null>(null);
  const [mult, setMult] = useState(100);
  const [elapsed, setElapsed] = useState(0);
  const [phase, setPhase] = useState<Phase>('idle');
  const [history, setHistory] = useState<number[]>([]);
  const runner = useRoundRunner('crash', config.display_name);
  const { announce } = runner;
  const { balance } = useAppData();
  const raf = useRef(0);
  const pollTimer = useRef<number | undefined>(undefined);
  const roundRef = useRef<RoundResponse<CrashResult> | null>(null);
  const announced = useRef<string | null>(null);
  const cashingOut = useRef(false);

  const loadHistory = useCallback(() => {
    api
      .crashHistory()
      .then((h) => setHistory(h.map((x) => Number(x.crash_point)).filter(Boolean)))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    loadHistory();
    const id = window.setInterval(loadHistory, 15000);
    return () => window.clearInterval(id);
  }, [loadHistory]);

  const autoNum = autoText ? Number(autoText.replace(',', '.')) : null;
  const autoH = autoNum ? Math.round(autoNum * 100) : null;
  const autoError = autoText && (!autoNum || autoH! < 101 || autoH! > 100000000) ? 'Auto-Cashout: 1,01× bis 1.000.000×' : null;
  const betError = validateBet(bet, limits, balance);

  const stopLoops = () => {
    cancelAnimationFrame(raf.current);
    window.clearTimeout(pollTimer.current);
  };

  const finish = useCallback(
    (r: RoundResponse<CrashResult>) => {
      stopLoops();
      roundRef.current = r;
      setRound(r);
      const res = r.result;
      const crashed = !res.win;
      setPhase(crashed ? 'crashed' : 'settled');
      setMult(crashed ? Number(res.crash_point ?? 100) : Number(res.cashout_multiplier ?? 100));
      if (announced.current !== r.round_id) {
        announced.current = r.round_id;
        const desc = res.win
          ? `${res.auto ? 'Auto-Cashout' : 'Cashout'} bei ${formatMultiplierH(Number(res.cashout_multiplier))} · Crash bei ${formatMultiplierH(Number(res.crash_point))}`
          : `Crash bei ${formatMultiplierH(Number(res.crash_point))}`;
        announce(r, desc, res.win ? Number(res.cashout_multiplier) / 100 : null);
        loadHistory();
      }
    },
    [announce, loadHistory],
  );

  const poll = useCallback(async () => {
    const r = roundRef.current;
    if (!r || r.status !== 'active') return;
    try {
      const next = (await api.crashPoll(r.round_id)) as RoundResponse<CrashResult>;
      if (next.status === 'settled') {
        finish(next);
        return;
      }
    } catch {
      /* Netzwerkfehler: weiter versuchen */
    }
    pollTimer.current = window.setTimeout(() => void poll(), 450);
  }, [finish]);

  const startLoops = useCallback(
    (r: RoundResponse<CrashResult>) => {
      stopLoops();
      roundRef.current = r;
      const runStart = new Date(r.result.run_start).getTime();
      const tick = () => {
        const now = serverNow();
        if (now < runStart) {
          setPhase('waiting');
          setMult(100);
          setElapsed(runStart - now);
        } else {
          setPhase('running');
          const t = now - runStart;
          setElapsed(t);
          setMult(crashMultiplierAt(t));
        }
        raf.current = requestAnimationFrame(tick);
      };
      raf.current = requestAnimationFrame(tick);
      const firstPoll = Math.max(300, runStart - serverNow() + 200);
      pollTimer.current = window.setTimeout(() => void poll(), firstPoll);
    },
    [poll],
  );

  useEffect(() => {
    api
      .getActiveRound<CrashResult>('crash')
      .then((r) => {
        if (r && r.status === 'active') {
          setRound(r);
          startLoops(r);
        }
      })
      .catch(() => undefined);
    return () => stopLoops();
  }, [startLoops]);

  const start = async () => {
    if (betError || autoError || (round && round.status === 'active')) return;
    runner.clearOutcome();
    const r = await runner.run(() => api.crashStart(bet, autoH, newIdempotencyKey('crash')));
    if (!r) return;
    const typed = r as RoundResponse<CrashResult>;
    setRound(typed);
    announced.current = null;
    startLoops(typed);
  };

  const cashout = async () => {
    const r = roundRef.current;
    if (!r || r.status !== 'active' || phase !== 'running' || cashingOut.current) return;
    cashingOut.current = true;
    const next = await runner.run(() => api.crashCashout(r.round_id));
    cashingOut.current = false;
    if (next && next.status === 'settled') finish(next as RoundResponse<CrashResult>);
  };

  useHotkey([' ', 'Enter', 'c', 'C'], () => {
    if (phase === 'running') void cashout();
    else if (phase !== 'waiting') void start();
  }, !runner.busy);

  const active = round?.status === 'active';
  const potential = active ? Math.floor((round!.bet_amount * mult) / 100) : 0;

  // Kurve
  const W = 400;
  const H = 220;
  const tMax = Math.max(8000, phase === 'running' || phase === 'crashed' || phase === 'settled' ? elapsed * 1.15 : 0);
  const mMax = Math.max(200, mult * 1.2);
  const pts: string[] = [];
  const tEnd = phase === 'waiting' || phase === 'idle' ? 0 : phase === 'running' ? elapsed : Math.log(Math.max(mult, 100) / 100) / CRASH_GROWTH;
  for (let i = 0; i <= 40; i++) {
    const t = (tEnd * i) / 40;
    const m = 100 * Math.exp(CRASH_GROWTH * t);
    pts.push(`${(t / tMax) * W},${H - ((m - 100) / (mMax - 100)) * (H - 20)}`);
  }
  const color = phase === 'crashed' ? '#ef4444' : phase === 'settled' ? '#22c55e' : '#f3c969';

  return (
    <GameFrame
      title={config.display_name}
      subtitle="Der Multiplikator steigt – zahle aus, bevor er crasht."
      runner={runner}
      onPlayAgain={() => void start()}
      rules={
        <>
          <p>
            Nach deinem Einsatz startet die Runde nach 3 Sekunden. Der Multiplikator steigt von 1,00× an. Der{' '}
            <strong>Crash-Zeitpunkt steht beim Start fest</strong> und bleibt bis zum Ende geheim.
          </p>
          <p>
            Klicke <strong>Cashout</strong> vor dem Crash, um Einsatz × aktuellen Multiplikator zu erhalten. Bei schlechter
            Verbindung zählt der Moment, in dem dein Cashout ankommt – also lieber etwas früher drücken.
          </p>
          <p>Optional: Auto-Cashout bei einem Zielmultiplikator. Crasht die Runde vorher, ist der Einsatz verloren.</p>
          <p>Status: Wartet → Läuft → Gecrasht bzw. Abgerechnet. Die Leiste „Letzte Crashes" zeigt die Runden aller Spieler.</p>
          <p>Tastatur: Leertaste/Enter startet bzw. zahlt aus.</p>
        </>
      }
      controls={
        <>
          <BetControls value={bet} onChange={setBet} limits={limits} disabled={active || runner.busy} />
          <div className="field">
            <label htmlFor="crash-auto">Auto-Cashout (optional)</label>
            <div className="input-group">
              <input
                id="crash-auto"
                className="input mono"
                inputMode="decimal"
                placeholder="z. B. 2.00"
                value={autoText}
                disabled={active || runner.busy}
                onChange={(e) => setAutoText(e.target.value.replace(/[^0-9.,]/g, '').slice(0, 10))}
              />
              <span className="addon">×</span>
            </div>
            {autoError && <span className="field-error">{autoError}</span>}
          </div>
          {active ? (
            <Button
              variant="gold"
              size="lg"
              block
              loading={runner.busy}
              disabled={phase !== 'running'}
              onClick={() => void cashout()}
            >
              {phase === 'waiting' ? 'Startet gleich …' : `Cashout ${formatCredits(potential)} Credits`}
            </Button>
          ) : (
            <Button variant="primary" size="lg" block loading={runner.busy} disabled={!!betError || !!autoError} onClick={() => void start()}>
              Einsatz platzieren
            </Button>
          )}
        </>
      }
      stage={
        <div className="stack">
          <div className="row-between">
            <span className={`badge ${phase === 'running' ? 'badge-success' : phase === 'crashed' ? 'badge-danger' : phase === 'settled' ? 'badge-gold' : ''}`}>
              {phase === 'running' && <span className="live-dot" />} {PHASE_LABEL[phase]}
            </span>
            {round && <span className="small muted mono">Einsatz {formatCredits(round.bet_amount)} Credits</span>}
          </div>
          <div style={{ position: 'relative' }}>
            <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="Multiplikatorkurve">
              {[0.25, 0.5, 0.75].map((f) => (
                <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} stroke="#252a38" strokeDasharray="4 6" />
              ))}
              {pts.length > 1 && tEnd > 0 && (
                <>
                  <polyline points={`0,${H} ${pts.join(' ')} ${pts[pts.length - 1].split(',')[0]},${H}`} fill={color} opacity=".12" />
                  <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="3.5" strokeLinecap="round" />
                </>
              )}
            </svg>
            <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none' }}>
              <div className="center">
                <div className="stat-value" style={{ fontSize: 'clamp(40px, 11vw, 68px)', color }} aria-live="off">
                  {phase === 'waiting' ? `${(elapsed / 1000).toFixed(1)} s` : formatMultiplierH(mult)}
                </div>
                <div className="small subtle" aria-live="polite">
                  {phase === 'crashed'
                    ? 'Gecrasht!'
                    : phase === 'settled'
                      ? 'Ausgezahlt'
                      : phase === 'waiting'
                        ? 'Runde startet …'
                        : phase === 'running'
                          ? `Möglicher Gewinn: ${formatCredits(potential)} Credits`
                          : 'Platziere einen Einsatz'}
                </div>
              </div>
            </div>
          </div>
        </div>
      }
      recent={
        <div>
          <div className="label" style={{ marginBottom: 6 }}>
            Letzte Crashes (alle Spieler)
          </div>
          <div className="recent-results">
            {history.length ? (
              history.map((h, i) => (
                <span key={i} className={`result-chip ${h >= 200 ? 'win' : 'loss'}`}>
                  {formatMultiplierH(h)}
                </span>
              ))
            ) : (
              <span className="small muted">Noch keine Runden.</span>
            )}
          </div>
        </div>
      }
    />
  );
}
