// Wiederverwendbare Spielgrafiken (eigene SVG/CSS): Karten, Würfel, Glücksrad, Zahlenraster.
import { useEffect, useRef, useState } from 'react';
import { cardLabel } from './logic';
import { prefersReducedMotion } from '../../lib/preferences';

export function Card({ card, hidden, index = 0, small, highlight }: { card?: number | null; hidden?: boolean; index?: number; small?: boolean; highlight?: boolean }) {
  const w = small ? 'clamp(40px, 10vw, 54px)' : 'clamp(54px, 14vw, 74px)';
  const base: React.CSSProperties = {
    width: w,
    aspectRatio: '5 / 7',
    borderRadius: 9,
    boxShadow: highlight ? '0 0 0 3px var(--gold-bright), 0 6px 16px rgba(0,0,0,.45)' : '0 6px 16px rgba(0,0,0,.45)',
    animation: `cardIn .3s ease ${index * 0.05}s both`,
    flex: 'none',
    willChange: 'transform',
  };
  if (hidden || card === undefined || card === null) {
    return <div role="img" aria-label="Verdeckte Karte" style={{ ...base, background: 'repeating-linear-gradient(45deg,#4c1d95 0 6px,#5b21b6 6px 12px)', border: '3px solid #f3c969' }} />;
  }
  const c = cardLabel(card);
  return (
    <div
      role="img"
      aria-label={`${c.rank} ${c.suit}`}
      style={{
        ...base,
        background: '#f8fafc',
        color: c.red ? '#b91c1c' : '#111827',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: small ? '3px 5px' : '5px 7px',
        fontWeight: 800,
      }}
    >
      <span style={{ fontSize: small ? 12 : 15, lineHeight: 1 }}>
        {c.rank}
        <br />
        {c.suit}
      </span>
      <span style={{ fontSize: small ? 18 : 26, alignSelf: 'center', lineHeight: 1 }}>{c.suit}</span>
    </div>
  );
}

const PIPS: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [[28, 28], [72, 72]],
  3: [[28, 28], [50, 50], [72, 72]],
  4: [[28, 28], [72, 28], [28, 72], [72, 72]],
  5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]],
  6: [[28, 25], [72, 25], [28, 50], [72, 50], [28, 75], [72, 75]],
};

/** Würfel; `rolling` zeigt zufällige Augen, bis das Ergebnis feststeht */
export function Die({ value, rolling, size = 56, tone = 'light' }: { value: number; rolling?: boolean; size?: number; tone?: 'light' | 'red' }) {
  const [shown, setShown] = useState(value);
  useEffect(() => {
    if (!rolling || prefersReducedMotion()) {
      setShown(value);
      return;
    }
    const id = window.setInterval(() => setShown(1 + Math.floor(Math.random() * 6)), 80);
    return () => window.clearInterval(id);
  }, [rolling, value]);
  const bg = tone === 'red' ? '#b91c1c' : '#f8fafc';
  const pip = tone === 'red' ? '#fff' : '#0d0f14';
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={`Würfel ${value}`}
      style={{ transform: rolling ? `rotate(${(shown * 37) % 30 - 15}deg)` : 'none', transition: 'transform .08s', flex: 'none' }}>
      <rect x="4" y="4" width="92" height="92" rx="20" fill={bg} stroke="rgba(0,0,0,.25)" strokeWidth="2" />
      {(PIPS[shown] ?? []).map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="8.5" fill={pip} />
      ))}
    </svg>
  );
}

