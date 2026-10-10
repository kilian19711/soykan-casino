import { useState } from 'react';
import { api } from '../../../lib/api';
import { newIdempotencyKey } from '../../../lib/misc';
import { formatCredits, formatMultiplier } from '../../../lib/format';
import { prefersReducedMotion } from '../../../lib/preferences';
import { useAppData } from '../../../app/AppData';
import { Button } from '../../../components/Button';
import { useHotkey } from '../../../hooks/useHotkey';
import { BetControls, GameFrame, RecentRounds, limitsOf, useBet, useRoundRunner } from '../shared';
import { diceChance, diceMultiplier, dicePayout, validateBet } from '../logic';
import type { GameConfig } from '../../../types';

interface DiceResult {
  roll: number;
  target: number;
  over: boolean;
  chance: number;
  multiplier: number;
  win: boolean;
}

export default function DiceGame({ config }: { config: GameConfig }) {
  const limits = limitsOf(config);
  const [bet, setBet] = useBet(limits);
  const [target, setTarget] = useState(5000);
  const [over, setOver] = useState(false);
  const [roll, setRoll] = useState<number | null>(null);
  const [lastWin, setLastWin] = useState<boolean | null>(null);
  const runner = useRoundRunner('dice', config.display_name);
  const { balance } = useAppData();

  const chance = diceChance(target, over);
  const valid = chance >= 100 && chance <= 9800;
  const mult = diceMultiplier(chance);
  const betError = validateBet(bet, limits, balance);

  const play = async () => {
    if (!valid || betError) return;
    const res = await runner.run(() => api.playDice(bet, target, over, newIdempotencyKey('dice')));
    if (!res) return;
    const r = res.result as unknown as DiceResult;
    setRoll(r.roll);
    setLastWin(r.win);
    window.setTimeout(
      () => runner.announce(res, `Wurf ${(r.roll / 100).toFixed(2)} · ${r.over ? 'über' : 'unter'} ${(r.target / 100).toFixed(2)}`, r.multiplier),
      prefersReducedMotion() ? 0 : 520,
    );
  };

  useHotkey([' ', 'Enter'], () => void play(), !runner.busy);

  const winFrom = over ? target / 100 : 0;
  const winTo = over ? 100 : target / 100;

  return (
    <GameFrame
      title={config.display_name}
      subtitle="Wähle Ziel und Richtung – gewürfelt wird eine Zahl von 0,00 bis 99,99."
      runner={runner}
      onPlayAgain={() => void play()}
      rules={
        <>
          <p>
            Gewürfelt wird eine Zufallszahl zwischen <strong>0,00 und 99,99</strong>. Du gewinnst, wenn sie
            <strong> unter</strong> (bzw. <strong>über</strong>) deinem Zielwert liegt.
          </p>
          <p>Gewinnchance: 1 % bis 98 %. Auszahlung = Einsatz × 99 / Gewinnchance (1 % Hausvorteil).</p>
          <p>Beispiel: 49,5 % Gewinnchance → 2,00× Auszahlung.</p>
          <p>Tastatur: Leertaste oder Enter würfelt.</p>
        </>
      }
      controls={
        <>
          <BetControls value={bet} onChange={setBet} limits={limits} disabled={runner.busy} />
          <div className="field">
            <span className="field-label">Richtung</span>
            <div className="segmented" role="group" aria-label="Richtung">
              <button type="button" aria-pressed={!over} onClick={() => setOver(false)} disabled={runner.busy}>
                Unter
              </button>
              <button type="button" aria-pressed={over} onClick={() => setOver(true)} disabled={runner.busy}>
                Über
              </button>
            </div>
          </div>
          <div className="field">
            <label htmlFor="dice-target">
              Zielwert: <span className="mono">{(target / 100).toFixed(2)}</span>
            </label>
            <input
              id="dice-target"
              type="range"
              min={over ? 199 : 100}
              max={over ? 9899 : 9800}
              step={1}
              value={target}
              disabled={runner.busy}
              onChange={(e) => setTarget(Number(e.target.value))}
            />
          </div>
          <dl className="kv">
            <dt>Gewinnchance</dt>
            <dd>{(chance / 100).toFixed(2)} %</dd>
            <dt>Multiplikator</dt>
            <dd>{formatMultiplier(mult, 4)}</dd>
            <dt>Möglicher Gewinn</dt>
            <dd className="gold">{formatCredits(dicePayout(bet, chance))} Credits</dd>
          </dl>
          <Button variant="primary" size="lg" block loading={runner.busy} disabled={!valid || !!betError} onClick={() => void play()}>
            Würfeln
          </Button>
        </>
      }
      stage={
        <div className="stack" style={{ padding: '30px 6px' }}>
          <div className="center">
            <div
              className={`stat-value xl ${lastWin === null ? '' : lastWin ? 'success' : 'subtle'}`}
              style={{ fontSize: 56 }}
              aria-live="polite"
            >
              {roll === null ? '–' : (roll / 100).toFixed(2)}
            </div>
            <div className="small subtle">{roll === null ? 'Noch kein Wurf' : lastWin ? 'Treffer!' : 'Kein Treffer'}</div>
          </div>
          <div style={{ position: 'relative', height: 46, marginTop: 24 }}>
            <div style={{ position: 'absolute', inset: '16px 0', borderRadius: 8, background: 'rgba(239,68,68,.35)' }} />
            <div
              style={{
                position: 'absolute',
                top: 16,
                bottom: 16,
                left: `${winFrom}%`,
                width: `${winTo - winFrom}%`,
                borderRadius: 8,
                background: 'rgba(34,197,94,.65)',
                transition: 'all .2s',
              }}
            />
            {roll !== null && (
              <div
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  top: 0,
                  left: `calc(${roll / 100}% - 14px)`,
                  width: 28,
                  height: 46,
                  borderRadius: 8,
                  background: '#f8fafc',
                  boxShadow: '0 4px 14px rgba(0,0,0,.5)',
                  transition: 'left .5s cubic-bezier(.2,.9,.3,1)',
                  display: 'grid',
                  placeItems: 'center',
                  color: '#0d0f14',
                  fontWeight: 800,
                  fontSize: 10,
                  fontFamily: 'var(--mono)',
                }}
              >
                {Math.round(roll / 100)}
              </div>
            )}
          </div>
          <div className="row-between small muted mono">
            <span>0</span>
            <span>25</span>
            <span>50</span>
            <span>75</span>
            <span>100</span>
          </div>
        </div>
      }
      recent={<RecentRounds rounds={runner.recent} label={(r) => (Number((r.result as { roll?: number }).roll ?? 0) / 100).toFixed(2)} />}
    />
  );
}
