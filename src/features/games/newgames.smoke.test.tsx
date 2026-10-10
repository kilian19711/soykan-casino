// Smoke-Test: rendert die 5 neuen Spiele (Migration 16) und spielt eine Runde mit gemockter Serverantwort.
/// <reference types="node" />
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const round = (result: Record<string, unknown>) => ({
  round_id: 'r1', game_key: 'x', status: 'settled', bet_amount: 100, payout_amount: 0, profit_amount: -100,
  result, server_seed_hash: 'h', started_at: new Date().toISOString(), completed_at: new Date().toISOString(), balance: 4900, server_now: new Date().toISOString(),
});
const playExtra = vi.fn(async (key: string) =>
  key === 'horse_race'
    ? round({ horse: 0, order: [2, 0, 1, 3, 4, 5], winner: 2, win: false, mult: 0 })
    : key === 'shell_game'
      ? round({ cup: 1, start: 0, swaps: [[0, 1], [1, 2]], ball: 2, win: false, mult: 0 })
      : round({ gems: [1, 1, 3, 4, 5], hand: 'pair', mult: 0.1 }),
);

vi.mock('../../lib/api', () => ({
  api: {
    getMyRounds: vi.fn(async () => []),
    getActiveRound: vi.fn(async () => null),
    getGameLimits: vi.fn(async () => ({ max_win_per_round: 100000 })),
    getJackpot: vi.fn(async () => ({ pot: 12345, last_win: null, last_winner: null })),
    playExtra: (k: string) => playExtra(k),
    jackpotSpin: vi.fn(async () => ({ ...round({ grid: Array(9).fill('cherry'), line_wins: [], jackpot: false, jackpot_win: 0, mult: 0 }), pot: 12347 })),
    pumpStart: vi.fn(),
    pumpAction: vi.fn(),
    pumpCashout: vi.fn(),
  },
}));
vi.mock('../../lib/supabase', () => ({
  supabase: { channel: () => ({ on() { return this; }, subscribe() { return this; } }), removeChannel: vi.fn() },
}));
vi.mock('../../app/AppData', () => ({ useAppData: () => ({ balance: 5000, applyServerBalance: () => undefined, dashboard: null }) }));
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ session: { user: { id: 'u1' } } }) }));
vi.mock('../../lib/preferences', async (orig) => ({ ...(await orig<typeof import('../../lib/preferences')>()), prefersReducedMotion: () => true }));

import { ToastProvider } from '../../components/Toast';
import * as G from './games/NewGames';
import type { GameConfig } from '../../types';

const sql = readFileSync(join(__dirname, '..', '..', '..', 'supabase', 'migrations', '20261010000016_new_games.sql'), 'utf8');
const configs: Record<string, GameConfig> = {};
for (const m of sql.matchAll(/\('([a-z_]+)', '([^']+)', true, '(\{[\s\S]*?\})'\)/g)) {
  configs[m[1]] = { game_key: m[1], display_name: m[2], enabled: true, config: JSON.parse(m[3]) };
}
const COMPONENTS: Record<string, React.ComponentType<{ config: GameConfig }>> = {
  horse_race: G.HorseRace, shell_game: G.ShellGame, diamonds: G.Diamonds, pump: G.Pump, jackpot_slot: G.JackpotSlot,
};

describe('Neue Spiele (Migration 16)', () => {
  it('hat Konfigurationen für alle 5 Spiele', () => {
    for (const k of Object.keys(COMPONENTS)) expect(configs[k], k).toBeDefined();
  });
  for (const [key, Comp] of Object.entries(COMPONENTS)) {
    it(`rendert ${key}`, async () => {
      render(
        <MemoryRouter>
          <ToastProvider>
            <Comp config={configs[key]} />
          </ToastProvider>
        </MemoryRouter>,
      );
      expect(screen.getAllByText(configs[key].display_name).length).toBeGreaterThan(0);
    });
  }
  for (const key of ['horse_race', 'shell_game', 'diamonds']) {
    it(`spielt eine Runde ${key}`, async () => {
      const Comp = COMPONENTS[key];
      render(
        <MemoryRouter>
          <ToastProvider>
            <Comp config={configs[key]} />
          </ToastProvider>
        </MemoryRouter>,
      );
      const btn = screen.getByRole('button', { name: /Rennen starten|Mischen|Ziehen/ });
      await act(async () => {
        fireEvent.click(btn);
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });
      expect(playExtra).toHaveBeenCalledWith(key);
    });
  }
});
