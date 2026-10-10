import { describe, expect, it } from 'vitest';
import {
  PLINKO_TABLES,
  ROULETTE_WHEEL,
  bjTotal,
  canSplit,
  cardLabel,
  crashMultiplierAt,
  crashTimeFor,
  diceChance,
  diceMultiplier,
  dicePayout,
  limboWinChance,
  minesMultiplier,
  plinkoRtp,
  rouletteColor,
  roulettePayout,
  rouletteWins,
  slotsRtp,
  validateBet,
} from './logic';

describe('Roulette-Abrechnung', () => {
  it('hat 37 Felder (europäisch, eine Null) und 18 rote Zahlen', () => {
    expect(new Set(ROULETTE_WHEEL).size).toBe(37);
    expect(ROULETTE_WHEEL.filter((n) => rouletteColor(n) === 'red')).toHaveLength(18);
    expect(rouletteColor(0)).toBe('green');
  });

  it('zahlt einzelne Zahl 35:1 inkl. Einsatz', () => {
    expect(roulettePayout([{ type: 'straight', value: 17, amount: 10 }], 17)).toBe(360);
    expect(roulettePayout([{ type: 'straight', value: 17, amount: 10 }], 18)).toBe(0);
  });

  it('wertet Außeneinsätze korrekt aus und lässt bei 0 alles verlieren', () => {
    const bets = [
      { type: 'red' as const, amount: 20 },
      { type: 'even' as const, amount: 10 },
      { type: 'low' as const, amount: 10 },
      { type: 'dozen' as const, value: 1, amount: 10 },
      { type: 'column' as const, value: 1, amount: 10 },
    ];
    // 1: rot, ungerade, 1-18, 1. Dutzend, 1. Kolonne
    expect(roulettePayout(bets, 1)).toBe(40 + 20 + 30 + 30);
    expect(roulettePayout(bets, 0)).toBe(0);
    expect(rouletteWins('column', 3, 36)).toBe(true);
    expect(rouletteWins('dozen', 3, 25)).toBe(true);
    expect(rouletteWins('black', undefined, 0)).toBe(false);
    expect(rouletteWins('odd', undefined, 0)).toBe(false);
  });

  it('hat einen erwarteten Rückfluss von 36/37 für jeden Einsatz', () => {
    for (const bet of [
      { type: 'straight' as const, value: 5, amount: 1 },
      { type: 'red' as const, amount: 1 },
      { type: 'dozen' as const, value: 2, amount: 1 },
    ]) {
      const total = Array.from({ length: 37 }, (_, n) => roulettePayout([bet], n)).reduce((a, b) => a + b, 0);
      expect(total / 37).toBeCloseTo(36 / 37, 10);
    }
  });
});

describe('Blackjack-Logik', () => {
  it('zählt Asse weich und hart', () => {
    expect(bjTotal([0, 12])).toEqual({ total: 21, soft: true }); // A + K
    expect(bjTotal([0, 0, 8])).toEqual({ total: 21, soft: true }); // A A 9
    expect(bjTotal([0, 5, 12]).total).toBe(17); // A 6 K = hart 17
    expect(bjTotal([9, 10, 1]).total).toBe(22); // 10 B 2 = bust
  });
  it('erlaubt Split nur bei gleichwertigen zwei Karten und nur einmal', () => {
    expect(canSplit([9, 12], 1)).toBe(true); // 10 und K
    expect(canSplit([9, 12], 2)).toBe(false);
    expect(canSplit([1, 2], 1)).toBe(false);
  });
  it('beschriftet Karten', () => {
    expect(cardLabel(0)).toMatchObject({ rank: 'A', suit: '♠', red: false });
    expect(cardLabel(13 + 12)).toMatchObject({ rank: 'K', suit: '♥', red: true });
  });
});

describe('Dice / Limbo / Crash', () => {
  it('berechnet Gewinnchance und Multiplikator mit 1 % Hausvorteil', () => {
    expect(diceChance(5000, false)).toBe(5000);
    expect(diceChance(5000, true)).toBe(4999);
    expect(diceMultiplier(4950)).toBeCloseTo(2, 10);
    expect(dicePayout(100, 4950)).toBe(200);
  });
  it('Limbo-Gewinnchance = 0,99 / Ziel', () => {
    expect(limboWinChance(200)).toBeCloseTo(0.495);
    expect(limboWinChance(101)).toBeCloseTo(0.9802, 3);
  });
  it('Crash-Kurve ist monoton und invertierbar', () => {
    expect(crashMultiplierAt(0)).toBe(100);
    expect(crashMultiplierAt(-5)).toBe(100);
    expect(crashMultiplierAt(10_000)).toBeGreaterThan(crashMultiplierAt(5_000));
    const t = crashTimeFor(250);
    expect(crashMultiplierAt(t + 1)).toBeGreaterThanOrEqual(250);
  });
});

describe('Mines-Multiplikator', () => {
  it('entspricht 0,99 × Kehrwert der Überlebenswahrscheinlichkeit', () => {
    expect(minesMultiplier(25, 3, 0)).toBe(1);
    expect(minesMultiplier(25, 3, 1)).toBeCloseTo(1.125, 4);
    expect(minesMultiplier(25, 1, 24)).toBeCloseTo(24.75, 2);
  });
});

describe('Auszahlungsquoten', () => {
  it('alle Plinko-Tabellen sind symmetrisch und haben eine Quote zwischen 97 % und 100 %', () => {
    for (const rows of ['8', '12', '16']) {
      for (const risk of ['low', 'medium', 'high'] as const) {
        const t = PLINKO_TABLES[rows][risk];
        expect(t).toHaveLength(Number(rows) + 1);
        expect([...t].reverse()).toEqual(t);
        const rtp = plinkoRtp(t);
        expect(rtp).toBeGreaterThan(0.97);
        expect(rtp).toBeLessThan(1);
      }
    }
  });
  it('Slots-Quote liegt unter 100 %', () => {
    const symbols = [
      { key: 'cherry', weight: 30, pay3: 9 },
      { key: 'leaf', weight: 24, pay3: 13 },
      { key: 'bell', weight: 18, pay3: 22 },
      { key: 'gem', weight: 12, pay3: 50 },
      { key: 'seven', weight: 6, pay3: 200 },
      { key: 'coin', weight: 5, pay3: 0 },
    ];
    const rtp = slotsRtp(symbols, 2);
    expect(rtp).toBeGreaterThan(0.95);
    expect(rtp).toBeLessThan(1);
  });
});

describe('Einsatzvalidierung', () => {
  const limits = { min: 10, max: 1000 };
  it('prüft Mindest-, Höchsteinsatz, Ganzzahl und Kontostand', () => {
    expect(validateBet(5, limits, 100)).toMatch(/Mindesteinsatz/);
    expect(validateBet(5000, limits, 100000)).toMatch(/Höchsteinsatz/);
    expect(validateBet(10.5, limits, 100)).toMatch(/ganzzahlig/);
    expect(validateBet(200, limits, 100)).toMatch(/Nicht genug/);
    expect(validateBet(100, limits, 100)).toBeNull();
  });
});
