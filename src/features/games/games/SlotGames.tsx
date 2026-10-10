import { useEffect, useState } from 'react';
import type { GameConfig } from '../../../types';
import { formatMultiplier } from '../../../lib/format';
import { prefersReducedMotion } from '../../../lib/preferences';
import { BigResult, PayTable, SimpleGame, tone, type R } from '../engine';
import { SLOT_SYMBOL_NAMES, SlotSymbol } from './SlotSymbols';

/** Walzen-Raster: dreht zufällige Symbole und stoppt Spalte für Spalte auf dem Serverergebnis */
export function Reels({
  grid,
  cols,
  rows,
  symbols,
  spinKey,
  spinning,
  highlight,
  cell = 58,
  values,
}: {
  grid: string[];
  cols: number;
  rows: number;
  symbols: string[];
  spinKey: unknown;
  spinning: boolean;
  highlight?: Set<number>;
  cell?: number;
  values?: number[];
}) {
  const [stopped, setStopped] = useState(cols);
  const [noise, setNoise] = useState<string[]>(grid);
  useEffect(() => {
    if (!spinning || prefersReducedMotion()) {
      setStopped(cols);
      return;
    }
    setStopped(0);
    const iv = window.setInterval(() => {
      setNoise(Array.from({ length: cols * rows }, () => symbols[Math.floor(Math.random() * symbols.length)]));
    }, 75);
    const timers = Array.from({ length: cols }, (_, c) => window.setTimeout(() => setStopped(c + 1), 450 + c * 260));
    return () => {
      window.clearInterval(iv);
      timers.forEach((t) => window.clearTimeout(t));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spinKey]);
  return (
    <div
      role="img"
      aria-label={`Walzen: ${grid.map((s) => SLOT_SYMBOL_NAMES[s] ?? s).join(', ')}`}
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gap: 6,
        padding: 10,
        borderRadius: 18,
        background: 'linear-gradient(180deg,#1c1408,#0f0b04)',
        border: '2px solid rgba(216,168,78,.6)',
        boxShadow: 'inset 0 0 30px rgba(0,0,0,.6), 0 10px 30px rgba(0,0,0,.4)',
        width: `min(100%, ${cols * (cell + 8) + 24}px)`,
        margin: '0 auto',
      }}
    >
      {Array.from({ length: cols * rows }).map((_, i) => {
        const col = i % cols;
        const done = col < stopped;
        const sym = done ? grid[i] : noise[i];
        const hl = done && !spinning && highlight?.has(i);
        return (
          <div
            key={i}
            style={{
              aspectRatio: '1',
              display: 'grid',
              placeItems: 'center',
              borderRadius: 10,
              background: hl ? 'radial-gradient(circle, rgba(243,201,105,.35), rgba(243,201,105,.08))' : '#f8fafc0d',
              border: hl ? '2px solid #f3c969' : '1px solid rgba(255,255,255,.06)',
              filter: done ? 'none' : 'blur(1.5px)',
              transform: done ? 'translateY(0)' : 'translateY(-3px)',
              transition: 'transform .12s ease-out, background .2s',
            }}
          >
            {sym && <SlotSymbol symbol={sym} size={cell} value={values && done && values[i] ? values[i] : undefined} />}
          </div>
        );
      })}
    </div>
  );
}

const LINES_5: number[][] = [
  [1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2], [0, 1, 2, 1, 0], [2, 1, 0, 1, 2],
  [0, 0, 1, 2, 2], [2, 2, 1, 0, 0], [1, 0, 0, 0, 1], [1, 2, 2, 2, 1], [0, 1, 1, 1, 0],
];
export const LINES_3: number[][] = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 4, 8], [6, 4, 2]];

// ---------------------------------------------------------------- Classic Slots (3 Walzen, 1 Linie)
export function ClassicSlots({ config }: { config: GameConfig }) {
  const syms = (config.config.symbols as { key: string; pay3: number }[]) ?? [];
  return (
    <SimpleGame
      config={config}
      subtitle="Der Klassiker: drei Walzen, eine Gewinnlinie."
      rules={
        <PayTable
          rows={[
            ...syms.filter((s) => s.pay3 > 0).sort((a, b) => b.pay3 - a.pay3).map((s): [string, string] => [`3× ${SLOT_SYMBOL_NAMES[s.key]}`, `${s.pay3}×`]),
            ['2× Kirschen (Walze 1+2)', `${config.config.two_cherry}×`],
            ['1× Kirsche (Walze 1)', `${config.config.one_cherry}×`],
          ]}
        />
      }
      params={() => ({})}
      animationMs={450 + 3 * 260 + 100}
      stage={(r, a) => (
        <div className="stack">
          <Reels grid={(r?.reels as string[]) ?? ['seven', 'seven', 'seven']} cols={3} rows={1} symbols={syms.map((s) => s.key)} spinKey={r} spinning={a} cell={80}
            highlight={r && Number(r.mult) > 0 ? new Set([0, 1, 2]) : undefined} />
          {r && !a && <BigResult text={Number(r.mult) > 0 ? `${r.mult}×` : 'Kein Gewinn'} tone={tone(r, a)} />}
        </div>
      )}
      describe={(r) => (r.reels as string[]).map((s) => SLOT_SYMBOL_NAMES[s]).join(' · ')}
      playLabel="Drehen"
    />
  );
}

