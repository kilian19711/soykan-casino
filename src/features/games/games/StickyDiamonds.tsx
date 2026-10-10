// Shisha Diamonds – Früchte-Slot nach dem Vorbild "Sticky Diamonds":
// 5 Walzen × 3 Reihen, 10 Linien, Diamant = Wild, 3+ Sterne = Freispiele mit klebenden Diamanten, danach Risikospiel.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GameConfig, RoundResponse } from '../../../types';
import { api } from '../../../lib/api';
import { formatCredits } from '../../../lib/format';
import { newIdempotencyKey, haptic } from '../../../lib/misc';
import { sd } from './sdSound';
import { prefersReducedMotion } from '../../../lib/preferences';
import { useAppData } from '../../../app/AppData';
import { useHotkey } from '../../../hooks/useHotkey';
import { Button } from '../../../components/Button';
import { BetControls, GameFrame, RecentRounds, limitsOf, useBet, useRoundRunner } from '../shared';
import { validateBet, cardLabel } from '../logic';
import { PayTable } from '../engine';
import './StickyDiamonds.css';

type Win = { line: number; symbol: string; count: number; pay: number };
type FreeSpin = { grid: string[]; line_wins: Win[]; scatter_win: number; win: number; sticky: number[] };
type Gamble = { pick: string; card: number; win: boolean };
type Res = {
  grid: string[];
  line_wins: Win[];
  stars: number;
  scatter_win: number;
  base_win: number;
  feature: boolean;
  free_spins: FreeSpin[];
  feature_win: number;
  multiplier: number;
  gambles: Gamble[];
  actions: number;
  state: 'gamble' | 'lost' | 'gamble_lost' | 'collected';
};

const LINES = [[1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2], [0, 1, 2, 1, 0], [2, 1, 0, 1, 2], [0, 0, 1, 2, 2], [2, 2, 1, 0, 0], [1, 0, 0, 0, 1], [1, 2, 2, 2, 1], [0, 1, 1, 1, 0]];
const LINE_COLORS = ['#f43f5e', '#f59e0b', '#22c55e', '#38bdf8', '#a855f7', '#ec4899', '#eab308', '#14b8a6', '#f97316', '#818cf8'];
const NAMES: Record<string, string> = {
  cherry: 'Kirschen', lemon: 'Zitrone', orange: 'Orange', plum: 'Pflaume', bell: 'Glocke', grapes: 'Trauben', melon: 'Melone',
  seven: 'Sieben', wild: 'Diamant (Wild)', star: 'Stern (Scatter)',
};
const FILLER = ['cherry', 'lemon', 'orange', 'plum', 'bell', 'grapes', 'melon', 'seven', 'cherry', 'lemon', 'orange', 'plum', 'wild', 'star'];
const SUITS: [string, string, boolean][] = [['spades', '♠', false], ['hearts', '♥', true], ['diamonds', '♦', true], ['clubs', '♣', false]];
const randomSym = () => FILLER[Math.floor(Math.random() * FILLER.length)];
const randomGrid = () => Array.from({ length: 15 }, randomSym);

