import { useEffect, useState } from 'react';
import type { GameConfig } from '../../../types';
import { formatCredits, formatMultiplier } from '../../../lib/format';
import { prefersReducedMotion } from '../../../lib/preferences';
import { Button } from '../../../components/Button';
import { useHotkey } from '../../../hooks/useHotkey';
import { BigResult, Choice, PayTable, SimpleGame, tone, useStepActions, useStepRound, type R } from '../engine';
import { BetControls, GameFrame, RecentRounds, limitsOf, useBet } from '../shared';
import { validateBet, cardLabel } from '../logic';
import { useAppData } from '../../../app/AppData';
import { Card } from '../visuals';

const rankName = (c: number) => cardLabel(c).rank;

/** Zeigt Karten nacheinander (Animation) */
function useDealt(cards: number[], key: unknown, stepMs = 280) {
  const [n, setN] = useState(cards.length);
  useEffect(() => {
    if (prefersReducedMotion()) {
      setN(cards.length);
      return;
    }
    setN(0);
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setN(i);
      if (i >= cards.length) window.clearInterval(id);
    }, stepMs);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return n;
}

function Hand({ title, cards, shown, total, win }: { title: string; cards: number[]; shown: number; total?: string; win?: boolean }) {
  return (
    <div className="stack" style={{ gap: 6, alignItems: 'center' }}>
      <div className="row" style={{ gap: 6 }}>
        <span className="label">{title}</span>
        {total && <span className={`badge mono ${win ? 'badge-gold' : ''}`}>{total}</span>}
      </div>
      <div className="row" style={{ gap: 6, minHeight: 92 }}>
        {cards.map((c, i) => (i < shown ? <Card key={i} card={c} index={i} highlight={win} /> : <Card key={i} hidden index={i} />))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Baccarat
export function Baccarat({ config }: { config: GameConfig }) {
  const [bet, setBet] = useState<'player' | 'banker' | 'tie'>('player');
  const pay = config.config.pay as Record<string, number>;
  return (
    <SimpleGame
      config={config}
      subtitle="Spieler, Bank oder Unentschieden – wer kommt näher an die 9?"
      rules={
        <>
          <p>Kartenwerte: Ass 1, 2–9 nach Zahl, 10/B/D/K = 0. Es zählt nur die letzte Ziffer der Summe. Gezogen wird nach den klassischen Drittkarten-Regeln (8 Decks).</p>
          <PayTable rows={[['Spieler', `${pay.player}× (Gleichstand: Einsatz zurück)`], ['Bank', `${pay.banker}× (Gleichstand: Einsatz zurück)`], ['Unentschieden', `${pay.tie}×`]]} />
        </>
      }
      params={() => ({ bet })}
      controls={(d) => <Choice label="Wette" value={bet} onChange={setBet} disabled={d} options={[['player', 'Spieler'], ['banker', 'Bank'], ['tie', 'Unentschieden']]} />}
      animationMs={(r) => ((r.player as number[]).length + (r.banker as number[]).length) * 300 + 300}
      stage={(r, a) => <BaccaratStage r={r} a={a} />}
      describe={(r) => `${r.winner === 'player' ? 'Spieler' : r.winner === 'banker' ? 'Bank' : 'Unentschieden'} · ${r.player_total}:${r.banker_total}`}
      recentLabel={(x) => {
        const w = (x.result as R).winner;
        return w === 'player' ? 'S' : w === 'banker' ? 'B' : 'U';
      }}
      playLabel="Karten geben"
    />
  );
}

function BaccaratStage({ r, a }: { r: R | null; a: boolean }) {
  const p = (r?.player as number[]) ?? [];
  const b = (r?.banker as number[]) ?? [];
  const seq: ('p' | 'b')[] = ['p', 'b', 'p', 'b', ...(p.length > 2 ? (['p'] as const) : []), ...(b.length > 2 ? (['b'] as const) : [])];
  const n = useDealt(seq as unknown as number[], r);
  const pShown = seq.slice(0, n).filter((x) => x === 'p').length;
  const bShown = seq.slice(0, n).filter((x) => x === 'b').length;
  if (!r) return <BigResult text="Bereit" sub="Wähle deine Wette und gib die Karten aus." />;
  return (
    <div className="stack-lg">
      <div className="grid-2" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Hand title="Spieler" cards={p} shown={a ? pShown : p.length} total={!a ? String(r.player_total) : undefined} win={!a && r.winner === 'player'} />
        <Hand title="Bank" cards={b} shown={a ? bShown : b.length} total={!a ? String(r.banker_total) : undefined} win={!a && r.winner === 'banker'} />
      </div>
      {!a && <BigResult text={r.winner === 'player' ? 'Spieler gewinnt' : r.winner === 'banker' ? 'Bank gewinnt' : 'Unentschieden'} tone={tone(r, a)} />}
    </div>
  );
}

// ---------------------------------------------------------------- Dragon Tiger
export function DragonTiger({ config }: { config: GameConfig }) {
  const [bet, setBet] = useState<'dragon' | 'tiger' | 'tie'>('dragon');
  const pay = config.config.pay as Record<string, number>;
  return (
    <SimpleGame
      config={config}
      subtitle="Eine Karte für Drache, eine für Tiger – die höhere gewinnt."
      rules={
        <>
          <p>Ass ist die niedrigste, König die höchste Karte. Bei Gleichstand verlieren Drache- und Tiger-Wetten nur die Hälfte.</p>
          <PayTable rows={[['Drache', `${pay.dragon}×`], ['Tiger', `${pay.tiger}×`], ['Unentschieden', `${pay.tie}×`]]} />
        </>
      }
      params={() => ({ bet })}
      controls={(d) => <Choice label="Wette" value={bet} onChange={setBet} disabled={d} options={[['dragon', 'Drache'], ['tiger', 'Tiger'], ['tie', 'Gleich']]} />}
      animationMs={900}
      stage={(r, a) => {
        if (!r) return <BigResult text="Drache vs. Tiger" />;
        return (
          <div className="stack-lg">
            <div className="grid-2" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <Hand title="Drache" cards={[Number(r.dragon)]} shown={a ? 0 : 1} win={!a && r.winner === 'dragon'} />
              <Hand title="Tiger" cards={[Number(r.tiger)]} shown={a ? 0 : 1} win={!a && r.winner === 'tiger'} />
            </div>
            {!a && <BigResult text={r.winner === 'dragon' ? 'Drache!' : r.winner === 'tiger' ? 'Tiger!' : 'Unentschieden'} tone={tone(r, a)} />}
          </div>
        );
      }}
      describe={(r) => `${rankName(Number(r.dragon))} gegen ${rankName(Number(r.tiger))}`}
      recentLabel={(x) => ({ dragon: 'D', tiger: 'T', tie: '=' })[String((x.result as R).winner)] ?? '–'}
      playLabel="Aufdecken"
    />
  );
}

// ---------------------------------------------------------------- Andar Bahar
export function AndarBahar({ config }: { config: GameConfig }) {
  const [side, setSide] = useState<'andar' | 'bahar'>('andar');
  const pay = config.config.pay as Record<string, number>;
  return (
    <SimpleGame
      config={config}
      subtitle="Der Joker wird aufgedeckt. Auf welcher Seite erscheint zuerst der gleiche Rang?"
      rules={
        <>
          <p>Karten werden abwechselnd auf Andar (zuerst) und Bahar gelegt, bis eine Karte mit dem Rang des Jokers erscheint.</p>
          <PayTable rows={[['Andar', `${pay.andar}×`], ['Bahar', `${pay.bahar}×`]]} />
        </>
      }
      params={() => ({ side })}
      controls={(d) => <Choice label="Seite" value={side} onChange={setSide} disabled={d} options={[['andar', 'Andar'], ['bahar', 'Bahar']]} />}
      animationMs={(r) => Math.min(6000, (r.dealt as number[]).length * 160 + 400)}
      stage={(r, a) => <AndarStage r={r} a={a} />}
      describe={(r) => `Joker ${rankName(Number(r.joker))} · ${r.winner === 'andar' ? 'Andar' : 'Bahar'} nach ${(r.dealt as number[]).length} Karten`}
      recentLabel={(x) => ((x.result as R).winner === 'andar' ? 'A' : 'B')}
      playLabel="Austeilen"
    />
  );
}

function AndarStage({ r, a }: { r: R | null; a: boolean }) {
  const dealt = (r?.dealt as number[]) ?? [];
  const n = useDealt(dealt, r, 160);
  if (!r) return <BigResult text="Andar oder Bahar?" />;
  const shown = a ? dealt.slice(0, n) : dealt;
  const andar = shown.filter((_, i) => i % 2 === 0).slice(-6);
  const bahar = shown.filter((_, i) => i % 2 === 1).slice(-6);
  return (
    <div className="stack">
      <div className="center stack" style={{ alignItems: 'center', gap: 4 }}>
        <span className="label">Joker</span>
        <Card card={Number(r.joker)} highlight />
      </div>
      <div className="grid-2" style={{ gridTemplateColumns: '1fr 1fr' }}>
        {[['Andar', andar, 'andar'], ['Bahar', bahar, 'bahar']].map(([t, cards, k]) => (
          <div key={String(k)} className="stack" style={{ alignItems: 'center', gap: 6 }}>
            <span className={`badge ${!a && r.winner === k ? 'badge-gold' : ''}`}>{String(t)}</span>
            <div className="row wrap" style={{ gap: 4, justifyContent: 'center' }}>
              {(cards as number[]).map((c, i) => <Card key={i} card={c} small index={0} />)}
            </div>
          </div>
        ))}
      </div>
      {!a && <BigResult text={r.winner === 'andar' ? 'Andar gewinnt' : 'Bahar gewinnt'} sub={`${dealt.length} Karten`} tone={tone(r, a)} />}
    </div>
  );
}

// ---------------------------------------------------------------- Card Duel
export function CardDuel({ config }: { config: GameConfig }) {
  const pay = Number(config.config.pay ?? 1.95);
  return (
    <SimpleGame
      config={config}
      subtitle="Deine Karte gegen die des Hauses – die höhere gewinnt."
      rules={<p>Ass ist die höchste Karte. Gewinn: {formatMultiplier(pay)}. Gleichstand: Einsatz zurück.</p>}
      params={() => ({})}
      animationMs={900}
      stage={(r, a) => {
        if (!r) return <BigResult text="Duell" />;
        return (
          <div className="stack-lg">
            <div className="grid-2" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <Hand title="Du" cards={[Number(r.player)]} shown={a ? 0 : 1} win={!a && r.winner === 'player'} />
              <Hand title="Haus" cards={[Number(r.house)]} shown={a ? 0 : 1} win={!a && r.winner === 'house'} />
            </div>
            {!a && <BigResult text={r.winner === 'player' ? 'Gewonnen!' : r.winner === 'house' ? 'Haus gewinnt' : 'Gleichstand'} tone={tone(r, a)} />}
          </div>
        );
      }}
      describe={(r) => `${rankName(Number(r.player))} gegen ${rankName(Number(r.house))}`}
      playLabel="Duell starten"
    />
  );
}

// ---------------------------------------------------------------- Hi-Lo (mehrstufig)
interface HiloRes extends R {
  card: number;
  history: { card: number; guess: string; ok: boolean; next?: number }[];
  multiplier: number;
  skips: number;
  state: string;
  step: number;
}

export function HiLo({ config }: { config: GameConfig }) {
  const limits = limitsOf(config);
  const [bet, setBet] = useBet(limits);
  const step = useStepRound<HiloRes>('hilo');
  const { runner, start, act, cashout } = useStepActions<HiloRes>('hilo', config.display_name, step);
  const { balance } = useAppData();
  const res = step.round?.result;
  const active = step.active;
  const rank = res ? (res.card % 13) + 1 : 7;
  const pHi = (14 - rank) / 13;
  const pLo = rank / 13;
  const mult = Number(res?.multiplier ?? 1);
  const describe = (r: HiloRes) => (r.state === 'lost' ? `Falsch getippt nach ${r.step} Treffern` : `${r.step} Treffer · ${formatMultiplier(Number(r.multiplier))}`);
  const maxSkips = Number(config.config.max_skips ?? 5);
  const betError = validateBet(bet, limits, balance);

  useHotkey(['ArrowUp', 'h', 'H'], () => active && pHi < 1 && void act({ guess: 'higher' }, describe), active && !runner.busy);
  useHotkey(['ArrowDown', 'l', 'L'], () => active && pLo < 1 && void act({ guess: 'lower' }, describe), active && !runner.busy);

  return (
    <GameFrame
      title={config.display_name}
      subtitle="Ist die nächste Karte höher oder niedriger? Steig aus, wann du willst."
      runner={runner}
      onPlayAgain={() => void start(bet, {}, describe)}
      rules={
        <>
          <p>Ass = 1 (niedrigste), König = 13. „Höher“ gewinnt bei gleichem oder höherem Rang, „Niedriger“ bei gleichem oder niedrigerem Rang.</p>
          <p>Jeder Treffer multipliziert deinen Gewinn mit 0,99 / Wahrscheinlichkeit. Du kannst bis zu {maxSkips} Karten überspringen und jederzeit auszahlen.</p>
          <p>Tastatur: ↑/H höher, ↓/L niedriger.</p>
        </>
      }
      controls={
        <>
          <BetControls value={bet} onChange={setBet} limits={limits} disabled={active || runner.busy} />
          {active ? (
            <>
              <div className="grid-2" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <Button variant="primary" onClick={() => void act({ guess: 'higher' }, describe)} disabled={runner.busy || pHi >= 1}>
                  Höher ({(pHi * 100).toFixed(0)} %)
                </Button>
                <Button variant="primary" onClick={() => void act({ guess: 'lower' }, describe)} disabled={runner.busy || pLo >= 1}>
                  Niedriger ({(pLo * 100).toFixed(0)} %)
                </Button>
              </div>
              <Button onClick={() => void act({ guess: 'skip' }, describe)} disabled={runner.busy || Number(res?.skips) >= maxSkips}>
                Karte überspringen ({maxSkips - Number(res?.skips ?? 0)} übrig)
              </Button>
              <Button variant="gold" size="lg" block onClick={() => void cashout(describe)} disabled={runner.busy || Number(res?.step) === 0}>
                Auszahlen {formatCredits(Math.floor((step.round?.bet_amount ?? 0) * mult))}
              </Button>
            </>
          ) : (
            <Button variant="primary" size="lg" block loading={runner.busy} disabled={!!betError} onClick={() => void start(bet, {}, describe)}>
              Runde starten
            </Button>
          )}
        </>
      }
      stage={
        <div className="stack-lg" style={{ alignItems: 'center' }}>
          <div className="row" style={{ gap: 16 }}>
            <Card card={res ? res.card : null} hidden={!res} highlight={active} />
          </div>
          <BigResult text={formatMultiplier(mult)} sub={active ? `Aktueller Multiplikator · ${res?.step ?? 0} Treffer` : res ? (res.state === 'lost' ? 'Verloren' : 'Ausgezahlt') : 'Starte eine Runde'} tone={!active && res ? (res.state === 'lost' ? 'loss' : 'win') : null} />
          {res && res.history.length > 0 && (
            <div className="row wrap" style={{ gap: 4, justifyContent: 'center' }}>
              {res.history.slice(-10).map((h, i) => (
                <span key={i} className={`badge ${h.ok ? 'badge-success' : 'badge-danger'}`}>
                  {rankName(h.card)} {h.guess === 'higher' ? '↑' : h.guess === 'lower' ? '↓' : '⤳'}
                </span>
              ))}
            </div>
          )}
        </div>
      }
      recent={<RecentRounds rounds={runner.recent} label={(x) => (x.payout_amount > 0 ? formatMultiplier(x.payout_amount / x.bet_amount) : '0×')} />}
    />
  );
}

// ---------------------------------------------------------------- Video Poker (Jacks or Better)
const HAND_NAMES: Record<string, string> = {
  royal: 'Royal Flush', straight_flush: 'Straight Flush', four: 'Vierling', full: 'Full House', flush: 'Flush',
  straight: 'Straße', three: 'Drilling', two_pair: 'Zwei Paare', jacks: 'Paar Buben+', none: 'Keine Gewinnhand',
};
interface VpRes extends R {
  hand: number[];
  state: string;
  hand_name: string;
  held?: boolean[];
}

export function VideoPoker({ config }: { config: GameConfig }) {
  const limits = limitsOf(config);
  const [bet, setBet] = useBet(limits);
  const [hold, setHold] = useState([false, false, false, false, false]);
  const step = useStepRound<VpRes>('video_poker');
  const { runner, start, act } = useStepActions<VpRes>('video_poker', config.display_name, step);
  const { balance } = useAppData();
  const res = step.round?.result;
  const pay = config.config.pay as Record<string, number>;
  const describe = (r: VpRes) => HAND_NAMES[r.hand_name] ?? r.hand_name;
  const betError = validateBet(bet, limits, balance);

  useEffect(() => {
    if (step.round?.status === 'active') setHold([false, false, false, false, false]);
  }, [step.round?.round_id, step.round?.status]);


  return (
    <GameFrame
      title={config.display_name}
      subtitle="Jacks or Better: Halte die besten Karten, tausche den Rest."
      runner={runner}
      onPlayAgain={() => void start(bet, {}, describe)}
      rules={
        <>
          <p>Du erhältst 5 Karten. Markiere die Karten, die du behalten willst, und ziehe einmal neu. Ausgezahlt wird nach der Endhand (Quote ≈ 99,5 % bei optimaler Strategie).</p>
          <PayTable rows={Object.entries(pay).filter(([, m]) => m > 0).map(([k, m]) => [HAND_NAMES[k], `${m}×`])} />
        </>
      }
      controls={
        <>
          <BetControls value={bet} onChange={setBet} limits={limits} disabled={step.active || runner.busy} />
          {step.active ? (
            <Button variant="gold" size="lg" block loading={runner.busy} onClick={() => void act({ hold }, describe)}>
              Ziehen ({hold.filter(Boolean).length} gehalten)
            </Button>
          ) : (
            <Button variant="primary" size="lg" block loading={runner.busy} disabled={!!betError} onClick={() => void start(bet, {}, describe)}>
              Karten geben
            </Button>
          )}
        </>
      }
      stage={
        <div className="stack-lg" style={{ alignItems: 'center' }}>
          <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
            {(res?.hand ?? [null, null, null, null, null]).map((c, i) => (
              <button key={`${step.round?.round_id}-${i}-${c}`} type="button" disabled={!step.active || runner.busy}
                onClick={() => setHold((h) => h.map((v, j) => (j === i ? !v : v)))}
                style={{ background: 'none', border: 0, padding: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, cursor: step.active ? 'pointer' : 'default' }}
                aria-pressed={hold[i]} aria-label={`Karte ${i + 1} ${hold[i] ? 'gehalten' : ''}`}>
                <Card card={c} hidden={c === null} index={i} small highlight={step.active ? hold[i] : Boolean(res?.held?.[i])} />
                <span className={`badge ${hold[i] && step.active ? 'badge-gold' : ''}`} style={{ visibility: step.active ? 'visible' : 'hidden' }}>HALTEN</span>
              </button>
            ))}
          </div>
          {res && <BigResult text={HAND_NAMES[res.hand_name] ?? '–'} sub={step.active ? 'Aktuelle Hand' : `${pay[res.hand_name] ?? 0}× Einsatz`} tone={step.active ? null : pay[res.hand_name] > 0 ? 'win' : 'loss'} />}
        </div>
      }
      recent={<RecentRounds rounds={runner.recent} label={(x) => HAND_NAMES[String((x.result as R).hand_name)] ?? '–'} />}
    />
  );
}
