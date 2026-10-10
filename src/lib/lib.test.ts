import { describe, expect, it } from 'vitest';
import { formatCountdown, formatCredits, formatMultiplierH, formatPlaytime, formatSigned, formatWeekKey, shortId } from './format';
import { AppError, authErrorMessage, toAppError } from './errors';
import { newIdempotencyKey, serverNow, syncServerTime } from './misc';

describe('Formatierung', () => {
  it('formatiert Spielzeit wie gefordert', () => {
    expect(formatPlaytime(12 * 60)).toBe('12 min');
    expect(formatPlaytime(3 * 3600 + 42 * 60)).toBe('03:42 h');
    expect(formatPlaytime(86400 + 4 * 3600 + 10 * 60)).toBe('1 Tag 04:10 h');
    expect(formatPlaytime(null)).toBe('0 min');
  });
  it('formatiert Countdown', () => {
    expect(formatCountdown((3 * 86400 + 8 * 3600 + 14 * 60 + 22) * 1000)).toBe('3 Tagen 08:14:22');
    expect(formatCountdown(5000)).toBe('00:00:05');
    expect(formatCountdown(-100)).toBe('00:00:00');
  });
  it('formatiert Credits ganzzahlig mit Tausenderpunkt', () => {
    expect(formatCredits(12345)).toBe('12.345');
    expect(formatSigned(1000)).toBe('+1.000');
    expect(formatSigned(-250)).toBe('−250');
    expect(formatMultiplierH(250)).toBe('2,50×');
    expect(formatWeekKey('2026-W41')).toBe('KW 41 / 2026');
    expect(formatWeekKey('P2026-11-01')).toBe('Runde bis 01.11.2026');
    expect(shortId('abcdef12-3456')).toBe('ABCDEF12');
  });
});

describe('Fehlerbehandlung', () => {
  it('erkennt Server-Fehlercodes in Supabase-Fehlern', () => {
    expect(toAppError({ message: 'INSUFFICIENT_BALANCE' }).code).toBe('INSUFFICIENT_BALANCE');
    expect(toAppError({ message: 'P0001: BONUS_ALREADY_CLAIMED' }).code).toBe('BONUS_ALREADY_CLAIMED');
    expect(toAppError(new TypeError('Failed to fetch')).code).toBe('NETWORK');
    expect(toAppError(new AppError('FORBIDDEN')).message).toMatch(/Berechtigungen/);
  });
  it('bevorzugt den spezifischeren Code', () => {
    expect(toAppError({ message: 'INVALID_IDEMPOTENCY_KEY' }).code).toBe('INVALID_IDEMPOTENCY_KEY');
  });
  it('übersetzt Auth-Fehler ohne private Daten', () => {
    expect(authErrorMessage({ message: 'Invalid login credentials' })).toBe('E-Mail oder Passwort ist falsch.');
    expect(authErrorMessage({ message: 'Email link is invalid or has expired' })).toMatch(/abgelaufen/);
  });
});

describe('Idempotency & Serverzeit', () => {
  it('erzeugt eindeutige Idempotency-IDs', () => {
    const keys = new Set(Array.from({ length: 500 }, () => newIdempotencyKey('t')));
    expect(keys.size).toBe(500);
    expect([...keys][0].length).toBeGreaterThanOrEqual(8);
  });
  it('berechnet Countdowns aus der Serverzeit statt der Geräteuhr', () => {
    const server = new Date(Date.now() + 3_600_000).toISOString(); // Gerät geht 1 h nach
    syncServerTime(server);
    expect(Math.abs(serverNow() - (Date.now() + 3_600_000))).toBeLessThan(50);
    syncServerTime(new Date().toISOString());
  });
});

import { gameFromPath } from '../app/Presence';
describe('Aktivitätsstatus', () => {
  it('erkennt das gerade gespielte Spiel aus dem Pfad', () => {
    expect(gameFromPath('/casino/roulette')).toBe('roulette');
    expect(gameFromPath('/casino')).toBeNull();
    expect(gameFromPath('/')).toBeNull();
  });
});
