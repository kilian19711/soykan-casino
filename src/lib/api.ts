// Datenzugriffsschicht: alle Supabase-Aufrufe an einer Stelle. UI-Komponenten rufen nur diese Funktionen auf.
import { supabase } from './supabase';
import { toAppError, AppError } from './errors';
import { syncServerTime } from './misc';
import { reportError } from './errorReporter';
import type {
  AdminOverview,
  AdminUser,
  AuditLog,
  CreditRequest,
  DashboardState,
  GameConfig,
  GameRoundRow,
  LeaderboardRow,
  LedgerEntry,
  NotificationItem,
  Profile,
  RoundResponse,
} from '../types';

export interface GiftItem {
  id: string;
  amount: number;
  message: string | null;
  created_at: string;
  outgoing: boolean;
  other_name: string;
  other_seed: string | null;
}

export interface DuelItem {
  id: string;
  game: 'coinflip' | 'dice' | 'highcard' | 'match' | 'live';
  game_key: string | null;
  game_name: string | null;
  rounds: number | null;
  accepted_at: string | null;
  c_rounds: number | null;
  o_rounds: number | null;
  c_quote: number | null;
  o_quote: number | null;
  stake: number;
  message: string | null;
  status: 'pending' | 'lobby' | 'running' | 'finished' | 'declined' | 'cancelled' | 'expired';
  result: Record<string, unknown>;
  created_at: string;
  expires_at: string;
  mine: boolean;
  won: boolean | null;
  has_winner: boolean;
  challenger_name: string;
  challenger_seed: string | null;
  opponent_name: string;
  opponent_seed: string | null;
}

export interface LiveDuel {
  id: string;
  game: string;
  game_key: string | null;
  rounds: number;
  stake: number;
  message: string | null;
  status: 'pending' | 'lobby' | 'running' | 'finished' | 'declined' | 'cancelled' | 'expired';
  result: Record<string, unknown>;
  start_at: string | null;
  expires_at: string;
  c_ready: boolean;
  o_ready: boolean;
  mine: boolean;
  won: boolean | null;
  has_winner: boolean;
  challenger_id: string;
  opponent_id: string;
  challenger_name: string;
  challenger_seed: string | null;
  opponent_name: string;
  opponent_seed: string | null;
  server_now: string;
  balance: number;
}

export interface PredictionState {
  period_key: string;
  locks_at: string;
  period_end: string;
  reward: number;
  my_pick: string | null;
  tips: number;
  last: { period_key: string; loser: string | null; tips: { name: string; pick: string; correct: boolean }[] } | null;
}

export interface ClientErrorRow {
  id: string;
  kind: 'crash' | 'error' | 'rejection' | 'server';
  message: string;
  stack: string | null;
  context: Record<string, unknown>;
  count: number;
  users: string[];
  first_seen_at: string;
  last_seen_at: string;
}

export interface DailyQuest {
  id: string;
  slot: number;
  tier: 'easy' | 'medium' | 'hard';
  title: string;
  metric: string;
  game_key: string | null;
  target: number;
  progress: number;
  reward: number;
  seen: boolean;
  completed_at: string | null;
  claimed_at: string | null;
}

export interface Achievement {
  key: string;
  title: string;
  description: string;
  icon: string;
  metric: string;
  target: number;
  progress: number;
  unlocked_at: string | null;
  reward: number;
}

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const started = Date.now();
  const { data, error } = await supabase.rpc(fn, args ?? {});
  if (error) {
    const appErr = toAppError(error);
    // Unerwartete Serverfehler an den Admin melden (Fachfehler wie INSUFFICIENT_BALANCE nicht)
    if (appErr.code === 'UNKNOWN' || appErr.code === 'INTERNAL_ERROR') {
      reportError('server', new Error(error.message), { rpc: fn, code: (error as { code?: string }).code ?? null, details: (error as { details?: string }).details ?? null });
    }
    throw appErr;
  }
  if (data && typeof data === 'object' && 'server_now' in (data as Record<string, unknown>)) {
    syncServerTime(String((data as Record<string, unknown>).server_now), started);
  }
  return data as T;
}

