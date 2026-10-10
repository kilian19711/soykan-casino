import { useMemo, useState } from 'react';
import type { GameConfig } from '../../../types';
import { formatCredits, formatMultiplier } from '../../../lib/format';
import { Button } from '../../../components/Button';
import { BigResult, PayTable, SimpleGame, tone, type R } from '../engine';
import { Die } from '../visuals';

const CHIPS = [10, 50, 100, 500, 1000];

// ---------------------------------------------------------------- Sic Bo
type SicBet = { type: string; value?: number; amount: number };
const keyOf = (b: { type: string; value?: number }) => `${b.type}:${b.value ?? ''}`;

export function SicBo({ config }: { config: GameConfig }) {
  const [chip, setChip] = useState(10);
  const [bets, setBets] = useState<Record<string, SicBet>>({});
  const totalPay = config.config.total_pay as Record<string, number>;
  const total = useMemo(() => Object.values(bets).reduce((s, b) => s + b.amount, 0), [bets]);
  const place = (type: string, value?: number) =>
    setBets((p) => {
      const k = keyOf({ type, value });
      return { ...p, [k]: { type, value, amount: (p[k]?.amount ?? 0) + chip } };
    });
  const amount = (type: string, value?: number) => bets[keyOf({ type, value })]?.amount;

  const Spot = ({ type, value, label, sub, disabled }: { type: string; value?: number; label: string; sub?: string; disabled: boolean }) => (
    <button type="button" disabled={disabled} onClick={() => place(type, value)}
      style={{ position: 'relative', minHeight: 48, borderRadius: 8, border: '1px solid rgba(255,255,255,.2)', background: 'rgba(255,255,255,.04)', color: 'var(--text)',
        fontWeight: 800, fontSize: 13, cursor: 'pointer', padding: 4 }}>
      {label}
      {sub && <div className="small muted" style={{ fontWeight: 600 }}>{sub}</div>}
      {amount(type, value) ? (
        <span style={{ position: 'absolute', top: -7, right: -5, minWidth: 22, height: 22, padding: '0 4px', borderRadius: 11, display: 'grid', placeItems: 'center',
          background: 'radial-gradient(circle at 35% 30%, #fff1c2, #f3c969 45%, #9a6d22)', color: '#2a1c06', fontSize: 9.5, border: '1.5px dashed #7a5418' }}>
          {amount(type, value)}
        </span>
      ) : null}
    </button>
  );

  return (
    <SimpleGame
      config={config}
      subtitle="Drei Würfel, viele Wetten – setz deine Chips auf den Tisch."
      hideBet
      totalBet={() => total}
      rules={
        <>
          <p>Mehrere Einsätze pro Wurf möglich. Klein (4–10) und Groß (11–17) verlieren bei einem Pasch aus drei gleichen.</p>
          <PayTable rows={[
            ['Klein / Groß', '2×'],
            ['Einzelzahl (1/2/3 Würfel)', '2× / 3× / 4×'],
            ['Beliebiger Dreier-Pasch', `${config.config.any_triple}×`],
            ['Bestimmter Dreier-Pasch', `${config.config.triple}×`],
            ...Object.entries(totalPay).map(([s, m]): [string, string] => [`Summe ${s}`, `${m}×`]),
          ]} />
        </>
      }
      params={() => (total > 0 ? { bets: Object.values(bets) } : null)}
      paramsHint="Setze mindestens einen Chip auf den Tisch."
      controls={(d) => (
        <>
          <div className="field">
            <span className="field-label">Chip</span>
            <div className="chip-group">
              {CHIPS.map((c) => (
                <button key={c} type="button" className="chip" aria-pressed={chip === c} disabled={d} onClick={() => setChip(c)}>{formatCredits(c)}</button>
              ))}
            </div>
          </div>
          <div className="row">
            <Button size="sm" disabled={d || !total} onClick={() => setBets({})}>Tisch leeren</Button>
          </div>
        </>
      )}
      animationMs={1300}
      stage={(r, a) => (
        <div className="stack-lg">
          <div className="row" style={{ justifyContent: 'center', gap: 14 }}>
            {((r?.dice as number[]) ?? [1, 2, 3]).map((d, i) => <Die key={i} value={d} rolling={a} size={64} tone="red" />)}
          </div>
          {r && !a && <BigResult text={`Summe ${r.sum}`} sub={Number(r.mult) > 0 ? `Auszahlung ${formatMultiplier(Number(r.mult))}` : 'Kein Gewinn'} tone={tone(r, a)} />}
          <div style={{ display: 'grid', gap: 6, gridTemplateColumns: 'repeat(2, 1fr)', padding: 10, borderRadius: 14, background: 'radial-gradient(circle at 50% 0%, #7f1d1d, #2b0a0a)', border: '2px solid #7a5418' }}>
            <Spot type="small" label="Klein" sub="4–10 · 2×" disabled={a} />
            <Spot type="big" label="Groß" sub="11–17 · 2×" disabled={a} />
            <div style={{ gridColumn: 'span 2', display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
              {Array.from({ length: 14 }, (_, i) => i + 4).map((s) => <Spot key={s} type="total" value={s} label={String(s)} sub={`${totalPay[s]}×`} disabled={a} />)}
            </div>
            <div style={{ gridColumn: 'span 2', display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 4 }}>
              {[1, 2, 3, 4, 5, 6].map((v) => <Spot key={v} type="single" value={v} label={String(v)} sub="Zahl" disabled={a} />)}
            </div>
            <div style={{ gridColumn: 'span 2', display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
              <Spot type="any_triple" label="3er" sub={`${config.config.any_triple}×`} disabled={a} />
              {[1, 2, 3, 4, 5, 6].map((v) => <Spot key={v} type="triple" value={v} label={`${v}${v}${v}`} sub={`${config.config.triple}×`} disabled={a} />)}
            </div>
          </div>
        </div>
      )}
      describe={(r) => `Würfel ${(r.dice as number[]).join('-')} · Summe ${r.sum}`}
      recentLabel={(x) => String((x.result as R).sum ?? '–')}
      playLabel="Würfeln"
    />
  );
}

// ---------------------------------------------------------------- Poker Dice
const HANDS: Record<string, string> = { five: 'Fünfling', four: 'Vierling', full: 'Full House', straight: 'Straße', three: 'Drilling', twopair: 'Zwei Paare', none: 'Nichts' };

export function PokerDice({ config }: { config: GameConfig }) {
  const pay = config.config.pay as Record<string, number>;
  return (
    <SimpleGame
      config={config}
      subtitle="Fünf Würfel – würfle die beste Pokerhand."
      rules={<PayTable rows={Object.entries(pay).filter(([, m]) => m > 0).map(([k, m]) => [HANDS[k], `${m}×`])} />}
      params={() => ({})}
      animationMs={1200}
      stage={(r, a) => (
        <div className="stack-lg" style={{ alignItems: 'center' }}>
          <div className="row wrap" style={{ justifyContent: 'center', gap: 10 }}>
            {((r?.dice as number[]) ?? [6, 6, 6, 6, 6]).map((d, i) => <Die key={i} value={d} rolling={a} size={58} />)}
          </div>
          {r && !a && <BigResult text={HANDS[String(r.hand)]} sub={Number(r.mult) > 0 ? `${r.mult}×` : 'Kein Gewinn'} tone={tone(r, a)} />}
        </div>
      )}
      describe={(r) => HANDS[String(r.hand)]}
      recentLabel={(x) => HANDS[String((x.result as R).hand)] ?? '–'}
      playLabel="Würfeln"
    />
  );
}

// ---------------------------------------------------------------- Dice Duel
export function DiceDuel({ config }: { config: GameConfig }) {
  const pay = Number(config.config.pay ?? 1.95);
  return (
    <SimpleGame
      config={config}
      subtitle="Zwei Würfel gegen zwei Würfel – die höhere Summe gewinnt."
      rules={<p>Du und das Haus würfeln je zwei Würfel. Höhere Summe gewinnt {formatMultiplier(pay)}, Gleichstand = Einsatz zurück.</p>}
      params={() => ({})}
      animationMs={1200}
      stage={(r, a) => {
        const p = (r?.player as number[]) ?? [6, 6];
        const h = (r?.house as number[]) ?? [6, 6];
        return (
          <div className="stack-lg">
            <div className="grid-2" style={{ gridTemplateColumns: '1fr 1fr' }}>
              {[['Du', p, 'player'], ['Haus', h, 'house']].map(([t, d, k]) => (
                <div key={String(k)} className="stack" style={{ alignItems: 'center' }}>
                  <span className={`badge ${r && !a && r.winner === k ? 'badge-gold' : ''}`}>{String(t)}</span>
                  <div className="row" style={{ gap: 8 }}>
                    {(d as number[]).map((x, i) => <Die key={i} value={x} rolling={a} size={56} tone={k === 'house' ? 'red' : 'light'} />)}
                  </div>
                  {r && !a && <span className="mono stat-value" style={{ fontSize: 22 }}>{(d as number[])[0] + (d as number[])[1]}</span>}
                </div>
              ))}
            </div>
            {r && !a && <BigResult text={r.winner === 'player' ? 'Gewonnen!' : r.winner === 'house' ? 'Haus gewinnt' : 'Gleichstand'} tone={tone(r, a)} />}
          </div>
        );
      }}
      describe={(r) => `${(r.player as number[]).join('+')} gegen ${(r.house as number[]).join('+')}`}
      playLabel="Würfeln"
    />
  );
}