// ---------------------------------------------------------------- Fruit Slots (3x3, 5 Linien)
export function FruitSlots({ config }: { config: GameConfig }) {
  const syms = (config.config.symbols as { key: string; pay3: number }[]) ?? [];
  return (
    <SimpleGame
      config={config}
      subtitle="3×3 Früchte, 5 Gewinnlinien, Coin-Bonus."
      rules={
        <>
          <p>Einsatz verteilt sich auf 5 Linien (3 Reihen, 2 Diagonalen). 3 gleiche Symbole auf einer Linie zahlen den Linienwert, 2 Kirschen am Linienanfang {String(config.config.pair_pay)}×. 3/4/5+ Coins irgendwo = 5/15/50× Einsatz.</p>
          <PayTable rows={syms.filter((s) => s.pay3 > 0).sort((a, b) => b.pay3 - a.pay3).map((s) => [`3× ${SLOT_SYMBOL_NAMES[s.key]}`, `${s.pay3}× Linieneinsatz`])} />
        </>
      }
      params={() => ({})}
      animationMs={450 + 3 * 260 + 100}
      stage={(r, a) => {
        const hl = new Set<number>();
        ((r?.line_wins as { line: number }[]) ?? []).forEach((w) => LINES_3[w.line].forEach((c) => hl.add(c)));
        if (r && Number(r.bonus_multiplier) > 0) (r.grid as string[]).forEach((s, i) => s === 'coin' && hl.add(i));
        return (
          <div className="stack">
            <Reels grid={(r?.grid as string[]) ?? ['cherry', 'lemon', 'plum', 'melon', 'seven', 'melon', 'plum', 'coin', 'cherry']} cols={3} rows={3}
              symbols={syms.map((s) => s.key)} spinKey={r} spinning={a} highlight={hl} cell={64} />
            {r && !a && <BigResult text={Number(r.mult) > 0 ? formatMultiplier(Number(r.mult)) : 'Kein Gewinn'} sub={Number(r.bonus_multiplier) > 0 ? `Coin-Bonus ${r.bonus_multiplier}×` : undefined} tone={tone(r, a)} />}
          </div>
        );
      }}
      describe={(r) => `${(r.line_wins as unknown[]).length} Linie(n)${Number(r.bonus_multiplier) > 0 ? ' + Bonus' : ''}`}
      playLabel="Drehen"
    />
  );
}

// ---------------------------------------------------------------- Neon Slots (5x3, 10 Linien, Wild)
export function NeonSlots({ config }: { config: GameConfig }) {
  const syms = (config.config.symbols as { key: string }[]) ?? [];
  const pays = config.config.pays as Record<string, number[]>;
  return (
    <SimpleGame
      config={config}
      subtitle="5 Walzen, 10 Linien, Wilds ersetzen alles."
      rules={
        <>
          <p>Gewinne zählen von links nach rechts ab 3 gleichen Symbolen. WILD ersetzt jedes Symbol. Einsatz verteilt sich auf 10 Linien.</p>
          <PayTable rows={Object.entries(pays).map(([k, t]) => [SLOT_SYMBOL_NAMES[k], `3: ${t[2]}× · 4: ${t[3]}× · 5: ${t[4]}×`])} />
        </>
      }
      params={() => ({})}
      animationMs={450 + 5 * 260 + 100}
      stage={(r, a) => {
        const hl = new Set<number>();
        ((r?.line_wins as { line: number; count: number }[]) ?? []).forEach((w) => LINES_5[w.line].slice(0, w.count).forEach((row, reel) => hl.add(row * 5 + reel)));
        return (
          <div className="stack">
            <Reels grid={(r?.grid as string[]) ?? Array.from({ length: 15 }, (_, i) => syms[i % syms.length].key)} cols={5} rows={3} symbols={syms.map((s) => s.key)}
              spinKey={r} spinning={a} highlight={hl} cell={52} />
            {r && !a && <BigResult text={Number(r.mult) > 0 ? formatMultiplier(Number(r.mult)) : 'Kein Gewinn'} tone={tone(r, a)} />}
          </div>
        );
      }}
      describe={(r) => `${(r.line_wins as unknown[]).length} Gewinnlinie(n)`}
      playLabel="Drehen"
    />
  );
}

