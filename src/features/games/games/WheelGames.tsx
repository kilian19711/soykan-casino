import { useEffect, useState } from 'react';
import type { GameConfig } from '../../../types';
import { formatMultiplier, formatMultiplierH } from '../../../lib/format';
import { BigResult, Choice, PayTable, SimpleGame, tone, type R } from '../engine';
import { SpinWheel } from '../visuals';

const multColor = (m: number) =>
  m === 0 ? '#2b3245' : m < 1 ? '#475569' : m < 2 ? '#2563eb' : m < 5 ? '#7c3aed' : m < 20 ? '#d97706' : '#d8a84e';

// ---------------------------------------------------------------- Coinflip
function Coin({ side, spinning }: { side: string | null; spinning: boolean }) {
  const heads = side !== 'tails';
  return (
    <div style={{ perspective: 600, display: 'grid', placeItems: 'center', padding: 20 }}>
      <div
        style={{
          width: 150,
          height: 150,
          borderRadius: '50%',
          display: 'grid',
          placeItems: 'center',
          fontWeight: 900,
          fontSize: 34,
          background: heads ? 'radial-gradient(circle at 35% 30%, #fff1c2, #f3c969 45%, #9a6d22)' : 'radial-gradient(circle at 35% 30%, #e2e8f0, #94a3b8 45%, #334155)',
          color: heads ? '#2a1c06' : '#0f172a',
          border: '6px solid rgba(0,0,0,.25)',
          animation: spinning ? 'coinSpin .25s linear infinite' : 'popIn .3s ease both',
          willChange: 'transform',
        }}
        aria-live="polite"
      >
        {spinning ? '' : heads ? 'SHB' : '★'}
      </div>
    </div>
  );
}

export function Coinflip({ config }: { config: GameConfig }) {
  const [side, setSide] = useState<'heads' | 'tails'>('heads');
  const pay = Number(config.config.pay ?? 1.98);
  return (
    <SimpleGame
      config={config}
      subtitle="Kopf oder Zahl – 50 : 50."
      rules={<p>Wähle eine Seite. Landet die Münze darauf, erhältst du {formatMultiplier(pay)} deines Einsatzes.</p>}
      params={() => ({ side })}
      controls={(d) => (
        <Choice label="Seite" value={side} onChange={setSide} disabled={d} options={[['heads', 'Kopf (SHB)'], ['tails', 'Zahl (★)']]} />
      )}
      animationMs={1200}
      stage={(r, a) => (
        <>
          <Coin side={r ? String(r.outcome) : side} spinning={a} />
          {r && !a && <BigResult text={r.win ? `Gewonnen ${formatMultiplier(pay)}` : 'Leider daneben'} tone={tone(r, a)} />}
        </>
      )}
      describe={(r) => `Münze: ${r.outcome === 'heads' ? 'Kopf' : 'Zahl'}`}
      recentLabel={(x) => ((x.result as R).outcome === 'heads' ? 'Kopf' : 'Zahl')}
      playLabel="Münze werfen"
    />
  );
}

// ---------------------------------------------------------------- Wheel
export function Wheel({ config }: { config: GameConfig }) {
  const [risk, setRisk] = useState<'low' | 'medium' | 'high'>('medium');
  const tables = config.config.tables as Record<string, number[]>;
  const segs = (tables[risk] ?? []).map((m) => ({ color: multColor(m), label: m ? `${m}×` : '' }));
  return (
    <SimpleGame
      config={config}
      subtitle="Dreh das Rad – das Segment unter dem Zeiger bestimmt den Multiplikator."
      rules={
        <>
          <p>20 Segmente, drei Risikostufen. Auszahlung = Einsatz × Segment-Multiplikator (Quote 99 %).</p>
          <PayTable rows={Object.entries(tables).map(([k, t]) => [k === 'low' ? 'Niedrig' : k === 'medium' ? 'Mittel' : 'Hoch', t.join(' · ')])} />
        </>
      }
      params={() => ({ risk })}
      controls={(d) => (
        <Choice label="Risiko" value={risk} onChange={setRisk} disabled={d} options={[['low', 'Niedrig'], ['medium', 'Mittel'], ['high', 'Hoch']]} />
      )}
      animationMs={3300}
      stage={(r, a) => (
        <WheelStage segs={segs} r={r} a={a} />
      )}
      describe={(r) => `Segment ${formatMultiplier(Number(r.mult))}`}
      playLabel="Drehen"
    />
  );
}

