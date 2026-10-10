-- Shishabar Online Casino – Grundschema
-- Virtuelle SHB-Credits ohne Echtgeldwert. Alle Beträge sind BIGINT.
-- Idempotent: kann auf einer leeren Datenbank mehrfach ausgeführt werden.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  display_name text not null,
  role text not null default 'user' check (role in ('user', 'admin')),
  status text not null default 'invited' check (status in ('invited', 'active', 'suspended', 'deleted')),
  avatar_seed text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  last_seen_at timestamptz,
  constraint username_format check (username ~ '^[A-Za-z0-9_.-]{2,24}$'),
  constraint display_name_length check (char_length(display_name) between 1 and 40)
);

-- Nur ein einziger Admin ist erlaubt.
create unique index if not exists profiles_single_admin on public.profiles ((role)) where role = 'admin';
create index if not exists profiles_status_idx on public.profiles (status);

-- ---------------------------------------------------------------------------
-- wallets & ledger
-- ---------------------------------------------------------------------------
create table if not exists public.wallets (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  balance bigint not null default 0 check (balance >= 0),
  updated_at timestamptz default now()
);

create table if not exists public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  amount bigint not null,
  balance_after bigint not null,
  entry_type text not null check (entry_type in (
    'weekly_bonus', 'game_bet', 'game_payout', 'admin_credit', 'admin_debit', 'credit_request'
  )),
  reason text not null,
  reference_type text,
  reference_id uuid,
  created_by uuid references public.profiles(id),
  idempotency_key text unique not null,
  created_at timestamptz default now()
);
create index if not exists credit_ledger_user_created_idx on public.credit_ledger (user_id, created_at desc);
create index if not exists credit_ledger_created_by_idx on public.credit_ledger (created_by);
create index if not exists credit_ledger_reference_idx on public.credit_ledger (reference_id);

-- Öffentliche Leaderboard-Spiegelung (ohne private Daten). Wird per Trigger gepflegt.
create table if not exists public.leaderboard_entries (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  balance bigint not null default 0,
  updated_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- credit_requests
-- ---------------------------------------------------------------------------
create table if not exists public.credit_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  amount bigint not null check (amount > 0 and amount <= 1000000),
  message text not null check (char_length(message) between 3 and 500),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_message text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists credit_requests_user_idx on public.credit_requests (user_id, created_at desc);
create index if not exists credit_requests_status_idx on public.credit_requests (status);
create index if not exists credit_requests_reviewed_by_idx on public.credit_requests (reviewed_by);

-- ---------------------------------------------------------------------------
-- bonus_claims
-- ---------------------------------------------------------------------------
create table if not exists public.bonus_claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  week_key text not null,
  amount bigint not null,
  claimed_at timestamptz default now(),
  unique (user_id, week_key)
);
create index if not exists bonus_claims_week_idx on public.bonus_claims (week_key);

-- ---------------------------------------------------------------------------
-- game_rounds (+ geheime Serverdaten getrennt)
-- ---------------------------------------------------------------------------
create table if not exists public.game_rounds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  game_key text not null,
  status text not null check (status in ('active', 'settled', 'cancelled')),
  bet_amount bigint not null check (bet_amount > 0),
  payout_amount bigint not null default 0 check (payout_amount >= 0),
  profit_amount bigint not null default 0,
  result jsonb not null default '{}'::jsonb,
  server_seed_hash text,
  client_nonce text,
  idempotency_key text unique not null,
  started_at timestamptz default now(),
  completed_at timestamptz
);
create index if not exists game_rounds_user_started_idx on public.game_rounds (user_id, started_at desc);
create index if not exists game_rounds_game_idx on public.game_rounds (game_key, started_at desc);
create index if not exists game_rounds_active_idx on public.game_rounds (user_id, game_key) where status = 'active';

-- Für Clients unsichtbar (keine RLS-Policy): Seed, Minenpositionen, Kartenstapel, Crash-Punkt.
create table if not exists public.game_round_secrets (
  round_id uuid primary key references public.game_rounds(id) on delete cascade,
  server_seed bytea not null,
  state jsonb not null default '{}'::jsonb
);

-- ---------------------------------------------------------------------------
-- game_sessions (Spielzeit)
-- ---------------------------------------------------------------------------
create table if not exists public.game_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  started_at timestamptz not null,
  last_heartbeat_at timestamptz not null,
  ended_at timestamptz,
  duration_seconds integer not null default 0 check (duration_seconds >= 0),
  user_agent_hash text
);
create index if not exists game_sessions_user_idx on public.game_sessions (user_id, started_at desc);
create index if not exists game_sessions_open_idx on public.game_sessions (user_id) where ended_at is null;

-- ---------------------------------------------------------------------------
-- Wochenabschluss
-- ---------------------------------------------------------------------------
create table if not exists public.weekly_snapshots (
  id uuid primary key default gen_random_uuid(),
  week_key text not null,
  user_id uuid not null references public.profiles(id),
  balance bigint not null,
  playtime_seconds integer not null default 0,
  captured_at timestamptz default now(),
  unique (week_key, user_id)
);
create index if not exists weekly_snapshots_user_idx on public.weekly_snapshots (user_id);

create table if not exists public.weekly_results (
  id uuid primary key default gen_random_uuid(),
  week_key text unique not null,
  loser_user_id uuid references public.profiles(id),
  loser_balance bigint not null,
  task_label text not null default 'Kasten mitbringen',
  finalized_at timestamptz default now()
);
create index if not exists weekly_results_loser_idx on public.weekly_results (loser_user_id);

-- ---------------------------------------------------------------------------
-- notifications, audit, config
-- ---------------------------------------------------------------------------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  type text not null,
  title text not null,
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz default now()
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id),
  action text not null,
  target_user_id uuid references public.profiles(id),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz default now()
);
create index if not exists audit_logs_created_idx on public.audit_logs (created_at desc);
create index if not exists audit_logs_actor_idx on public.audit_logs (actor_id);
create index if not exists audit_logs_target_idx on public.audit_logs (target_user_id);

create table if not exists public.game_configs (
  game_key text primary key,
  display_name text not null,
  enabled boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz default now()
);
create index if not exists game_configs_updated_by_idx on public.game_configs (updated_by);

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz default now()
);
create index if not exists app_settings_updated_by_idx on public.app_settings (updated_by);

-- Erwartete Mitglieder (Seed): Namen ohne E-Mail, werden im Admin-Panel zum Einladen vorgeschlagen.
create table if not exists public.expected_members (
  username text primary key,
  display_name text not null,
  is_admin boolean not null default false
);

-- Einfaches serverseitiges Rate-Limiting
create table if not exists public.rate_limit_events (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  action text not null,
  created_at timestamptz not null default now()
);
create index if not exists rate_limit_events_lookup_idx on public.rate_limit_events (user_id, action, created_at desc);