// ---------------------------------------------------------------- Cluster Slots (6x6)
export function ClusterSlots({ config }: { config: GameConfig }) {
  const syms = (config.config.symbols as { key: string; pays: number[] }[]) ?? [];
  return (
    <SimpleGame
      config={config}
      subtitle="6×6 Edelsteine – Gruppen ab 5 verbundenen gleichen Steinen gewinnen."
      rules={
        <>
          <p>Steine sind verbunden, wenn sie waagerecht oder senkrecht aneinandergrenzen. Jede Gruppe ab 5 Steinen zahlt nach Größe (9+ = Höchstwert).</p>
          <PayTable rows={syms.map((s) => [SLOT_SYMBOL_NAMES[s.key], `5: ${s.pays[5]}× · 7: ${s.pays[7]}× · 9+: ${s.pays[9]}×`])} />
        </>
      }
      params={() => ({})}
      animationMs={450 + 6 * 220 + 150}
      stage={(r, a) => {
        const hl = new Set<number>();
        ((r?.clusters as { cells: number[] }[]) ?? []).forEach((c) => c.cells.forEach((x) => hl.add(x)));
        return (
          <div className="stack">
            <Reels grid={(r?.grid as string[]) ?? Array.from({ length: 36 }, (_, i) => syms[(i * 7) % syms.length].key)} cols={6} rows={6} symbols={syms.map((s) => s.key)}
              spinKey={r} spinning={a} highlight={hl} cell={42} />
            {r && !a && <BigResult text={Number(r.mult) > 0 ? formatMultiplier(Number(r.mult)) : 'Kein Cluster'} sub={`${(r.clusters as unknown[]).length} Cluster`} tone={tone(r, a)} />}
          </div>
        );
      }}
      describe={(r) => `${(r.clusters as unknown[]).length} Cluster`}
      playLabel="Drehen"
    />
  );
}

// ---------------------------------------------------------------- Lucky Seven (3 Ziffernwalzen)
export function LuckySeven({ config }: { config: GameConfig }) {
  const pay = config.config.pay as Record<string, number>;
  return (
    <SimpleGame
      config={config}
      subtitle="Drei Ziffern 0–9. Jede 7 bringt Glück."
      rules={<PayTable rows={[['7 7 7', `${pay.triple7}×`], ['Drei gleiche Ziffern', `${pay.triple}×`], ['Zwei Siebenen', `${pay.two7}×`], ['Eine Sieben', `${pay.one7}×`]]} />}
      params={() => ({})}
      animationMs={1300}
      stage={(r, a) => <DigitStage r={r} a={a} />}
      describe={(r) => (r.digits as number[]).join(' ')}
      recentLabel={(x) => ((x.result as R).digits as number[]).join('')}
      playLabel="Drehen"
    />
  );
}

function DigitStage({ r, a }: { r: R | null; a: boolean }) {
  const [noise, setNoise] = useState([7, 7, 7]);
  const [stopped, setStopped] = useState(3);
  useEffect(() => {
    if (!r || !a || prefersReducedMotion()) return;
    setStopped(0);
    const iv = window.setInterval(() => setNoise([0, 1, 2].map(() => Math.floor(Math.random() * 10))), 60);
    const t = [0, 1, 2].map((i) => window.setTimeout(() => setStopped(i + 1), 450 + i * 300));
    return () => {
      window.clearInterval(iv);
      t.forEach(window.clearTimeout);
    };
  }, [r, a]);
  const digits = (r?.digits as number[]) ?? [7, 7, 7];
  return (
    <div className="stack" style={{ alignItems: 'center' }}>
      <div className="row" style={{ gap: 10 }}>
        {digits.map((d, i) => {
          const v = !a || i < stopped ? d : noise[i];
          return (
            <div key={i} className="mono" style={{ width: 'clamp(70px, 20vw, 100px)', aspectRatio: '3/4', borderRadius: 16, display: 'grid', placeItems: 'center',
              background: 'linear-gradient(180deg,#f8fafc,#cbd5e1)', color: v === 7 ? '#dc2626' : '#0f172a', fontSize: 'clamp(46px, 13vw, 70px)', fontWeight: 900,
              boxShadow: v === 7 && (!a || i < stopped) ? '0 0 0 3px #f3c969, 0 8px 20px rgba(0,0,0,.4)' : '0 8px 20px rgba(0,0,0,.4)' }}>
              {v}
            </div>
          );
        })}
      </div>
      {r && !a && <BigResult text={Number(r.mult) > 0 ? `${r.mult}×` : 'Keine Sieben'} tone={tone(r, a)} />}
    </div>
  );
}

