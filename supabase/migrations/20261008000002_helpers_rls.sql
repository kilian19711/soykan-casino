-- Hilfsfunktionen, Trigger, Row-Level Security und Realtime.

-- ---------------------------------------------------------------------------
-- Zeit/Woche (Europe/Berlin, Woche Mo 00:00 – So 23:59:59)
-- ---------------------------------------------------------------------------
create or replace function public.shb_week_start(p_ts timestamptz default now())
returns timestamptz language sql stable set search_path = '' as $$
  select (date_trunc('week', p_ts at time zone 'Europe/Berlin')) at time zone 'Europe/Berlin';
$$;

create or replace function public.shb_week_end(p_ts timestamptz default now())
returns timestamptz language sql stable set search_path = '' as $$
  select ((date_trunc('week', p_ts at time zone 'Europe/Berlin')) + interval '7 days') at time zone 'Europe/Berlin';
$$;

create or replace function public.shb_week_key(p_ts timestamptz default now())
returns text language sql stable set search_path = '' as $$
  select to_char(p_ts at time zone 'Europe/Berlin', 'IYYY-"W"IW');
$$;

-- ---------------------------------------------------------------------------
-- Rollen und Settings
-- ---------------------------------------------------------------------------
create or replace function public.shb_is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and status = 'active'
  );
$$;

create or replace function public.shb_setting(p_key text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select value from public.app_settings where key = p_key;
$$;

-- Liefert die aktive Benutzer-ID oder bricht ab.
create or replace function public.shb_require_user()
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_status text;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;
  select status into v_status from public.profiles where id = v_uid;
  if v_status is null then
    raise exception 'PROFILE_MISSING' using errcode = 'P0001';
  elsif v_status = 'suspended' then
    raise exception 'ACCOUNT_SUSPENDED' using errcode = 'P0001';
  elsif v_status <> 'active' then
    raise exception 'ACCOUNT_NOT_ACTIVE' using errcode = 'P0001';
  end if;
  return v_uid;
end;
$$;

create or replace function public.shb_require_admin()
returns uuid language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.shb_is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return auth.uid();
end;
$$;

-- ---------------------------------------------------------------------------
-- Rate-Limiting: max p_max Aufrufe in p_seconds Sekunden
-- ---------------------------------------------------------------------------
create or replace function public.shb_rate_limit(p_user uuid, p_action text, p_max int, p_seconds int)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_count int;
begin
  select count(*) into v_count from public.rate_limit_events
  where user_id = p_user and action = p_action
    and created_at > now() - make_interval(secs => p_seconds);
  if v_count >= p_max then
    raise exception 'RATE_LIMITED' using errcode = 'P0001';
  end if;
  insert into public.rate_limit_events (user_id, action) values (p_user, p_action);
end;
$$;

-- ---------------------------------------------------------------------------
-- Ledger-Buchung (einzige Stelle, die wallets.balance verändert)
-- Idempotent: gleicher Key => keine zweite Buchung, vorhandener Saldo wird zurückgegeben.
-- ---------------------------------------------------------------------------
create or replace function public.shb_apply_ledger(
  p_user uuid,
  p_amount bigint,
  p_entry_type text,
  p_reason text,
  p_reference_type text,
  p_reference_id uuid,
  p_created_by uuid,
  p_idempotency_key text
) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_balance bigint;
  v_existing bigint;
begin
  if p_idempotency_key is null or char_length(p_idempotency_key) < 8 then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode = 'P0001';
  end if;

  select balance_after into v_existing from public.credit_ledger where idempotency_key = p_idempotency_key;
  if found then
    return v_existing;
  end if;

  select balance into v_balance from public.wallets where user_id = p_user for update;
  if not found then
    raise exception 'WALLET_MISSING' using errcode = 'P0001';
  end if;

  if v_balance + p_amount < 0 then
    raise exception 'INSUFFICIENT_BALANCE' using errcode = 'P0001';
  end if;

  v_balance := v_balance + p_amount;
  update public.wallets set balance = v_balance, updated_at = now() where user_id = p_user;

  insert into public.credit_ledger (
    user_id, amount, balance_after, entry_type, reason, reference_type, reference_id, created_by, idempotency_key
  ) values (
    p_user, p_amount, v_balance, p_entry_type, p_reason, p_reference_type, p_reference_id, p_created_by, p_idempotency_key
  );
  return v_balance;
end;
$$;

create or replace function public.shb_notify(p_user uuid, p_type text, p_title text, p_message text, p_metadata jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, type, title, message, metadata)
  values (p_user, p_type, p_title, p_message, coalesce(p_metadata, '{}'::jsonb));
$$;

create or replace function public.shb_audit(p_action text, p_target uuid, p_metadata jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_logs (actor_id, action, target_user_id, metadata)
  values (auth.uid(), p_action, p_target, coalesce(p_metadata, '{}'::jsonb));
$$;

-- ---------------------------------------------------------------------------
-- Trigger
-- ---------------------------------------------------------------------------
create or replace function public.shb_touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.shb_touch_updated_at();
drop trigger if exists credit_requests_touch on public.credit_requests;
create trigger credit_requests_touch before update on public.credit_requests
  for each row execute function public.shb_touch_updated_at();

-- Neuer Auth-Benutzer => Profil. Admin-Rolle nur für die konfigurierte Admin-Adresse.
create or replace function public.shb_handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_admin_email text;
  v_base text;
  v_username text;
  v_display text;
  v_role text := 'user';
  v_i int := 1;
begin
  select value #>> '{}' into v_admin_email from public.app_settings where key = 'admin_email';

  v_base := coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1));
  v_base := regexp_replace(v_base, '[^A-Za-z0-9_.-]', '', 'g');
  if char_length(v_base) < 2 then v_base := 'spieler'; end if;
  v_base := left(v_base, 20);
  v_username := v_base;
  while exists (select 1 from public.profiles where lower(username) = lower(v_username)) loop
    v_i := v_i + 1;
    v_username := v_base || v_i::text;
  end loop;

  v_display := left(coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), v_username), 40);

  if v_admin_email is not null and lower(new.email) = lower(v_admin_email)
     and not exists (select 1 from public.profiles where role = 'admin') then
    v_role := 'admin';
  end if;

  insert into public.profiles (id, username, display_name, role, status, avatar_seed)
  values (new.id, v_username, v_display, v_role, 'invited', v_username)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.shb_handle_new_auth_user();

