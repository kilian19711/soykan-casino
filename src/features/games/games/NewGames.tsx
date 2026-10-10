// Neue Spiele: Pferderennen, Hütchenspiel, Diamonds, Pump, Jackpot-Slot (alle Ergebnisse vom Server).
import { useEffect, useRef, useState } from 'react';
import type { GameConfig } from '../../../types';
import { api } from '../../../lib/api';
import { supabase } from '../../../lib/supabase';
import { formatCredits, formatMultiplier } from '../../../lib/format';
import { newIdempotencyKey, haptic, playTone } from '../../../lib/misc';
import { prefersReducedMotion } from '../../../lib/preferences';
import { useAppData } from '../../../app/AppData';
import { Button } from '../../../components/Button';
import { BigResult, Choice, PayTable, SimpleGame, tone, useStepRound, type R } from '../engine';
import { BetControls, GameFrame, RecentRounds, limitsOf, useBet, useRoundRunner } from '../shared';
import { validateBet } from '../logic';
import { LINES_3, Reels } from './SlotGames';
import { SLOT_SYMBOL_NAMES } from './SlotSymbols';
import './newgames.css';

// ================================================================ Pferderennen
const HORSE_COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#a855f7', '#f97316'];

function RaceTrack({ order, pick, running, names }: { order: number[] | null; pick: number; running: boolean; names: string[] }) {
  const [t, setT] = useState(order && !running ? 1 : 0);
  const raf = useRef<number>();
  const DUR = 4200;
  useEffect(() => {
    if (!order) return;
    if (!running || prefersReducedMotion()) {
      setT(1);
      return;
    }
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / DUR);
      setT(p);
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    setT(0);
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current!);
  }, [order, running]);
  // Position: Pferd auf Platz k erreicht das Ziel zum Zeitpunkt 0.78 + k*0.04; davor leichtes Hin und Her
  const pos = (h: number) => {
    if (!order) return 0;
    const rank = order.indexOf(h);
    const finish = 0.8 + rank * 0.04;
    const base = Math.min(1, t / finish);
    const wobble = base < 1 ? Math.sin(t * 9 + h * 1.7) * 0.035 * (1 - base) : 0;
    return Math.max(0, Math.min(1, base * base * (3 - 2 * base) + wobble));
  };
  return (
    <div className="race">
      {names.map((n, h) => (
        <div key={h} className={`race-lane ${h === pick ? 'mine' : ''}`}>
          <span className="race-name">
            <span className="race-dot" style={{ background: HORSE_COLORS[h] }} />
            {n}
          </span>
          <div className="race-track">
            <div className="race-finish" />
            <div className="race-horse" style={{ left: `calc(${pos(h) * 100}% - ${pos(h) * 34}px)` }}>
              <span style={{ filter: `drop-shadow(0 0 6px ${HORSE_COLORS[h]})` }} className={running && t < 1 ? 'gallop' : ''}>
                🏇
              </span>
            </div>
          </div>
          {order && t >= 1 && <span className="race-place">{order.indexOf(h) + 1}.</span>}
        </div>
      ))}
    </div>
  );
}

