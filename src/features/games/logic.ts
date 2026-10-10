// Reine Spiel-Hilfsfunktionen für Anzeige und Validierung im Client.
// WICHTIG: Ergebnisse und Auszahlungen werden ausschließlich serverseitig bestimmt.
// Diese Funktionen spiegeln die Serverregeln nur für Vorschau, Regeltexte und Tests.

// ------------------------------------------------------------------ Einsatz
export interface BetLimits {
  min: number;
  max: number;
}

export function validateBet(amount: number, limits: BetLimits, balance: number | null): string | null {
  if (!Number.isFinite(amount) || !Number.isInteger(amount)) return 'Bitte gib einen ganzzahligen Einsatz ein.';
  if (amount < limits.min) return `Mindesteinsatz: ${limits.min} Credits`;
  if (amount > limits.max) return `Höchsteinsatz: ${limits.max} Credits`;
  if (balance !== null && amount > balance) return 'Nicht genug Credits.';
  return null;
}

// ------------------------------------------------------------------ Roulette
export const ROULETTE_RED = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
/** Reihenfolge der Zahlen auf einem europäischen Rad */
export const ROULETTE_WHEEL = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7,
  28, 12, 35, 3, 26,
];

export type RouletteBetType = 'straight' | 'red' | 'black' | 'even' | 'odd' | 'low' | 'high' | 'dozen' | 'column';
export interface RouletteBet {
  type: RouletteBetType;
  value?: number;
  amount: number;
}

export const ROULETTE_ODDS: Record<RouletteBetType, number> = {
  straight: 35,
  dozen: 2,
  column: 2,
  red: 1,
  black: 1,
  even: 1,
  odd: 1,
  low: 1,
  high: 1,
};

export function rouletteColor(n: number): 'green' | 'red' | 'black' {
  if (n === 0) return 'green';
  return ROULETTE_RED.includes(n) ? 'red' : 'black';
}

export function rouletteWins(type: RouletteBetType, value: number | undefined, n: number): boolean {
  switch (type) {
    case 'straight':
      return n === value;
    case 'red':
      return ROULETTE_RED.includes(n);
    case 'black':
      return n > 0 && !ROULETTE_RED.includes(n);
    case 'even':
      return n > 0 && n % 2 === 0;
    case 'odd':
      return n % 2 === 1;
    case 'low':
      return n >= 1 && n <= 18;
    case 'high':
      return n >= 19 && n <= 36;
    case 'dozen':
      return n > 0 && Math.floor((n - 1) / 12) + 1 === value;
    case 'column':
      return n > 0 && ((n - 1) % 3) + 1 === value;
  }
}

export function roulettePayout(bets: RouletteBet[], n: number): number {
  return bets.reduce((sum, b) => sum + (rouletteWins(b.type, b.value, n) ? b.amount * (ROULETTE_ODDS[b.type] + 1) : 0), 0);
}

export function betKey(b: { type: RouletteBetType; value?: number }) {
  return `${b.type}:${b.value ?? ''}`;
}

// ------------------------------------------------------------------ Blackjack
export function bjCardValue(card: number): number {
  const r = card % 13;
  if (r === 0) return 1;
  if (r >= 9) return 10;
  return r + 1;
}

export function bjTotal(cards: number[]): { total: number; soft: boolean } {
  let sum = 0;
  let ace = false;
  for (const c of cards) {
    sum += bjCardValue(c);
    if (c % 13 === 0) ace = true;
  }
  if (ace && sum + 10 <= 21) return { total: sum + 10, soft: true };
  return { total: sum, soft: false };
}

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'B', 'D', 'K'];
const SUITS = ['♠', '♥', '♦', '♣'] as const;
export function cardLabel(card: number): { rank: string; suit: (typeof SUITS)[number]; red: boolean } {
  const suitIdx = Math.floor(card / 13) % 4;
  return { rank: RANKS[card % 13], suit: SUITS[suitIdx], red: suitIdx === 1 || suitIdx === 2 };
}

export function canSplit(cards: number[], handsCount: number): boolean {
  return handsCount === 1 && cards.length === 2 && bjCardValue(cards[0]) === bjCardValue(cards[1]);
}

// ------------------------------------------------------------------ Dice
/** Gewinnchance in Hundertstel-Prozent (100 = 1 %) für Ziel 0–9999 */
export function diceChance(target: number, over: boolean): number {
  return over ? 9999 - target : target;
}
export function diceMultiplier(chance: number): number {
  return 9900 / chance;
}
export function dicePayout(bet: number, chance: number): number {
  return Math.floor((bet * 9900) / chance);
}

