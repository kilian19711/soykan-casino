import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { api } from '../lib/api';
import { useAuth } from '../features/auth/AuthProvider';
import { useToast } from '../components/Toast';
import { formatCredits } from '../lib/format';
import type { DashboardState, NotificationItem } from '../types';

interface AppData {
  balance: number | null;
  /** Kontostand aus einer Serverantwort übernehmen (keine Client-Berechnung) */
  applyServerBalance: (balance: number | null | undefined) => void;
  balanceFlash: 'up' | 'down' | null;
  dashboard: DashboardState | null;
  dashboardError: string | null;
  refreshDashboard: () => Promise<void>;
  unread: number;
  setUnread: (n: number) => void;
  /** Zähler, der sich bei Realtime-Ereignissen erhöht (für Listen, die neu laden sollen) */
  ledgerVersion: number;
  notificationsVersion: number;
  leaderboardVersion: number;
  requestsVersion: number;
  /** Zuletzt geschaffte Quest (für das Pop-up) */
  questEvent: QuestEvent | null;
  clearQuestEvent: () => void;
}

export interface QuestEvent {
  id: string;
  questId: string;
  title: string;
  amount: number;
}

const Ctx = createContext<AppData | null>(null);

export function AppDataProvider({ children }: { children: ReactNode }) {
  const { session, isAdmin } = useAuth();
  const toast = useToast();
  const userId = session?.user.id ?? null;
  const [balance, setBalance] = useState<number | null>(null);
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);
  const [dashboard, setDashboard] = useState<DashboardState | null>(null);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const [ledgerVersion, setLedgerVersion] = useState(0);
  const [notificationsVersion, setNotificationsVersion] = useState(0);
  const [leaderboardVersion, setLeaderboardVersion] = useState(0);
  const [requestsVersion, setRequestsVersion] = useState(0);
  const [questEvent, setQuestEvent] = useState<QuestEvent | null>(null);
  const clearQuestEvent = useCallback(() => setQuestEvent(null), []);
  const balanceRef = useRef<number | null>(null);
  const flashTimer = useRef<number | undefined>(undefined);

  const applyServerBalance = useCallback((next: number | null | undefined) => {
    if (next === null || next === undefined || Number.isNaN(Number(next))) return;
    const value = Number(next);
    const prev = balanceRef.current;
    balanceRef.current = value;
    setBalance(value);
    if (prev !== null && prev !== value) {
      setFlash(value > prev ? 'up' : 'down');
      window.clearTimeout(flashTimer.current);
      flashTimer.current = window.setTimeout(() => setFlash(null), 900);
    }
  }, []);

  const refreshDashboard = useCallback(async () => {
    try {
      const d = await api.getDashboard();
      setDashboard(d);
      setDashboardError(null);
      applyServerBalance(d.balance);
      setUnread(Number(d.unread_notifications));
    } catch (e) {
      setDashboardError(e instanceof Error ? e.message : 'Fehler');
    }
  }, [applyServerBalance]);

  useEffect(() => {
    if (!userId) {
      setBalance(null);
      balanceRef.current = null;
      setDashboard(null);
      return;
    }
    void refreshDashboard();

    const channel = supabase
      .channel(`user-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wallets', filter: `user_id=eq.${userId}` }, (payload) => {
        const row = payload.new as { balance?: number };
        if (row && row.balance !== undefined) applyServerBalance(Number(row.balance));
        setLedgerVersion((v) => v + 1);
      })
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        (payload) => {
          const n = payload.new as NotificationItem;
          setUnread((u) => u + 1);
          setNotificationsVersion((v) => v + 1);
          const amount = Number((n.metadata as { amount?: number })?.amount ?? 0);
          switch (n.type) {
            case 'admin_credit':
              toast.success(n.title, `+${formatCredits(amount)} Credits`);
              break;
            case 'admin_debit':
              toast.warn(n.title, n.message);
              break;
            case 'credit_request_approved':
              toast.success(n.title, n.message);
              setRequestsVersion((v) => v + 1);
              break;
            case 'credit_request_rejected':
              toast.error(n.title, n.message);
              setRequestsVersion((v) => v + 1);
              break;
            case 'announcement':
              toast.info(n.title, n.message);
              void refreshDashboard();
              break;
            case 'achievement':
              toast.win(n.title, n.message);
              void refreshDashboard();
              break;
            case 'quest_completed': {
              const m = n.metadata as { quest_id?: string; amount?: number };
              if (m.quest_id) setQuestEvent({ id: n.id, questId: m.quest_id, title: n.message, amount: Number(m.amount ?? 0) });
              void refreshDashboard();
              break;
            }
            case 'week_finalized':
              toast.info(n.title, n.message);
              void refreshDashboard();
              break;
            case 'duel':
            case 'gift_received':
              toast.info(n.title, n.message);
              void refreshDashboard();
              break;
            case 'prediction':
            case 'jackpot':
              toast.win(n.title, n.message);
              break;
            case 'credit_request_new':
              toast.info(n.title, n.message);
              setRequestsVersion((v) => v + 1);
              break;
            default:
              break;
          }
        },
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leaderboard_entries' }, () => {
        setLeaderboardVersion((v) => v + 1);
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'weekly_results' }, () => {
        void refreshDashboard();
      });

    if (isAdmin) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table: 'credit_requests' }, () => {
        setRequestsVersion((v) => v + 1);
      });
    }
    channel.subscribe();

    // Nach Rückkehr in den Vordergrund Daten auffrischen (z. B. nach Standby auf dem iPhone)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refreshDashboard();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, isAdmin]);

  const value = useMemo<AppData>(
    () => ({
      balance,
      applyServerBalance,
      balanceFlash: flash,
      dashboard,
      dashboardError,
      refreshDashboard,
      unread,
      setUnread,
      ledgerVersion,
      notificationsVersion,
      leaderboardVersion,
      requestsVersion,
      questEvent,
      clearQuestEvent,
    }),
    [balance, applyServerBalance, flash, dashboard, dashboardError, refreshDashboard, unread, ledgerVersion, notificationsVersion, leaderboardVersion, requestsVersion, questEvent, clearQuestEvent],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppData(): AppData {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAppData außerhalb von AppDataProvider');
  return ctx;
}