// ------------------------------------------------------------------ Symbole (eigene SVGs)
function SymbolDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        <radialGradient id="sd-red" cx="35%" cy="30%" r="70%"><stop offset="0" stopColor="#ff8a8a" /><stop offset=".45" stopColor="#e11d48" /><stop offset="1" stopColor="#7f1d1d" /></radialGradient>
        <radialGradient id="sd-yellow" cx="35%" cy="30%" r="75%"><stop offset="0" stopColor="#fffbc2" /><stop offset=".5" stopColor="#facc15" /><stop offset="1" stopColor="#a16207" /></radialGradient>
        <radialGradient id="sd-orange" cx="35%" cy="30%" r="75%"><stop offset="0" stopColor="#ffd8a8" /><stop offset=".5" stopColor="#f97316" /><stop offset="1" stopColor="#9a3412" /></radialGradient>
        <radialGradient id="sd-plum" cx="35%" cy="30%" r="75%"><stop offset="0" stopColor="#e9b8ff" /><stop offset=".5" stopColor="#9333ea" /><stop offset="1" stopColor="#3b0764" /></radialGradient>
        <radialGradient id="sd-grape" cx="35%" cy="30%" r="70%"><stop offset="0" stopColor="#d8b4fe" /><stop offset=".55" stopColor="#7c3aed" /><stop offset="1" stopColor="#2e1065" /></radialGradient>
        <linearGradient id="sd-gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff3c4" /><stop offset=".45" stopColor="#f3c969" /><stop offset="1" stopColor="#a16207" /></linearGradient>
        <linearGradient id="sd-seven" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ffe08a" /><stop offset=".35" stopColor="#f97316" /><stop offset="1" stopColor="#b91c1c" /></linearGradient>
        <linearGradient id="sd-melon" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ff6b81" /><stop offset="1" stopColor="#be123c" /></linearGradient>
        <linearGradient id="sd-dia" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#e0f7ff" /><stop offset=".4" stopColor="#67e8f9" /><stop offset="1" stopColor="#0e7490" /></linearGradient>
        <radialGradient id="sd-star" cx="50%" cy="45%" r="60%"><stop offset="0" stopColor="#fffbe6" /><stop offset=".5" stopColor="#facc15" /><stop offset="1" stopColor="#c2410c" /></radialGradient>
      </defs>
    </svg>
  );
}