// ------------------------------------------------------------------ Limbo / Crash
/** Gewinnwahrscheinlichkeit für einen Zielmultiplikator (in Hundertsteln) */
export function limboWinChance(targetH: number): number {
  return Math.min(1, 99 / targetH);
}

export const CRASH_GROWTH = 0.00006;
export const CRASH_START_DELAY_MS = 3000;
/** Multiplikator (in Hundertsteln) nach t Millisekunden Laufzeit */
export function crashMultiplierAt(ms: number): number {
  if (ms <= 0) return 100;
  return Math.floor(100 * Math.exp(CRASH_GROWTH * ms));
}
export function crashTimeFor(multiplierH: number): number {
  return Math.log(multiplierH / 100) / CRASH_GROWTH;
}

// ------------------------------------------------------------------ Mines
export function minesMultiplier(cells: number, mines: number, revealed: number): number {
  if (revealed === 0) return 1;
  let v = 0.99;
  for (let i = 0; i < revealed; i++) v = (v * (cells - i)) / (cells - mines - i);
  return Math.round(v * 10000) / 10000;
}

// ------------------------------------------------------------------ Plinko
export type PlinkoRisk = 'low' | 'medium' | 'high';
/** Identisch mit der Server-Konfiguration (game_configs.plinko.tables). */
export const PLINKO_TABLES: Record<string, Record<PlinkoRisk, number[]>> = {
  8: {
    low: [2.8, 2, 1.41, 0.9, 0.5, 0.9, 1.41, 2, 2.8],
    medium: [4.6, 2.8, 1.57, 0.8, 0.3, 0.8, 1.57, 2.8, 4.6],
    high: [7.1, 3.5, 1.63, 0.69, 0.2, 0.69, 1.63, 3.5, 7.1],
  },
  12: {
    low: [3.9, 3, 2.3, 1.66, 1.19, 0.8, 0.5, 0.8, 1.19, 1.66, 2.3, 3, 3.9],
    medium: [8.6, 5.4, 3.4, 2.1, 1.21, 0.65, 0.3, 0.65, 1.21, 2.1, 3.4, 5.4, 8.6],
    high: [18, 9.3, 4.7, 2.4, 1.14, 0.52, 0.2, 0.52, 1.14, 2.4, 4.7, 9.3, 18],
  },
  16: {
    low: [5.5, 4.3, 3.3, 2.6, 1.96, 1.47, 1.07, 0.75, 0.5, 0.75, 1.07, 1.47, 1.96, 2.6, 3.3, 4.3, 5.5],
    medium: [17, 11, 6.8, 4.3, 2.7, 1.67, 1.01, 0.58, 0.3, 0.58, 1.01, 1.67, 2.7, 4.3, 6.8, 11, 17],
    high: [49, 25, 13, 6.6, 3.4, 1.7, 0.86, 0.42, 0.2, 0.42, 0.86, 1.7, 3.4, 6.6, 13, 25, 49],
  },
};

function binom(n: number, k: number) {
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}
/** Erwartete Auszahlungsquote einer Plinko-Tabelle */
export function plinkoRtp(table: number[]): number {
  const n = table.length - 1;
  return table.reduce((sum, m, k) => sum + (m * binom(n, k)) / 2 ** n, 0);
}

// ------------------------------------------------------------------ Slots
export interface SlotSymbol {
  key: string;
  weight: number;
  pay3: number;
}
export const SLOT_LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 4, 8],
  [6, 4, 2],
];
export const SLOT_LINE_NAMES = ['Obere Reihe', 'Mittlere Reihe', 'Untere Reihe', 'Diagonale ↘', 'Diagonale ↗'];

/** Theoretische Auszahlungsquote (Linien + Scatter-Bonus) */
export function slotsRtp(symbols: SlotSymbol[], cherryPairPay: number): number {
  const total = symbols.reduce((s, x) => s + x.weight, 0);
  const p = Object.fromEntries(symbols.map((s) => [s.key, s.weight / total]));
  let line = 0;
  for (const s of symbols) if (s.key !== 'coin') line += p[s.key] ** 3 * s.pay3;
  line += (p.cherry ?? 0) ** 2 * (1 - (p.cherry ?? 0)) * cherryPairPay;
  const q = p.coin ?? 0;
  let scatter = 0;
  for (let k = 3; k <= 9; k++) {
    const pr = binom(9, k) * q ** k * (1 - q) ** (9 - k);
    scatter += pr * (k >= 5 ? 50 : k === 4 ? 15 : 5);
  }
  return line + scatter; // 5 Linien à Einsatz/5 => Linienanteil = line
}
