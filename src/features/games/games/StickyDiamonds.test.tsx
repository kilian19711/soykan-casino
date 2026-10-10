// Ablauf Shisha Diamonds: Spin mit Gewinn -> Risikospiel -> Einsammeln (Server gemockt, ohne Animationen).
/// <reference types="node" />
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const apiMock = vi.hoisted(() => ({
  getMyRounds: vi.fn(async () => []),
  getActiveRound: vi.fn(async () => null),
  getGameLimits: vi.fn(async () => ({ max_win_per_round: 100000 })),
  stickySpin: vi.fn(),
  stickyGamble: vi.fn(),
  stickyCollect: vi.fn(),
}));
vi.mock('../../../lib/api', () => ({ api: apiMock }));
vi.mock('../../../app/AppData', () => ({ useAppData: () => ({ balance: 5000, applyServerBalance: () => undefined, dashboard: null }) }));
vi.mock('../../auth/AuthProvider', () => ({ useAuth: () => ({ session: { user: { id: 'u1' } } }) }));
vi.mock('../../../lib/preferences', async (orig) => ({ ...(await orig<typeof import('../../../lib/preferences')>()), prefersReducedMotion: () => true }));

import { ToastProvider } from '../../../components/Toast';
import { ShishaDiamonds } from './StickyDiamonds';

const sql = readFileSync(join(__dirname, '..', '..', '..', '..', 'supabase', 'migrations', '20261009000008_shisha_diamonds_v2.sql'), 'utf8');
const config = JSON.parse(/set config = '(\{[\s\S]*?\})'::jsonb/.exec(sql)![1]);
const grid = ['cherry', 'lemon', 'orange', 'plum', 'bell', 'melon', 'melon', 'melon', 'plum', 'bell', 'seven', 'lemon', 'orange', 'plum', 'bell'];
const result = (extra: object) => ({
  grid, line_wins: [{ line: 0, symbol: 'melon', count: 3, pay: 24 }], stars: 0, scatter_win: 0, base_win: 2.4, feature: false,
  free_spins: [], feature_win: 0, multiplier: 2.4, gambles: [], actions: 0, state: 'gamble', ...extra,
});
const round = (status: string, payout: number, res: object) => ({
  round_id: 'r1', game_key: 'shisha_diamonds', status, bet_amount: 100, payout_amount: payout, profit_amount: payout - 100, result: res,
  balance: 5000, server_seed_hash: 'x', started_at: '', completed_at: null, server_now: '',
});

describe('Shisha Diamonds', () => {
  it('Spin mit Gewinn, Risiko gewonnen, dann Einsammeln', async () => {
    apiMock.stickySpin.mockResolvedValueOnce(round('active', 0, result({})));
    apiMock.stickyGamble.mockResolvedValueOnce(round('active', 0, result({ multiplier: 4.8, actions: 1, gambles: [{ pick: 'red', card: 13, win: true }] })));
    apiMock.stickyCollect.mockResolvedValueOnce(round('settled', 480, result({ multiplier: 4.8, state: 'collected' })));
    render(
      <MemoryRouter>
        <ToastProvider>
          <ShishaDiamonds config={{ game_key: 'shisha_diamonds', display_name: 'Shisha Diamonds', enabled: true, config }} />
        </ToastProvider>
      </MemoryRouter>,
    );
    await act(async () => fireEvent.click(screen.getAllByRole('button', { name: 'Drehen' })[0]));
    expect(apiMock.stickySpin).toHaveBeenCalledWith(100, expect.any(String));
    const red = await screen.findByRole('button', { name: /ROT/ });
    expect(screen.getByRole('button', { name: /Einsammeln 240/ })).toBeInTheDocument();
    await act(async () => fireEvent.click(red));
    expect(apiMock.stickyGamble).toHaveBeenCalledWith('r1', 'red', 0);
    const collect = await screen.findByRole('button', { name: /Einsammeln 480/ });
    await act(async () => fireEvent.click(collect));
    expect(apiMock.stickyCollect).toHaveBeenCalledWith('r1');
    expect(await screen.findByText(/\+380 Credits/)).toBeInTheDocument();
  });
});
