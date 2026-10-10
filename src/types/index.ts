export type Role = 'user' | 'admin';
export type ProfileStatus = 'invited' | 'active' | 'suspended' | 'deleted';

export interface Profile {
  id: string;
  username: string;
  display_name: string;
  role: Role;
  status: ProfileStatus;
  avatar_seed: string | null;
  created_at: string;
  last_seen_at: string | null;
  preferences?: { announcements?: boolean; show_feed?: boolean; push?: boolean };
}

export interface WeeklyResultInfo {
  week_key: string;
  loser_user_id: string | null;
  loser_display_name: string | null;
  loser_username?: string | null;
  loser_balance: number;
  task_label: string;
  finalized_at: string;
}

export interface DashboardState {
  server_now: string;
  week_key: string;
  week_start: string;
  week_end: string;
  profile: Profile;
  balance: number;
  rank: number | null;
  bonus: { amount: number; claimed: boolean; next_available_at: string; period?: 'day' | 'week' };
  playtime_total: number;
  playtime_week: number;
  last_weekly_result: WeeklyResultInfo | null;
  current_lowest: { user_id: string; display_name: string; username: string; balance: number } | null;
  task_label: string;
  unread_notifications: number;
  pending_requests: number;
  period_weeks?: number;
  quests?: { unseen: boolean; claimable: number };
}

export interface LedgerEntry {
  id: string;
  user_id: string;
  amount: number;
  balance_after: number;
  entry_type: 'weekly_bonus' | 'game_bet' | 'game_payout' | 'admin_credit' | 'admin_debit' | 'credit_request' | 'achievement_reward' | 'quest_reward' | 'gift_sent' | 'gift_received' | 'duel_stake' | 'duel_payout' | 'duel_refund' | 'prediction_reward';
  reason: string;
  reference_type: string | null;
  reference_id: string | null;
  created_at: string;
}

export type CreditRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface CreditRequest {
  id: string;
  user_id: string;
  amount: number;
  message: string;
  status: CreditRequestStatus;
  reviewed_at: string | null;
  review_message: string | null;
  created_at: string;
}

export interface LeaderboardRow {
  user_id: string;
  username: string;
  display_name: string;
  avatar_seed: string | null;
  balance: number;
  week_change: number | null;
  playtime_seconds: number;
  rounds_count: number;
  bonus_claimed: boolean;
  rank: number;
}

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  message: string;
  metadata: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
}

export interface GameConfig {
  game_key: string;
  display_name: string;
  enabled: boolean;
  config: {
    implemented?: boolean;
    min_bet: number;
    max_bet: number;
    category?: string;
    [k: string]: unknown;
  };
  updated_at?: string;
}

export interface RoundResponse<R = unknown> {
  round_id: string;
  game_key: string;
  status: 'active' | 'settled' | 'cancelled';
  bet_amount: number;
  payout_amount: number;
  profit_amount: number;
  result: R;
  server_seed_hash: string;
  started_at: string;
  completed_at: string | null;
  balance: number;
  server_now: string;
  current_multiplier?: number;
}

export interface GameRoundRow {
  id: string;
  user_id: string;
  game_key: string;
  status: string;
  bet_amount: number;
  payout_amount: number;
  profit_amount: number;
  result: Record<string, unknown>;
  server_seed_hash: string | null;
  started_at: string;
  completed_at: string | null;
}

export interface AdminUser {
  id: string;
  username: string;
  display_name: string;
  email: string | null;
  role: Role;
  status: ProfileStatus;
  balance: number;
  playtime_seconds: number;
  rounds_count: number;
  created_at: string;
  last_seen_at: string | null;
  invited_at: string | null;
  email_confirmed_at: string | null;
}

export interface AdminOverview {
  server_now: string;
  week_key: string;
  week_end: string;
  active_users: number;
  invited_users: number;
  suspended_users: number;
  total_credits: number;
  open_requests: number;
  live_sessions: number;
  rounds_today: number;
  stale_active_rounds: number;
  last_weekly_result: {
    week_key: string;
    loser_display_name: string | null;
    loser_balance: number;
    finalized_at: string;
    task_label: string;
  } | null;
  previous_week_finalized: boolean;
  cron_enabled: boolean;
}

export interface AuditLog {
  id: string;
  actor_id: string | null;
  action: string;
  target_user_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}
