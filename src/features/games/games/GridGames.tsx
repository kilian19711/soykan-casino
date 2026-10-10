import { useState } from 'react';
import type { GameConfig } from '../../../types';
import { formatCredits, formatMultiplier } from '../../../lib/format';
import { Button } from '../../../components/Button';
import { useAppData } from '../../../app/AppData';
import { BigResult, Choice, PayTable, useStepActions, useStepRound, type R } from '../engine';
import { BetControls, GameFrame, RecentRounds, limitsOf, useBet } from '../shared';
import { validateBet } from '../logic';

// ---------------------------------------------------------------- Towers / Gem Hunt (gleiche Engine)
interface TowerRes extends R {
  cols: number;
  bombs: number;
  floors: number;
  floor: number;
  picks: number[];
  multiplier: number;
  next_multiplier: number;
  state: string;
  bomb_rows?: (number[] | number)[];
  difficulty: string;
}

function TowerGame({ config, theme }: { config: GameConfig; theme: 'tower' | 'gems' }) {
  const limits = limitsOf(config);
  const [bet, setBet] = useBet(limits);
  const levels = config.config.levels as Record<string, { cols: number; bombs: number }>;
  const [difficulty, setDifficulty] = useState(String(config.config.default_level));
  const step = useStepRound<TowerRes>(config.game_key);
  const { runner, start, act, cashout } = useStepActions<TowerRes>(config.game_key, config.display_name, step);
  const { balance } = useAppData();
  const res = step.round?.result;
  const lvl = res ? { cols: res.cols, bombs: res.bombs } : levels[difficulty];
  const floors = res?.floors ?? Number(config.config.floors);
  const betError = validateBet(bet, limits, balance);
  const describe = (r: TowerRes) => (r.state === 'lost' ? `Erwischt auf Ebene ${r.floor + 1}` : `${r.floor} Ebenen · ${formatMultiplier(Number(r.multiplier))}`);
  const multAt = (f: number) => 0.99 * Math.pow(lvl.cols / (lvl.cols - lvl.bombs), f);
  const LEVEL_NAMES: Record<string, string> = { easy: 'Leicht', medium: 'Mittel', hard: 'Schwer', expert: 'Experte', hunt: 'Jagd' };

  return (
    <GameFrame
      title={config.display_name}
      subtitle={theme === 'gems' ? 'Finde in jeder Reihe einen Edelstein – eine Kiste ist verflucht.' : 'Klettere den Turm hinauf, Ebene für Ebene.'}
      runner={runner}
      onPlayAgain={() => void start(bet, { difficulty }, describe)}
      rules={
        <>
          <p>
            Pro Ebene {lvl.cols} Felder, davon {lvl.bombs} {theme === 'gems' ? 'verflucht' : 'Fallen'}. Wähle ein Feld: sicher = nächste Ebene, Falle = Einsatz verloren. Du kannst nach jeder
            Ebene auszahlen. Multiplikator = 0,99 × ({lvl.cols}/{lvl.cols - lvl.bombs})^Ebenen.
          </p>
          <PayTable rows={Array.from({ length: floors }, (_, f): [string, string] => [`Ebene ${f + 1}`, formatMultiplier(multAt(f + 1))])} />
        </>
      }
      controls={
        <>
          <BetControls value={bet} onChange={setBet} limits={limits} disabled={step.active || runner.busy} />
          {Object.keys(levels).length > 1 && (
            <Choice label="Schwierigkeit" value={difficulty} onChange={setDifficulty} disabled={step.active || runner.busy}
              options={Object.keys(levels).map((k): [string, string] => [k, LEVEL_NAMES[k] ?? k])} />
          )}
          {step.active ? (
            <Button variant="gold" size="lg" block loading={runner.busy} disabled={!res?.floor} onClick={() => void cashout(describe)}>
              Auszahlen {formatCredits(Math.floor((step.round?.bet_amount ?? 0) * Number(res?.multiplier ?? 1)))}
            </Button>
          ) : (
            <Button variant="primary" size="lg" block loading={runner.busy} disabled={!!betError} onClick={() => void start(bet, { difficulty }, describe)}>
              Runde starten
            </Button>
          )}
        </>
      }
      stage={
        <div style={{ display: 'flex', flexDirection: 'column-reverse', gap: 6, maxWidth: 420, margin: '0 auto' }}>
          {Array.from({ length: floors }, (_, f) => {
            const isCurrent = step.active && res?.floor === f;
            const picked = res?.picks?.[f];
            // ältere Runden speichern pro Ebene nur eine Zahl statt einer Liste
            const rawBombs: unknown = res?.bomb_rows?.[f];
            const bombs: number[] = Array.isArray(rawBombs) ? rawBombs : typeof rawBombs === 'number' ? [rawBombs] : [];
            return (
              <div key={f} className="row" style={{ gap: 6 }}>
                <span className="mono small muted" style={{ width: 52, textAlign: 'right', flex: 'none' }}>{formatMultiplier(multAt(f + 1))}</span>
                <div style={{ flex: 1, display: 'grid', gridTemplateColumns: `repeat(${lvl.cols}, 1fr)`, gap: 6 }}>
                  {Array.from({ length: lvl.cols }, (_, c) => {
                    const isPick = picked === c;
                    const isBomb = bombs.includes(c);
                    const finished = !!res && !step.active;
                    const reached = !!res && f < (res.floor ?? 0);
                    const lostHere = finished && res?.state === 'lost' && f === res.floor;
                    // Zustand des Feldes: getroffen, sicher gewählt, Falle aufgedeckt, sicher aufgedeckt, aktuell, offen
                    const kind = isPick && isBomb ? 'hit' : isPick ? 'safe' : finished && isBomb ? 'bomb' : finished && (reached || lostHere || bombs.length > 0) ? 'clear' : isCurrent ? 'current' : 'idle';
                    const STYLE: Record<string, { bg: string; border: string; color: string; opacity: number }> = {
                      hit: { bg: 'linear-gradient(180deg,#b91c1c,#7f1d1d)', border: '#ef4444', color: '#fff', opacity: 1 },
                      safe: { bg: 'linear-gradient(180deg,#16a34a,#14532d)', border: '#22c55e', color: '#fff', opacity: 1 },
                      bomb: { bg: 'rgba(239,68,68,0.16)', border: 'rgba(239,68,68,0.45)', color: '#fca5a5', opacity: 1 },
                      clear: { bg: 'rgba(34,197,94,0.08)', border: 'rgba(34,197,94,0.25)', color: '#86efac', opacity: 0.85 },
                      current: { bg: 'linear-gradient(180deg,#2b3245,#1f2433)', border: 'var(--accent)', color: '#fff', opacity: 1 },
                      idle: { bg: 'var(--card)', border: 'var(--border)', color: 'var(--muted)', opacity: step.active ? 0.55 : 0.8 },
                    };
                    const st = STYLE[kind];
                    const symbol = kind === 'hit' ? '✕' : kind === 'safe' ? (theme === 'gems' ? '◆' : '✓') : kind === 'bomb' ? '✕' : kind === 'clear' && theme === 'gems' ? '◇' : '';
                    return (
                      <button key={c} type="button" disabled={!isCurrent || runner.busy} onClick={() => void act({ col: c }, describe)}
                        aria-label={`Ebene ${f + 1}, Feld ${c + 1}`}
                        style={{ height: 38, borderRadius: 9, border: `1px solid ${st.border}`, background: st.bg, color: st.color, WebkitTextFillColor: st.color, opacity: st.opacity,
                          cursor: isCurrent ? 'pointer' : 'default', display: 'grid', placeItems: 'center', fontSize: 18, fontWeight: 800,
                          animation: isPick ? 'popCell .25s ease both' : undefined }}>
                        {symbol}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      }
      recent={<RecentRounds rounds={runner.recent} label={(x) => (x.payout_amount > 0 ? formatMultiplier(x.payout_amount / x.bet_amount) : 'Falle')} />}
    />
  );
}

export const Towers = ({ config }: { config: GameConfig }) => <TowerGame config={config} theme="tower" />;
export const GemHunt = ({ config }: { config: GameConfig }) => <TowerGame config={config} theme="gems" />;

// ---------------------------------------------------------------- Treasure Grid
interface TreasureRes extends R {
  cells: number;
  picks: number[];
  found: number[];
  max_picks: number;
  state: string;
  multiplier?: number;
  all_values?: number[];
}

export function TreasureGrid({ config }: { config: GameConfig }) {
  const limits = limitsOf(config);
  const [bet, setBet] = useBet(limits);
  const step = useStepRound<TreasureRes>('treasure_grid');
  const { runner, start, act } = useStepActions<TreasureRes>('treasure_grid', config.display_name, step);
  const { balance } = useAppData();
  const res = step.round?.result;
  const values = (config.config.values as number[]) ?? [];
  const picks = Number(config.config.picks ?? 3);
  const betError = validateBet(bet, limits, balance);
  const describe = (r: TreasureRes) => `Funde: ${r.found.map((v) => `${v}×`).join(', ')} → ${formatMultiplier(Number(r.multiplier ?? 0))}`;
  return (
    <GameFrame
      title={config.display_name}
      subtitle={`16 Schatzkisten – öffne ${picks}. Dein Gewinn ist der Durchschnitt der Funde.`}
      runner={runner}
      onPlayAgain={() => void start(bet, {}, describe)}
      rules={<p>Die Kisten enthalten {values.map((v) => `${v}×`).join(', ')} (zufällig verteilt). Nach {picks} geöffneten Kisten wird Einsatz × Durchschnitt ausgezahlt.</p>}
      controls={
        <>
          <BetControls value={bet} onChange={setBet} limits={limits} disabled={step.active || runner.busy} />
          {!step.active && (
            <Button variant="primary" size="lg" block loading={runner.busy} disabled={!!betError} onClick={() => void start(bet, {}, describe)}>
              Schatzsuche starten
            </Button>
          )}
          {step.active && <p className="small subtle">Noch {picks - (res?.picks.length ?? 0)} Kiste(n) öffnen.</p>}
        </>
      }
      stage={
        <div className="stack" style={{ alignItems: 'center' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 8, width: 'min(100%, 380px)' }}>
            {Array.from({ length: 16 }, (_, i) => {
              const pi = res?.picks.indexOf(i) ?? -1;
              const val = pi >= 0 ? res!.found[pi] : !step.active && res?.all_values ? res.all_values[i] : null;
              return (
                <button key={`${step.round?.round_id}-${i}`} type="button" disabled={!step.active || pi >= 0 || runner.busy} onClick={() => void act({ cell: i }, describe)}
                  aria-label={`Kiste ${i + 1}${val !== null ? `: ${val}×` : ''}`}
                  style={{ aspectRatio: '1', borderRadius: 12, border: pi >= 0 ? '2px solid var(--gold-bright)' : '1px solid var(--border-strong)',
                    background: val === null ? 'linear-gradient(180deg,#7a5418,#4a3210)' : pi >= 0 ? 'rgba(243,201,105,.18)' : '#ffffff08',
                    color: 'var(--text)', fontFamily: 'var(--mono)', fontWeight: 800, cursor: step.active && pi < 0 ? 'pointer' : 'default',
                    opacity: !step.active && pi < 0 && val !== null ? 0.55 : 1, animation: pi >= 0 ? 'popCell .3s ease both' : undefined }}>
                  {val !== null ? `${val}×` : '?'}
                </button>
              );
            })}
          </div>
          {res && !step.active && <BigResult text={formatMultiplier(Number(res.multiplier ?? 0))} sub="Durchschnitt deiner Funde" tone={Number(res.multiplier) >= 1 ? 'win' : 'loss'} />}
        </div>
      }
      recent={<RecentRounds rounds={runner.recent} label={(x) => formatMultiplier(x.payout_amount / x.bet_amount)} />}
    />
  );
}