export function HorseRace({ config }: { config: GameConfig }) {
  const [horse, setHorse] = useState(0);
  const names = (config.config.names as string[]) ?? [];
  const pays = (config.config.pays as number[]) ?? [];
  const weights = (config.config.weights as number[]) ?? [];
  const total = weights.reduce((a, b) => a + b, 0);
  return (
    <SimpleGame
      config={config}
      subtitle="Setz auf ein Pferd – gewinnt es, zahlt die Quote."
      rules={
        <>
          <p>6 Pferde mit unterschiedlichen Siegchancen. Favoriten gewinnen öfter, zahlen aber weniger. Auszahlungsquote ca. 96 %.</p>
          <PayTable rows={names.map((n, i): [string, string] => [`${n} (${Math.round((weights[i] / total) * 100)} %)`, `${pays[i]}×`])} />
        </>
      }
      params={() => ({ horse })}
      playFn={(bet, p, key) => api.playExtra(config.game_key, bet, p, key)}
      controls={(d) => (
        <div className="field">
          <span className="field-label">Dein Pferd</span>
          <div className="horse-pick">
            {names.map((n, i) => (
              <button key={i} type="button" disabled={d} aria-pressed={horse === i} onClick={() => setHorse(i)}>
                <span className="race-dot" style={{ background: HORSE_COLORS[i] }} />
                <span className="grow">{n}</span>
                <span className="mono gold">{pays[i]}×</span>
              </button>
            ))}
          </div>
        </div>
      )}
      animationMs={4400}
      stage={(r, a) => (
        <>
          <RaceTrack order={(r?.order as number[]) ?? null} pick={r ? Number(r.horse) : horse} running={a} names={names} />
          {r && !a && (
            <BigResult text={r.win ? `Sieg! ${formatMultiplier(pays[Number(r.horse)])}` : `${names[Number(r.winner)]} gewinnt`} tone={tone(r, a)} />
          )}
        </>
      )}
      describe={(r) => `Sieger: ${names[Number(r.winner)]}`}
      recentLabel={(x) => names[Number((x.result as R).winner)] ?? '–'}
      playLabel="Rennen starten"
    />
  );
}

// ================================================================ Hütchenspiel
function Cups({ result, pick, running }: { result: R | null; pick: number; running: boolean }) {
  // slotOf[cup] = aktuelle Position (0..2) des Bechers
  const [slotOf, setSlotOf] = useState([0, 1, 2]);
  const [phase, setPhase] = useState<'show' | 'shuffle' | 'reveal'>('reveal');
  useEffect(() => {
    if (!result) return;
    const swaps = (result.swaps as number[][]) ?? [];
    if (!running || prefersReducedMotion()) {
      setPhase('reveal');
      return;
    }
    setSlotOf([0, 1, 2]);
    setPhase('show');
    const timers: number[] = [];
    let slots = [0, 1, 2];
    timers.push(window.setTimeout(() => setPhase('shuffle'), 700));
    swaps.forEach(([a, b], i) => {
      timers.push(
        window.setTimeout(() => {
          // Becher an Position a und b tauschen
          const ca = slots.indexOf(a);
          const cb = slots.indexOf(b);
          slots = [...slots];
          slots[ca] = b;
          slots[cb] = a;
          setSlotOf(slots);
        }, 1000 + i * 330),
      );
    });
    timers.push(window.setTimeout(() => setPhase('reveal'), 1000 + swaps.length * 330 + 250));
    return () => timers.forEach(clearTimeout);
  }, [result, running]);
  // Becher-Index, unter dem die Kugel liegt: zu Beginn der Becher an Startposition, er wandert mit
  const ballCup = result ? Number(result.start) : 1;
  const finalPos = (cup: number) => (phase === 'reveal' && result ? finalSlot(result, cup) : slotOf[cup]);
  const lifted = (cup: number) =>
    !result ? false : phase === 'show' ? cup === ballCup : phase === 'reveal' && !running ? finalPos(cup) === Number(result.ball) || finalPos(cup) === Number(result.cup) : false;
  return (
    <div className="cups">
      {[0, 1, 2].map((cup) => (
        <div key={cup} className="cup-slot" style={{ left: `${finalPos(cup) * 33.333}%` }}>
          <div className={`cup ${lifted(cup) ? 'lifted' : ''} ${!result && cup === pick ? 'picked' : ''}`}>
            <svg viewBox="0 0 80 90" aria-hidden="true">
              <defs>
                <linearGradient id={`cupg${cup}`} x1="0" x2="1">
                  <stop offset="0" stopColor="#7f1d1d" />
                  <stop offset=".5" stopColor="#dc2626" />
                  <stop offset="1" stopColor="#7f1d1d" />
                </linearGradient>
              </defs>
              <path d="M14 86 L24 8 Q40 2 56 8 L66 86 Z" fill={`url(#cupg${cup})`} stroke="#450a0a" strokeWidth="2" />
              <ellipse cx="40" cy="86" rx="27" ry="4" fill="#450a0a" />
              <path d="M22 30 Q40 34 58 30" stroke="#fca5a5" strokeWidth="2" fill="none" opacity=".6" />
            </svg>
          </div>
          {cup === ballCup && <div className={`ball ${lifted(cup) ? 'shown' : ''}`} />}
        </div>
      ))}
    </div>
  );
}
function finalSlot(result: R, cup: number) {
  let slots = [0, 1, 2];
  for (const [a, b] of (result.swaps as number[][]) ?? []) {
    const ca = slots.indexOf(a);
    const cb = slots.indexOf(b);
    slots = [...slots];
    slots[ca] = b;
    slots[cb] = a;
  }
  return slots[cup];
}