function WheelStage({ segs, r, a }: { segs: { color: string; label: string; weight?: number }[]; r: R | null; a: boolean }) {
  return (
    <div className="stack">
      <SpinWheel segments={segs} targetIndex={r ? Number(r.index) : null} spinKey={r} />
      {r && !a && <BigResult text={formatMultiplier(Number(r.mult))} tone={tone(r, a)} />}
    </div>
  );
}

// ---------------------------------------------------------------- Color Wheel
const COLOR_HEX: Record<string, string> = { grau: '#475569', rot: '#dc2626', blau: '#2563eb', gruen: '#16a34a', gold: '#d8a84e' };
const COLOR_NAME: Record<string, string> = { grau: 'Grau', rot: 'Rot', blau: 'Blau', gruen: 'Grün', gold: 'Gold' };

export function ColorWheel({ config }: { config: GameConfig }) {
  const [color, setColor] = useState('rot');
  const layout = (config.config.layout as string[]) ?? [];
  const pay = config.config.pay as Record<string, number>;
  const segs = layout.map((c) => ({ color: COLOR_HEX[c], label: '' }));
  return (
    <SimpleGame
      config={config}
      subtitle="Setz auf eine Farbe – je seltener, desto höher die Auszahlung."
      rules={
        <>
          <p>54 Segmente. Grau zahlt nie.</p>
          <PayTable rows={Object.entries(pay).map(([c, m]) => [`${COLOR_NAME[c]} (${layout.filter((x) => x === c).length} Felder)`, `${m}×`])} />
        </>
      }
      params={() => ({ color })}
      controls={(d) => (
        <div className="field">
          <span className="field-label">Farbe</span>
          <div className="chip-group">
            {Object.entries(pay).map(([c, m]) => (
              <button key={c} type="button" className="chip" aria-pressed={color === c} disabled={d} onClick={() => setColor(c)}
                style={{ borderColor: color === c ? COLOR_HEX[c] : undefined }}>
                <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 5, background: COLOR_HEX[c], marginRight: 6 }} />
                {COLOR_NAME[c]} {m}×
              </button>
            ))}
          </div>
        </div>
      )}
      animationMs={3300}
      stage={(r, a) => <WheelStage segs={segs} r={r} a={a} />}
      describe={(r) => `Feld: ${COLOR_NAME[String(r.hit)]}`}
      recentLabel={(x) => COLOR_NAME[String((x.result as R).hit)] ?? '–'}
      playLabel="Drehen"
    />
  );
}

// ---------------------------------------------------------------- Bonus Wheel
export function BonusWheel({ config }: { config: GameConfig }) {
  const segments = (config.config.segments as [number, number][]) ?? [];
  const segs = segments.map(([m, w]) => ({ color: multColor(m), label: `${m}×`, weight: Math.max(w, 1.2) }));
  return (
    <SimpleGame
      config={config}
      subtitle="Einfach drehen – vom Totalverlust bis zum 50×-Jackpot."
      rules={
        <>
          <p>Die Segmente sind unterschiedlich groß (Wahrscheinlichkeit). Kleine Segmente zeigen sehr seltene Treffer vergrößert an.</p>
          <PayTable rows={segments.map(([m, w]) => [`${m}×`, `${w} %`])} />
        </>
      }
      params={() => ({})}
      animationMs={3300}
      stage={(r, a) => <WheelStage segs={segs} r={r} a={a} />}
      describe={(r) => `Bonus ${formatMultiplier(Number(r.mult))}`}
      playLabel="Bonusrad drehen"
    />
  );
}

