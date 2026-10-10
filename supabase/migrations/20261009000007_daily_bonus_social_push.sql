-- Tagesbonus, Ankündigungen (Bonus verfügbar, 10/18 Uhr), Push-Benachrichtigungen,
-- Erfolge/Abzeichen, Live-Feed (große Gewinne), Wochen-Rückblick. Texte: "Credits".

create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------------------
-- Tagesbonus (ersetzt den Wochenbonus). Periode = Kalendertag Europe/Berlin, Schlüssel 'D2026-10-09'.
-- bonus_claims.week_key bleibt als Spaltenname bestehen und enthält jetzt den Perioden-Schlüssel.
-- ---------------------------------------------------------------------------
create or replace function public.shb_day_key(p_ts timestamptz default now())
returns text language sql stable set search_path = '' as $$
  select 'D' || to_char(p_ts at time zone 'Europe/Berlin', 'YYYY-MM-DD');
$$;

create or replace function public.shb_day_end(p_ts timestamptz default now())
returns timestamptz language sql stable set search_path = '' as $$
  select (date_trunc('day', p_ts at time zone 'Europe/Berlin') + interval '1 day') at time zone 'Europe/Berlin';
$$;

insert into public.app_settings (key, value) values ('daily_bonus_amount', '250') on conflict (key) do nothing;