export function ShellGame({ config }: { config: GameConfig }) {
  const [cup, setCup] = useState(1);
  const pay = Number(config.config.pay ?? 2.88);
  return (
    <SimpleGame
      config={config}
      subtitle="Behalte die Kugel im Auge – unter welchem Becher liegt sie?"
      rules={<p>Die Kugel wird gezeigt, dann werden die Becher gemischt. Tippe auf die Position, unter der du die Kugel vermutest. Richtig = {pay}× (Quote 96 %).</p>}
      params={() => ({ cup })}
      playFn={(bet, p, key) => api.playExtra(config.game_key, bet, p, key)}
      controls={(d) => <Choice label="Becher-Position" value={cup} onChange={setCup} disabled={d} options={[[0, 'Links'], [1, 'Mitte'], [2, 'Rechts']]} />}
      animationMs={(r) => 1000 + ((r.swaps as unknown[])?.length ?? 8) * 330 + 700}
      stage={(r, a) => (
        <>
          <Cups result={r} pick={cup} running={a} />
          {r && !a && <BigResult text={r.win ? `Gefunden! ${formatMultiplier(pay)}` : 'Leider daneben'} tone={tone(r, a)} />}
        </>
      )}
      describe={(r) => (r.win ? 'Kugel gefunden' : 'Daneben')}
      recentLabel={(x) => ((x.result as R).win ? 'Treffer' : 'Daneben')}
      playLabel="Mischen"
    />
  );
}

// ================================================================ Diamonds (Stake-Stil)
const GEM_COLORS = ['#ef4444', '#22c55e', '#3b82f6', '#eab308', '#a855f7', '#06b6d4', '#f97316'];
const HAND_NAMES: Record<string, string> = { five: '5 gleiche', four: '4 gleiche', full: 'Full House', three: '3 gleiche', twopair: '2 Paare', pair: '1 Paar', none: 'Nichts' };

function Gem({ color, show, hl, delay }: { color: string; show: boolean; hl: boolean; delay: number }) {
  return (
    <div className={`gem-slot ${hl ? 'hl' : ''}`}>
      {show && (
        <svg viewBox="0 0 60 60" className="gem" style={{ animationDelay: `${delay}ms` }} aria-hidden="true">
          <path d="M14 8 H46 L56 22 L30 54 L4 22 Z" fill={color} />
          <path d="M14 8 L22 22 L30 8 L38 22 L46 8" fill="none" stroke="#fff" strokeOpacity=".45" strokeWidth="2" />
          <path d="M4 22 H56 M22 22 L30 54 L38 22" fill="none" stroke="#000" strokeOpacity=".2" strokeWidth="2" />
          <path d="M16 12 L22 20" stroke="#fff" strokeWidth="3" strokeLinecap="round" opacity=".7" />
        </svg>
      )}
    </div>
  );
}

