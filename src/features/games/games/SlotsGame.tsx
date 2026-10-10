import { useEffect, useRef, useState } from 'react';
import { api } from '../../../lib/api';
import { newIdempotencyKey } from '../../../lib/misc';
import { formatCredits, formatMultiplier } from '../../../lib/format';
import { prefersReducedMotion } from '../../../lib/preferences';
import { useAppData } from '../../../app/AppData';
import { useToast } from '../../../components/Toast';
import { Button } from '../../../components/Button';
import { useHotkey } from '../../../hooks/useHotkey';
import { BetControls, GameFrame, RecentRounds, limitsOf, useBet, useRoundRunner } from '../shared';
import { SLOT_LINES, SLOT_LINE_NAMES, validateBet, type SlotSymbol as SlotSym } from '../logic';
import { SLOT_SYMBOL_NAMES, SlotSymbol } from './SlotSymbols';
import type { GameConfig } from '../../../types';

interface SlotsResult {
  grid: string[];
  line_wins: { line: number; symbol: string; pay: number }[];
  scatter_count: number;
  bonus_multiplier: number;
  multiplier: number;
}

const DEFAULT_GRID = ['leaf', 'gem', 'bell', 'seven', 'seven', 'seven', 'cherry', 'coin', 'leaf'];

export default function SlotsGame({ config }: { config: GameConfig }) {
  const limits = limitsOf(config);
  const [bet, setBet] = useBet(limits);
  const [grid, setGrid] = useState<string[]>(DEFAULT_GRID);
  const [spinning, setSpinning] = useState<boolean[]>([false, false, false]);
  const [result, setResult] = useState<SlotsResult | null>(null);
  const runner = useRoundRunner('slots', config.display_name);
  const toast = useToast();
  const { balance } = useAppData();
  const timers = useRef<number[]>([]);
  const symbols = (config.config.symbols as SlotSym[] | undefined) ?? [];
  const keys = symbols.length ? symbols.map((s) => s.key) : Object.keys(SLOT_SYMBOL_NAMES);
  const anySpinning = spinning.some(Boolean);
  const betError = validateBet(bet, limits, balance);

  useEffect(() => () => timers.current.forEach((t) => window.clearInterval(t)), []);

  const spin = async () => {
    if (betError || anySpinning) return;
    setResult(null);
    const res = await runner.run(() => api.playSlots(bet, newIdempotencyKey('slots')));
    if (!res) return;
    const r = res.result as unknown as SlotsResult;
    const finish = () => {
      setGrid(r.grid);
      setResult(r);
      const desc = r.line_wins.length
        ? `${r.line_wins.length} Gewinnlinie${r.line_wins.length > 1 ? 'n' : ''}${r.bonus_multiplier ? ' + Bonus' : ''}`
        : r.bonus_multiplier
          ? `${r.scatter_count} Coins Bonus`
          : 'Keine Gewinnkombination';
      if (r.bonus_multiplier > 0) toast.win('Bonus!', `${r.scatter_count} Coins: ${r.bonus_multiplier}× Einsatz`);
      runner.announce(res, desc, Number(r.multiplier) || null);
    };
    if (prefersReducedMotion()) {
      finish();
      return;
    }
    setSpinning([true, true, true]);
    // Walzen drehen zufällig (nur Optik) und stoppen nacheinander auf dem Serverergebnis
    const iv = window.setInterval(() => {
      setGrid((g) => g.map((s, i) => (spinningRef.current[i % 3] ? keys[Math.floor(Math.random() * keys.length)] : s)));
    }, 70);
    timers.current.push(iv);
    [0, 1, 2].forEach((reel) => {
      window.setTimeout(() => {
        spinningRef.current[reel] = false;
        setSpinning((sp) => sp.map((v, i) => (i === reel ? false : v)));
        setGrid((g) => g.map((s, i) => (i % 3 === reel ? r.grid[i] : s)));
        if (reel === 2) {
          window.clearInterval(iv);
          finish();
        }
      }, 650 + reel * 380);
    });
    spinningRef.current = [true, true, true];
  };
  const spinningRef = useRef<boolean[]>([false, false, false]);

  useHotkey([' ', 'Enter'], () => void spin(), !runner.busy && !anySpinning);

  const winCells = new Set<number>();
  result?.line_wins.forEach((w) => {
    const line = SLOT_LINES[w.line];
    if (w.pay > 0 && result.grid[line[0]] === result.grid[line[1]] && result.grid[line[1]] === result.grid[line[2]]) line.forEach((c) => winCells.add(c));
    else line.slice(0, 2).forEach((c) => winCells.add(c));
  });
  if (result && result.bonus_multiplier > 0) result.grid.forEach((s, i) => s === 'coin' && winCells.add(i));

  return (
    <GameFrame
      title={config.display_name}
      subtitle="Drei Walzen, fünf Gewinnlinien, eigener Coin-Bonus. Autoplay ist bewusst nicht aktiviert."
      runner={runner}
      onPlayAgain={() => void spin()}
      rules={
        <>
          <p>
            3 Walzen × 3 Reihen, <strong>5 Gewinnlinien</strong> (3 Reihen + 2 Diagonalen). Dein Einsatz wird gleichmäßig auf
            alle Linien verteilt (Linieneinsatz = Einsatz / 5).
          </p>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Kombination</th>
                  <th className="num">Gewinn (× Linieneinsatz)</th>
                </tr>
              </thead>
              <tbody>
                {symbols
                  .filter((s) => s.key !== 'coin')
                  .sort((a, b) => b.pay3 - a.pay3)
                  .map((s) => (
                    <tr key={s.key}>
                      <td>
                        <span className="row">
                          <SlotSymbol symbol={s.key} size={22} /> 3× {SLOT_SYMBOL_NAMES[s.key]}
                        </span>
                      </td>
                      <td className="num">{s.pay3}×</td>
                    </tr>
                  ))}
                <tr>
                  <td>
                    <span className="row">
                      <SlotSymbol symbol="cherry" size={22} /> 2× Kirschen (Walze 1+2)
                    </span>
                  </td>
                  <td className="num">{String(config.config.cherry_pair_pay ?? 2)}×</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p>
            <strong>Bonuskombination:</strong> Coins zählen überall auf dem Raster. 3 Coins = 5× Einsatz, 4 Coins = 15×
            Einsatz, 5+ Coins = 50× Einsatz – zusätzlich zu Liniengewinnen.
          </p>
          <p>Theoretische Auszahlungsquote ≈ 98,8 %.</p>
        </>
      }
      controls={
        <>
          <BetControls value={bet} onChange={setBet} limits={limits} disabled={runner.busy || anySpinning} />
          <p className="small muted">Linieneinsatz: {formatCredits(Math.floor(bet / 5))} Credits × 5 Linien</p>
          <Button variant="gold" size="lg" block loading={runner.busy || anySpinning} disabled={!!betError} onClick={() => void spin()}>
            Drehen
          </Button>
        </>
      }
      stage={
        <div className="stack" style={{ alignItems: 'center', padding: '12px 0' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
              gap: 8,
              padding: 12,
              borderRadius: 18,
              background: 'linear-gradient(180deg,#1c1408,#0f0b04)',
              border: '2px solid rgba(216,168,78,.6)',
              boxShadow: 'inset 0 0 30px rgba(0,0,0,.6), 0 10px 30px rgba(0,0,0,.4)',
              width: 'min(100%, 380px)',
            }}
            role="img"
            aria-label={`Walzen: ${grid.map((s) => SLOT_SYMBOL_NAMES[s] ?? s).join(', ')}`}
          >
            {grid.map((s, i) => (
              <div
                key={i}
                style={{
                  aspectRatio: '1',
                  display: 'grid',
                  placeItems: 'center',
                  borderRadius: 12,
                  background: winCells.has(i) ? 'radial-gradient(circle, rgba(243,201,105,.35), rgba(243,201,105,.08))' : '#f8fafc0d',
                  border: winCells.has(i) ? '2px solid #f3c969' : '1px solid rgba(255,255,255,.06)',
                  filter: spinning[i % 3] ? 'blur(1.5px)' : 'none',
                  transition: 'background .2s, border-color .2s',
                }}
              >
                <SlotSymbol symbol={s} size={58} />
              </div>
            ))}
          </div>
          <div className="small subtle center" aria-live="polite" style={{ minHeight: 20 }}>
            {result &&
              (result.line_wins.length || result.bonus_multiplier
                ? [
                    ...result.line_wins.map((w) => `${SLOT_LINE_NAMES[w.line]}: ${SLOT_SYMBOL_NAMES[w.symbol]} ${w.pay}×`),
                    result.bonus_multiplier ? `Bonus ${result.bonus_multiplier}×` : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : 'Keine Gewinnkombination')}
          </div>
        </div>
      }
      recent={
        <RecentRounds
          rounds={runner.recent}
          label={(r) => (r.payout_amount > 0 ? formatMultiplier(r.payout_amount / r.bet_amount) : '0×')}
        />
      }
    />
  );
}
