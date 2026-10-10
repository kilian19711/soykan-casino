import { useEffect, useState } from 'react';
import type { GameConfig } from '../../../types';
import { prefersReducedMotion } from '../../../lib/preferences';
import { Button } from '../../../components/Button';
import { BigResult, PayTable, SimpleGame, tone, type R } from '../engine';
import { NumberPicker, useReveal } from '../visuals';
import { SlotSymbol } from './SlotSymbols';

function randomPicks(pool: number, k: number) {
  const s = new Set<number>();
  while (s.size < k) s.add(1 + Math.floor(Math.random() * pool));
  return [...s].sort((a, b) => a - b);
}

/** Gemeinsame Oberfläche für Keno, Number Draw und Digital Lottery */
function DrawGame({ config, subtitle, columns }: { config: GameConfig; subtitle: string; columns: number }) {
  const c = config.config as unknown as { pool: number; draw: number; min_picks: number; max_picks: number; pay: Record<string, number[]> };
  const [picks, setPicks] = useState<number[]>([]);
  const toggle = (n: number) => setPicks((p) => (p.includes(n) ? p.filter((x) => x !== n) : p.length < c.max_picks ? [...p, n] : p));
  const table = c.pay[String(picks.length)] ?? [];
  return (
    <SimpleGame
      config={config}
      subtitle={subtitle}
      rules={
        <>
          <p>
            Wähle {c.min_picks === c.max_picks ? c.min_picks : `${c.min_picks}–${c.max_picks}`} Zahlen aus 1–{c.pool}. Dann werden {c.draw} Zahlen gezogen. Je mehr Treffer, desto höher der Gewinn.
          </p>
          <PayTable rows={Object.entries(c.pay).map(([k, t]) => [`${k} gewählt`, t.map((m, h) => (m ? `${h}: ${m}×` : '')).filter(Boolean).join(' · ')])} />
        </>
      }
      params={() => (picks.length >= c.min_picks ? { picks } : null)}
      paramsHint={`Wähle ${c.min_picks === c.max_picks ? c.min_picks : `mindestens ${c.min_picks}`} Zahl(en).`}
      controls={(d) => (
        <>
          <div className="row wrap">
            <Button size="sm" disabled={d} onClick={() => setPicks(randomPicks(c.pool, c.max_picks))}>Zufällig</Button>
            <Button size="sm" disabled={d || !picks.length} onClick={() => setPicks([])}>Leeren</Button>
            <span className="small muted">{picks.length}/{c.max_picks} gewählt</span>
          </div>
          {table.length > 0 && (
            <div className="small subtle">Gewinne: {table.map((m, h) => (m ? `${h} Treffer ${m}×` : '')).filter(Boolean).join(' · ')}</div>
          )}
        </>
      )}
      animationMs={c.draw * 180 + 200}
      stage={(r, a) => <DrawStage r={r} a={a} c={c} picks={picks} toggle={toggle} columns={columns} />}
      describe={(r) => `${r.hits} von ${(r.picks as number[]).length} Treffern`}
      recentLabel={(x) => `${(x.result as R).hits} Tr.`}
      playLabel="Ziehen"
    />
  );
}

function DrawStage({ r, a, c, picks, toggle, columns }: { r: R | null; a: boolean; c: { pool: number; draw: number; max_picks: number }; picks: number[]; toggle: (n: number) => void; columns: number }) {
  const drawn = useReveal((r?.drawn as number[]) ?? null, 180, r);
  return (
    <div className="stack">
      <NumberPicker count={c.pool} picks={picks} drawn={r ? drawn : []} max={c.max_picks} onToggle={toggle} disabled={a} columns={columns} />
      {r && !a && <BigResult text={`${r.hits} Treffer`} sub={Number(r.mult) > 0 ? `${r.mult}× Einsatz` : 'Kein Gewinn'} tone={tone(r, a)} />}
    </div>
  );
}

export const Keno = ({ config }: { config: GameConfig }) => <DrawGame config={config} subtitle="Wähle bis zu 10 Zahlen – 10 von 40 werden gezogen." columns={8} />;
export const NumberDraw = ({ config }: { config: GameConfig }) => <DrawGame config={config} subtitle="Bis zu 5 Glückszahlen aus 36 – 6 werden gezogen." columns={6} />;
export const DigitalLottery = ({ config }: { config: GameConfig }) => <DrawGame config={config} subtitle="5 aus 30 – triff alle fünf für den Jackpot." columns={6} />;

// ---------------------------------------------------------------- Bingo
export function Bingo({ config }: { config: GameConfig }) {
  const pay = (config.config.pay as number[]) ?? [];
  const draw = Number(config.config.draw ?? 30);
  return (
    <SimpleGame
      config={config}
      subtitle={`Deine Karte wird zufällig erstellt. ${draw} von 75 Kugeln werden gezogen.`}
      rules={
        <>
          <p>5×5-Karte mit freier Mitte. Zählt werden volle Reihen, Spalten und Diagonalen (12 Linien).</p>
          <PayTable rows={pay.map((m, i): [string, string] => [`${i}${i === pay.length - 1 ? '+' : ''} Linie(n)`, `${m}×`]).filter(([, m]) => m !== '0×')} />
        </>
      }
      params={() => ({})}
      animationMs={draw * 90 + 300}
      stage={(r, a) => <BingoStage r={r} a={a} />}
      describe={(r) => `${r.lines} Linie(n)`}
      recentLabel={(x) => `${(x.result as R).lines} L`}
      playLabel="Bingo spielen"
    />
  );
}