create or replace function public.claim_weekly_bonus(p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.shb_require_user();
  v_day text := public.shb_day_key(now());
  v_amount bigint := coalesce((public.shb_setting('daily_bonus_amount') #>> '{}')::bigint, 250);
  v_claim_id uuid;
  v_balance bigint;
begin
  perform public.shb_rate_limit(v_uid, 'bonus_claim', 10, 60);
  if v_amount <= 0 then raise exception 'BONUS_DISABLED'; end if;
  insert into public.bonus_claims (user_id, week_key, amount)
  values (v_uid, v_day, v_amount)
  on conflict (user_id, week_key) do nothing
  returning id into v_claim_id;
  if v_claim_id is null then raise exception 'BONUS_ALREADY_CLAIMED'; end if;
  v_balance := public.shb_apply_ledger(v_uid, v_amount, 'weekly_bonus', 'Tagesbonus ' || substr(v_day, 2),
    'bonus_claim', v_claim_id, null, 'bonus:' || v_uid::text || ':' || v_day);
  return jsonb_build_object('amount', v_amount, 'balance', v_balance, 'day_key', v_day,
    'next_available_at', public.shb_day_end(now()));
end;
$$;

-- Dashboard: Bonus jetzt täglich
create or replace function public.get_dashboard_state()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_week text := public.shb_week_key(v_now);
  v_amount bigint := coalesce((public.shb_setting('daily_bonus_amount') #>> '{}')::bigint, 250);
  v_claimed boolean; v_balance bigint; v_rank bigint; v_last jsonb; v_lowest jsonb; v_profile jsonb;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select to_jsonb(p) - 'updated_at' into v_profile from public.profiles p where p.id = v_uid;
  select balance into v_balance from public.wallets where user_id = v_uid;
  select exists (select 1 from public.bonus_claims where user_id = v_uid and week_key = public.shb_day_key(v_now)) into v_claimed;
  select r.rnk into v_rank from (
    select l.user_id, rank() over (order by l.balance desc) as rnk
      from public.leaderboard_entries l join public.profiles p on p.id = l.user_id where p.status = 'active'
  ) r where r.user_id = v_uid;
  select jsonb_build_object('week_key', w.week_key, 'loser_user_id', w.loser_user_id, 'loser_display_name', p.display_name,
      'loser_username', p.username, 'loser_balance', w.loser_balance, 'task_label', w.task_label, 'finalized_at', w.finalized_at)
    into v_last from public.weekly_results w left join public.profiles p on p.id = w.loser_user_id
   order by w.finalized_at desc limit 1;
  select jsonb_build_object('user_id', p.id, 'display_name', p.display_name, 'username', p.username, 'balance', l.balance)
    into v_lowest from public.leaderboard_entries l join public.profiles p on p.id = l.user_id
   where p.status = 'active' order by l.balance asc, p.username asc limit 1;
  return jsonb_build_object(
    'server_now', v_now, 'week_key', v_week,
    'week_start', public.shb_week_start(v_now), 'week_end', public.shb_week_end(v_now),
    'profile', v_profile, 'balance', coalesce(v_balance, 0), 'rank', v_rank,
    'bonus', jsonb_build_object('amount', v_amount, 'claimed', v_claimed, 'period', 'day',
      'next_available_at', case when v_claimed then public.shb_day_end(v_now) else v_now end),
    'playtime_total', public.shb_playtime(v_uid),
    'playtime_week', public.shb_playtime(v_uid, public.shb_week_start(v_now), null),
    'last_weekly_result', v_last, 'current_lowest', v_lowest,
    'task_label', coalesce(public.shb_setting('weekly_task_label') #>> '{}', 'Kasten mitbringen'),
    'unread_notifications', (select count(*) from public.notifications where user_id = v_uid and read_at is null),
    'pending_requests', (select count(*) from public.credit_requests where user_id = v_uid and status = 'pending')
  );
end;
$$;

-- Leaderboard: Bonusstatus des heutigen Tages
create or replace function public.get_leaderboard()
returns table (
  user_id uuid, username text, display_name text, avatar_seed text, balance bigint,
  week_change bigint, playtime_seconds integer, rounds_count bigint, bonus_claimed boolean, rank bigint
) language plpgsql stable security definer set search_path = '' as $$
declare v_prev_week text := public.shb_week_key(now() - interval '7 days'); v_day text := public.shb_day_key(now());
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  return query
  select p.id, p.username, p.display_name, p.avatar_seed, l.balance,
         case when s.balance is null then null else l.balance - s.balance end,
         public.shb_playtime(p.id),
         (select count(*) from public.game_rounds r where r.user_id = p.id and r.status = 'settled'),
         exists (select 1 from public.bonus_claims b where b.user_id = p.id and b.week_key = v_day),
         rank() over (order by l.balance desc)
    from public.profiles p
    join public.leaderboard_entries l on l.user_id = p.id
    left join public.weekly_snapshots s on s.user_id = p.id and s.week_key = v_prev_week
   where p.status = 'active'
   order by l.balance desc, p.username asc;
end;
$$;

-- ---------------------------------------------------------------------------
-- Texte: "Credits" statt "SHB-Credits"
-- ---------------------------------------------------------------------------
create or replace function public.request_credits(p_amount bigint, p_message text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.shb_require_user(); v_id uuid; v_admin uuid; v_name text;
begin
  p_message := btrim(p_message);
  if p_amount is null or p_amount <= 0 or p_amount > 1000000 then raise exception 'INVALID_AMOUNT'; end if;
  if p_message is null or char_length(p_message) < 3 or char_length(p_message) > 500 then raise exception 'INVALID_MESSAGE'; end if;
  perform public.shb_rate_limit(v_uid, 'credit_request', 5, 3600);
  if (select count(*) from public.credit_requests where user_id = v_uid and status = 'pending') >= 3 then
    raise exception 'TOO_MANY_PENDING_REQUESTS';
  end if;
  insert into public.credit_requests (user_id, amount, message) values (v_uid, p_amount, p_message) returning id into v_id;
  select id into v_admin from public.profiles where role = 'admin' limit 1;
  select display_name into v_name from public.profiles where id = v_uid;
  if v_admin is not null then
    perform public.shb_notify(v_admin, 'credit_request_new', 'Neue Credit-Anfrage',
      v_name || ' fragt ' || p_amount || ' Credits an.', jsonb_build_object('request_id', v_id));
  end if;
  return v_id;
end;
$$;

create or replace function public.admin_adjust_credits(p_user_id uuid, p_amount bigint, p_reason text, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_admin uuid := public.shb_require_admin(); v_balance bigint; v_before bigint;
begin
  p_reason := btrim(p_reason);
  if p_amount is null or p_amount = 0 or abs(p_amount) > 100000000 then raise exception 'INVALID_AMOUNT'; end if;
  if p_reason is null or char_length(p_reason) < 3 then raise exception 'REASON_REQUIRED'; end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then raise exception 'USER_NOT_FOUND'; end if;
  perform public.shb_rate_limit(v_admin, 'admin_action', 60, 60);
  select balance into v_before from public.wallets where user_id = p_user_id;
  v_balance := public.shb_apply_ledger(p_user_id, p_amount, case when p_amount > 0 then 'admin_credit' else 'admin_debit' end,
    p_reason, 'admin_adjustment', null, v_admin, 'admin:' || p_idempotency_key);
  if v_balance <> v_before then
    perform public.shb_audit(case when p_amount > 0 then 'credit_grant' else 'credit_deduct' end, p_user_id,
      jsonb_build_object('amount', p_amount, 'reason', p_reason, 'balance_before', v_before, 'balance_after', v_balance));
    perform public.shb_notify(p_user_id, case when p_amount > 0 then 'admin_credit' else 'admin_debit' end,
      case when p_amount > 0 then 'Gutschrift' else 'Abzug' end,
      (case when p_amount > 0 then '+' else '' end) || p_amount || ' Credits – ' || p_reason, jsonb_build_object('amount', p_amount));
  end if;
  return jsonb_build_object('balance', v_balance);
end;
$$;

create or replace function public.admin_review_credit_request(p_request_id uuid, p_approve boolean, p_message text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_admin uuid := public.shb_require_admin(); v_req public.credit_requests; v_balance bigint;
begin
  perform public.shb_rate_limit(v_admin, 'admin_action', 60, 60);
  select * into v_req from public.credit_requests where id = p_request_id for update;
  if not found then raise exception 'REQUEST_NOT_FOUND'; end if;
  if v_req.status <> 'pending' then raise exception 'REQUEST_ALREADY_REVIEWED'; end if;
  if not p_approve and (p_message is null or char_length(btrim(p_message)) < 3) then raise exception 'REASON_REQUIRED'; end if;
  update public.credit_requests
     set status = case when p_approve then 'approved' else 'rejected' end,
         reviewed_by = v_admin, reviewed_at = now(), review_message = nullif(btrim(p_message), '')
   where id = p_request_id;
  if p_approve then
    v_balance := public.shb_apply_ledger(v_req.user_id, v_req.amount, 'credit_request',
      'Credit-Anfrage genehmigt' || coalesce(': ' || nullif(btrim(p_message), ''), ''),
      'credit_request', v_req.id, v_admin, 'credit_request:' || v_req.id::text);
  end if;
  perform public.shb_audit(case when p_approve then 'credit_request_approve' else 'credit_request_reject' end,
    v_req.user_id, jsonb_build_object('request_id', v_req.id, 'amount', v_req.amount, 'message', p_message));
  perform public.shb_notify(v_req.user_id,
    case when p_approve then 'credit_request_approved' else 'credit_request_rejected' end,
    case when p_approve then 'Credit-Anfrage genehmigt' else 'Credit-Anfrage abgelehnt' end,
    case when p_approve then '+' || v_req.amount || ' Credits wurden gutgeschrieben.'
         else 'Deine Anfrage über ' || v_req.amount || ' Credits wurde abgelehnt: ' || btrim(p_message) end,
    jsonb_build_object('request_id', v_req.id, 'amount', v_req.amount));
  return jsonb_build_object('status', case when p_approve then 'approved' else 'rejected' end, 'balance', v_balance);
end;
$$;

-- ---------------------------------------------------------------------------
-- Ankündigungen: Tagesbonus verfügbar (00:00) und Erinnerungen 10:00 / 18:00 (Europe/Berlin)
-- Idempotent über announcement_log (eine Ankündigung pro Typ und Tag).
-- ---------------------------------------------------------------------------
create table if not exists public.announcement_log (
  kind text not null,
  day_key text not null,
  sent_at timestamptz not null default now(),
  primary key (kind, day_key)
);
alter table public.announcement_log enable row level security;

create or replace function public.shb_announce(p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := p_now;
  v_hour int := extract(hour from v_now at time zone 'Europe/Berlin')::int;
  v_day text := public.shb_day_key(v_now);
  v_amount bigint := coalesce((public.shb_setting('daily_bonus_amount') #>> '{}')::bigint, 250);
  v_kind text; v_title text; v_msg text; v_n int := 0;
begin
  if v_hour = 0 then
    v_kind := 'bonus_ready'; v_title := 'Dein Tagesbonus ist da';
    v_msg := '+' || v_amount || ' Credits warten auf dich – jetzt abholen!';
  elsif v_hour = 10 then
    v_kind := 'reminder_10'; v_title := 'Die Spiele warten auf dich';
    v_msg := 'Guten Morgen! Hol dir deinen Tagesbonus und dreh eine Runde.';
  elsif v_hour = 18 then
    v_kind := 'reminder_18'; v_title := 'Feierabend im Casino';
    v_msg := 'Die Spiele warten auf dich – heute schon dein Glück versucht?';
  else
    return jsonb_build_object('skipped', true);
  end if;
  insert into public.announcement_log (kind, day_key) values (v_kind, v_day) on conflict do nothing;
  if not found then return jsonb_build_object('skipped', true, 'reason', 'already_sent'); end if;

  insert into public.notifications (user_id, type, title, message, metadata)
  select p.id, 'announcement', v_title,
         case when v_kind <> 'bonus_ready' and exists (select 1 from public.bonus_claims b where b.user_id = p.id and b.week_key = v_day)
              then 'Die Spiele warten auf dich – schau mal wieder rein!' else v_msg end,
         jsonb_build_object('kind', v_kind)
    from public.profiles p
   where p.status = 'active'
     and coalesce((p.preferences ->> 'announcements')::boolean, true);
  get diagnostics v_n = row_count;
  return jsonb_build_object('kind', v_kind, 'sent', v_n);
end;
$$;

-- Benutzer-Einstellungen (Ankündigungen, Feed sichtbar, Push)
alter table public.profiles add column if not exists preferences jsonb not null default '{}'::jsonb;

create or replace function public.update_my_preferences(p_prefs jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.shb_require_user(); v_clean jsonb := '{}'::jsonb; k text;
begin
  foreach k in array array['announcements', 'show_feed', 'push'] loop
    if p_prefs ? k then v_clean := v_clean || jsonb_build_object(k, (p_prefs ->> k)::boolean); end if;
  end loop;
  update public.profiles set preferences = preferences || v_clean where id = v_uid;
  return (select preferences from public.profiles where id = v_uid);
end;
$$;

-- ---------------------------------------------------------------------------
-- Push-Benachrichtigungen (Web Push). Abos pro Gerät; Versand über Edge Function push-dispatch.
-- ---------------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text unique not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  last_error text
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
drop policy if exists push_subscriptions_select on public.push_subscriptions;
create policy push_subscriptions_select on public.push_subscriptions for select to authenticated using (user_id = (select auth.uid()));

alter table public.notifications add column if not exists pushed_at timestamptz;
create index if not exists notifications_push_idx on public.notifications (created_at) where pushed_at is null;

create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.shb_require_user();
begin
  if p_endpoint !~ '^https://' or char_length(p_endpoint) > 1000 or char_length(p_p256dh) > 200 or char_length(p_auth) > 100 then
    raise exception 'INVALID_PARAMS';
  end if;
  perform public.shb_rate_limit(v_uid, 'push_subscribe', 20, 3600);
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values (v_uid, p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, last_error = null;
  update public.profiles set preferences = preferences || '{"push":true}'::jsonb where id = v_uid;
end;
$$;

create or replace function public.delete_push_subscription(p_endpoint text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.shb_require_user();
begin
  delete from public.push_subscriptions where user_id = v_uid and (p_endpoint is null or endpoint = p_endpoint);
  if not exists (select 1 from public.push_subscriptions where user_id = v_uid) then
    update public.profiles set preferences = preferences || '{"push":false}'::jsonb where id = v_uid;
  end if;
end;
$$;

-- Privater Konfigurationsspeicher (nur Service-Role/Postgres): VAPID-Schlüssel, Dispatch-Secret
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table if not exists private.config (key text primary key, value text not null);

-- Ruft die Edge Function push-dispatch auf (pg_net, asynchron). Nur wenn Konfiguration vorhanden.
create or replace function public.shb_dispatch_push()
returns void language plpgsql security definer set search_path = '' as $$
declare v_url text; v_secret text;
begin
  select value into v_url from private.config where key = 'push_dispatch_url';
  select value into v_secret from private.config where key = 'push_dispatch_secret';
  if v_url is null or v_secret is null then return; end if;
  if not exists (select 1 from public.notifications where pushed_at is null and created_at > now() - interval '15 minutes') then return; end if;
  perform net.http_post(url := v_url, headers := jsonb_build_object('Content-Type', 'application/json', 'x-dispatch-secret', v_secret),
    body := '{}'::jsonb, timeout_milliseconds := 20000);
end;
$$;

-- ---------------------------------------------------------------------------
-- Erfolge / Abzeichen
-- ---------------------------------------------------------------------------
create table if not exists public.achievements (
  user_id uuid not null references public.profiles(id) on delete cascade,
  key text not null,
  unlocked_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  primary key (user_id, key)
);
alter table public.achievements enable row level security;
drop policy if exists achievements_select on public.achievements;
create policy achievements_select on public.achievements for select to authenticated using (true);

create or replace function public.shb_unlock(p_user uuid, p_key text, p_title text, p_meta jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.achievements (user_id, key, metadata) values (p_user, p_key, p_meta) on conflict do nothing;
  if found then
    perform public.shb_notify(p_user, 'achievement', 'Erfolg freigeschaltet: ' || p_title, 'Neues Abzeichen in deinem Profil.',
      jsonb_build_object('key', p_key));
  end if;
end;
$$;

create or replace function public.shb_round_achievements()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_cnt bigint; v_ratio numeric; v_losses int; v_games int;
begin
  if new.status <> 'settled' or old.status = 'settled' then return new; end if;
  v_ratio := case when new.bet_amount > 0 then new.payout_amount::numeric / new.bet_amount else 0 end;
  select count(*) into v_cnt from public.game_rounds where user_id = new.user_id and status = 'settled';
  if v_cnt = 1 then perform public.shb_unlock(new.user_id, 'first_round', 'Erste Runde'); end if;
  if v_cnt = 100 then perform public.shb_unlock(new.user_id, 'rounds_100', '100 Runden'); end if;
  if v_cnt = 1000 then perform public.shb_unlock(new.user_id, 'rounds_1000', '1.000 Runden'); end if;
  if new.payout_amount > new.bet_amount then perform public.shb_unlock(new.user_id, 'first_win', 'Erster Gewinn'); end if;
  if v_ratio >= 10 then perform public.shb_unlock(new.user_id, 'win_10x', '10×-Gewinn'); end if;
  if v_ratio >= 100 then perform public.shb_unlock(new.user_id, 'win_100x', '100×-Gewinn'); end if;
  if new.profit_amount >= 10000 then perform public.shb_unlock(new.user_id, 'profit_10k', '+10.000 in einer Runde'); end if;
  if new.game_key = 'blackjack' and new.result -> 'hands' -> 0 ->> 'outcome' = 'blackjack' then
    perform public.shb_unlock(new.user_id, 'blackjack', 'Blackjack!');
  end if;
  if new.game_key = 'shisha_diamonds' and (new.result ->> 'feature')::boolean then
    perform public.shb_unlock(new.user_id, 'diamond_feature', 'Diamantenregen');
  end if;
  select count(*) into v_losses from (
    select payout_amount from public.game_rounds where user_id = new.user_id and status = 'settled'
     order by completed_at desc limit 10) t where payout_amount = 0;
  if v_losses = 10 then perform public.shb_unlock(new.user_id, 'loss_streak_10', 'Pechsträhne (10 Verluste in Folge)'); end if;
  select count(distinct game_key) into v_games from public.game_rounds where user_id = new.user_id and status = 'settled';
  if v_games >= 10 then perform public.shb_unlock(new.user_id, 'explorer_10', 'Entdecker (10 Spiele)'); end if;
  if v_games >= 25 then perform public.shb_unlock(new.user_id, 'explorer_25', 'Weltenbummler (25 Spiele)'); end if;
  return new;
end;
$$;
drop trigger if exists on_round_settled_achievements on public.game_rounds;
create trigger on_round_settled_achievements after update of status on public.game_rounds
  for each row execute function public.shb_round_achievements();

create or replace function public.shb_week_achievements()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_cnt int;
begin
  if new.loser_user_id is null then return new; end if;
  select count(*) into v_cnt from public.weekly_results where loser_user_id = new.loser_user_id;
  if v_cnt >= 1 then perform public.shb_unlock(new.loser_user_id, 'kasten_1', 'Kastenträger'); end if;
  if v_cnt >= 3 then perform public.shb_unlock(new.loser_user_id, 'kasten_3', 'Kasten-König (3×)'); end if;
  return new;
end;
$$;
drop trigger if exists on_week_result_achievements on public.weekly_results;
create trigger on_week_result_achievements after insert on public.weekly_results
  for each row execute function public.shb_week_achievements();

-- ---------------------------------------------------------------------------
-- Live-Feed: große Gewinne der letzten 24 h (nur Name, Spiel, Multiplikator, Gewinn)
-- ---------------------------------------------------------------------------
create or replace function public.get_big_wins(p_limit int default 20)
returns table (round_id uuid, display_name text, avatar_seed text, game_key text, multiplier numeric, profit bigint, completed_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select r.id, p.display_name, p.avatar_seed, r.game_key, round(r.payout_amount::numeric / r.bet_amount, 2), r.profit_amount, r.completed_at
    from public.game_rounds r join public.profiles p on p.id = r.user_id
   where auth.uid() is not null and r.status = 'settled' and r.completed_at > now() - interval '24 hours'
     and r.payout_amount >= r.bet_amount * 5 and r.profit_amount >= 200
   order by r.completed_at desc
   limit least(greatest(p_limit, 1), 50);
$$;

-- ---------------------------------------------------------------------------
-- Wochen-Rückblick (laufende oder angegebene Woche)
-- ---------------------------------------------------------------------------
create or replace function public.get_week_recap(p_offset_weeks int default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_ref timestamptz := now() - make_interval(weeks => greatest(0, least(p_offset_weeks, 52)));
  v_start timestamptz := public.shb_week_start(v_ref); v_end timestamptz := public.shb_week_end(v_ref);
  v_res jsonb;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  with r as (
    select r.*, p.display_name from public.game_rounds r join public.profiles p on p.id = r.user_id
     where r.status = 'settled' and r.completed_at >= v_start and r.completed_at < v_end
  )
  select jsonb_build_object(
    'week_key', public.shb_week_key(v_ref), 'week_start', v_start, 'week_end', v_end,
    'rounds', (select count(*) from r),
    'wagered', (select coalesce(sum(bet_amount), 0) from r),
    'biggest_win', (select jsonb_build_object('display_name', display_name, 'game_key', game_key, 'profit', profit_amount,
                      'multiplier', round(payout_amount::numeric / bet_amount, 2)) from r order by profit_amount desc limit 1),
    'biggest_multiplier', (select jsonb_build_object('display_name', display_name, 'game_key', game_key,
                      'multiplier', round(payout_amount::numeric / bet_amount, 2)) from r where payout_amount > 0
                      order by payout_amount::numeric / bet_amount desc limit 1),
    'biggest_loss', (select jsonb_build_object('display_name', display_name, 'game_key', game_key, 'loss', -profit_amount)
                      from r order by profit_amount asc limit 1),
    'top_game', (select jsonb_build_object('game_key', game_key, 'rounds', count(*)) from r group by game_key order by count(*) desc limit 1),
    'most_rounds', (select jsonb_build_object('display_name', display_name, 'rounds', count(*)) from r group by display_name order by count(*) desc limit 1),
    'best_week', (select jsonb_build_object('display_name', display_name, 'profit', sum(profit_amount)) from r group by display_name order by sum(profit_amount) desc limit 1),
    'longest_playtime', (select jsonb_build_object('display_name', p.display_name, 'seconds', sum(s.duration_seconds))
                      from public.game_sessions s join public.profiles p on p.id = s.user_id
                     where s.started_at >= v_start and s.started_at < v_end group by p.display_name order by sum(s.duration_seconds) desc limit 1)
  ) into v_res;
  return v_res;
end;
$$;

-- ---------------------------------------------------------------------------
-- Cron: Ankündigungen stündlich zur vollen Stunde (+1 min), Push-Versand minütlich
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from cron.job where jobname = 'shb_announce') then perform cron.unschedule('shb_announce'); end if;
  if exists (select 1 from cron.job where jobname = 'shb_push') then perform cron.unschedule('shb_push'); end if;
  perform cron.schedule('shb_announce', '1 * * * *', 'select public.shb_announce();');
  perform cron.schedule('shb_push', '* * * * *', 'select public.shb_dispatch_push();');
end $$;

-- ---------------------------------------------------------------------------
-- Rechte (neue RPCs)
-- ---------------------------------------------------------------------------
revoke execute on function public.shb_announce(timestamptz), public.shb_dispatch_push(), public.shb_unlock(uuid, text, text, jsonb),
  public.shb_round_achievements(), public.shb_week_achievements(), public.shb_day_key(timestamptz), public.shb_day_end(timestamptz)
  from public, anon, authenticated;
grant execute on function public.update_my_preferences(jsonb), public.save_push_subscription(text, text, text),
  public.delete_push_subscription(text), public.get_big_wins(int), public.get_week_recap(int) to authenticated;
do $$
declare t text;
begin
  foreach t in array array['achievements'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Push-Versand: nur für die Edge Function (Service-Role)
-- ---------------------------------------------------------------------------
create or replace function public.shb_push_batch(p_secret text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_ok boolean; v_items jsonb;
begin
  select exists (select 1 from private.config where key = 'push_dispatch_secret' and value = p_secret) into v_ok;
  if not v_ok then raise exception 'FORBIDDEN'; end if;
  with pending as (
    select n.id, n.user_id, n.title, n.message, n.type from public.notifications n
     where n.pushed_at is null and n.created_at > now() - interval '15 minutes'
     order by n.created_at limit 200
     for update skip locked
  ), marked as (
    update public.notifications n set pushed_at = now() from pending where n.id = pending.id returning pending.*
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'title', m.title, 'message', m.message, 'type', m.type,
           'subs', (select coalesce(jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)), '[]'::jsonb)
                      from public.push_subscriptions s where s.user_id = m.user_id))), '[]'::jsonb)
    into v_items from marked m;
  return jsonb_build_object('items', v_items,
    'vapid_public', (select value from private.config where key = 'vapid_public'),
    'vapid_private', (select value from private.config where key = 'vapid_private'),
    'vapid_subject', coalesce((select value from private.config where key = 'vapid_subject'), 'mailto:admin@example.com'));
end;
$$;

create or replace function public.shb_push_gone(p_secret text, p_endpoints text[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from private.config where key = 'push_dispatch_secret' and value = p_secret) then raise exception 'FORBIDDEN'; end if;
  delete from public.push_subscriptions where endpoint = any(p_endpoints);
end;
$$;

-- Öffentlicher VAPID-Schlüssel für den Browser
create or replace function public.get_push_public_key()
returns text language sql stable security definer set search_path = '' as $$
  select value from private.config where key = 'vapid_public' and auth.uid() is not null;
$$;

revoke execute on function public.shb_push_batch(text), public.shb_push_gone(text, text[]) from public, anon, authenticated;
grant execute on function public.shb_push_batch(text), public.shb_push_gone(text, text[]) to service_role;
grant execute on function public.get_push_public_key() to authenticated;

-- Admin darf den Tagesbonus konfigurieren
create or replace function public.admin_update_setting(p_key text, p_value jsonb, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_admin uuid := public.shb_require_admin(); v_old jsonb;
begin
  if p_reason is null or char_length(btrim(p_reason)) < 3 then raise exception 'REASON_REQUIRED'; end if;
  if p_key not in ('daily_bonus_amount', 'weekly_bonus_amount', 'weekly_task_label', 'confetti_enabled') then raise exception 'SETTING_NOT_EDITABLE'; end if;
  if p_key in ('daily_bonus_amount', 'weekly_bonus_amount') and ((p_value #>> '{}')::bigint < 0 or (p_value #>> '{}')::bigint > 1000000) then
    raise exception 'INVALID_VALUE';
  end if;
  if p_key = 'weekly_task_label' and char_length(p_value #>> '{}') not between 3 and 60 then raise exception 'INVALID_VALUE'; end if;
  select value into v_old from public.app_settings where key = p_key;
  insert into public.app_settings (key, value, updated_by, updated_at) values (p_key, p_value, v_admin, now())
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();
  perform public.shb_audit('setting_update', null, jsonb_build_object('key', p_key, 'before', v_old, 'after', p_value, 'reason', p_reason));
end;
$$;
