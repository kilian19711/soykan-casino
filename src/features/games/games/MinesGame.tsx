import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { newIdempotencyKey } from '../../../lib/misc';
import { formatCredits, formatMultiplier } from '../../../lib/format';
import { useAppData } from '../../../app/AppData';
import { Button } from '../../../components/Button';
import { useHotkey } from '../../../hooks/useHotkey';
import { BetControls, GameFrame, LossModal, RecentRounds, limitsOf, useBet, useRoundRunner, type Outcome } from '../shared';
import { minesMultiplier, validateBet } from '../logic';
import type { GameConfig, RoundResponse } from '../../../types';

interface MinesResult {
  grid: number;
  mines: number;
  revealed: number[];
  multiplier: number;
  next_multiplier?: number;
  state: 'playing' | 'lost' | 'cashed_out';
  hit?: number;
  mine_positions?: number[];
}

function Gem() {
  return (
    <svg viewBox="0 0 32 32" width="60%" height="60%" aria-hidden="true">
      <path d="M8 12 13 6h6l5 6-8 15Z" fill="#22c55e" />
      <path d="M8 12h16l-8 15Z" fill="#16a34a" />
      <path d="M13 6l-2 6h10l-2-6" stroke="#bbf7d0" strokeWidth="1" fill="none" />
    </svg>
  );
}
function Mine() {
  return (
    <svg viewBox="0 0 32 32" width="60%" height="60%" aria-hidden="true">
      <circle cx="16" cy="17" r="8" fill="#111827" stroke="#f87171" strokeWidth="1.5" />
      <path d="M16 5v4M16 25v3M4 17h4M24 17h4M8 9l3 3M24 9l-3 3" stroke="#f87171" strokeWidth="2" strokeLinecap="round" />
      <circle cx="13" cy="14" r="2" fill="#fca5a5" />
    </svg>
  );
}