export function Diamonds({ config }: { config: GameConfig }) {
  const pay = config.config.pay as Record<string, number>;
  return (
    <SimpleGame
      config={config}
      subtitle="5 Edelsteine – je mehr gleiche, desto höher der Gewinn."
      rules={
        <>
          <p>Es werden 5 Edelsteine aus 7 Farben gezogen. Die Auszahlung richtet sich nach dem Muster (wie Poker). Quote ca. 98 %.</p>
          <PayTable rows={Object.entries(HAND_NAMES).map(([k, n]): [string, string] => [n, `${pay[k]}×`])} />
        </>
      }
      params={() => ({})}
      playFn={(bet, p, key) => api.playExtra(config.game_key, bet, p, key)}
      animationMs={5 * 180 + 400}
      stage={(r, a) => {
        const gems = (r?.gems as number[]) ?? null;
        const counts = new Map<number, number>();
        gems?.forEach((g) => counts.set(g, (counts.get(g) ?? 0) + 1));
        return (
          <div className="stack center">
            <div className="gem-row">
              {[0, 1, 2, 3, 4].map((i) => (
                <Gem key={`${i}-${String(r?.gems)}`} color={gems ? GEM_COLORS[gems[i]] : '#334155'} show={!!gems} delay={i * 180}
                  hl={!!gems && !a && (counts.get(gems[i]) ?? 0) >= 2} />
              ))}
            </div>
            <div className="gem-table">
              {Object.entries(HAND_NAMES).filter(([k]) => k !== 'none').map(([k, n]) => (
                <span key={k} className={r && !a && r.hand === k ? 'on' : ''}>
                  {n} <b className="mono">{pay[k]}×</b>
                </span>
              ))}
            </div>
            {r && !a && <BigResult text={Number(r.mult) > 0 ? `${HAND_NAMES[String(r.hand)]} · ${formatMultiplier(Number(r.mult))}` : 'Kein Muster'} tone={tone(r, a)} />}
          </div>
        );
      }}
      describe={(r) => HAND_NAMES[String(r.hand)] ?? ''}
      recentLabel={(x) => HAND_NAMES[String((x.result as R).hand)] ?? '–'}
      playLabel="Ziehen"
    />
  );
}

// ================================================================ Pump (Stake-Stil)
interface PumpRes extends R {
  difficulty: string;
  bad: number;
  pumps: number;
  multiplier: number;
  next_multiplier: number | null;
  max_pumps: number;
  state: string;
}
const LEVEL_NAMES: Record<string, string> = { easy: 'Leicht', medium: 'Mittel', hard: 'Schwer', expert: 'Experte' };