// ---------------------------------------------------------------- Goal Multiplier
export function GoalMultiplier({ config }: { config: GameConfig }) {
  const [corner, setCorner] = useState(0);
  const pay = Number(config.config.pay ?? 1.47);
  return (
    <SimpleGame
      config={config}
      subtitle="Elfmeter! Wähle eine Ecke – der Torwart springt in eine von drei."
      rules={<p>Trifft der Torwart deine Ecke nicht, ist es ein Tor: {formatMultiplier(pay)}. Gewinnchance 2/3.</p>}
      params={() => ({ corner })}
      controls={(d) => (
        <Choice label="Ecke" value={corner} onChange={setCorner} disabled={d} options={[[0, 'Links'], [1, 'Mitte'], [2, 'Rechts']]} />
      )}
      animationMs={900}
      stage={(r, a) => (
        <div className="stack" style={{ alignItems: 'center' }}>
          <svg viewBox="0 0 300 170" style={{ width: 'min(100%, 460px)' }} role="img" aria-label="Tor">
            <rect x="0" y="150" width="300" height="20" fill="#14532d" />
            <rect x="30" y="20" width="240" height="130" fill="none" stroke="#f8fafc" strokeWidth="6" />
            {Array.from({ length: 12 }).map((_, i) => (
              <line key={i} x1={30 + i * 20} y1="20" x2={30 + i * 20} y2="150" stroke="#f8fafc" strokeOpacity=".15" />
            ))}
            {[0, 1, 2].map((c) => (
              <rect key={c} x={33 + c * 78} y="23" width="78" height="124" fill={!a && r && Number(r.keeper) === c ? 'rgba(239,68,68,.25)' : c === corner ? 'rgba(79,142,247,.15)' : 'transparent'} />
            ))}
            <g style={{ transform: `translateX(${a || !r ? 0 : (Number(r.keeper) - 1) * 78}px)`, transition: 'transform .5s cubic-bezier(.2,.9,.3,1)' }}>
              <circle cx="150" cy="70" r="13" fill="#f59e0b" />
              <rect x="135" y="85" width="30" height="45" rx="8" fill="#f59e0b" />
            </g>
            <circle
              cx={!a && r ? 72 + Number(r.corner) * 78 : 150}
              cy={!a && r ? 60 : 158}
              r="9"
              fill="#fff"
              stroke="#111"
              style={{ transition: 'cx .45s ease-out, cy .45s ease-out' }}
            />
          </svg>
          {r && !a && <BigResult text={r.goal ? 'TOR!' : 'Gehalten'} tone={tone(r, a)} sub={r.goal ? formatMultiplier(pay) : undefined} />}
        </div>
      )}
      describe={(r) => (r.goal ? 'Tor' : 'Gehalten')}
      recentLabel={(x) => ((x.result as R).goal ? 'Tor' : 'Gehalten')}
      playLabel="Schießen"
    />
  );
}

