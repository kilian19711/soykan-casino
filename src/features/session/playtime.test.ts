import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const apiMock = vi.hoisted(() => ({
  startSession: vi.fn(async () => 'session-1'),
  heartbeat: vi.fn(async () => ({ ok: true })),
  endSession: vi.fn(async () => undefined),
}));
vi.mock('../../lib/api', () => ({ api: apiMock }));
vi.mock('../auth/AuthProvider', () => ({ SIGN_OUT_EVENT: 'shb:before-signout' }));

import { HEARTBEAT_MS, HIDDEN_END_MS, usePlaytimeTracker } from './usePlaytimeTracker';

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('Spielzeit-Heartbeat', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.values(apiMock).forEach((m) => m.mockClear());
    setVisibility('visible');
  });
  afterEach(() => vi.useRealTimers());

  it('startet eine Session und sendet etwa alle 30 Sekunden einen Heartbeat', async () => {
    const { unmount } = renderHook(() => usePlaytimeTracker(true));
    await vi.advanceTimersByTimeAsync(10);
    expect(apiMock.startSession).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 3);
    expect(apiMock.heartbeat).toHaveBeenCalledTimes(3);
    unmount();
    await vi.advanceTimersByTimeAsync(10);
    expect(apiMock.endSession).toHaveBeenCalledWith('session-1');
  });

  it('pausiert im Hintergrund und beendet die Session nach längerer Abwesenheit', async () => {
    renderHook(() => usePlaytimeTracker(true));
    await vi.advanceTimersByTimeAsync(10);
    setVisibility('hidden');
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 1.5);
    expect(apiMock.heartbeat).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(HIDDEN_END_MS);
    expect(apiMock.endSession).toHaveBeenCalledTimes(1);
    setVisibility('visible');
    await vi.advanceTimersByTimeAsync(10);
    expect(apiMock.startSession).toHaveBeenCalledTimes(2);
  });

  it('startet nichts, wenn deaktiviert', async () => {
    renderHook(() => usePlaytimeTracker(false));
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    expect(apiMock.startSession).not.toHaveBeenCalled();
  });
});
