// Duell-Raum: Lobby (Bereit-Knopf), laufende Runden im Gleichtakt und Endstand.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { LiveDuel } from '../../lib/api';

let duel: Partial<LiveDuel> = {};
const ready = vi.fn(async () => ({ ...duel, o_ready: true }));
vi.mock('../../lib/api', () => ({
  api: {
    getDuel: vi.fn(async () => duel),
    readyLiveDuel: () => ready(),
    joinLiveDuel: vi.fn(),
    leaveLiveDuel: vi.fn(),
    cancelDuel: vi.fn(),
    createLiveDuel: vi.fn(),
  },
}));
vi.mock('../../lib/supabase', () => ({
  supabase: { channel: () => ({ on() { return this; }, subscribe() { return this; } }), removeChannel: vi.fn() },
}));
vi.mock('../../app/AppData', () => ({ useAppData: () => ({ applyServerBalance: vi.fn(), refreshDashboard: vi.fn() }) }));
vi.mock('../../lib/preferences', async (orig) => ({ ...(await orig<typeof import('../../lib/preferences')>()), prefersReducedMotion: () => true }));

import { ToastProvider } from '../../components/Toast';
import { LiveDuelRoom } from './LiveDuel';

const base: Partial<LiveDuel> = {
  id: 'd1', game: 'live', game_key: 'live_dice', rounds: 3, stake: 100, message: null, expires_at: new Date(Date.now() + 600000).toISOString(),
  mine: false, challenger_id: 'a', opponent_id: 'b', challenger_name: 'Leo', opponent_name: 'Sam', challenger_seed: null, opponent_seed: null,
  server_now: new Date().toISOString(), balance: 5000, result: {}, start_at: null, c_ready: true, o_ready: false, won: null, has_winner: false,
};
const renderRoom = () =>
  render(
    <MemoryRouter initialEntries={['/casino/duelle/d1']}>
      <ToastProvider>
        <Routes>
          <Route path="/casino/duelle/:id" element={<LiveDuelRoom />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );

describe('Live-Duell-Raum', () => {
  beforeEach(() => {
    ready.mockClear();
  });

  it('zeigt im Raum den Bereit-Knopf und meldet bereit', async () => {
    duel = { ...base, status: 'lobby' };
    renderRoom();
    const btn = await screen.findByRole('button', { name: 'Bereit!' });
    expect(screen.getByText('Bereit ✓')).toBeInTheDocument(); // Herausforderer ist bereit
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(ready).toHaveBeenCalled();
  });

  it('zeigt nach Ablauf aller Runden den Endstand', async () => {
    duel = {
      ...base,
      status: 'finished', won: true, has_winner: true,
      start_at: new Date(Date.now() - 60000).toISOString(),
      result: { rounds: [{ c: [1, 2], o: [6, 6], winner: 'o' }, { c: [3, 3], o: [5, 6], winner: 'o' }, { c: [6, 6], o: [1, 1], winner: 'c' }], c_wins: 1, o_wins: 2 },
    };
    renderRoom();
    expect(await screen.findByText('Gewonnen! +200')).toBeInTheDocument();
    expect(screen.getByText('Endstand 2 : 1')).toBeInTheDocument();
  });

  it('zeigt während des Spiels die aktuelle Runde', async () => {
    duel = {
      ...base,
      status: 'finished', won: false, has_winner: true,
      start_at: new Date(Date.now() - 4000).toISOString(),
      result: { rounds: [{ c: [6, 6], o: [1, 1], winner: 'c' }, { c: [6, 5], o: [1, 2], winner: 'c' }, { c: [1, 1], o: [2, 2], winner: 'o' }], c_wins: 2, o_wins: 1 },
    };
    renderRoom();
    expect(await screen.findByText('2/3')).toBeInTheDocument();
  });
});