async function select<T>(promise: PromiseLike<{ data: T | null; error: unknown }>): Promise<T> {
  const { data, error } = await promise;
  if (error) throw toAppError(error);
  return (data ?? ([] as unknown)) as T;
}

// ---------------------------------------------------------------------------
// Konto
// ---------------------------------------------------------------------------
export const api = {
  activateAccount: () => rpc<string>('activate_my_account'),
  isAdmin: () => rpc<boolean>('shb_is_admin'),
  getMyProfile: async (userId: string) =>
    select<Profile | null>(
      supabase
        .from('profiles')
        .select('id, username, display_name, role, status, avatar_seed, created_at, last_seen_at, preferences')
        .eq('id', userId)
        .maybeSingle(),
    ),
  updateMyProfile: (displayName: string, avatarSeed: string | null) =>
    rpc<void>('update_my_profile', { p_display_name: displayName, p_avatar_seed: avatarSeed }),

  getDashboard: () => rpc<DashboardState>('get_dashboard_state'),
  getServerTime: async () => {
    const started = Date.now();
    const t = await rpc<string>('get_server_time');
    syncServerTime(t, started);
    return t;
  },

  // Wallet & Ledger
  getMyBalance: async (userId: string) => {
    const row = await select<{ balance: number } | null>(
      supabase.from('wallets').select('balance').eq('user_id', userId).maybeSingle(),
    );
    return Number(row?.balance ?? 0);
  },
  getLedger: (userId: string, limit = 50, offset = 0) =>
    select<LedgerEntry[]>(
      supabase
        .from('credit_ledger')
        .select('id, user_id, amount, balance_after, entry_type, reason, reference_type, reference_id, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1),
    ),

  // Bonus
  claimWeeklyBonus: (key: string) =>
    rpc<{ amount: number; balance: number; week_key: string; next_available_at: string }>('claim_weekly_bonus', {
      p_idempotency_key: key,
    }),

  // Credit-Anfragen
  requestCredits: (amount: number, message: string) =>
    rpc<string>('request_credits', { p_amount: amount, p_message: message }),
  cancelCreditRequest: (id: string) => rpc<void>('cancel_credit_request', { p_request_id: id }),
  getMyCreditRequests: (userId: string) =>
    select<CreditRequest[]>(
      supabase
        .from('credit_requests')
        .select('id, user_id, amount, message, status, reviewed_at, review_message, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(100),
    ),

  // Leaderboard
  getLeaderboard: () => rpc<LeaderboardRow[]>('get_leaderboard'),

  // Benachrichtigungen
  getNotifications: (limit = 50) =>
    select<NotificationItem[]>(
      supabase
        .from('notifications')
        .select('id, type, title, message, metadata, read_at, created_at')
        .order('created_at', { ascending: false })
        .limit(limit),
    ),
  markNotificationsRead: (ids: string[] | null) => rpc<number>('mark_notifications_read', { p_ids: ids }),

  // Spielzeit
  startSession: (uaHash: string) => rpc<string>('start_game_session', { p_user_agent_hash: uaHash }),
  heartbeat: (sessionId: string) =>
    rpc<{ ok: boolean; reason?: string }>('heartbeat_game_session', { p_session_id: sessionId }),
  endSession: (sessionId: string) => rpc<void>('end_game_session', { p_session_id: sessionId }),

  // Spiele
  getGameConfigs: () =>
    select<GameConfig[]>(
      supabase.from('game_configs').select('game_key, display_name, enabled, config, updated_at').order('display_name'),
    ),
  getMyRounds: (userId: string, gameKey?: string, limit = 30, offset = 0) => {
    let q = supabase
      .from('game_rounds')
      .select('id, user_id, game_key, status, bet_amount, payout_amount, profit_amount, result, server_seed_hash, started_at, completed_at')
      .eq('user_id', userId)
      .order('started_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (gameKey) q = q.eq('game_key', gameKey);
    return select<GameRoundRow[]>(q);
  },
  getRound: (roundId: string) =>
    select<GameRoundRow | null>(
      supabase
        .from('game_rounds')
        .select('id, user_id, game_key, status, bet_amount, payout_amount, profit_amount, result, server_seed_hash, started_at, completed_at')
        .eq('id', roundId)
        .maybeSingle(),
    ),
  getActiveRound: <R>(gameKey: string) => rpc<RoundResponse<R> | null>('get_active_round', { p_game_key: gameKey }),

  playDice: (bet: number, target: number, over: boolean, key: string) =>
    rpc<RoundResponse>('play_dice', { p_bet: bet, p_target: target, p_over: over, p_idempotency_key: key }),
  playLimbo: (bet: number, targetH: number, key: string) =>
    rpc<RoundResponse>('play_limbo', { p_bet: bet, p_target: targetH, p_idempotency_key: key }),
  playPlinko: (bet: number, rows: number, risk: string, key: string) =>
    rpc<RoundResponse>('play_plinko', { p_bet: bet, p_rows: rows, p_risk: risk, p_idempotency_key: key }),
  playSlots: (bet: number, key: string) => rpc<RoundResponse>('play_slots', { p_bet: bet, p_idempotency_key: key }),
  playRoulette: (bets: { type: string; value?: number; amount: number }[], key: string) =>
    rpc<RoundResponse>('play_roulette', { p_bets: bets, p_idempotency_key: key }),
  minesStart: (bet: number, grid: number, mines: number, key: string) =>
    rpc<RoundResponse>('mines_start', { p_bet: bet, p_grid: grid, p_mines: mines, p_idempotency_key: key }),
  minesReveal: (roundId: string, cell: number) =>
    rpc<RoundResponse>('mines_reveal', { p_round_id: roundId, p_cell: cell }),
  minesCashout: (roundId: string) => rpc<RoundResponse>('mines_cashout', { p_round_id: roundId }),
  blackjackStart: (bet: number, key: string) =>
    rpc<RoundResponse>('blackjack_start', { p_bet: bet, p_idempotency_key: key }),
  blackjackAction: (roundId: string, action: string, seq: number) =>
    rpc<RoundResponse>('blackjack_action', { p_round_id: roundId, p_action: action, p_action_seq: seq }),
  crashStart: (bet: number, autoH: number | null, key: string) =>
    rpc<RoundResponse>('crash_start', { p_bet: bet, p_auto_cashout: autoH, p_idempotency_key: key }),
  crashCashout: (roundId: string) => rpc<RoundResponse>('crash_cashout', { p_round_id: roundId }),
  crashPoll: (roundId: string) => rpc<RoundResponse>('crash_poll', { p_round_id: roundId }),
  playGame: (gameKey: string, bet: number, params: Record<string, unknown>, key: string) =>
    rpc<RoundResponse>('play_game', { p_game_key: gameKey, p_bet: bet, p_params: params, p_idempotency_key: key }),
  stepStart: (gameKey: string, bet: number, params: Record<string, unknown>, key: string) =>
    rpc<RoundResponse>('step_start', { p_game_key: gameKey, p_bet: bet, p_params: params, p_idempotency_key: key }),
  stepAction: (roundId: string, action: Record<string, unknown>, seq: number) =>
    rpc<RoundResponse>('step_action', { p_round_id: roundId, p_action: action, p_seq: seq }),
  stepCashout: (roundId: string) => rpc<RoundResponse>('step_cashout', { p_round_id: roundId }),
  playExtra: (gameKey: string, bet: number, params: Record<string, unknown>, key: string) =>
    rpc<RoundResponse>('play_extra', { p_game_key: gameKey, p_bet: bet, p_params: params, p_idempotency_key: key }),
  pumpStart: (bet: number, difficulty: string, key: string) => rpc<RoundResponse>('pump_start', { p_bet: bet, p_difficulty: difficulty, p_idempotency_key: key }),
  pumpAction: (roundId: string, seq: number) => rpc<RoundResponse>('pump_action', { p_round_id: roundId, p_seq: seq }),
  pumpCashout: (roundId: string) => rpc<RoundResponse>('pump_cashout', { p_round_id: roundId }),
  jackpotSpin: (bet: number, key: string) => rpc<RoundResponse & { pot?: number }>('jackpot_spin', { p_bet: bet, p_idempotency_key: key }),
  getJackpot: () => rpc<{ pot: number; last_win: number | null; last_won_at: string | null; last_winner: string | null } | null>('get_jackpot'),
  // Soziales
  sendCredits: (to: string, amount: number, message: string, key: string) =>
    rpc<{ balance: number; sent_today: number; limit: number }>('send_credits', { p_to: to, p_amount: amount, p_message: message, p_idempotency_key: key }),
  getMyGifts: () => rpc<{ limit: number; sent_today: number; items: GiftItem[] }>('get_my_gifts'),
  createDuel: (opponent: string, game: string, stake: number, message: string, key: string) =>
    rpc<{ id: string; balance: number }>('create_duel', { p_opponent: opponent, p_game: game, p_stake: stake, p_message: message, p_idempotency_key: key }),
  acceptDuel: (id: string) => rpc<{ won?: boolean; result?: Record<string, unknown>; running?: boolean; balance: number }>('accept_duel', { p_duel: id }),
  cancelDuel: (id: string) => rpc<{ status: string; balance: number }>('cancel_duel', { p_duel: id }),
  createMatchDuel: (opponent: string, gameKey: string, rounds: number, stake: number, message: string, key: string) =>
    rpc<{ id: string; balance: number }>('create_match_duel', { p_opponent: opponent, p_game_key: gameKey, p_rounds: rounds, p_stake: stake, p_message: message, p_idempotency_key: key }),
  createLiveDuel: (opponent: string, game: string, rounds: number, stake: number, message: string, key: string) =>
    rpc<{ id: string; balance: number }>('create_live_duel', { p_opponent: opponent, p_game: game, p_rounds: rounds, p_stake: stake, p_message: message, p_idempotency_key: key }),
  getDuel: (id: string) => rpc<LiveDuel>('get_duel', { p_duel: id }),
  joinLiveDuel: (id: string) => rpc<LiveDuel>('join_live_duel', { p_duel: id }),
  readyLiveDuel: (id: string) => rpc<LiveDuel>('ready_live_duel', { p_duel: id }),
  leaveLiveDuel: (id: string) => rpc<LiveDuel>('leave_live_duel', { p_duel: id }),
  getMyDuels: () => rpc<{ max_stake: number; items: DuelItem[] }>('get_my_duels'),
  setPrediction: (userId: string) => rpc<PredictionState>('set_prediction', { p_user: userId }),
  getPredictionState: () => rpc<PredictionState>('get_prediction_state'),
  stickySpin: (bet: number, key: string) => rpc<RoundResponse>('sticky_spin', { p_bet: bet, p_idempotency_key: key }),
  stickyGamble: (roundId: string, pick: string, seq: number) =>
    rpc<RoundResponse>('sticky_gamble', { p_round_id: roundId, p_pick: pick, p_seq: seq }),
  stickyCollect: (roundId: string) => rpc<RoundResponse>('sticky_collect', { p_round_id: roundId }),

  // Soziales
  updatePreferences: (prefs: Record<string, boolean>) => rpc<Record<string, boolean>>('update_my_preferences', { p_prefs: prefs }),
  getBigWins: () =>
    rpc<{ round_id: string; display_name: string; avatar_seed: string | null; game_key: string; multiplier: number; profit: number; completed_at: string }[]>(
      'get_big_wins',
      { p_limit: 15 },
    ),
  getWeekRecap: (offset = 0) => rpc<Record<string, unknown>>('get_week_recap', { p_offset_weeks: offset }),
  getAchievements: (userId?: string) => rpc<Achievement[]>('get_achievements', { p_user: userId ?? null }),
  getMyQuests: () => rpc<{ day_key: string; resets_at: string; quests: DailyQuest[] }>('get_my_quests'),
  markQuestsSeen: () => rpc<void>('mark_quests_seen'),
  claimQuest: (id: string) => rpc<{ amount: number; balance: number }>('claim_daily_quest', { p_quest_id: id }),
  getAchievementCounts: () =>
    select<{ user_id: string; key: string }[]>(supabase.from('achievements').select('user_id, key')),
  getGameLimits: () => rpc<{ max_win_per_round: number } | null>('get_game_limits'),
  getPushKey: () => rpc<string | null>('get_push_public_key'),
  savePushSubscription: (endpoint: string, p256dh: string, auth: string) =>
    rpc<void>('save_push_subscription', { p_endpoint: endpoint, p_p256dh: p256dh, p_auth: auth }),
  deletePushSubscription: (endpoint: string | null) => rpc<void>('delete_push_subscription', { p_endpoint: endpoint }),

  crashHistory: () => rpc<{ crash_point: number; completed_at: string }[]>('get_crash_history', { p_limit: 20 }),

  // Wochenergebnisse
  getWeeklyResults: (limit = 12) =>
    select<
      { id: string; week_key: string; loser_user_id: string | null; loser_balance: number; task_label: string; finalized_at: string }[]
    >(supabase.from('weekly_results').select('id, week_key, loser_user_id, loser_balance, task_label, finalized_at').order('finalized_at', { ascending: false }).limit(limit)),
  getProfilesPublic: () =>
    select<Pick<Profile, 'id' | 'username' | 'display_name' | 'avatar_seed' | 'status'>[]>(
      supabase.from('profiles').select('id, username, display_name, avatar_seed, status'),
    ),

  // ---------------------------------------------------------------------------
  // Admin (jede Funktion prüft serverseitig erneut die Admin-Rolle)
  // ---------------------------------------------------------------------------
  admin: {
    overview: () => rpc<AdminOverview>('admin_get_overview'),
    listErrors: () => rpc<ClientErrorRow[]>('admin_list_errors'),
    deleteErrors: (ids: string[] | null) => rpc<number>('admin_delete_errors', { p_ids: ids }),
    cleanupPreview: (from: string | null, to: string | null) => rpc<Record<string, number>>('admin_cleanup_preview', { p_from: from, p_to: to }),
    cleanup: (targets: string[], from: string | null, to: string | null, reason: string) =>
      rpc<Record<string, number>>('admin_cleanup', { p_targets: targets, p_from: from, p_to: to, p_reason: reason }),
    listUsers: () => rpc<AdminUser[]>('admin_list_users'),
    adjustCredits: (userId: string, amount: number, reason: string, key: string) =>
      rpc<{ balance: number }>('admin_adjust_credits', {
        p_user_id: userId,
        p_amount: amount,
        p_reason: reason,
        p_idempotency_key: key,
      }),
    reviewRequest: (id: string, approve: boolean, message: string | null) =>
      rpc<{ status: string; balance: number | null }>('admin_review_credit_request', {
        p_request_id: id,
        p_approve: approve,
        p_message: message,
      }),
    setStatus: (userId: string, status: 'active' | 'suspended', reason: string) =>
      rpc<void>('admin_set_user_status', { p_user_id: userId, p_status: status, p_reason: reason }),
    updateProfile: (userId: string, displayName: string, username: string, reason: string) =>
      rpc<void>('admin_update_profile', {
        p_user_id: userId,
        p_display_name: displayName,
        p_username: username,
        p_reason: reason,
      }),
    updateGameConfig: (gameKey: string, enabled: boolean, config: Record<string, unknown>, reason: string) =>
      rpc<void>('admin_update_game_config', {
        p_game_key: gameKey,
        p_enabled: enabled,
        p_config: config,
        p_reason: reason,
      }),
    updateSetting: (key: string, value: unknown, reason: string) =>
      rpc<void>('admin_update_setting', { p_key: key, p_value: value, p_reason: reason }),
    finalizeWeek: (currentWeek: boolean, reason: string) =>
      rpc<{ week_key: string; already_finalized: boolean; loser_user_id?: string; loser_balance?: number }>(
        'admin_finalize_week',
        { p_current_week: currentWeek, p_reason: reason },
      ),
    settings: () =>
      select<{ key: string; value: unknown; updated_at: string }[]>(
        supabase.from('app_settings').select('key, value, updated_at').order('key'),
      ),
    expectedMembers: () =>
      select<{ username: string; display_name: string; is_admin: boolean }[]>(
        supabase.from('expected_members').select('username, display_name, is_admin').order('display_name'),
      ),
    creditRequests: (status?: string) => {
      let q = supabase
        .from('credit_requests')
        .select('id, user_id, amount, message, status, reviewed_at, review_message, created_at')
        .order('created_at', { ascending: false })
        .limit(200);
      if (status) q = q.eq('status', status);
      return select<CreditRequest[]>(q);
    },
    ledger: (userId?: string, entryTypes?: string[], limit = 100) => {
      let q = supabase
        .from('credit_ledger')
        .select('id, user_id, amount, balance_after, entry_type, reason, reference_type, reference_id, created_at')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (userId) q = q.eq('user_id', userId);
      if (entryTypes?.length) q = q.in('entry_type', entryTypes);
      return select<LedgerEntry[]>(q);
    },
    rounds: (filters: { userId?: string; gameKey?: string; limit?: number }) => {
      let q = supabase
        .from('game_rounds')
        .select('id, user_id, game_key, status, bet_amount, payout_amount, profit_amount, result, server_seed_hash, started_at, completed_at')
        .order('started_at', { ascending: false })
        .limit(filters.limit ?? 100);
      if (filters.userId) q = q.eq('user_id', filters.userId);
      if (filters.gameKey) q = q.eq('game_key', filters.gameKey);
      return select<GameRoundRow[]>(q);
    },
    sessions: (limit = 100) =>
      select<
        { id: string; user_id: string; started_at: string; last_heartbeat_at: string; ended_at: string | null; duration_seconds: number }[]
      >(
        supabase
          .from('game_sessions')
          .select('id, user_id, started_at, last_heartbeat_at, ended_at, duration_seconds')
          .order('started_at', { ascending: false })
          .limit(limit),
      ),
    snapshots: (weekKey: string) =>
      select<{ user_id: string; balance: number; playtime_seconds: number; captured_at: string }[]>(
        supabase.from('weekly_snapshots').select('user_id, balance, playtime_seconds, captured_at').eq('week_key', weekKey).order('balance'),
      ),
    audit: (limit = 200) =>
      select<AuditLog[]>(
        supabase
          .from('audit_logs')
          .select('id, actor_id, action, target_user_id, metadata, created_at')
          .order('created_at', { ascending: false })
          .limit(limit),
      ),
    invite: async (payload: { email: string; username?: string; display_name?: string; resend?: boolean }) => {
      const { data, error } = await supabase.functions.invoke('admin-invite-user', { body: payload });
      if (error) throw await functionError(error);
      return data as { ok: boolean; user_id: string | null };
    },
    sendPasswordReset: async (userId: string) => {
      const { data, error } = await supabase.functions.invoke('admin-send-password-reset', { body: { user_id: userId } });
      if (error) throw await functionError(error);
      return data as { ok: boolean };
    },
  },
};

async function functionError(error: unknown): Promise<AppError> {
  // FunctionsHttpError enthält die Response im context
  const ctx = (error as { context?: Response }).context;
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = (await ctx.json()) as { error?: string };
      if (body?.error) return toAppError(body.error);
    } catch {
      /* ignore */
    }
  }
  return toAppError(error);
}
