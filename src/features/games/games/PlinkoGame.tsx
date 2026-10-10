import { useEffect, useRef, useState } from 'react';
import { api } from '../../../lib/api';
import { newIdempotencyKey } from '../../../lib/misc';
import { formatMultiplier } from '../../../lib/format';
import { prefersReducedMotion } from '../../../lib/preferences';
import { useAppData } from '../../../app/AppData';
import { Button } from '../../../components/Button';
import { useHotkey } from '../../../hooks/useHotkey';
import { BetControls, GameFrame, RecentRounds, limitsOf, useBet, useRoundRunner } from '../shared';
import { PLINKO_TABLES, validateBet, type PlinkoRisk } from '../logic';
import type { GameConfig } from '../../../types';

interface PlinkoResult {
  rows: number;
  risk: PlinkoRisk;
  path: number[];
  bucket: number;
  multiplier: number;
}

const W = 320;
const TOP = 26;

function bucketColor(m: number) {
  if (m >= 10) return '#d8a84e';
  if (m >= 3) return '#f59e0b';
  if (m >= 1) return '#4f8ef7';
  return '#334155';
}

export default function PlinkoGame({ config }: { config: GameConfig }) {
  const limits = limitsOf(config);
  const [bet, setBet] = useBet(limits);
  const [rows, setRows] = useState(12);
  const [risk, setRisk] = useState<PlinkoRisk>('medium');
  const [ball, setBall] = useState<{ x: number; y: number } | null>(null);
  const [hit, setHit] = useState<number | null>(null);
  const [animating, setAnimating] = useState(false);
  const runner = useRoundRunner('plinko', config.display_name);
  const { balance } = useAppData();
  const timer = useRef<number[]>([]);

  useEffect(() => () => timer.current.forEach((t) => window.clearTimeout(t)), []);

  const tables = (config.config.tables as Record<string, Record<PlinkoRisk, number[]>> | undefined) ?? PLINKO_TABLES;
  const table = tables[String(rows)]?.[risk] ?? PLINKO_TABLES[String(rows)][risk];
  const gap = W / (rows + 2);
  const rowH = 300 / (rows + 1);
  const H = TOP + rows * rowH + 46;
  const betError = validateBet(bet, limits, balance);

  const pegX = (row: number, i: number) => W / 2 - ((row + 2) * gap) / 2 + gap / 2 + i * gap;

  const play = async () => {
    if (betError || animating) return;
    setHit(null);
    const res = await runner.run(() => api.playPlinko(bet, rows, risk, newIdempotencyKey('plinko')));
    if (!res) return;
    const r = res.result as unknown as PlinkoResult;
    setAnimating(true);
    const finish = () => {
      setAnimating(false);
      setHit(r.bucket);
      runner.announce(res, `Feld ${r.bucket + 1} · ${formatMultiplier(Number(r.multiplier))}`, Number(r.multiplier));
    };
    if (prefersReducedMotion()) {
      setBall(null);
      finish();
      return;
    }
    // Ballpfad aus Serverpfad: Position = Anzahl Rechts-Schritte
    let rights = 0;
    const steps: { x: number; y: number }[] = [{ x: W / 2, y: TOP - 14 }];
    r.path.forEach((bit, row) => {
      rights += bit;
      const x = W / 2 - (row + 1) * (gap / 2) + rights * gap;
      steps.push({ x, y: TOP + row * rowH + rowH * 0.55 });
    });
    steps.push({ x: W / 2 - (rows * gap) / 2 + r.bucket * gap, y: TOP + rows * rowH + 18 });
    steps.forEach((s, i) => {
      timer.current.push(window.setTimeout(() => setBall(s), i * 95));
    });
    timer.current.push(
      window.setTimeout(() => {
        setBall(null);
        finish();
      }, steps.length * 95 + 120),
    );
  };

  useHotkey([' ', 'Enter'], () => void play(), !runner.busy && !animating);

  return (
    <GameFrame
      title={config.display_name}
      subtitle="Die Kugel fällt durch das Nagelbrett – wo landet sie?"
      runner={runner}
      onPlayAgain={() => void play()}
      rules={
        <>
          <p>
            Wähle <strong>Reihenanzahl</strong> (8, 12, 16) und <strong>Risikostufe</strong>. Die Kugel springt an jedem Nagel
            zufällig nach links oder rechts.
          </p>
          <p>Das Zielfeld bestimmt den Multiplikator. Auszahlung = Einsatz × Multiplikator (abgerundet).</p>
          <p>Höheres Risiko: größere Randmultiplikatoren, aber kleinere Werte in der Mitte. Theoretische Auszahlungsquote ≈ 98–99 %.</p>
          <div className="table-wrap">
            <table className="table">
              <tbody>
                {(['low', 'medium', 'high'] as PlinkoRisk[]).map((rk) => (
                  <tr key={rk}>
                    <td>{rk === 'low' ? 'Niedrig' : rk === 'medium' ? 'Mittel' : 'Hoch'}</td>
                    <td className="mono small">{(tables[String(rows)]?.[rk] ?? []).join(' · ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      }
      controls={
        <>
          <BetControls value={bet} onChange={setBet} limits={limits} disabled={runner.busy || animating} />
          <div className="field">
            <span className="field-label">Risiko</span>
            <div className="segmented" role="group" aria-label="Risiko">
              {(['low', 'medium', 'high'] as PlinkoRisk[]).map((rk) => (
                <button key={rk} type="button" aria-pressed={risk === rk} disabled={runner.busy || animating} onClick={() => setRisk(rk)}>
                  {rk === 'low' ? 'Niedrig' : rk === 'medium' ? 'Mittel' : 'Hoch'}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <span className="field-label">Reihen</span>
            <div className="segmented" role="group" aria-label="Reihen">
              {[8, 12, 16].map((n) => (
                <button key={n} type="button" aria-pressed={rows === n} disabled={runner.busy || animating} onClick={() => setRows(n)}>
                  {n}
                </button>
              ))}
            </div>
          </div>
          <Button variant="primary" size="lg" block loading={runner.busy || animating} disabled={!!betError} onClick={() => void play()}>
            Kugel fallen lassen
          </Button>
        </>
      }
      stage={
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: 560, margin: '0 auto' }} role="img" aria-label="Plinko-Brett">
          {Array.from({ length: rows }).map((_, row) =>
            Array.from({ length: row + 3 }).map((__, i) => (
              <circle key={`${row}-${i}`} cx={pegX(row, i)} cy={TOP + row * rowH} r={rows > 12 ? 2.2 : 2.8} fill="#cbd5e1" opacity=".85" />
            )),
          )}
          {table.map((m, i) => {
            const bw = gap - 3;
            const x = W / 2 - (rows * gap) / 2 + i * gap - bw / 2;
            const y = TOP + rows * rowH + 8;
            return (
              <g key={i}>
                <rect
                  x={x}
                  y={y}
                  width={bw}
                  height={22}
                  rx={4}
                  fill={bucketColor(m)}
                  opacity={hit === null || hit === i ? 1 : 0.45}
                  stroke={hit === i ? '#fff' : 'none'}
                  strokeWidth={1.5}
                />
                <text
                  x={x + bw / 2}
                  y={y + 14.5}
                  textAnchor="middle"
                  fontSize={rows > 12 ? 6.2 : 7.5}
                  fontWeight="800"
                  fill={m >= 10 ? '#2a1c06' : '#fff'}
                  fontFamily="JetBrains Mono, monospace"
                >
                  {m}
                </text>
              </g>
            );
          })}
          {ball && (
            <circle cx={ball.x} cy={ball.y} r={rows > 12 ? 5 : 6} fill="#f3c969" stroke="#7a5418" strokeWidth="1" style={{ transition: 'cx .09s linear, cy .09s ease-in' }} />
          )}
        </svg>
      }
      recent={<RecentRounds rounds={runner.recent} label={(r) => formatMultiplier(Number((r.result as { multiplier?: number }).multiplier ?? 0))} />}
    />
  );
}