export function FruitSymbol({ s }: { s: string }) {
  const shine = <ellipse cx="38" cy="34" rx="9" ry="6" fill="#fff" opacity=".45" />;
  switch (s) {
    case 'cherry':
      return (
        <svg viewBox="0 0 100 100" className="sd-sym">
          <path d="M50 18c-6 18-18 30-24 44M50 18c4 16 10 30 22 40" stroke="#166534" strokeWidth="5" fill="none" strokeLinecap="round" />
          <path d="M50 18c10-8 24-8 32 0-10 6-22 6-32 0Z" fill="#22c55e" />
          <circle cx="30" cy="68" r="18" fill="url(#sd-red)" /><circle cx="70" cy="64" r="18" fill="url(#sd-red)" />
          <ellipse cx="24" cy="62" rx="5" ry="3.5" fill="#fff" opacity=".6" /><ellipse cx="64" cy="58" rx="5" ry="3.5" fill="#fff" opacity=".6" />
        </svg>
      );
    case 'lemon':
      return (
        <svg viewBox="0 0 100 100" className="sd-sym">
          <path d="M12 54C14 30 38 20 58 24c14 3 26 10 30 26-2 22-26 34-46 30C24 77 12 70 12 54Z" fill="url(#sd-yellow)" />
          <path d="M84 40l8-4-4 9Z" fill="#a16207" />{shine}
        </svg>
      );
    case 'orange':
      return (
        <svg viewBox="0 0 100 100" className="sd-sym">
          <circle cx="50" cy="56" r="32" fill="url(#sd-orange)" />
          <path d="M50 24c4-10 16-14 24-10-6 8-14 12-24 10Z" fill="#16a34a" />
          {[...Array(9)].map((_, i) => <circle key={i} cx={36 + (i % 3) * 14} cy={46 + Math.floor(i / 3) * 12} r="1.4" fill="#9a3412" opacity=".5" />)}
          {shine}
        </svg>
      );
    case 'plum':
      return (
        <svg viewBox="0 0 100 100" className="sd-sym">
          <ellipse cx="50" cy="56" rx="30" ry="34" fill="url(#sd-plum)" />
          <path d="M50 24c0-6 2-10 6-14" stroke="#4d2a10" strokeWidth="4" strokeLinecap="round" />
          <path d="M52 26c2 20 2 40-2 60" stroke="#3b0764" strokeWidth="2" opacity=".5" fill="none" />{shine}
        </svg>
      );
    case 'bell':
      return (
        <svg viewBox="0 0 100 100" className="sd-sym">
          <path d="M50 14c-18 0-26 16-26 32 0 14-6 20-12 26h76c-6-6-12-12-12-26 0-16-8-32-26-32Z" fill="url(#sd-gold)" stroke="#7c4a03" strokeWidth="2" />
          <rect x="10" y="70" width="80" height="8" rx="4" fill="#b45309" /><circle cx="50" cy="84" r="7" fill="#7c4a03" />
          <ellipse cx="38" cy="34" rx="6" ry="10" fill="#fff" opacity=".45" />
        </svg>
      );
    case 'grapes':
      return (
        <svg viewBox="0 0 100 100" className="sd-sym">
          <path d="M50 12v12M50 18c8-8 20-8 26-2-8 6-18 6-26 2Z" stroke="#166534" strokeWidth="4" fill="#22c55e" />
          {[[34, 34], [50, 32], [66, 34], [26, 50], [42, 48], [58, 48], [74, 50], [34, 64], [50, 64], [66, 64], [42, 78], [58, 78], [50, 90]].map(([x, y], i) => (
            <g key={i}><circle cx={x} cy={y} r="10" fill="url(#sd-grape)" /><circle cx={x - 3} cy={y - 3} r="2.5" fill="#fff" opacity=".55" /></g>
          ))}
        </svg>
      );
    case 'melon':
      return (
        <svg viewBox="0 0 100 100" className="sd-sym">
          <path d="M8 40h84c0 26-18 46-42 46S8 66 8 40Z" fill="#15803d" />
          <path d="M14 40h72c0 22-16 39-36 39S14 62 14 40Z" fill="#bbf7d0" />
          <path d="M18 40h64c0 19-14 34-32 34S18 59 18 40Z" fill="url(#sd-melon)" />
          {[[34, 50], [50, 56], [66, 50], [42, 64], [58, 64]].map(([x, y], i) => <ellipse key={i} cx={x} cy={y} rx="2.4" ry="4" fill="#1f2937" />)}
        </svg>
      );
    case 'seven':
      return (
        <svg viewBox="0 0 100 100" className="sd-sym">
          <path d="M22 16h58v14L50 88H32l28-56H22Z" fill="url(#sd-seven)" stroke="#fde68a" strokeWidth="4" strokeLinejoin="round" />
          <path d="M26 20h46" stroke="#fff" strokeWidth="3" opacity=".5" />
        </svg>
      );
    case 'wild':
      return (
        <svg viewBox="0 0 100 100" className="sd-sym sd-wild">
          <path d="M18 36 34 16h32l16 20-32 50Z" fill="url(#sd-dia)" stroke="#e0f7ff" strokeWidth="2.5" strokeLinejoin="round" />
          <path d="M18 36h64M34 16l-6 20 22 50 22-50-6-20M50 16v20" stroke="#ffffff" strokeWidth="1.6" opacity=".7" fill="none" />
          <rect x="16" y="66" width="68" height="20" rx="6" fill="#0b1220" stroke="#67e8f9" strokeWidth="2" />
          <text x="50" y="81" textAnchor="middle" fontSize="15" fontWeight="900" fill="#e0f7ff" fontFamily="Inter, Arial" letterSpacing="2">WILD</text>
        </svg>
      );
    case 'star':
      return (
        <svg viewBox="0 0 100 100" className="sd-sym sd-star">
          <path d="m50 8 11 26 28 2-21 18 7 28-25-15-25 15 7-28-21-18 28-2Z" fill="url(#sd-star)" stroke="#fff7d6" strokeWidth="3" strokeLinejoin="round" />
          <circle cx="50" cy="48" r="9" fill="#fff" opacity=".35" />
        </svg>
      );
    default:
      return null;
  }
}