// ---------------------------------------------------------------- Rocket Multiplier
export function RocketMultiplier({ config }: { config: GameConfig }) {
  const [target, setTarget] = useState('2.00');
  const t = Math.round(Number(target.replace(',', '.')) * 100);
  const valid = Number.isFinite(t) && t >= 101 && t <= 100000000;
  return (
    <SimpleGame
      config={config}
      subtitle="Wie hoch fliegt die Rakete? Erreicht sie dein Ziel, gewinnst du."
      rules={<p>Wähle, wie hoch die Rakete fliegen soll. Gewinnchance = 99 % / Ziel. Auszahlung = Einsatz × Ziel.</p>}
      params={() => (valid ? { target: t } : null)}
      paramsHint="Ziel zwischen 1,01× und 1.000.000×"
      controls={(d) => (
        <div className="field">
          <label htmlFor="rocket-target">Zielhöhe (Multiplikator)</label>
          <div className="input-group">
            <input id="rocket-target" className="input mono" inputMode="decimal" value={target} disabled={d}
              onChange={(e) => setTarget(e.target.value.replace(/[^0-9.,]/g, '').slice(0, 10))} />
            <span className="addon">×</span>
          </div>
          <div className="chip-group">
            {['1.5', '2', '5', '10', '50'].map((v) => (
              <button key={v} type="button" className="chip" disabled={d} onClick={() => setTarget(Number(v).toFixed(2))}>{v}×</button>
            ))}
          </div>
        </div>
      )}
      animationMs={(r) => (r.win ? 1500 : 1200)}
      stage={(r, a) => {
        const res = r ? Number(r.result) : 100;
        const height = Math.min(90, Math.log10(res / 100 + 1) * 45);
        return (
          <div style={{ position: 'relative', height: 300, overflow: 'hidden', borderRadius: 12, background: 'linear-gradient(180deg,#0b1026,#1b1440 60%,#2d1b4e)' }}>
            {Array.from({ length: 30 }).map((_, i) => (
              <span key={i} style={{ position: 'absolute', left: `${(i * 37) % 100}%`, top: `${(i * 53) % 100}%`, width: 2, height: 2, background: '#fff', opacity: 0.5, borderRadius: 1 }} />
            ))}
            <div style={{ position: 'absolute', left: '50%', bottom: `${r ? (a ? height : r.win ? height : height) : 4}%`, transform: 'translateX(-50%)',
              transition: 'bottom 1.1s cubic-bezier(.3,.7,.3,1)', fontSize: 46, willChange: 'bottom' }} aria-hidden="true">
              <svg width="48" height="80" viewBox="0 0 48 80"><path d="M24 2c12 12 16 30 12 50H12C8 32 12 14 24 2Z" fill="#e2e8f0" /><circle cx="24" cy="26" r="7" fill="#4f8ef7" />
                <path d="M12 52 2 66l12-4Zm24 0 10 14-12-4Z" fill="#ef4444" />{(a || !r) && <path d="M16 54h16l-8 24Z" fill="#f59e0b" />}</svg>
            </div>
            <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
              <BigResult text={r && !a ? formatMultiplierH(res) : a ? 'Start …' : `Ziel ${valid ? formatMultiplierH(t) : '–'}`} tone={tone(r, a)} />
            </div>
          </div>
        );
      }}
      describe={(r) => `Höhe ${formatMultiplierH(Number(r.result))} · Ziel ${formatMultiplierH(Number(r.target))}`}
      recentLabel={(x) => formatMultiplierH(Number((x.result as R).result ?? 100))}
      playLabel="Starten"
    />
  );
}

// ---------------------------------------------------------------- Safe Cracker
export function SafeCracker({ config }: { config: GameConfig }) {
  const [safe, setSafe] = useState<number | null>(null);
  const contents = (config.config.contents as number[]) ?? [];
  return (
    <SimpleGame
      config={config}
      subtitle="Sechs Tresore, sechs Inhalte. Welchen knackst du?"
      rules={<p>Die Inhalte {contents.map((c) => `${c}×`).join(', ')} werden zufällig auf die Tresore verteilt. Du erhältst den Multiplikator deines Tresors.</p>}
      params={() => (safe === null ? null : { safe })}
      paramsHint="Wähle einen Tresor."
      animationMs={1000}
      stage={(r, a) => (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 10, maxWidth: 420, margin: '0 auto' }}>
          {contents.map((_, i) => {
            const open = r && !a;
            const val = open ? Number((r.contents as number[])[i]) : null;
            const mine = r ? Number(r.safe) === i : safe === i;
            return (
              <button key={i} type="button" onClick={() => setSafe(i)} disabled={a}
                style={{ aspectRatio: '1', borderRadius: 14, border: mine ? '3px solid var(--gold-bright)' : '1px solid var(--border-strong)',
                  background: open ? (val! >= 1 ? 'linear-gradient(180deg,#14532d,#0f3d22)' : '#2b1d1d') : 'linear-gradient(180deg,#334155,#1e293b)',
                  color: 'var(--text)', display: 'grid', placeItems: 'center', fontFamily: 'var(--mono)', fontWeight: 800, fontSize: 20, cursor: 'pointer',
                  animation: a && mine ? 'shake .3s ease infinite' : open ? 'popCell .3s ease both' : undefined }}
                aria-label={`Tresor ${i + 1}${val !== null ? `, ${val}×` : ''}`}>
                {val !== null ? `${val}×` : (
                  <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true"><rect x="4" y="4" width="32" height="32" rx="5" fill="none" stroke="#94a3b8" strokeWidth="3" />
                    <circle cx="20" cy="20" r="7" fill="none" stroke="#f3c969" strokeWidth="3" /><path d="M20 13v3M27 20h-3" stroke="#f3c969" strokeWidth="3" /></svg>
                )}
              </button>
            );
          })}
        </div>
      )}
      describe={(r) => `Tresor ${Number(r.safe) + 1}: ${r.mult}×`}
      playLabel="Tresor knacken"
    />
  );
}