function BingoStage({ r, a }: { r: R | null; a: boolean }) {
  const drawn = useReveal((r?.drawn as number[]) ?? null, 90, r);
  const card = (r?.card as number[]) ?? Array.from({ length: 25 }, () => 0);
  const shownSet = new Set(a ? drawn : ((r?.drawn as number[]) ?? []));
  return (
    <div className="stack" style={{ alignItems: 'center' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0,1fr))', gap: 6, width: 'min(100%, 340px)' }}>
        {['B', 'I', 'N', 'G', 'O'].map((l) => (
          <div key={l} className="center label" style={{ color: 'var(--gold-bright)' }}>{l}</div>
        ))}
        {card.map((n, i) => {
          const marked = i === 12 || (n > 0 && shownSet.has(n));
          return (
            <div key={i} className="mono" style={{ aspectRatio: '1', display: 'grid', placeItems: 'center', borderRadius: 10, fontWeight: 800,
              background: marked ? 'linear-gradient(135deg,#d8a84e,#a87a2a)' : 'var(--card)', color: marked ? '#1a1205' : 'var(--text)',
              border: '1px solid var(--border-strong)', transition: 'background .25s', animation: marked && i !== 12 ? 'popCell .3s ease both' : undefined }}>
              {i === 12 ? '★' : n || ''}
            </div>
          );
        })}
      </div>
      <div className="small muted">{r ? `${(a ? drawn : (r.drawn as number[])).length} Kugeln gezogen` : 'Noch keine Karte'}</div>
      {r && !a && <BigResult text={`${r.lines} Linie(n)`} sub={Number(r.mult) > 0 ? `${r.mult}× Einsatz` : 'Kein Gewinn'} tone={tone(r, a)} />}
    </div>
  );
}

// ---------------------------------------------------------------- Scratch Card (Rubbellos)
export function ScratchCard({ config }: { config: GameConfig }) {
  const prizes = (config.config.prizes as [number, number, string | null][]) ?? [];
  return (
    <SimpleGame
      config={config}
      subtitle="Rubbel 9 Felder frei – drei gleiche Symbole gewinnen."
      rules={
        <>
          <p>Drei gleiche Symbole gewinnen den Preis des Symbols. Alle anderen Symbole erscheinen höchstens zweimal.</p>
          <div className="table-wrap">
            <table className="table">
              <tbody>
                {prizes.filter(([m]) => m > 0).map(([m, , s]) => (
                  <tr key={String(s)}>
                    <td><span className="row"><SlotSymbol symbol={String(s)} size={22} /> 3×</span></td>
                    <td className="num">{m}×</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      }
      params={() => ({})}
      animationMs={2600}
      stage={(r, a) => <ScratchStage r={r} a={a} />}
      describe={(r) => (Number(r.mult) > 0 ? `3× Symbol – ${r.mult}×` : 'Kein Gewinn')}
      playLabel="Neues Los kaufen"
    />
  );
}

function ScratchStage({ r, a }: { r: R | null; a: boolean }) {
  const [openCount, setOpenCount] = useState(0);
  useEffect(() => {
    if (!r) return;
    if (prefersReducedMotion()) {
      setOpenCount(9);
      return;
    }
    setOpenCount(0);
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setOpenCount(i);
      if (i >= 9) window.clearInterval(id);
    }, 260);
    return () => window.clearInterval(id);
  }, [r]);
  const opened = Array.from({ length: 9 }, (_, i) => i < openCount);
  const grid = (r?.grid as string[]) ?? [];
  const all = openCount >= 9 && !a;
  return (
    <div className="stack" style={{ alignItems: 'center' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 8, width: 'min(100%, 320px)' }}>
        {Array.from({ length: 9 }).map((_, i) => {
          const sym = grid[i];
          const win = all && r && Number(r.mult) > 0 && sym === r.symbol;
          return (
            <div key={i} role="img"
              aria-label={opened[i] ? `Feld ${i + 1}: ${sym}` : `Feld ${i + 1} verdeckt`}
              style={{ aspectRatio: '1', borderRadius: 12, border: win ? '2px solid var(--gold-bright)' : '1px solid var(--border-strong)', display: 'grid', placeItems: 'center',
                background: opened[i] ? '#f8fafc12' : 'repeating-linear-gradient(135deg,#94a3b8 0 6px,#cbd5e1 6px 12px)',
                transition: 'background .2s', animation: opened[i] ? 'popCell .25s ease both' : undefined }}>
              {opened[i] && sym ? <SlotSymbol symbol={sym} size={44} /> : null}
            </div>
          );
        })}
      </div>
      {r && all && <BigResult text={Number(r.mult) > 0 ? `Gewonnen ${r.mult}×` : 'Leider nichts'} tone={Number(r.mult) > 0 ? 'win' : 'loss'} />}
      {!r && <p className="small muted">Kaufe ein Los – die Felder werden automatisch freigerubbelt.</p>}
    </div>
  );
}