export function Pump({ config }: { config: GameConfig }) {
  const limits = limitsOf(config);
  const [bet, setBet] = useBet(limits);
  const levels = config.config.levels as Record<string, number>;
  const [difficulty, setDifficulty] = useState('medium');
  const step = useStepRound<PumpRes>(config.game_key);
  const runner = useRoundRunner(config.game_key, config.display_name);
  const { balance } = useAppData();
  const [squish, setSquish] = useState(0);
  const res = step.round?.result;
  const active = step.active;
  const betError = validateBet(bet, limits, balance);
  const popped = res?.state === 'popped';
  const describe = (r: PumpRes) => (r.state === 'popped' ? `Geplatzt bei Pumpe ${Number(r.popped_at)}` : `${r.pumps} Pumpen · ${formatMultiplier(Number(r.multiplier))}`);
  const settle = (r: Awaited<ReturnType<typeof api.pumpStart>> | null) => {
    if (!r) return;
    step.setRound(r as never);
    if (r.status === 'settled') {
      const x = r.result as PumpRes;
      if (x.state === 'popped') {
        playTone('loss');
        haptic([40, 30, 80]);
      }
      runner.announce(r, describe(x), r.payout_amount > 0 ? r.payout_amount / r.bet_amount : null);
    }
  };
  const start = async () => {
    runner.clearOutcome();
    settle(await runner.run(() => api.pumpStart(bet, difficulty, newIdempotencyKey('pump'))));
  };
  const pump = async () => {
    if (!step.round) return;
    setSquish((s) => s + 1);
    playTone('click');
    settle(await runner.run(() => api.pumpAction(step.round!.round_id, step.seq)));
  };
  const cashout = async () => {
    if (!step.round) return;
    settle(await runner.run(() => api.pumpCashout(step.round!.round_id)));
  };
  const pumps = res?.pumps ?? 0;
  const maxP = res?.max_pumps ?? 25 - (levels[difficulty] ?? 3);
  const scale = 0.55 + Math.min(1, pumps / Math.max(8, maxP * 0.6)) * 0.6;

  return (
    <GameFrame
      title={config.display_name}
      subtitle="Pump den Ballon auf – jede Pumpe erhöht den Multiplikator. Platzt er, ist der Einsatz weg."
      runner={runner}
      onPlayAgain={() => void start()}
      rules={
        <p>
          25 Pump-Positionen, je nach Stufe platzen 1 / 3 / 5 / 10 davon den Ballon. Nach jeder sicheren Pumpe kannst du auszahlen. Multiplikator = 0,98 ×
          25!/(25−n)! ÷ (25−b)!/(25−b−n)! (Quote 98 %).
        </p>
      }
      controls={
        <>
          <BetControls value={bet} onChange={setBet} limits={limits} disabled={active || runner.busy} />
          <Choice label="Schwierigkeit" value={difficulty} onChange={setDifficulty} disabled={active || runner.busy}
            options={Object.keys(levels).map((k): [string, string] => [k, LEVEL_NAMES[k] ?? k])} />
          {active ? (
            <div className="stack" style={{ gap: 8 }}>
              <Button variant="primary" size="lg" block loading={runner.busy} onClick={() => void pump()}>
                Pumpen {res?.next_multiplier ? `→ ${formatMultiplier(Number(res.next_multiplier))}` : ''}
              </Button>
              <Button variant="gold" size="lg" block disabled={!pumps || runner.busy} onClick={() => void cashout()}>
                Auszahlen {formatCredits(Math.floor((step.round?.bet_amount ?? 0) * Number(res?.multiplier ?? 1)))}
              </Button>
            </div>
          ) : (
            <Button variant="primary" size="lg" block loading={runner.busy} disabled={!!betError} onClick={() => void start()}>
              Runde starten
            </Button>
          )}
        </>
      }
      stage={
        <div className="pump-stage">
          <div className="pump-mult mono">{popped ? 'BOOM!' : formatMultiplier(Number(res?.multiplier ?? 1))}</div>
          <div className="pump-area">
            {popped ? (
              <div className="pump-pop" aria-hidden="true">
                {Array.from({ length: 12 }).map((_, i) => (
                  <span key={i} style={{ transform: `rotate(${i * 30}deg) translateY(-70px)` }} />
                ))}
                <b>💥</b>
              </div>
            ) : (
              <svg viewBox="0 0 120 160" className={`balloon ${squish ? 'puff' : ''}`} key={squish} style={{ transform: `scale(${scale})` }} aria-hidden="true">
                <defs>
                  <radialGradient id="bal" cx=".35" cy=".3" r=".8">
                    <stop offset="0" stopColor="#fda4af" />
                    <stop offset=".5" stopColor="#f43f5e" />
                    <stop offset="1" stopColor="#9f1239" />
                  </radialGradient>
                </defs>
                <ellipse cx="60" cy="62" rx="48" ry="58" fill="url(#bal)" />
                <ellipse cx="42" cy="38" rx="10" ry="16" fill="#fff" opacity=".35" />
                <path d="M54 118 L66 118 L60 128 Z" fill="#9f1239" />
                <path d="M60 128 Q54 142 62 156" stroke="#cbd5e1" strokeWidth="2" fill="none" />
              </svg>
            )}
          </div>
          <div className="pump-bar" style={{ gridTemplateColumns: `repeat(${maxP}, minmax(0, 1fr))` }} aria-label={`${pumps} von ${maxP} Pumpen`}>
            {Array.from({ length: maxP }).map((_, i) => (
              <span key={i} className={i < pumps ? 'on' : popped && i === pumps ? 'pop' : ''} />
            ))}
          </div>
          <div className="small subtle">
            {pumps} / {maxP} Pumpen · Stufe {LEVEL_NAMES[res?.difficulty ?? difficulty]}
          </div>
        </div>
      }
      recent={<RecentRounds rounds={runner.recent} label={(x) => (x.payout_amount > 0 ? formatMultiplier(x.payout_amount / x.bet_amount) : 'Geplatzt')} />}
    />
  );
}