create or replace function public.shb_handle_new_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.wallets (user_id, balance) values (new.id, 0) on conflict do nothing;
  insert into public.leaderboard_entries (user_id, balance) values (new.id, 0) on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists on_profile_created on public.profiles;
create trigger on_profile_created after insert on public.profiles
  for each row execute function public.shb_handle_new_profile();

create or replace function public.shb_sync_leaderboard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.leaderboard_entries (user_id, balance, updated_at)
  values (new.user_id, new.balance, now())
  on conflict (user_id) do update set balance = excluded.balance, updated_at = excluded.updated_at;
  return new;
end;
$$;

drop trigger if exists on_wallet_changed on public.wallets;
create trigger on_wallet_changed after insert or update of balance on public.wallets
  for each row execute function public.shb_sync_leaderboard();

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.wallets enable row level security;
alter table public.credit_ledger enable row level security;
alter table public.leaderboard_entries enable row level security;
alter table public.credit_requests enable row level security;
alter table public.bonus_claims enable row level security;
alter table public.game_rounds enable row level security;
alter table public.game_round_secrets enable row level security;
alter table public.game_sessions enable row level security;
alter table public.weekly_snapshots enable row level security;
alter table public.weekly_results enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;
alter table public.game_configs enable row level security;
alter table public.app_settings enable row level security;
alter table public.expected_members enable row level security;
alter table public.rate_limit_events enable row level security;

-- Schreibrechte laufen ausschließlich über SECURITY-DEFINER-Funktionen.
revoke insert, update, delete, truncate on all tables in schema public from anon, authenticated;
revoke all on all tables in schema public from anon;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (true);

drop policy if exists wallets_select on public.wallets;
create policy wallets_select on public.wallets for select to authenticated
  using (user_id = (select auth.uid()) or (select public.shb_is_admin()));

drop policy if exists ledger_select on public.credit_ledger;
create policy ledger_select on public.credit_ledger for select to authenticated
  using (user_id = (select auth.uid()) or (select public.shb_is_admin()));

drop policy if exists leaderboard_select on public.leaderboard_entries;
create policy leaderboard_select on public.leaderboard_entries for select to authenticated using (true);

drop policy if exists credit_requests_select on public.credit_requests;
create policy credit_requests_select on public.credit_requests for select to authenticated
  using (user_id = (select auth.uid()) or (select public.shb_is_admin()));

drop policy if exists bonus_claims_select on public.bonus_claims;
create policy bonus_claims_select on public.bonus_claims for select to authenticated
  using (user_id = (select auth.uid()) or (select public.shb_is_admin()));

drop policy if exists game_rounds_select on public.game_rounds;
create policy game_rounds_select on public.game_rounds for select to authenticated
  using (user_id = (select auth.uid()) or (select public.shb_is_admin()));

-- game_round_secrets: bewusst KEINE Policy => für Clients unlesbar.

drop policy if exists game_sessions_select on public.game_sessions;
create policy game_sessions_select on public.game_sessions for select to authenticated
  using (user_id = (select auth.uid()) or (select public.shb_is_admin()));

drop policy if exists weekly_snapshots_select on public.weekly_snapshots;
create policy weekly_snapshots_select on public.weekly_snapshots for select to authenticated using (true);

drop policy if exists weekly_results_select on public.weekly_results;
create policy weekly_results_select on public.weekly_results for select to authenticated using (true);

drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs for select to authenticated
  using ((select public.shb_is_admin()));

drop policy if exists game_configs_select on public.game_configs;
create policy game_configs_select on public.game_configs for select to authenticated using (true);

drop policy if exists app_settings_select on public.app_settings;
create policy app_settings_select on public.app_settings for select to authenticated
  using ((select public.shb_is_admin()));

drop policy if exists expected_members_select on public.expected_members;
create policy expected_members_select on public.expected_members for select to authenticated
  using ((select public.shb_is_admin()));

-- rate_limit_events: keine Policy.

-- ---------------------------------------------------------------------------
-- Interne Funktionen dürfen nicht direkt aufgerufen werden.
-- ---------------------------------------------------------------------------
revoke execute on function public.shb_apply_ledger(uuid, bigint, text, text, text, uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.shb_notify(uuid, text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.shb_audit(text, uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.shb_rate_limit(uuid, text, int, int) from public, anon, authenticated;
revoke execute on function public.shb_setting(text) from public, anon, authenticated;
revoke execute on function public.shb_require_user() from public, anon, authenticated;
revoke execute on function public.shb_require_admin() from public, anon, authenticated;
revoke execute on function public.shb_handle_new_auth_user() from public, anon, authenticated;
revoke execute on function public.shb_handle_new_profile() from public, anon, authenticated;
revoke execute on function public.shb_sync_leaderboard() from public, anon, authenticated;
revoke execute on function public.shb_is_admin() from public, anon;
grant execute on function public.shb_is_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['wallets', 'leaderboard_entries', 'notifications', 'credit_requests', 'weekly_results'] loop
    if not exists (
      select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