export default function MinesGame({ config }: { config: GameConfig }) {
  const limits = limitsOf(config);
  const [bet, setBet] = useBet(limits);
  const [gridSize, setGridSize] = useState(5);
  const [mines, setMines] = useState(3);
  const [round, setRound] = useState<RoundResponse<MinesResult> | null>(null);
  const [pendingCell, setPendingCell] = useState<number | null>(null);
  const [lossOutcome, setLossOutcome] = useState<Outcome | null>(null);
  const runner = useRoundRunner('mines', config.display_name);
  const { balance } = useAppData();

  // Offene Runde nach Reload fortsetzen
  useEffect(() => {
    api
      .getActiveRound<MinesResult>('mines')
      .then((r) => {
        if (r) {
          setRound(r);
          setGridSize(r.result.grid);
          setMines(r.result.mines);
        }
      })
      .catch(() => undefined);
  }, []);

  const active = round?.status === 'active';
  const res = round?.result;
  const cells = (res?.grid ?? gridSize) ** 2;
  const maxMines = gridSize * gridSize - 1;
  const betError = validateBet(bet, limits, balance);
  const revealedCount = res?.revealed.length ?? 0;
  const currentPayout = active && res ? Math.floor(round.bet_amount * res.multiplier) : 0;

  const settle = (r: RoundResponse<MinesResult>) => {
    setRound(r);
    if (r.status === 'settled') {
      const won = r.result.state === 'cashed_out';
      const desc = won
        ? `${r.result.revealed.length} sichere Felder · ${formatMultiplier(Number(r.result.multiplier))}`
        : `Mine getroffen nach ${r.result.revealed.length} sicheren Feldern`;
      runner.announce(r, desc, won ? Number(r.result.multiplier) : null);
      if (!won) setLossOutcome({ round: r, gameName: config.display_name, description: desc });
    }
  };

  const start = async () => {
    if (betError || active) return;
    const r = await runner.run(() => api.minesStart(bet, gridSize, mines, newIdempotencyKey('mines')));
    if (r) {
      runner.clearOutcome();
      setRound(r as RoundResponse<MinesResult>);
    }
  };

  const reveal = async (cell: number) => {
    if (!round || !active || res?.revealed.includes(cell) || runner.busy) return;
    setPendingCell(cell);
    const r = await runner.run(() => api.minesReveal(round.round_id, cell));
    setPendingCell(null);
    if (r) settle(r as RoundResponse<MinesResult>);
  };

  const cashout = async () => {
    if (!round || !active || revealedCount === 0) return;
    const r = await runner.run(() => api.minesCashout(round.round_id));
    if (r) settle(r as RoundResponse<MinesResult>);
  };

  useHotkey(['c', 'C'], () => void cashout(), active && revealedCount > 0 && !runner.busy);
  useHotkey(['Enter'], () => void start(), !active && !runner.busy);

  const size = res?.grid ?? gridSize;

  return (
    <>
    <GameFrame
      title={config.display_name}
      subtitle="Decke sichere Felder auf und steige rechtzeitig aus – jede Mine beendet die Runde."
      runner={runner}
      onPlayAgain={() => void start()}
      rules={
        <>
          <p>
            Wähle Rastergröße (4×4, 5×5, 6×6) und Minenanzahl. Die Minen werden beim Start zufällig
            verteilt und bleiben bis zum Rundenende verdeckt.
          </p>
          <p>
            Jedes sichere Feld erhöht den Multiplikator. Mit <strong>Auszahlen</strong> erhältst du Einsatz × aktuellen
            Multiplikator. Triffst du eine Mine, ist der Einsatz sofort verloren.
          </p>
          <p>Multiplikator nach k Feldern = 0,99 × Π (Felder − i) / (Felder − Minen − i).</p>
          <p>Tastatur: Enter startet, C zahlt aus. Offene Runden werden nach einem Neuladen fortgesetzt.</p>
        </>
      }
      controls={
        <>
          <BetControls value={bet} onChange={setBet} limits={limits} disabled={active || runner.busy} />
          <div className="field">
            <span className="field-label">Raster</span>
            <div className="segmented" role="group" aria-label="Rastergröße">
              {[4, 5, 6].map((g) => (
                <button
                  key={g}
                  type="button"
                  aria-pressed={gridSize === g}
                  disabled={active || runner.busy}
                  onClick={() => {
                    setGridSize(g);
                    setMines((m) => Math.min(m, g * g - 1));
                  }}
                >
                  {g}×{g}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label htmlFor="mines-count">
              Minen: <span className="mono">{mines}</span>
            </label>
            <input
              id="mines-count"
              type="range"
              min={1}
              max={maxMines}
              value={mines}
              disabled={active || runner.busy}
              onChange={(e) => setMines(Number(e.target.value))}
            />
          </div>
          <dl className="kv">
            <dt>Aktueller Multiplikator</dt>
            <dd>{formatMultiplier(active && res ? Number(res.multiplier) : 1)}</dd>
            <dt>Nächstes Feld</dt>
            <dd>{formatMultiplier(minesMultiplier(size * size, res?.mines ?? mines, revealedCount + 1))}</dd>
            {active && (
              <>
                <dt>Auszahlung jetzt</dt>
                <dd className="gold">{formatCredits(currentPayout)} Credits</dd>
              </>
            )}
          </dl>
          {active ? (
            <Button variant="gold" size="lg" block loading={runner.busy && pendingCell === null} disabled={revealedCount === 0 || runner.busy} onClick={() => void cashout()}>
              Auszahlen {revealedCount > 0 ? `(${formatCredits(currentPayout)} Credits)` : ''}
            </Button>
          ) : (
            <Button variant="primary" size="lg" block loading={runner.busy} disabled={!!betError} onClick={() => void start()}>
              Runde starten
            </Button>
          )}
        </>
      }
      stage={
        <div className="stack" style={{ alignItems: 'center' }}>
          <div
            role="grid"
            aria-label={`Minenfeld ${size}×${size}`}
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))`,
              gap: 8,
              width: 'min(100%, 460px)',
            }}
          >
            {Array.from({ length: cells }).map((_, i) => {
              const revealed = res?.revealed.includes(i);
              const isMine = res?.mine_positions?.includes(i);
              const hit = res?.hit === i;
              const showMine = round?.status === 'settled' && isMine;
              const showGem = revealed || (round?.status === 'settled' && !isMine);
              return (
                <button
                  key={`${round?.round_id ?? 'idle'}-${i}`}
                  type="button"
                  role="gridcell"
                  aria-label={`Feld ${i + 1}${revealed ? ', sicher' : showMine ? ', Mine' : ', verdeckt'}`}
                  disabled={!active || revealed || runner.busy}
                  onClick={() => void reveal(i)}
                  style={{
                    aspectRatio: '1',
                    borderRadius: 10,
                    border: hit ? '2px solid #f87171' : '1px solid var(--border-strong)',
                    background: revealed
                      ? 'linear-gradient(180deg,#14532d,#0f3d22)'
                      : showMine
                        ? hit
                          ? '#7f1d1d'
                          : '#3f1d1d'
                        : showGem
                          ? '#13261b'
                          : active
                            ? 'linear-gradient(180deg,#2b3245,#1f2433)'
                            : 'var(--card)',
                    display: 'grid',
                    placeItems: 'center',
                    cursor: active && !revealed ? 'pointer' : 'default',
                    opacity: round?.status === 'settled' && !revealed && !hit ? 0.65 : 1,
                    animation: revealed || hit ? 'popCell .25s ease both' : undefined,
                    transition: 'transform .1s, background .2s',
                  }}
                >
                  {pendingCell === i ? <span className="spinner" style={{ width: 18, height: 18 }} /> : showMine ? <Mine /> : showGem ? <Gem /> : null}
                </button>
              );
            })}
          </div>
          {!round && <p className="small subtle">Wähle Einsatz, Raster und Minen und starte eine Runde.</p>}
        </div>
      }
      recent={
        <RecentRounds
          rounds={runner.recent}
          label={(r) => (r.payout_amount > 0 ? formatMultiplier(Number((r.result as { multiplier?: number }).multiplier ?? 0)) : 'Mine')}
        />
      }
    />
    <LossModal outcome={lossOutcome} onClose={() => setLossOutcome(null)} onPlayAgain={() => void start()} />
    </>
  );
}