// ================================================================ Jackpot-Slot
function useJackpotPot() {
  const [pot, setPot] = useState<{ pot: number; last_win: number | null; last_winner: string | null } | null>(null);
  useEffect(() => {
    api.getJackpot().then((j) => j && setPot(j)).catch(() => undefined);
    const ch = supabase
      .channel('jackpot')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'jackpot_state' }, (p) => {
        const row = p.new as { pot: number; last_win: number | null };
        setPot((old) => ({ pot: Number(row.pot), last_win: row.last_win ?? old?.last_win ?? null, last_winner: old?.last_winner ?? null }));
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, []);
  return [pot, setPot] as const;
}

export function JackpotSlot({ config }: { config: GameConfig }) {
  const syms = (config.config.symbols as { key: string; pay3: number }[]) ?? [];
  const [pot, setPot] = useJackpotPot();
  const odds = Number(config.config.jackpot_odds ?? 2000000);
  return (
    <SimpleGame
      config={config}
      subtitle="3×3 Früchte mit gemeinsamem Jackpot – jeder Spin füllt den Topf."
      rules={
        <>
          <p>
            5 Gewinnlinien wie bei Fruit Slots. Zusätzlich fließen {Number(config.config.jackpot_share) * 100} % jedes Einsatzes in den gemeinsamen Jackpot. Bei jedem Spin
            kannst du ihn knacken – je höher dein Einsatz, desto größer die Chance (bei 1.000 Credits etwa 1 : {formatCredits(odds / 1000)}).
          </p>
          <PayTable rows={syms.filter((s) => s.pay3 > 0).sort((a, b) => b.pay3 - a.pay3).map((s): [string, string] => [`3× ${SLOT_SYMBOL_NAMES[s.key]}`, `${s.pay3}× Linieneinsatz`])} />
        </>
      }
      params={() => ({})}
      playFn={(bet, _p, key) =>
        api.jackpotSpin(bet, key).then((r) => {
          if (r.pot !== undefined) setPot((o) => ({ pot: Number(r.pot), last_win: o?.last_win ?? null, last_winner: o?.last_winner ?? null }));
          return r;
        })
      }
      animationMs={(r) => 450 + 3 * 260 + (r.jackpot ? 1600 : 100)}
      stage={(r, a) => {
        const hl = new Set<number>();
        ((r?.line_wins as { line: number }[]) ?? []).forEach((w) => LINES_3[w.line].forEach((c) => hl.add(c)));
        return (
          <div className="stack">
            <div className={`jp-banner ${r?.jackpot && !a ? 'hit' : ''}`}>
              <span className="label">Jackpot</span>
              <span className="jp-pot mono">{pot ? formatCredits(r?.jackpot && !a ? Number(r.jackpot_win) : pot.pot) : '…'}</span>
              {pot?.last_winner && <span className="small muted">Zuletzt: {pot.last_winner} · {formatCredits(pot.last_win)}</span>}
            </div>
            <Reels grid={(r?.grid as string[]) ?? ['cherry', 'seven', 'plum', 'melon', 'seven', 'lemon', 'plum', 'seven', 'cherry']} cols={3} rows={3}
              symbols={syms.map((s) => s.key)} spinKey={r} spinning={a} highlight={hl} cell={64} />
            {r && !a && (
              <BigResult text={r.jackpot ? `JACKPOT! +${formatCredits(Number(r.jackpot_win))}` : Number(r.mult) > 0 ? formatMultiplier(Number(r.mult)) : 'Kein Gewinn'}
                tone={r.jackpot ? 'win' : tone(r, a)} />
            )}
          </div>
        );
      }}
      describe={(r) => (r.jackpot ? `JACKPOT ${formatCredits(Number(r.jackpot_win))}` : `${(r.line_wins as unknown[]).length} Linie(n)`)}
      playLabel="Drehen"
    />
  );
}
