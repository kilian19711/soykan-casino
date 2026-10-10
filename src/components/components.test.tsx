import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { Button, useAction } from './Button';
import { Modal } from './Modal';
import { ToastProvider, useToast } from './Toast';
import { sortLeaderboard } from '../features/leaderboard/LeaderboardPage';
import type { LeaderboardRow } from '../types';

function DoubleClickHarness({ fn }: { fn: () => Promise<void> }) {
  const action = useAction(fn);
  return (
    <Button loading={action.busy} onClick={() => void action.run()}>
      Absenden
    </Button>
  );
}

describe('Doppelklick-Schutz', () => {
  it('führt eine laufende Aktion nur einmal aus, auch bei schnellen Mehrfachklicks', async () => {
    let resolve: () => void = () => undefined;
    const fn = vi.fn(() => new Promise<void>((r) => (resolve = r)));
    render(<DoubleClickHarness fn={fn} />);
    const btn = screen.getByRole('button', { name: 'Absenden' });
    fireEvent.click(btn);
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(btn).toBeDisabled();
    await act(async () => resolve());
    expect(btn).not.toBeDisabled();
  });
});

describe('Modal', () => {
  function Harness({ required = false }: { required?: boolean }) {
    const [open, setOpen] = useState(true);
    return (
      <Modal open={open} onClose={() => setOpen(false)} title="Testdialog" required={required}>
        <button type="button">Innen</button>
      </Modal>
    );
  }
  it('schließt bei Escape', () => {
    render(<Harness />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('bleibt bei Pflichtbestätigung offen', () => {
    render(<Harness required />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('Toasts', () => {
  function Trigger() {
    const toast = useToast();
    return (
      <button type="button" onClick={() => toast.win('Gewonnen', '+500 SHB')}>
        auslösen
      </button>
    );
  }
  it('zeigt Meldungen in einer aria-live-Region an', () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('auslösen'));
    expect(screen.getByText('Gewonnen')).toBeInTheDocument();
    expect(screen.getByText('Gewonnen').closest('[aria-live]')).not.toBeNull();
  });
});

describe('Leaderboard-Sortierung', () => {
  const row = (username: string, balance: number): LeaderboardRow => ({
    user_id: username,
    username,
    display_name: username,
    avatar_seed: null,
    balance,
    week_change: null,
    playtime_seconds: 0,
    rounds_count: 0,
    bonus_claimed: false,
    rank: 0,
  });
  it('sortiert nach Kontostand absteigend, bei Gleichstand alphabetisch', () => {
    const sorted = sortLeaderboard([row('mia', 500), row('ben', 1500), row('leo', 500), row('tom', 0)]);
    expect(sorted.map((r) => r.username)).toEqual(['ben', 'leo', 'mia', 'tom']);
  });
});