// ------------------------------------------------------------------ Walze
/** Eine Walze: Streifen aus Zielsymbolen + Zufallssymbolen + alten Symbolen, per CSS-Transform gedreht (GPU, flüssig). */
function Reel({ col, final, spinId, delay, duration, winCells, sticky, onStop }: {
  col: number;
  final: string[];
  spinId: number;
  delay: number;
  duration: number;
  winCells: Set<number>;
  sticky: Set<number>;
  onStop: (col: number) => void;
}) {
  const stripRef = useRef<HTMLDivElement>(null);
  const [strip, setStrip] = useState<string[]>(final);
  const prev = useRef<string[]>(final);
  const [moving, setMoving] = useState(false);
  useEffect(() => {
    if (spinId === 0) return;
    const filler = Array.from({ length: 14 + col * 3 }, randomSym);
    const s = [...final, ...filler, ...prev.current];
    prev.current = final;
    const el = stripRef.current;
    if (!el || duration === 0) {
      setStrip(final);
      onStop(col);
      return;
    }
    setStrip(s);
    setMoving(true);
    el.style.transition = 'none';
    el.style.transform = `translate3d(0, ${-((s.length - 3) / s.length) * 100}%, 0)`;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        el.style.transition = `transform ${duration}ms cubic-bezier(.12,.62,.2,1.06) ${delay}ms`;
        el.style.transform = 'translate3d(0, 0, 0)';
      });
    });
    const t = window.setTimeout(() => {
      setMoving(false);
      setStrip(final);
      el.style.transition = 'none';
      el.style.transform = 'translate3d(0, 0, 0)';
      onStop(col);
    }, delay + duration + 20);
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spinId]);
  return (
    <div className="sd-reel">
      <div ref={stripRef} className={`sd-strip ${moving ? 'moving' : ''}`}>
        {strip.map((s, i) => {
          const cell = i < 3 && !moving ? i * 5 + col : -1;
          return (
            <div key={i} className={`sd-cell ${cell >= 0 && winCells.has(cell) ? 'win' : ''} ${winCells.size && cell >= 0 && !winCells.has(cell) ? 'dim' : ''}`}>
              <FruitSymbol s={s} />
            </div>
          );
        })}
      </div>
      {[0, 1, 2].map((row) =>
        sticky.has(row * 5 + col) ? (
          <div key={row} className="sd-sticky" style={{ top: `${(row * 100) / 3}%` }}>
            <FruitSymbol s="wild" />
          </div>
        ) : null,
      )}
    </div>
  );
}

