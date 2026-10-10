import { useMemo, useRef, useState } from 'react';
import { api } from '../../../lib/api';
import { newIdempotencyKey } from '../../../lib/misc';
import { formatCredits } from '../../../lib/format';
import { prefersReducedMotion } from '../../../lib/preferences';
import { useAppData } from '../../../app/AppData';
import { Button } from '../../../components/Button';
import { useHotkey } from '../../../hooks/useHotkey';
import { GameFrame, RecentRounds, limitsOf, useRoundRunner } from '../shared';
import {
  ROULETTE_ODDS,
  ROULETTE_WHEEL,
  betKey,
  rouletteColor,
  rouletteWins,
  type RouletteBet,
  type RouletteBetType,
} from '../logic';
import type { GameConfig } from '../../../types';

interface RouletteResult {
  number: number;
  bets: { type: RouletteBetType; value: number; amount: number; win: boolean; payout: number }[];
}

const CHIPS = [10, 50, 100, 500, 1000, 5000];
const COLORS = { red: '#b91c1c', black: '#111827', green: '#15803d' };

function Wheel({ rotation, ballNumber }: { rotation: number; ballNumber: number | null }) {
  const n = ROULETTE_WHEEL.length;
  const seg = 360 / n;
  return (
    <div style={{ position: 'relative', width: 'min(78vw, 300px)', aspectRatio: '1', margin: '0 auto' }}>
      <svg
        viewBox="-110 -110 220 220"
        style={{
          width: '100%',
          height: '100%',
          transform: `rotate(${rotation}deg)`,
          transition: prefersReducedMotion() ? 'none' : 'transform 3.6s cubic-bezier(.12,.75,.12,1)',
        }}
        role="img"
        aria-label="Roulette-Rad"
      >
        <circle r="108" fill="#5c3f10" />
        <circle r="102" fill="#1a1205" stroke="#d8a84e" strokeWidth="2" />
        {ROULETTE_WHEEL.map((num, i) => {
          const a1 = ((i * seg - 90 - seg / 2) * Math.PI) / 180;
          const a2 = (((i + 1) * seg - 90 - seg / 2) * Math.PI) / 180;
          const mid = ((i * seg - 90) * Math.PI) / 180;
          return (
            <g key={num}>
              <path
                d={`M0 0 L${98 * Math.cos(a1)} ${98 * Math.sin(a1)} A98 98 0 0 1 ${98 * Math.cos(a2)} ${98 * Math.sin(a2)} Z`}
                fill={COLORS[rouletteColor(num)]}
                stroke="#d8a84e"
                strokeWidth=".5"
              />
              <text
                x={84 * Math.cos(mid)}
                y={84 * Math.sin(mid)}
                fill="#fff"
                fontSize="8"
                fontWeight="700"
                textAnchor="middle"
                dominantBaseline="central"
                transform={`rotate(${i * seg} ${84 * Math.cos(mid)} ${84 * Math.sin(mid)})`}
                fontFamily="JetBrains Mono, monospace"
              >
                {num}
              </text>
            </g>
          );
        })}
        <circle r="60" fill="#2a1c06" stroke="#d8a84e" strokeWidth="2" />
        <circle r="44" fill="#7a5418" />
        <circle r="14" fill="#f3c969" />
        {[0, 45, 90, 135].map((d) => (
          <rect key={d} x="-2" y="-40" width="4" height="80" fill="#d8a84e" transform={`rotate(${d})`} rx="2" />
        ))}
      </svg>
      {/* Zeiger */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: -6,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 0,
          height: 0,
          borderLeft: '9px solid transparent',
          borderRight: '9px solid transparent',
          borderTop: '16px solid #f3c969',
          filter: 'drop-shadow(0 2px 3px rgba(0,0,0,.6))',
        }}
      />
      {ballNumber !== null && (
        <div
          aria-live="polite"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            pointerEvents: 'none',
          }}
        >
          <span
            className="mono"
            style={{
              width: 64,
              height: 64,
              borderRadius: '50%',
              display: 'grid',
              placeItems: 'center',
              fontSize: 26,
              fontWeight: 800,
              background: COLORS[rouletteColor(ballNumber)],
              border: '3px solid #f3c969',
              boxShadow: '0 0 24px rgba(0,0,0,.6)',
              animation: 'popIn .3s ease both',
            }}
          >
            {ballNumber}
          </span>
        </div>
      )}
    </div>
  );
}