// ---------------------------------------------------------------- Drop Ball
export function DropBall({ config }: { config: GameConfig }) {
  const table = (config.config.table as number[]) ?? [];
  const rows = table.length - 1;
  return (
    <SimpleGame
      config={config}
      subtitle="Pachinko-Style: Die Kugel fällt durch 10 Reihen in ein Feld."
      rules={<p>Feld-Multiplikatoren: {table.join(' · ')}. Quote ≈ 97,9 %.</p>}
      params={() => ({})}
      animationMs={rows * 110 + 200}
      stage={(r, a) => <DropBoard table={table} r={r} a={a} />}
      describe={(r) => `Feld ${Number(r.bucket) + 1} · ${r.mult}×`}
      recentLabel={(x) => `${(x.result as R).mult}×`}
      playLabel="Kugel fallen lassen"
    />
  );
}

function DropBoard({ table, r, a }: { table: number[]; r: R | null; a: boolean }) {
  const rows = table.length - 1;
  const W = 320, gap = W / (rows + 2), rowH = 24, TOP = 20;
  const [step, setStep] = useState(-1);
  useEffect(() => {
    if (!r || !a) return;
    let i = 0;
    setStep(0);
    const id = window.setInterval(() => {
      i += 1;
      setStep(i);
      if (i > rows) window.clearInterval(id);
    }, 110);
    return () => window.clearInterval(id);
  }, [r, a, rows]);
  const path = (r?.path as number[]) ?? [];
  const rights = path.slice(0, Math.max(0, step)).reduce((s, b) => s + b, 0);
  const ballX = W / 2 - (Math.max(0, step) * gap) / 2 + rights * gap;
  const ballY = TOP + Math.max(0, step) * rowH;
  return (
    <svg viewBox={`0 0 ${W} ${TOP + rows * rowH + 50}`} style={{ width: '100%', maxWidth: 520, margin: '0 auto', display: 'block' }} role="img" aria-label="Drop Ball">
      {Array.from({ length: rows }).map((_, row) =>
        Array.from({ length: row + 2 }).map((__, i) => (
          <circle key={`${row}-${i}`} cx={W / 2 - ((row + 1) * gap) / 2 + i * gap} cy={TOP + row * rowH + rowH / 2} r="3" fill="#94a3b8" />
        )),
      )}
      {table.map((m, i) => {
        const x = W / 2 - (rows * gap) / 2 + i * gap - gap / 2 + 1.5;
        const hit = r && !a && Number(r.bucket) === i;
        return (
          <g key={i}>
            <rect x={x} y={TOP + rows * rowH + 8} width={gap - 3} height="22" rx="4" fill={m >= 4 ? '#d8a84e' : m >= 1 ? '#2563eb' : '#334155'} stroke={hit ? '#fff' : 'none'} strokeWidth="2" />
            <text x={x + (gap - 3) / 2} y={TOP + rows * rowH + 23} fontSize="8" fontWeight="800" textAnchor="middle" fill="#fff" fontFamily="JetBrains Mono">{m}</text>
          </g>
        );
      })}
      {r && a && step >= 0 && <circle cx={ballX} cy={ballY} r="7" fill="#f3c969" stroke="#7a5418" style={{ transition: 'cx .1s linear, cy .1s ease-in' }} />}
    </svg>
  );
}

