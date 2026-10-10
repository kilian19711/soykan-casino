-- Benutzer- und Admin-RPCs: Profil, Dashboard, Bonus, Credit-Anfragen, Spielzeit, Wochenabschluss.

-- ---------------------------------------------------------------------------
-- Konto / Profil
-- ---------------------------------------------------------------------------
create or replace function public.activate_my_account()
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_status text;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select status into v_status from public.profiles where id = v_uid for update;
  if v_status = 'invited' then
    update public.profiles set status = 'active', last_seen_at = now() where id = v_uid;
    return 'active';
  end if;
  update public.profiles set last_seen_at = now() where id = v_uid;
  return v_status;
end;
$$;

create or replace function public.update_my_profile(p_display_name text, p_avatar_seed text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.shb_require_user();
begin
  p_display_name := btrim(p_display_name);
  if p_display_name is null or char_length(p_display_name) < 1 or char_length(p_display_name) > 40 then
    raise exception 'INVALID_DISPLAY_NAME';
  end if;
  if p_avatar_seed is not null and char_length(p_avatar_seed) > 40 then
    raise exception 'INVALID_AVATAR_SEED';
  end if;
  perform public.shb_rate_limit(v_uid, 'profile_update', 10, 60);
  update public.profiles
     set display_name = p_display_name, avatar_seed = coalesce(nullif(btrim(p_avatar_seed), ''), avatar_seed)
   where id = v_uid;
end;
$$;

create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_count int;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  update public.notifications set read_at = now()
   where user_id = v_uid and read_at is null and (p_ids is null or id = any(p_ids));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Spielzeit
-- ---------------------------------------------------------------------------
-- Pro Benutzer existiert höchstens eine offene Session; mehrere Tabs teilen sich diese.
create or replace function public.start_game_session(p_user_agent_hash text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.shb_require_user();
  v_id uuid;
begin
  perform public.shb_rate_limit(v_uid, 'session_start', 30, 60);
  -- verwaiste Sessions schließen (kein Heartbeat seit > 2 Minuten)
  update public.game_sessions set ended_at = last_heartbeat_at
   where user_id = v_uid and ended_at is null and last_heartbeat_at < now() - interval '2 minutes';

  select id into v_id from public.game_sessions
   where user_id = v_uid and ended_at is null
   order by last_heartbeat_at desc limit 1 for update;
  if v_id is null then
    insert into public.game_sessions (user_id, started_at, last_heartbeat_at, user_agent_hash)
    values (v_uid, now(), now(), left(p_user_agent_hash, 64))
    returning id into v_id;
  else
    update public.game_sessions set last_heartbeat_at = now() where id = v_id;
  end if;
  update public.profiles set last_seen_at = now() where id = v_uid;
  return v_id;
end;
$$;

-- Zählt höchstens 45 Sekunden pro Heartbeat; längere Lücken (Hintergrund) zählen nicht.
create or replace function public.heartbeat_game_session(p_session_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.shb_require_user();
  v_row public.game_sessions;
  v_delta int;
begin
  select * into v_row from public.game_sessions where id = p_session_id and user_id = v_uid for update;
  if not found or v_row.ended_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'SESSION_CLOSED');
  end if;
  v_delta := greatest(0, floor(extract(epoch from (now() - v_row.last_heartbeat_at)))::int);
  if v_delta > 120 then
    update public.game_sessions set ended_at = v_row.last_heartbeat_at where id = v_row.id;
    return jsonb_build_object('ok', false, 'reason', 'SESSION_EXPIRED');
  end if;
  v_delta := least(v_delta, 45);
  update public.game_sessions
     set last_heartbeat_at = now(),
         duration_seconds = least(duration_seconds + v_delta, 86400)
   where id = v_row.id;
  update public.profiles set last_seen_at = now() where id = v_uid;
  return jsonb_build_object('ok', true, 'added', v_delta);
end;
$$;

create or replace function public.end_game_session(p_session_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return; end if;
  update public.game_sessions
     set duration_seconds = least(duration_seconds + least(greatest(0, floor(extract(epoch from (now() - last_heartbeat_at)))::int), 45), 86400),
         last_heartbeat_at = now(),
         ended_at = now()
   where id = p_session_id and user_id = v_uid and ended_at is null;
end;
$$;

create or replace function public.shb_playtime(p_user uuid, p_from timestamptz default null, p_to timestamptz default null)
returns integer language sql stable security definer set search_path = '' as $$
  select coalesce(sum(duration_seconds), 0)::int from public.game_sessions
   where user_id = p_user
     and (p_from is null or started_at >= p_from)
     and (p_to is null or started_at < p_to);
$$;

-- ---------------------------------------------------------------------------
-- Wochenbonus
-- ---------------------------------------------------------------------------
create or replace function public.claim_weekly_bonus(p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.shb_require_user();
  v_week text := public.shb_week_key(now());
  v_amount bigint := coalesce((public.shb_setting('weekly_bonus_amount') #>> '{}')::bigint, 1000);
  v_claim_id uuid;
  v_balance bigint;
begin
  perform public.shb_rate_limit(v_uid, 'bonus_claim', 10, 60);
  if v_amount <= 0 then raise exception 'BONUS_DISABLED'; end if;

  insert into public.bonus_claims (user_id, week_key, amount)
  values (v_uid, v_week, v_amount)
  on conflict (user_id, week_key) do nothing
  returning id into v_claim_id;

  if v_claim_id is null then
    raise exception 'BONUS_ALREADY_CLAIMED';
  end if;

  v_balance := public.shb_apply_ledger(v_uid, v_amount, 'weekly_bonus', 'Wochenbonus ' || v_week,
    'bonus_claim', v_claim_id, null, 'bonus:' || v_uid::text || ':' || v_week);

  perform public.shb_notify(v_uid, 'bonus', 'Wochenbonus abgeholt',
    '+' || v_amount || ' SHB-Credits wurden deinem Konto gutgeschrieben.', jsonb_build_object('week_key', v_week));

  return jsonb_build_object('amount', v_amount, 'balance', v_balance, 'week_key', v_week,
    'next_available_at', public.shb_week_end(now()));
end;
$$;

-- ---------------------------------------------------------------------------
-- Credit-Anfragen
-- ---------------------------------------------------------------------------
create or replace function public.request_credits(p_amount bigint, p_message text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.shb_require_user();
  v_id uuid;
  v_admin uuid;
  v_name text;
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
      v_name || ' fragt ' || p_amount || ' SHB-Credits an.', jsonb_build_object('request_id', v_id));
  end if;
  return v_id;
end;
$$;

create or replace function public.cancel_credit_request(p_request_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.shb_require_user();
begin
  update public.credit_requests set status = 'cancelled'
   where id = p_request_id and user_id = v_uid and status = 'pending';
  if not found then raise exception 'REQUEST_NOT_CANCELLABLE'; end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Leaderboard
-- ---------------------------------------------------------------------------
create or replace function public.get_leaderboard()
returns table (
  user_id uuid, username text, display_name text, avatar_seed text, balance bigint,
  week_change bigint, playtime_seconds integer, rounds_count bigint, bonus_claimed boolean, rank bigint
) language plpgsql stable security definer set search_path = '' as $$
declare
  v_prev_week text := public.shb_week_key(now() - interval '7 days');
  v_week text := public.shb_week_key(now());
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  return query
  select p.id, p.username, p.display_name, p.avatar_seed, l.balance,
         case when s.balance is null then null else l.balance - s.balance end,
         public.shb_playtime(p.id),
         (select count(*) from public.game_rounds r where r.user_id = p.id and r.status = 'settled'),
         exists (select 1 from public.bonus_claims b where b.user_id = p.id and b.week_key = v_week),
         rank() over (order by l.balance desc)
    from public.profiles p
    join public.leaderboard_entries l on l.user_id = p.id
    left join public.weekly_snapshots s on s.user_id = p.id and s.week_key = v_prev_week
   where p.status = 'active'
   order by l.balance desc, p.username asc;
end;
$$;

-- ---------------------------------------------------------------------------
-- Dashboard
-- ---------------------------------------------------------------------------
create or replace function public.get_dashboard_state()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_week text := public.shb_week_key(v_now);
  v_amount bigint := coalesce((public.shb_setting('weekly_bonus_amount') #>> '{}')::bigint, 1000);
  v_claimed boolean;
  v_balance bigint;
  v_rank bigint;
  v_last jsonb;
  v_lowest jsonb;
  v_profile jsonb;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select to_jsonb(p) - 'updated_at' into v_profile from public.profiles p where p.id = v_uid;
  select balance into v_balance from public.wallets where user_id = v_uid;
  select exists (select 1 from public.bonus_claims where user_id = v_uid and week_key = v_week) into v_claimed;

  select r.rnk into v_rank from (
    select l.user_id, rank() over (order by l.balance desc) as rnk
      from public.leaderboard_entries l join public.profiles p on p.id = l.user_id
     where p.status = 'active'
  ) r where r.user_id = v_uid;

  select jsonb_build_object(
      'week_key', w.week_key, 'loser_user_id', w.loser_user_id, 'loser_display_name', p.display_name,
      'loser_username', p.username, 'loser_balance', w.loser_balance, 'task_label', w.task_label,
      'finalized_at', w.finalized_at)
    into v_last
    from public.weekly_results w left join public.profiles p on p.id = w.loser_user_id
   order by w.finalized_at desc limit 1;

  select jsonb_build_object('user_id', p.id, 'display_name', p.display_name, 'username', p.username, 'balance', l.balance)
    into v_lowest
    from public.leaderboard_entries l join public.profiles p on p.id = l.user_id
   where p.status = 'active'
   order by l.balance asc, p.username asc limit 1;

  return jsonb_build_object(
    'server_now', v_now,
    'week_key', v_week,
    'week_start', public.shb_week_start(v_now),
    'week_end', public.shb_week_end(v_now),
    'profile', v_profile,
    'balance', coalesce(v_balance, 0),
    'rank', v_rank,
    'bonus', jsonb_build_object('amount', v_amount, 'claimed', v_claimed,
      'next_available_at', case when v_claimed then public.shb_week_end(v_now) else v_now end),
    'playtime_total', public.shb_playtime(v_uid),
    'playtime_week', public.shb_playtime(v_uid, public.shb_week_start(v_now), null),
    'last_weekly_result', v_last,
    'current_lowest', v_lowest,
    'task_label', coalesce(public.shb_setting('weekly_task_label') #>> '{}', 'Kasten mitbringen'),
    'unread_notifications', (select count(*) from public.notifications where user_id = v_uid and read_at is null),
    'pending_requests', (select count(*) from public.credit_requests where user_id = v_uid and status = 'pending')
  );
end;
$$;

create or replace function public.get_server_time()
returns timestamptz language sql stable set search_path = '' as $$ select now(); $$;

-- ---------------------------------------------------------------------------
-- Wochenabschluss
-- ---------------------------------------------------------------------------
create or replace function public.shb_finalize_week(p_week_start timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_start timestamptz := public.shb_week_start(p_week_start);
  v_end timestamptz := public.shb_week_end(p_week_start);
  v_key text := public.shb_week_key(p_week_start);
  v_label text := coalesce(public.shb_setting('weekly_task_label') #>> '{}', 'Kasten mitbringen');
  v_loser uuid;
  v_loser_balance bigint;
  v_loser_name text;
  v_result_id uuid;
begin
  -- Lock gegen parallele Ausführung derselben Woche
  perform pg_advisory_xact_lock(hashtext('finalize_week:' || v_key));

  if exists (select 1 from public.weekly_results where week_key = v_key) then
    return jsonb_build_object('week_key', v_key, 'already_finalized', true);
  end if;

  insert into public.weekly_snapshots (week_key, user_id, balance, playtime_seconds)
  select v_key, p.id, w.balance, public.shb_playtime(p.id, v_start, v_end)
    from public.profiles p join public.wallets w on w.user_id = p.id
   where p.status = 'active'
  on conflict (week_key, user_id) do nothing;

  -- Tie-Break: niedrigster Kontostand, längere Spielzeit, frühester Zeitpunkt des Erreichens, Benutzername
  select s.user_id, s.balance, p.display_name into v_loser, v_loser_balance, v_loser_name
    from public.weekly_snapshots s
    join public.profiles p on p.id = s.user_id
   where s.week_key = v_key
   order by s.balance asc,
            s.playtime_seconds desc,
            coalesce((select max(l.created_at) from public.credit_ledger l where l.user_id = s.user_id), p.created_at) asc,
            p.username asc
   limit 1;

  insert into public.weekly_results (week_key, loser_user_id, loser_balance, task_label)
  values (v_key, v_loser, coalesce(v_loser_balance, 0), v_label)
  on conflict (week_key) do nothing
  returning id into v_result_id;

  if v_result_id is not null then
    insert into public.notifications (user_id, type, title, message, metadata)
    select p.id, 'week_finalized', 'Wochenabschluss ' || v_key,
           case when v_loser is null then 'Die Woche wurde abgeschlossen.'
                when p.id = v_loser then 'Du hast diese Woche den niedrigsten Kontostand. Wochenaufgabe: ' || v_label
                else coalesce(v_loser_name, '?') || ' hat den niedrigsten Kontostand. Wochenaufgabe: ' || v_label end,
           jsonb_build_object('week_key', v_key, 'loser_user_id', v_loser)
      from public.profiles p where p.status = 'active';
  end if;

  return jsonb_build_object('week_key', v_key, 'already_finalized', v_result_id is null,
    'loser_user_id', v_loser, 'loser_balance', v_loser_balance);
end;
$$;

-- Für pg_cron: schließt die zuletzt beendete Woche ab, falls noch nicht geschehen. Idempotent.
create or replace function public.finalize_week()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_prev timestamptz := public.shb_week_start(now()) - interval '1 day';
begin
  -- Nur für Cron (postgres/service_role) gedacht; normale Benutzer haben kein EXECUTE-Recht.
  -- Wochen ohne jede Aktivität (z. B. vor dem Start der App) werden nicht automatisch abgeschlossen.
  if not exists (select 1 from public.credit_ledger
                  where created_at >= public.shb_week_start(v_prev) and created_at < public.shb_week_end(v_prev)) then
    return jsonb_build_object('skipped', true, 'reason', 'NO_ACTIVITY');
  end if;
  return public.shb_finalize_week(v_prev);
end;
$$;

create or replace function public.admin_finalize_week(p_current_week boolean default false, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := public.shb_require_admin();
  v_res jsonb;
begin
  if p_reason is null or char_length(btrim(p_reason)) < 3 then raise exception 'REASON_REQUIRED'; end if;
  perform public.shb_rate_limit(v_admin, 'admin_action', 60, 60);
  if p_current_week then
    v_res := public.shb_finalize_week(now());
  else
    v_res := public.shb_finalize_week(public.shb_week_start(now()) - interval '1 day');
  end if;
  perform public.shb_audit('finalize_week', null, v_res || jsonb_build_object('reason', p_reason, 'current_week', p_current_week));
  return v_res;
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin-Funktionen
-- ---------------------------------------------------------------------------
create or replace function public.admin_list_users()
returns table (
  id uuid, username text, display_name text, email text, role text, status text, balance bigint,
  playtime_seconds integer, rounds_count bigint, created_at timestamptz, last_seen_at timestamptz,
  invited_at timestamptz, email_confirmed_at timestamptz
) language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.shb_require_admin();
  return query
  select p.id, p.username, p.display_name, u.email::text, p.role, p.status, coalesce(w.balance, 0),
         public.shb_playtime(p.id),
         (select count(*) from public.game_rounds r where r.user_id = p.id),
         p.created_at, p.last_seen_at, u.invited_at, u.email_confirmed_at
    from public.profiles p
    left join auth.users u on u.id = p.id
    left join public.wallets w on w.user_id = p.id
   order by p.display_name;
end;
$$;

create or replace function public.admin_adjust_credits(p_user_id uuid, p_amount bigint, p_reason text, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := public.shb_require_admin();
  v_balance bigint;
  v_before bigint;
begin
  p_reason := btrim(p_reason);
  if p_amount is null or p_amount = 0 or abs(p_amount) > 100000000 then raise exception 'INVALID_AMOUNT'; end if;
  if p_reason is null or char_length(p_reason) < 3 then raise exception 'REASON_REQUIRED'; end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then raise exception 'USER_NOT_FOUND'; end if;
  perform public.shb_rate_limit(v_admin, 'admin_action', 60, 60);

  select balance into v_before from public.wallets where user_id = p_user_id;
  v_balance := public.shb_apply_ledger(p_user_id, p_amount,
    case when p_amount > 0 then 'admin_credit' else 'admin_debit' end,
    p_reason, 'admin_adjustment', null, v_admin, 'admin:' || p_idempotency_key);

  if v_balance <> v_before then
    perform public.shb_audit(case when p_amount > 0 then 'credit_grant' else 'credit_deduct' end, p_user_id,
      jsonb_build_object('amount', p_amount, 'reason', p_reason, 'balance_before', v_before, 'balance_after', v_balance));
    perform public.shb_notify(p_user_id, case when p_amount > 0 then 'admin_credit' else 'admin_debit' end,
      case when p_amount > 0 then 'Admin-Gutschrift' else 'Admin-Abzug' end,
      (case when p_amount > 0 then '+' else '' end) || p_amount || ' SHB-Credits – ' || p_reason,
      jsonb_build_object('amount', p_amount));
  end if;
  return jsonb_build_object('balance', v_balance);
end;
$$;

create or replace function public.admin_review_credit_request(p_request_id uuid, p_approve boolean, p_message text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := public.shb_require_admin();
  v_req public.credit_requests;
  v_balance bigint;
begin
  perform public.shb_rate_limit(v_admin, 'admin_action', 60, 60);
  select * into v_req from public.credit_requests where id = p_request_id for update;
  if not found then raise exception 'REQUEST_NOT_FOUND'; end if;
  if v_req.status <> 'pending' then raise exception 'REQUEST_ALREADY_REVIEWED'; end if;
  if not p_approve and (p_message is null or char_length(btrim(p_message)) < 3) then
    raise exception 'REASON_REQUIRED';
  end if;

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
    case when p_approve then '+' || v_req.amount || ' SHB-Credits wurden gutgeschrieben.'
         else 'Deine Anfrage über ' || v_req.amount || ' SHB-Credits wurde abgelehnt: ' || btrim(p_message) end,
    jsonb_build_object('request_id', v_req.id, 'amount', v_req.amount));
  return jsonb_build_object('status', case when p_approve then 'approved' else 'rejected' end, 'balance', v_balance);
end;
$$;

create or replace function public.admin_set_user_status(p_user_id uuid, p_status text, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := public.shb_require_admin();
  v_old text;
begin
  if p_status not in ('active', 'suspended') then raise exception 'INVALID_STATUS'; end if;
  if p_reason is null or char_length(btrim(p_reason)) < 3 then raise exception 'REASON_REQUIRED'; end if;
  if p_user_id = v_admin then raise exception 'CANNOT_CHANGE_SELF'; end if;
  perform public.shb_rate_limit(v_admin, 'admin_action', 60, 60);
  select status into v_old from public.profiles where id = p_user_id for update;
  if v_old is null then raise exception 'USER_NOT_FOUND'; end if;
  if v_old = 'invited' and p_status = 'active' then raise exception 'USER_NOT_YET_REGISTERED'; end if;
  update public.profiles set status = p_status where id = p_user_id;
  if p_status = 'suspended' then
    update public.game_sessions set ended_at = now() where user_id = p_user_id and ended_at is null;
  end if;
  perform public.shb_audit(case when p_status = 'suspended' then 'user_suspend' else 'user_unsuspend' end,
    p_user_id, jsonb_build_object('from', v_old, 'to', p_status, 'reason', p_reason));
end;
$$;

create or replace function public.admin_update_profile(p_user_id uuid, p_display_name text, p_username text, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := public.shb_require_admin();
  v_old jsonb;
begin
  if p_reason is null or char_length(btrim(p_reason)) < 3 then raise exception 'REASON_REQUIRED'; end if;
  if p_username !~ '^[A-Za-z0-9_.-]{2,24}$' then raise exception 'INVALID_USERNAME'; end if;
  if char_length(btrim(p_display_name)) not between 1 and 40 then raise exception 'INVALID_DISPLAY_NAME'; end if;
  if exists (select 1 from public.profiles where lower(username) = lower(p_username) and id <> p_user_id) then
    raise exception 'USERNAME_TAKEN';
  end if;
  select jsonb_build_object('username', username, 'display_name', display_name) into v_old from public.profiles where id = p_user_id;
  if v_old is null then raise exception 'USER_NOT_FOUND'; end if;
  update public.profiles set display_name = btrim(p_display_name), username = p_username where id = p_user_id;
  perform public.shb_audit('profile_update', p_user_id,
    jsonb_build_object('before', v_old, 'after', jsonb_build_object('username', p_username, 'display_name', btrim(p_display_name)), 'reason', p_reason));
end;
$$;

create or replace function public.admin_update_game_config(p_game_key text, p_enabled boolean, p_config jsonb, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := public.shb_require_admin();
  v_old public.game_configs;
  v_min bigint; v_max bigint;
begin
  if p_reason is null or char_length(btrim(p_reason)) < 3 then raise exception 'REASON_REQUIRED'; end if;
  select * into v_old from public.game_configs where game_key = p_game_key for update;
  if not found then raise exception 'GAME_NOT_FOUND'; end if;
  if p_enabled and not coalesce((v_old.config ->> 'implemented')::boolean, false) then
    raise exception 'GAME_NOT_IMPLEMENTED';
  end if;
  p_config := coalesce(p_config, v_old.config);
  v_min := (p_config ->> 'min_bet')::bigint;
  v_max := (p_config ->> 'max_bet')::bigint;
  if v_min is null or v_max is null or v_min < 1 or v_max < v_min or v_max > 10000000 then
    raise exception 'INVALID_LIMITS';
  end if;
  -- 'implemented' darf nicht über die UI verändert werden
  p_config := jsonb_set(p_config, '{implemented}', coalesce(v_old.config -> 'implemented', 'false'::jsonb));
  update public.game_configs set enabled = p_enabled, config = p_config, updated_by = v_admin, updated_at = now()
   where game_key = p_game_key;
  perform public.shb_audit('game_config_update', null,
    jsonb_build_object('game_key', p_game_key, 'enabled', p_enabled, 'before', v_old.config, 'after', p_config, 'reason', p_reason));
end;
$$;

create or replace function public.admin_update_setting(p_key text, p_value jsonb, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := public.shb_require_admin();
  v_old jsonb;
begin
  if p_reason is null or char_length(btrim(p_reason)) < 3 then raise exception 'REASON_REQUIRED'; end if;
  if p_key not in ('weekly_bonus_amount', 'weekly_task_label', 'confetti_enabled') then raise exception 'SETTING_NOT_EDITABLE'; end if;
  if p_key = 'weekly_bonus_amount' and ((p_value #>> '{}')::bigint < 0 or (p_value #>> '{}')::bigint > 1000000) then
    raise exception 'INVALID_VALUE';
  end if;
  if p_key = 'weekly_task_label' and char_length(p_value #>> '{}') not between 3 and 60 then
    raise exception 'INVALID_VALUE';
  end if;
  select value into v_old from public.app_settings where key = p_key;
  insert into public.app_settings (key, value, updated_by, updated_at) values (p_key, p_value, v_admin, now())
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();
  perform public.shb_audit('setting_update', null, jsonb_build_object('key', p_key, 'before', v_old, 'after', p_value, 'reason', p_reason));
end;
$$;

create or replace function public.admin_get_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_last jsonb;
begin
  perform public.shb_require_admin();
  select jsonb_build_object('week_key', w.week_key, 'loser_display_name', p.display_name, 'loser_balance', w.loser_balance,
                            'finalized_at', w.finalized_at, 'task_label', w.task_label)
    into v_last
    from public.weekly_results w left join public.profiles p on p.id = w.loser_user_id
   order by w.finalized_at desc limit 1;
  return jsonb_build_object(
    'server_now', now(),
    'week_key', public.shb_week_key(now()),
    'week_end', public.shb_week_end(now()),
    'active_users', (select count(*) from public.profiles where status = 'active'),
    'invited_users', (select count(*) from public.profiles where status = 'invited'),
    'suspended_users', (select count(*) from public.profiles where status = 'suspended'),
    'total_credits', (select coalesce(sum(balance), 0) from public.wallets),
    'open_requests', (select count(*) from public.credit_requests where status = 'pending'),
    'live_sessions', (select count(*) from public.game_sessions where ended_at is null and last_heartbeat_at > now() - interval '2 minutes'),
    'rounds_today', (select count(*) from public.game_rounds where started_at > now() - interval '24 hours'),
    'stale_active_rounds', (select count(*) from public.game_rounds where status = 'active' and started_at < now() - interval '1 day'),
    'last_weekly_result', v_last,
    'previous_week_finalized', exists (select 1 from public.weekly_results
                                        where week_key = public.shb_week_key(public.shb_week_start(now()) - interval '1 day')),
    'cron_enabled', exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron')
  );
end;
$$;

-- Wird von der Edge Function admin-invite-user (Service Role) genutzt, um Audit-Einträge mit Akteur zu schreiben.
create or replace function public.shb_service_audit(p_actor uuid, p_action text, p_target uuid, p_metadata jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_logs (actor_id, action, target_user_id, metadata)
  values (p_actor, p_action, p_target, coalesce(p_metadata, '{}'::jsonb));
$$;

-- Funktionsrechte werden zentral in 20261008000005_seed_grants_cron.sql vergeben.
