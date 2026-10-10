import { useEffect, useRef, useState } from 'react';
import { api } from '../../../lib/api';
import { newIdempotencyKey } from '../../../lib/misc';
import { formatCredits, formatMultiplierH } from '../../../lib/format';
import { prefersReducedMotion } from '../../../lib/preferences';
import { useAppData } from '../../../app/AppData';
import { Button } from '../../../components/Button';
import { useHotkey } from '../../../hooks/useHotkey';
import { BetControls, GameFrame, RecentRounds, limitsOf, useBet, useRoundRunner } from '../shared';
import { limboWinChance, validateBet } from '../logic';
import type { GameConfig } from '../../../types';

interface LimboResult {
  result_multiplier: number;
  target_multiplier: number;
  win: boolean;
}

export default function LimboGame({ config }: { config: GameConfig }) {
  const limits = limitsOf(config);
  const [bet, setBet] = useBet(limits);
  const [targetText, setTargetText] = useState('2.00');
  const [display, setDisplay] = useState<number | null>(null);
  const [result, setResult] = useState<LimboResult | null>(null);
  const runner = useRoundRunner('limbo', config.display_name);
  const { balance } = useAppData();
  const raf = useRef(0);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const targetNum = Number(targetText.replace(',', '.'));
  const targetH = Math.round(targetNum * 100);
  const targetError =
    !Number.isFinite(targetNum) || targetH < 101 ? 'Mindestens 1,01×' : targetH > 100000000 ? 'Höchstens 1.000.000×' : null;
  const betError = validateBet(bet, limits, balance);

  const animateTo = (value: number, done: () => void) => {
    if (prefersReducedMotion()) {
      setDisplay(value);
      done();
      return;
    }
    const start = performance.now();
    const dur = Math.min(900, 300 + Math.log10(value / 100 + 1) * 300);
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(Math.round(100 + (value - 100) * eased));
      if (p < 1) raf.current = requestAnimationFrame(tick);
      else done();
    };
    raf.current = requestAnimationFrame(tick);
  };

  const play = async () => {
    if (targetError || betError) return;
    setResult(null);
    const res = await runner.run(() => api.playLimbo(bet, targetH, newIdempotencyKey('limbo')));
    if (!res) return;
    const r = res.result as unknown as LimboResult;
    animateTo(r.result_multiplier, () => {
      setResult(r);
      runner.announce(
        res,
        `Ergebnis ${formatMultiplierH(r.result_multiplier)} · Ziel ${formatMultiplierH(r.target_multiplier)}`,
        r.win ? r.target_multiplier / 100 : null,
      );
    });
  };

  useHotkey([' ', 'Enter'], () => void play(), !runner.busy);

  return (
    <GameFrame
      title={config.display_name}
      subtitle="Lege einen Zielmultiplikator fest. Erreicht der Servermultiplikator dein Ziel, gewinnst du."
      runner={runner}
      onPlayAgain={() => void play()}
      rules={
        <>
          <p>
            Du wählst einen <strong>Zielmultiplikator</strong> (1,01× bis 1.000.000×). Dann wird ein zufälliger
            Ergebnismultiplikator gezogen.
          </p>
          <p>
            Ist das Ergebnis <strong>größer oder gleich</strong> deinem Ziel, erhältst du Einsatz × Zielmultiplikator. Sonst
            ist der Einsatz verloren.
          </p>
          <p>Gewinnchance = 99 % / Zielmultiplikator (z. B. 2,00× → 49,5 %).</p>
        </>
      }
      controls={
        <>
          <BetControls value={bet} onChange={setBet} limits={limits} disabled={runner.busy} />
          <div className="field">
            <label htmlFor="limbo-target">Zielmultiplikator</label>
            <div className="input-group">
              <input
                id="limbo-target"
                className="input mono"
                inputMode="decimal"
                value={targetText}
                disabled={runner.busy}
                aria-invalid={targetError ? true : undefined}
                onChange={(e) => setTargetText(e.target.value.replace(/[^0-9.,]/g, '').slice(0, 10))}
              />
              <span className="addon">×</span>
            </div>
            <div className="chip-group">
              {['1.5', '2', '3', '5', '10', '100'].map((v) => (
                <button key={v} type="button" className="chip" disabled={runner.busy} onClick={() => setTargetText(Number(v).toFixed(2))}>
                  {v}×
                </button>
              ))}
            </div>
            {targetError && <span className="field-error">{targetError}</span>}
          </div>
          <dl className="kv">
            <dt>Gewinnchance</dt>
            <dd>{targetError ? '–' : `${(limboWinChance(targetH) * 100).toFixed(4)} %`}</dd>
            <dt>Möglicher Gewinn</dt>
            <dd className="gold">{targetError ? '–' : `${formatCredits(Math.floor((bet * targetH) / 100))} Credits`}</dd>
          </dl>
          <Button variant="primary" size="lg" block loading={runner.busy} disabled={!!targetError || !!betError} onClick={() => void play()}>
            Spielen
          </Button>
        </>
      }
      stage={
        <div className="center stack" style={{ padding: '48px 0', minHeight: 260, justifyContent: 'center' }}>
          <div
            className={`stat-value ${result ? (result.win ? 'success' : 'danger') : ''}`}
            style={{ fontSize: 'clamp(44px, 12vw, 80px)', transition: 'color .2s' }}
            aria-live="polite"
          >
            {display === null ? '1,00×' : formatMultiplierH(display)}
          </div>
          <div className="subtle">
            {result ? (result.win ? 'Ziel erreicht!' : 'Ziel verfehlt') : `Ziel: ${targetError ? '–' : formatMultiplierH(targetH)}`}
          </div>
        </div>
      }
      recent={
        <RecentRounds
          rounds={runner.recent}
          label={(r) => formatMultiplierH(Number((r.result as { result_multiplier?: number }).result_multiplier ?? 100))}
        />
      }
    />
  );
}