function CountUp({ value, ms = 900 }: { value: number; ms?: number }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (prefersReducedMotion() || value <= from.current) {
      from.current = value;
      setShown(value);
      return;
    }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      setShown(Math.round(a + (value - a) * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return <>{formatCredits(shown)}</>;
}

function PlayingCard({ card, flipKey }: { card: number | null; flipKey: number }) {
  const c = card === null ? null : cardLabel(card);
  return (
    <div className="sd-card-wrap">
      {c ? (
        <div key={`f${flipKey}`} className={`sd-card-face sd-card-front ${c.red ? 'red' : ''}`}>
          <span className="corner">{c.rank}<br />{c.suit}</span>
          <span className="pip">{c.suit}</span>
          <span className="corner br">{c.rank}<br />{c.suit}</span>
        </div>
      ) : (
        <div key={`b${flipKey}`} className="sd-card-face sd-card-back" />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Spiel
type Phase = 'idle' | 'spinning' | 'win' | 'intro' | 'free' | 'gamble' | 'gambling';

export function ShishaDiamonds({ config }: { config: GameConfig }) {
  const limits = limitsOf(config);
  const [bet, setBet] = useBet(limits);
  const runner = useRoundRunner('shisha_diamonds', config.display_name);
  const { balance } = useAppData();
  const pays = (config.config.pays as Record<string, number[]>) ?? {};
  const fsTable = (config.config.free_spins as Record<string, number>) ?? {};
  const scatterPay = (config.config.scatter_pay as Record<string, number>) ?? {};
  const maxGambles = Number(config.config.max_gambles ?? 5);

  const [grid, setGrid] = useState<string[]>(() => randomGrid());
  const [spinId, setSpinId] = useState(0);
  const [phase, setPhase] = useState<Phase>('idle');
  const [wins, setWins] = useState<Win[]>([]);
  const [sticky, setSticky] = useState<Set<number>>(new Set());
  const [fs, setFs] = useState<{ i: number; n: number; total: number } | null>(null);
  const [win, setWin] = useState(0);
  const [round, setRound] = useState<RoundResponse<Res> | null>(null);
  const [anticipate, setAnticipate] = useState(false);
  const [turbo, setTurbo] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [gcard, setGcard] = useState<{ card: number | null; key: number }>({ card: null, key: 0 });
  const stopsLeft = useRef(0);
  const stopResolve = useRef<(() => void) | null>(null);
  const skip = useRef(false);
  const alive = useRef(true);
  useEffect(() => () => {
    alive.current = false;
  }, []);

  const reduced = prefersReducedMotion();
  const speed = turbo ? 0.45 : 1;
  const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, skip.current || reduced ? 0 : ms * speed));

  // Offene Runde nach Reload fortsetzen
  useEffect(() => {
    api
      .getActiveRound<Res>('shisha_diamonds')
      .then((r) => {
        if (!r || r.status !== 'active' || !alive.current) return;
        const res = r.result as Res;
        const last = res.free_spins.length ? res.free_spins[res.free_spins.length - 1].grid : res.grid;
        setGrid(last);
        setRound(r);
        setWin(Math.floor(r.bet_amount * res.multiplier));
        setPhase('gamble');
      })
      .catch(() => undefined);
  }, []);

  const gridRef = useRef(grid);
  gridRef.current = grid;
  const starsSeen = useRef(0);
  const onReelStop = useCallback((col: number) => {
    sd.stop(col);
    const stars = [0, 1, 2].filter((row) => gridRef.current[row * 5 + col] === 'star').length;
    if (stars) {
      starsSeen.current += stars;
      sd.star(Math.min(starsSeen.current, 5));
    }
    if (col === 2 && starsSeen.current >= 2) sd.tension();
    stopsLeft.current -= 1;
    if (stopsLeft.current <= 0) stopResolve.current?.();
  }, []);

  /** Dreht alle Walzen auf `target`; Walzen mit klebenden Diamanten drehen dahinter mit. */
  const spinTo = (target: string[], antic: boolean) =>
    new Promise<void>((resolve) => {
      setWins([]);
      setAnticipate(antic);
      stopsLeft.current = 5;
      starsSeen.current = 0;
      sd.spin();
      stopResolve.current = () => {
        setAnticipate(false);
        resolve();
      };
      setGrid(target);
      setSpinId((x) => x + 1);
    });

  const reelDelay = (c: number) => (reduced || skip.current ? 0 : (c * 110 + (anticipate && c >= 3 ? (c - 2) * 700 : 0)) * speed);
  const reelDuration = (c: number) => (reduced || skip.current ? 0 : (560 + c * 70 + (anticipate && c >= 3 ? 600 : 0)) * speed);

  const lineBet = bet / 10;
  const betError = validateBet(bet, limits, balance);
  const busy = runner.busy || (phase !== 'idle' && phase !== 'gamble');

  const showWins = async (w: Win[], amount: number, ms: number) => {
    if (!w.length && amount <= 0) return;
    setWins(w);
    if (amount > 0) sd.win(amount >= bet * 5);
    await sleep(ms);
  };

  const finish = (r: RoundResponse<Res>, text: string) => {
    setPhase('idle');
    setFs(null);
    runner.announce(r, text, r.payout_amount > 0 ? r.payout_amount / r.bet_amount : null);
  };

  const spin = async () => {
    if (betError || busy) return;
    if (phase === 'gamble' && round) {
      // Schnell weiterspielen: Gewinn automatisch einsammeln
      const ok = await collect();
      if (!ok) return;
    }
    skip.current = false;
    runner.clearOutcome();
    setGcard({ card: null, key: 0 });
    setSticky(new Set());
    setFs(null);
    setWin(0);
    setPhase('spinning');
    const res = (await runner.run(() => api.stickySpin(bet, newIdempotencyKey('sd')))) as RoundResponse<Res> | null;
    if (!res || !alive.current) {
      setPhase('idle');
      return;
    }
    const r = res.result as Res;
    setRound(res);
    const starsEarly = [0, 1, 2].reduce((n, c) => n + [0, 1, 2].filter((row) => r.grid[row * 5 + c] === 'star').length, 0);
    await spinTo(r.grid, starsEarly >= 2);
    const baseCredits = Math.floor(bet * r.base_win);
    setWin(baseCredits);
    setPhase('win');
    await showWins(r.line_wins, baseCredits, r.line_wins.length ? 1300 : 600);

    if (r.feature) {
      haptic([20, 40, 20]);
      sd.fanfare();
      setBanner(`${r.free_spins.length} FREISPIELE`);
      setPhase('intro');
      await sleep(1900);
      setBanner(null);
      setPhase('free');
      let total = 0;
      let stuck = new Set<number>();
      for (let i = 0; i < r.free_spins.length; i++) {
        const f = r.free_spins[i];
        setFs({ i: i + 1, n: r.free_spins.length, total });
        setSticky(stuck);
        await spinTo(f.grid, false);
        if (f.sticky.length > stuck.size) sd.sticky();
        stuck = new Set(f.sticky);
        setSticky(stuck);
        total += f.win;
        setFs({ i: i + 1, n: r.free_spins.length, total });
        setWin(Math.floor(bet * (r.base_win + total)));
        await showWins(f.line_wins, Math.floor(bet * f.win), f.line_wins.length ? 1000 : 350);
      }
      setBanner(`FREISPIEL-GEWINN ${formatCredits(Math.floor(bet * r.feature_win))}`);
      await sleep(1800);
      setBanner(null);
      setFs(null);
      setSticky(new Set());
      setPhase('win');
    }

    if (res.status === 'settled') finish(res, 'Kein Gewinn');
    else {
      setWin(Math.floor(bet * r.multiplier));
      setPhase('gamble');
    }
  };

  const gamble = async (pick: string) => {
    if (!round || phase !== 'gamble') return;
    setPhase('gambling');
    setGcard({ card: null, key: gcard.key + 1 });
    const res = (await runner.run(() => api.stickyGamble(round.round_id, pick, Number(round.result?.actions ?? 0)))) as RoundResponse<Res> | null;
    if (!res) {
      setPhase('gamble');
      return;
    }
    const r = res.result as Res;
    const g = r.gambles[r.gambles.length - 1];
    setGcard((x) => ({ card: g.card, key: x.key }));
    sd.flip();
    await sleep(650);
    setRound(res);
    setWin(Math.floor(res.bet_amount * r.multiplier));
    if (g.win) sd.gambleWin();
    else sd.gambleLose();
    if (res.status === 'settled') finish(res, g.win ? 'Risiko gewonnen' : 'Risiko verloren');
    else setPhase('gamble');
  };

  const collect = async () => {
    if (!round) return false;
    const res = (await runner.run(() => api.stickyCollect(round.round_id))) as RoundResponse<Res> | null;
    if (!res) return false;
    sd.collect();
    setRound(res);
    const r = res.result as Res;
    finish(res, r.feature ? `Freispiele: ${r.free_spins.length}` : `${r.line_wins.length} Gewinnlinie(n)`);
    return true;
  };

  useHotkey([' ', 'Enter'], () => void spin(), !busy);

  const winCells = useMemo(() => {
    const s = new Set<number>();
    wins.forEach((w) => LINES[w.line].slice(0, w.count).forEach((row, c) => s.add(row * 5 + c)));
    return s;
  }, [wins]);

  const gambles = (round?.result as Res | undefined)?.gambles ?? [];
  const gamblesLeft = maxGambles - gambles.length;
  const isFree = phase === 'free' || phase === 'intro';

  const stage = (
    <div className={`sd-cabinet ${isFree ? 'free' : ''}`}>
      <SymbolDefs />
      <div className="sd-top">
        <div className="sd-logo">
          STICKY <span>◆</span> DIAMONDS
        </div>
        {fs ? (
          <span className="sd-fs-badge">
            Freispiel {fs.i}/{fs.n}
          </span>
        ) : (
          <span className="sd-sub">10 Linien · Diamanten kleben in den Freispielen</span>
        )}
      </div>
      <div className={`sd-window ${anticipate ? 'anticipate' : ''}`}>
        {[0, 1, 2, 3, 4].map((c) => (
          <Reel
            key={c}
            col={c}
            final={[0, 1, 2].map((row) => grid[row * 5 + c])}
            spinId={spinId}
            delay={reelDelay(c)}
            duration={reelDuration(c)}
            winCells={winCells}
            sticky={sticky}
            onStop={onReelStop}
          />
        ))}
        {wins.length > 0 && (
          <svg className="sd-lines" viewBox="0 0 500 300" preserveAspectRatio="none" aria-hidden="true">
            {wins.map((w, i) => (
              <polyline
                key={`${spinId}-${i}`}
                points={LINES[w.line].map((row, c) => `${c * 100 + 50},${row * 100 + 50}`).join(' ')}
                stroke={LINE_COLORS[w.line]}
                style={{ animationDelay: `${i * 0.12}s` }}
              />
            ))}
          </svg>
        )}
        {banner && (
          <div className="sd-banner" role="status">
            <div>{banner}</div>
          </div>
        )}
      </div>
      <div className="sd-bar">
        <div>
          <span className="label">Gewinn</span>
          <strong className={`mono ${win > 0 ? 'gold' : ''}`}>
            <CountUp value={win} />
          </strong>
        </div>
        <div>
          <span className="label">{fs ? 'Freispiel-Gewinn' : 'Linieneinsatz'}</span>
          <strong className="mono">{fs ? formatCredits(Math.floor(bet * fs.total)) : formatCredits(lineBet)}</strong>
        </div>
        <div>
          <span className="label">Einsatz</span>
          <strong className="mono">{formatCredits(round && phase !== 'idle' ? round.bet_amount : bet)}</strong>
        </div>
      </div>

      {phase === 'gamble' || phase === 'gambling' ? (
        <div className="sd-gamble" role="group" aria-label="Risikospiel">
          <PlayingCard card={gcard.card} flipKey={gcard.key} />
          <div className="sd-gamble-body">
            <div className="small subtle">
              Risiko {gamblesLeft > 0 ? `(noch ${gamblesLeft}×)` : ''} · Rot/Schwarz verdoppelt, Symbol vervierfacht
            </div>
            <div className="sd-gamble-row">
              <button type="button" className="sd-gbtn red" disabled={phase === 'gambling'} onClick={() => void gamble('red')}>
                ROT <small>{formatCredits(win * 2)}</small>
              </button>
              <button type="button" className="sd-gbtn black" disabled={phase === 'gambling'} onClick={() => void gamble('black')}>
                SCHWARZ <small>{formatCredits(win * 2)}</small>
              </button>
            </div>
            <div className="sd-gamble-row suits">
              {SUITS.map(([k, sym, red]) => (
                <button key={k} type="button" className={`sd-gbtn suit ${red ? 'red' : 'black'}`} disabled={phase === 'gambling'}
                  onClick={() => void gamble(k)} aria-label={`Symbol ${sym}, ${formatCredits(win * 4)}`}>
                  {sym}
                  <small>×4</small>
                </button>
              ))}
            </div>
            <div className="sd-history" aria-label="Letzte Risikokarten">
              {gambles.slice(-5).map((g, i) => {
                const c = cardLabel(g.card);
                return (
                  <span key={i} className={`sd-mini ${c.red ? 'red' : ''} ${g.win ? 'ok' : 'bad'}`}>
                    {c.rank}
                    {c.suit}
                  </span>
                );
              })}
            </div>
          </div>
          <Button variant="gold" size="lg" disabled={phase === 'gambling'} onClick={() => void collect()} className="sd-collect">
            Einsammeln {formatCredits(win)}
          </Button>
        </div>
      ) : (
        <div className="sd-actions">
          <label className="sd-turbo">
            <input type="checkbox" checked={turbo} onChange={(e) => setTurbo(e.target.checked)} /> Schnell
          </label>
          <button
            type="button"
            className={`sd-spin ${busy ? 'busy' : ''}`}
            disabled={!!betError || runner.busy || phase === 'spinning'}
            onClick={() => (busy ? (skip.current = true) : void spin())}
            aria-label={busy ? 'Animation überspringen' : 'Drehen'}
          >
            <svg viewBox="0 0 48 48" aria-hidden="true">
              <path d="M38 24a14 14 0 1 1-4.1-9.9M38 10v8h-8" fill="none" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <span className="sd-hint small muted">{busy && phase !== 'spinning' ? 'Tippen = überspringen' : 'Leertaste = Drehen'}</span>
        </div>
      )}
    </div>
  );

  return (
    <GameFrame
      title={config.display_name}
      subtitle="Früchte, Diamant-Wilds und klebende Diamanten in den Freispielen."
      runner={runner}
      onPlayAgain={() => void spin()}
      rules={
        <>
          <p>
            <strong>5 Walzen, 3 Reihen, 10 feste Gewinnlinien.</strong> Gewinne zählen von links nach rechts. Melonen und Trauben gewinnen schon ab 2 gleichen
            Symbolen, alle anderen ab 3. Der Einsatz wird gleichmäßig auf die 10 Linien verteilt (Linieneinsatz = Einsatz / 10).
          </p>
          <p>
            <strong>Diamant = Wild:</strong> ersetzt alle Symbole außer dem Stern. Fünf Diamanten zahlen wie fünf Siebenen.
          </p>
          <p>
            <strong>Stern = Scatter:</strong> zahlt überall auf den Walzen ({Object.entries(scatterPay).map(([k, v]) => `${k}× → ${v}× Einsatz`).join(', ')}) und startet
            Freispiele ({Object.entries(fsTable).map(([k, v]) => `${k} Sterne: ${v}`).join(', ')}).
          </p>
          <p>
            <strong>Sticky Diamonds:</strong> In den Freispielen bleibt jeder gelandete Diamant bis zum Ende der Freispiele kleben.
          </p>
          <p>
            <strong>Risikospiel:</strong> Nach jedem Gewinn kannst du einsammeln oder riskieren: Farbe der nächsten Karte (Rot/Schwarz) verdoppelt, das richtige Symbol
            vervierfacht. Falsch = Gewinn weg. Höchstens {maxGambles}× pro Runde. Ein neuer Spin sammelt einen offenen Gewinn automatisch ein.
          </p>
          <PayTable
            rows={Object.entries(pays).map(([k, t]) => [
              NAMES[k],
              t
                .map((v, i) => (v ? `${i + 1}×: ${v}` : null))
                .filter(Boolean)
                .join(' · ') + ' (× Linieneinsatz)',
            ])}
          />
          <p className="small muted">Auszahlungsquote ca. 96 % (wie das Original).</p>
        </>
      }
      controls={
        <>
          <BetControls value={bet} onChange={setBet} limits={limits} disabled={busy || phase === 'gamble'} />
          <dl className="kv">
            <dt>Linien</dt>
            <dd>10</dd>
            <dt>Linieneinsatz</dt>
            <dd>{formatCredits(lineBet)}</dd>
            <dt>Top-Gewinn (5× Sieben)</dt>
            <dd className="gold">{formatCredits(lineBet * (pays.seven?.[4] ?? 0))}</dd>
          </dl>
          <Button variant="primary" size="lg" block loading={runner.busy} disabled={!!betError || busy} onClick={() => void spin()}>
            {phase === 'gamble' ? 'Einsammeln & Drehen' : 'Drehen'}
          </Button>
        </>
      }
      stage={stage}
      recent={<RecentRounds rounds={runner.recent} label={(x) => (x.payout_amount > 0 ? `${(x.payout_amount / x.bet_amount).toFixed(1)}×` : '0×')} />}
    />
  );
}