/** Glücksrad mit Segmenten; dreht so, dass `targetIndex` unter dem Zeiger (oben) landet */
export function SpinWheel({
  segments,
  targetIndex,
  spinKey,
  size = 300,
}: {
  segments: { color: string; label: string; weight?: number }[];
  targetIndex: number | null;
  spinKey: unknown;
  size?: number;
}) {
  const total = segments.reduce((s, x) => s + (x.weight ?? 1), 0);
  const [rotation, setRotation] = useState(0);
  const rotRef = useRef(0);
  const angles: [number, number][] = [];
  let acc = 0;
  for (const s of segments) {
    const a = ((s.weight ?? 1) / total) * 360;
    angles.push([acc, acc + a]);
    acc += a;
  }
  useEffect(() => {
    if (targetIndex === null || !angles[targetIndex]) return;
    const [a0, a1] = angles[targetIndex];
    const mid = (a0 + a1) / 2 + (Math.random() - 0.5) * (a1 - a0) * 0.6;
    const cur = rotRef.current;
    const next = cur - (cur % 360) + 360 * 5 + (360 - mid);
    rotRef.current = next;
    setRotation(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spinKey]);
  const r = 100;
  const pt = (deg: number, rad: number) => [rad * Math.sin((deg * Math.PI) / 180), -rad * Math.cos((deg * Math.PI) / 180)];
  return (
    <div style={{ position: 'relative', width: `min(78vw, ${size}px)`, aspectRatio: '1', margin: '0 auto' }}>
      <svg viewBox="-110 -110 220 220" style={{ width: '100%', height: '100%', transform: `rotate(${rotation}deg)`, willChange: 'transform',
        transition: prefersReducedMotion() ? 'none' : 'transform 3.2s cubic-bezier(.12,.8,.14,1)' }} role="img" aria-label="Glücksrad">
        <circle r="108" fill="#5c3f10" />
        {segments.map((s, i) => {
          const [a0, a1] = angles[i];
          const [x0, y0] = pt(a0, r);
          const [x1, y1] = pt(a1, r);
          const [tx, ty] = pt((a0 + a1) / 2, 76);
          const large = a1 - a0 > 180 ? 1 : 0;
          return (
            <g key={i}>
              <path d={`M0 0 L${x0} ${y0} A${r} ${r} 0 ${large} 1 ${x1} ${y1} Z`} fill={s.color} stroke="#1a1205" strokeWidth=".8" />
              {a1 - a0 >= 9 && (
                <text x={tx} y={ty} fill="#fff" fontSize={a1 - a0 > 20 ? 10 : 7} fontWeight="800" textAnchor="middle" dominantBaseline="central"
                  transform={`rotate(${(a0 + a1) / 2} ${tx} ${ty})`} fontFamily="JetBrains Mono, monospace">
                  {s.label}
                </text>
              )}
            </g>
          );
        })}
        <circle r="22" fill="#1a1205" stroke="#d8a84e" strokeWidth="3" />
      </svg>
      <div aria-hidden="true" style={{ position: 'absolute', top: -6, left: '50%', transform: 'translateX(-50%)', borderLeft: '10px solid transparent',
        borderRight: '10px solid transparent', borderTop: '18px solid #f3c969', filter: 'drop-shadow(0 2px 3px rgba(0,0,0,.6))' }} />
    </div>
  );
}

/** Zahlenraster zum Auswählen (Keno, Lotto, Number Draw) */
export function NumberPicker({
  count,
  picks,
  drawn,
  max,
  onToggle,
  disabled,
  columns = 8,
}: {
  count: number;
  picks: number[];
  drawn: number[];
  max: number;
  onToggle: (n: number) => void;
  disabled?: boolean;
  columns?: number;
}) {
  return (
    <div role="group" aria-label="Zahlen wählen" style={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: 6 }}>
      {Array.from({ length: count }, (_, i) => i + 1).map((n) => {
        const picked = picks.includes(n);
        const hit = drawn.includes(n);
        return (
          <button
            key={n}
            type="button"
            aria-pressed={picked}
            disabled={disabled || (!picked && picks.length >= max)}
            onClick={() => onToggle(n)}
            className="mono"
            style={{
              aspectRatio: '1',
              borderRadius: 10,
              border: picked ? '2px solid var(--accent)' : '1px solid var(--border-strong)',
              background: picked && hit ? 'linear-gradient(135deg,#16a34a,#15803d)' : hit ? 'rgba(243,201,105,.25)' : picked ? 'rgba(79,142,247,.2)' : 'var(--card)',
              color: 'var(--text)',
              fontWeight: 800,
              fontSize: 14,
              cursor: 'pointer',
              transition: 'background .2s, transform .1s',
              animation: hit ? 'popCell .3s ease both' : undefined,
            }}
          >
            {n}
          </button>
        );
      })}
    </div>
  );
}

/** Zeigt Elemente nacheinander an (für Ziehungen) */
export function useReveal<T>(items: T[] | null, stepMs: number, key: unknown) {
  const [count, setCount] = useState(items?.length ?? 0);
  useEffect(() => {
    if (!items) return;
    if (prefersReducedMotion()) {
      setCount(items.length);
      return;
    }
    setCount(0);
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setCount(i);
      if (i >= items.length) window.clearInterval(id);
    }, stepMs);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return items ? items.slice(0, count) : [];
}