export default function RouletteGame({ config }: { config: GameConfig }) {
  const limits = limitsOf(config);
  const { balance } = useAppData();
  const [chip, setChip] = useState(() => CHIPS.find((c) => c >= limits.min) ?? limits.min);
  const [bets, setBets] = useState<Record<string, RouletteBet>>({});
  const [history, setHistory] = useState<Record<string, RouletteBet>[]>([]);
  const [lastBets, setLastBets] = useState<Record<string, RouletteBet> | null>(null);
  const [rotation, setRotation] = useState(0);
  const [result, setResult] = useState<RouletteResult | null>(null);
  const [spinning, setSpinning] = useState(false);
  const runner = useRoundRunner('roulette', config.display_name);
  const rotationRef = useRef(0);

  const total = useMemo(() => Object.values(bets).reduce((s, b) => s + b.amount, 0), [bets]);
  const totalError =
    total === 0
      ? 'Setze mindestens einen Chip.'
      : total < limits.min
        ? `Mindesteinsatz gesamt: ${limits.min} Credits`
        : total > limits.max
          ? `Höchsteinsatz gesamt: ${formatCredits(limits.max)} Credits`
          : balance !== null && total > balance
            ? 'Nicht genug Credits.'
            : null;

  const place = (type: RouletteBetType, value?: number) => {
    if (spinning || runner.busy) return;
    const key = betKey({ type, value });
    setHistory((h) => [...h, bets]);
    setBets((prev) => ({ ...prev, [key]: { type, value, amount: (prev[key]?.amount ?? 0) + chip } }));
    setResult(null);
  };
  const undo = () => {
    if (!history.length) return;
    setBets(history[history.length - 1]);
    setHistory(history.slice(0, -1));
  };
  const clear = () => {
    setHistory((h) => [...h, bets]);
    setBets({});
  };

  const spin = async (useBets = bets) => {
    const list = Object.values(useBets);
    const sum = list.reduce((s, b) => s + b.amount, 0);
    if (!list.length || sum < limits.min || sum > limits.max || spinning) return;
    setResult(null);
    const res = await runner.run(() => api.playRoulette(list, newIdempotencyKey('roulette')));
    if (!res) return;
    const r = res.result as unknown as RouletteResult;
    setLastBets(useBets);
    const idx = ROULETTE_WHEEL.indexOf(r.number);
    const seg = 360 / ROULETTE_WHEEL.length;
    // Rad so drehen, dass die Zahl unter dem Zeiger (oben) landet, plus 4–5 volle Umdrehungen
    const current = rotationRef.current;
    const targetMod = (360 - idx * seg) % 360;
    const base = current - (current % 360);
    const next = base + 360 * 5 + targetMod;
    rotationRef.current = next;
    setSpinning(true);
    setRotation(next);
    window.setTimeout(
      () => {
        setSpinning(false);
        setResult(r);
        const color = rouletteColor(r.number) === 'red' ? 'Rot' : rouletteColor(r.number) === 'black' ? 'Schwarz' : 'Grün';
        runner.announce(res, `Zahl ${r.number} (${color})`, res.payout_amount > 0 ? res.payout_amount / res.bet_amount : null);
      },
      prefersReducedMotion() ? 50 : 3700,
    );
  };

  useHotkey([' ', 'Enter'], () => void spin(), !runner.busy && !spinning);

  const amountFor = (type: RouletteBetType, value?: number) => bets[betKey({ type, value })]?.amount;
  const isWinner = (type: RouletteBetType, value?: number) => result !== null && rouletteWins(type, value, result.number);

  const Cell = ({
    type,
    value,
    label,
    bg,
    span,
    aria,
  }: {
    type: RouletteBetType;
    value?: number;
    label: string;
    bg?: string;
    span?: string;
    aria: string;
  }) => {
    const amount = amountFor(type, value);
    const win = isWinner(type, value);
    return (
      <button
        type="button"
        onClick={() => place(type, value)}
        disabled={spinning || runner.busy}
        aria-label={`${aria}${amount ? `, Einsatz ${amount} Credits` : ''}`}
        style={{
          gridColumn: span,
          position: 'relative',
          minHeight: 40,
          border: win ? '2px solid #f3c969' : '1px solid rgba(255,255,255,.18)',
          background: bg ?? 'transparent',
          color: '#fff',
          fontWeight: 800,
          fontSize: 13,
          borderRadius: 6,
          cursor: 'pointer',
          fontFamily: 'var(--mono)',
          boxShadow: win ? '0 0 14px rgba(243,201,105,.6)' : 'none',
        }}
      >
        {label}
        {amount ? (
          <span
            style={{
              position: 'absolute',
              top: -7,
              right: -5,
              minWidth: 22,
              height: 22,
              padding: '0 4px',
              borderRadius: 11,
              background: 'radial-gradient(circle at 35% 30%, #fff1c2, #f3c969 45%, #9a6d22)',
              color: '#2a1c06',
              fontSize: 9.5,
              display: 'grid',
              placeItems: 'center',
              border: '1.5px dashed #7a5418',
              zIndex: 1,
            }}
          >
            {amount >= 1000 ? `${Math.round(amount / 100) / 10}k` : amount}
          </span>
        ) : null}
      </button>
    );
  };

  const numbers = Array.from({ length: 12 }, (_, col) => [3 + col * 3, 2 + col * 3, 1 + col * 3]);

  return (
    <GameFrame
      title={config.display_name}
      subtitle="Europäisches Roulette mit einer Null. Setze Chips, dann dreh das Rad."
      runner={runner}
      onPlayAgain={() => lastBets && void spin(lastBets)}
      rules={
        <>
          <p>Europäisches Roulette mit den Zahlen 0–36. Mehrere Einsätze pro Runde sind möglich, solange der Gesamteinsatz gedeckt ist.</p>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Einsatz</th>
                  <th className="num">Auszahlung</th>
                </tr>
              </thead>
              <tbody>
                <tr><td>Einzelne Zahl (0–36)</td><td className="num">{ROULETTE_ODDS.straight}:1</td></tr>
                <tr><td>Dutzend (1–12, 13–24, 25–36)</td><td className="num">{ROULETTE_ODDS.dozen}:1</td></tr>
                <tr><td>Kolonne</td><td className="num">{ROULETTE_ODDS.column}:1</td></tr>
                <tr><td>Rot / Schwarz</td><td className="num">1:1</td></tr>
                <tr><td>Gerade / Ungerade</td><td className="num">1:1</td></tr>
                <tr><td>1–18 / 19–36</td><td className="num">1:1</td></tr>
              </tbody>
            </table>
          </div>
          <p>Bei der Null verlieren alle Einsätze außer einem direkten Einsatz auf 0.</p>
        </>
      }
      controls={
        <>
          <div className="field">
            <span className="field-label">Chip-Wert</span>
            <div className="chip-group" role="group" aria-label="Chip-Wert">
              {CHIPS.filter((c) => c >= limits.min && c <= limits.max).map((c) => (
                <button key={c} type="button" className="chip" aria-pressed={chip === c} onClick={() => setChip(c)}>
                  {formatCredits(c)}
                </button>
              ))}
            </div>
          </div>
          <dl className="kv">
            <dt>Gesamteinsatz</dt>
            <dd className="gold">{formatCredits(total)} Credits</dd>
            <dt>Einsätze</dt>
            <dd>{Object.keys(bets).length}</dd>
            <dt>Verfügbar</dt>
            <dd>{formatCredits(balance)} Credits</dd>
          </dl>
          {totalError && total > 0 && <span className="field-error">{totalError}</span>}
          <div className="row">
            <Button size="sm" onClick={undo} disabled={!history.length || spinning || runner.busy}>
              Rückgängig
            </Button>
            <Button size="sm" onClick={clear} disabled={!total || spinning || runner.busy}>
              Leeren
            </Button>
            <Button size="sm" onClick={() => lastBets && setBets(lastBets)} disabled={!lastBets || spinning || runner.busy}>
              Wiederholen
            </Button>
          </div>
          <Button variant="primary" size="lg" block loading={runner.busy || spinning} disabled={!!totalError} onClick={() => void spin()}>
            Rad drehen
          </Button>
        </>
      }
      stage={
        <div className="stack-lg">
          <Wheel rotation={rotation} ballNumber={spinning ? null : (result?.number ?? null)} />
          <div style={{ overflowX: 'auto', paddingTop: 8 }}>
            <div
              role="group"
              aria-label="Roulette-Tisch"
              style={{
                display: 'grid',
                gridTemplateColumns: '44px repeat(12, minmax(30px, 1fr)) 44px',
                gap: 4,
                minWidth: 520,
                padding: 10,
                borderRadius: 14,
                background: 'radial-gradient(circle at 50% 0%, #166534, #052e16)',
                border: '2px solid #7a5418',
              }}
            >
              <div style={{ gridRow: '1 / span 3', display: 'grid' }}>
                <Cell type="straight" value={0} label="0" bg={COLORS.green} aria="Zahl 0" />
              </div>
              {[0, 1, 2].map((row) =>
                numbers.map((col, ci) => {
                  const n = col[row];
                  return (
                    <div key={n} style={{ gridRow: row + 1, gridColumn: ci + 2, display: 'grid' }}>
                      <Cell type="straight" value={n} label={String(n)} bg={COLORS[rouletteColor(n)]} aria={`Zahl ${n}`} />
                    </div>
                  );
                }),
              )}
              {[3, 2, 1].map((c, row) => (
                <div key={c} style={{ gridRow: row + 1, gridColumn: 14, display: 'grid' }}>
                  <Cell type="column" value={c} label="2:1" aria={`Kolonne ${c}`} />
                </div>
              ))}
              {[1, 2, 3].map((d) => (
                <div key={d} style={{ gridRow: 4, gridColumn: `${2 + (d - 1) * 4} / span 4`, display: 'grid' }}>
                  <Cell type="dozen" value={d} label={`${(d - 1) * 12 + 1}–${d * 12}`} aria={`Dutzend ${d}`} />
                </div>
              ))}
              {(
                [
                  ['low', '1–18', undefined],
                  ['even', 'Gerade', undefined],
                  ['red', 'Rot', COLORS.red],
                  ['black', 'Schwarz', COLORS.black],
                  ['odd', 'Ungerade', undefined],
                  ['high', '19–36', undefined],
                ] as [RouletteBetType, string, string | undefined][]
              ).map(([t, label, bg], i) => (
                <div key={t} style={{ gridRow: 5, gridColumn: `${2 + i * 2} / span 2`, display: 'grid' }}>
                  <Cell type={t} label={label} bg={bg} aria={label} />
                </div>
              ))}
            </div>
          </div>
          {result && (
            <ul className="list small" aria-label="Einsatzauswertung">
              {result.bets.map((b, i) => (
                <li key={i} className="row-between" style={{ padding: '4px 0' }}>
                  <span className="subtle">
                    {b.type === 'straight' ? `Zahl ${b.value}` : b.type === 'dozen' ? `Dutzend ${b.value}` : b.type === 'column' ? `Kolonne ${b.value}` : b.type}
                    {' · '}
                    {formatCredits(b.amount)} Credits
                  </span>
                  <span className={b.win ? 'success mono' : 'muted mono'}>{b.win ? `+${formatCredits(b.payout)}` : '–'}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      }
      recent={
        <RecentRounds
          rounds={runner.recent}
          label={(r) => {
            const n = Number((r.result as { number?: number }).number ?? 0);
            return `${n}${rouletteColor(n) === 'red' ? ' ●' : rouletteColor(n) === 'black' ? ' ○' : ''}`;
          }}
        />
      }
    />
  );
}
