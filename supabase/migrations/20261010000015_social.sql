-- Migration 15: Soziales – Credits verschenken, Duelle unter Freunden, Kasten-Prognose.
-- Nur neue Tabellen/Funktionen/Trigger; bestehende Spiel-Funktionen bleiben unverändert.

insert into public.app_settings (key, value) values
  ('gift_daily_limit', '5000'),       -- max. verschenkte Credits pro Spieler und Tag
  ('duel_max_stake', '5000'),
  ('prediction_reward', '500')        -- Belohnung für richtigen Kasten-Tipp
on conflict (key) do nothing;

alter table public.credit_ledger drop constraint if exists credit_ledger_entry_type_check;
alter table public.credit_ledger add constraint credit_ledger_entry_type_check check (entry_type in (
  'weekly_bonus', 'game_bet', 'game_payout', 'admin_credit', 'admin_debit', 'credit_request', 'achievement_reward', 'quest_reward',
  'gift_sent', 'gift_received', 'duel_stake', 'duel_payout', 'duel_refund', 'prediction_reward'
));

-- ---------------------------------------------------------------------------
-- Credits verschenken
-- ---------------------------------------------------------------------------
create table if not exists public.credit_gifts (
  id uuid primary key default gen_random_uuid(),
  from_user uuid not null references public.profiles(id) on delete cascade,
  to_user uuid not null references public.profiles(id) on delete cascade,
  amount bigint not null check (amount > 0),
  message text,
  created_at timestamptz not null default now()
);
create index if not exists credit_gifts_from_idx on public.credit_gifts (from_user, created_at desc);
create index if not exists credit_gifts_to_idx on public.credit_gifts (to_user, created_at desc);
alter table public.credit_gifts enable row level security;

create or replace function public.shb_gifts_today(p_user uuid)
returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce(sum(amount), 0) from public.credit_gifts
   where from_user = p_user and created_at >= (date_trunc('day', now() at time zone 'Europe/Berlin') at time zone 'Europe/Berlin');
$$;

create or replace function public.send_credits(p_to uuid, p_amount bigint, p_message text, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.shb_require_user();
  v_limit bigint := coalesce((public.shb_setting('gift_daily_limit') #>> '{}')::bigint, 5000);
  v_id uuid; v_name text; v_balance bigint;
begin
  perform public.shb_check_idem(p_idempotency_key);
  if exists (select 1 from public.credit_ledger where idempotency_key = 'gift:' || v_uid::text || ':' || p_idempotency_key || ':out') then
    return jsonb_build_object('duplicate', true, 'balance', (select balance from public.wallets where user_id = v_uid));
  end if;
  if p_to is null or p_to = v_uid then raise exception 'INVALID_RECIPIENT'; end if;
  if not exists (select 1 from public.profiles where id = p_to and status = 'active') then raise exception 'INVALID_RECIPIENT'; end if;
  if p_amount is null or p_amount < 10 then raise exception 'INVALID_AMOUNT'; end if;
  perform public.shb_rate_limit(v_uid, 'gift', 20, 3600);
  perform pg_advisory_xact_lock(hashtext('gift:' || v_uid::text));
  if public.shb_gifts_today(v_uid) + p_amount > v_limit then raise exception 'GIFT_LIMIT_REACHED'; end if;
  p_message := nullif(left(btrim(coalesce(p_message, '')), 140), '');
  insert into public.credit_gifts (from_user, to_user, amount, message) values (v_uid, p_to, p_amount, p_message) returning id into v_id;
  select display_name into v_name from public.profiles where id = v_uid;
  v_balance := public.shb_apply_ledger(v_uid, -p_amount, 'gift_sent', 'Geschenk an ' || (select display_name from public.profiles where id = p_to),
    'credit_gift', v_id, null, 'gift:' || v_uid::text || ':' || p_idempotency_key || ':out');
  perform public.shb_apply_ledger(p_to, p_amount, 'gift_received', 'Geschenk von ' || v_name,
    'credit_gift', v_id, null, 'gift:' || v_uid::text || ':' || p_idempotency_key || ':in');
  perform public.shb_notify(p_to, 'gift_received', v_name || ' hat dir Credits geschenkt',
    '+' || p_amount || ' Credits' || coalesce(' – „' || p_message || '“', ''), jsonb_build_object('amount', p_amount, 'from', v_uid));
  return jsonb_build_object('id', v_id, 'balance', v_balance, 'sent_today', public.shb_gifts_today(v_uid), 'limit', v_limit);
end;
$$;

create or replace function public.get_my_gifts()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := public.shb_require_user();
begin
  return jsonb_build_object(
    'limit', coalesce((public.shb_setting('gift_daily_limit') #>> '{}')::bigint, 5000),
    'sent_today', public.shb_gifts_today(v_uid),
    'items', (select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) from (
       select g.id, g.amount, g.message, g.created_at, g.from_user = v_uid as outgoing,
              case when g.from_user = v_uid then pt.display_name else pf.display_name end as other_name,
              case when g.from_user = v_uid then pt.avatar_seed else pf.avatar_seed end as other_seed
         from public.credit_gifts g join public.profiles pf on pf.id = g.from_user join public.profiles pt on pt.id = g.to_user
        where g.from_user = v_uid or g.to_user = v_uid
        order by g.created_at desc limit 30) x));
end;
$$;

-- ---------------------------------------------------------------------------
-- Duelle: Herausforderer setzt Einsatz (wird reserviert), Gegner nimmt an -> sofortige, faire Auslosung.
-- Spiele: coinflip (Münzwurf), dice (2 Würfel, höhere Summe), highcard (höhere Karte). Kein Hausvorteil.
-- ---------------------------------------------------------------------------
create table if not exists public.duels (
  id uuid primary key default gen_random_uuid(),
  challenger uuid not null references public.profiles(id) on delete cascade,
  opponent uuid not null references public.profiles(id) on delete cascade,
  game text not null check (game in ('coinflip', 'dice', 'highcard')),
  stake bigint not null check (stake > 0),
  message text,
  status text not null default 'pending' check (status in ('pending', 'finished', 'declined', 'cancelled', 'expired')),
  winner uuid references public.profiles(id),
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  resolved_at timestamptz
);
create index if not exists duels_challenger_idx on public.duels (challenger, created_at desc);
create index if not exists duels_opponent_idx on public.duels (opponent, created_at desc);
alter table public.duels enable row level security;

-- Abgelaufene Duelle zurückerstatten (wird bei jedem Duell-Aufruf und per Cron ausgeführt)
create or replace function public.shb_expire_duels()
returns int language plpgsql security definer set search_path = '' as $$
declare d public.duels; v_n int := 0;
begin
  for d in select * from public.duels where status = 'pending' and expires_at < now() for update skip locked loop
    update public.duels set status = 'expired', resolved_at = now() where id = d.id;
    perform public.shb_apply_ledger(d.challenger, d.stake, 'duel_refund', 'Duell abgelaufen – Einsatz zurück', 'duel', d.id, null,
      'duel:' || d.id::text || ':refund');
    perform public.shb_notify(d.challenger, 'duel', 'Duell abgelaufen', 'Deine Herausforderung wurde nicht angenommen. Einsatz zurück.',
      jsonb_build_object('duel_id', d.id));
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

create or replace function public.create_duel(p_opponent uuid, p_game text, p_stake bigint, p_message text, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.shb_require_user(); v_id uuid; v_name text; v_balance bigint;
  v_max bigint := coalesce((public.shb_setting('duel_max_stake') #>> '{}')::bigint, 5000);
  v_label text;
begin
  perform public.shb_check_idem(p_idempotency_key);
  if exists (select 1 from public.credit_ledger where idempotency_key = 'duelc:' || v_uid::text || ':' || p_idempotency_key) then
    raise exception 'DUPLICATE_REQUEST';
  end if;
  perform public.shb_expire_duels();
  if p_opponent is null or p_opponent = v_uid or not exists (select 1 from public.profiles where id = p_opponent and status = 'active') then
    raise exception 'INVALID_RECIPIENT';
  end if;
  if p_game not in ('coinflip', 'dice', 'highcard') then raise exception 'INVALID_PARAMS'; end if;
  if p_stake is null or p_stake < 10 or p_stake > v_max then raise exception 'INVALID_AMOUNT'; end if;
  perform public.shb_rate_limit(v_uid, 'duel', 20, 3600);
  if (select count(*) from public.duels where challenger = v_uid and status = 'pending') >= 3 then raise exception 'TOO_MANY_DUELS'; end if;
  insert into public.duels (challenger, opponent, game, stake, message)
  values (v_uid, p_opponent, p_game, p_stake, nullif(left(btrim(coalesce(p_message, '')), 140), '')) returning id into v_id;
  v_balance := public.shb_apply_ledger(v_uid, -p_stake, 'duel_stake', 'Duell-Einsatz (reserviert)', 'duel', v_id, null,
    'duelc:' || v_uid::text || ':' || p_idempotency_key);
  select display_name into v_name from public.profiles where id = v_uid;
  v_label := case p_game when 'coinflip' then 'Münzwurf' when 'dice' then 'Würfel' else 'Höchste Karte' end;
  perform public.shb_notify(p_opponent, 'duel', v_name || ' fordert dich heraus!',
    v_label || ' um ' || p_stake || ' Credits. Annehmen oder ablehnen im Bereich Social.', jsonb_build_object('duel_id', v_id));
  return jsonb_build_object('id', v_id, 'balance', v_balance);
end;
$$;

create or replace function public.accept_duel(p_duel uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.shb_require_user(); d public.duels; v_seed bytea := extensions.gen_random_bytes(32);
  a int; b int; a2 int; b2 int; v_cwin boolean; v_res jsonb; v_winner uuid; v_loser uuid; v_i int := 0;
  v_cname text; v_oname text;
begin
  perform public.shb_expire_duels();
  select * into d from public.duels where id = p_duel for update;
  if not found or d.opponent <> v_uid then raise exception 'DUEL_NOT_FOUND'; end if;
  if d.status <> 'pending' then raise exception 'DUEL_NOT_OPEN'; end if;
  perform public.shb_apply_ledger(v_uid, -d.stake, 'duel_stake', 'Duell-Einsatz', 'duel', d.id, null, 'duel:' || d.id::text || ':opp');
  -- Auslosung (bei Gleichstand wird neu gewürfelt/gezogen)
  if d.game = 'coinflip' then
    v_cwin := public.shb_rng(v_seed, 0) < 0.5;
    v_res := jsonb_build_object('coin', case when v_cwin then 'challenger' else 'opponent' end);
  elsif d.game = 'dice' then
    loop
      a := public.shb_rng_int(v_seed, v_i * 4, 6) + 1; a2 := public.shb_rng_int(v_seed, v_i * 4 + 1, 6) + 1;
      b := public.shb_rng_int(v_seed, v_i * 4 + 2, 6) + 1; b2 := public.shb_rng_int(v_seed, v_i * 4 + 3, 6) + 1;
      exit when a + a2 <> b + b2 or v_i > 20;
      v_i := v_i + 1;
    end loop;
    v_cwin := a + a2 > b + b2 or (a + a2 = b + b2 and public.shb_rng(v_seed, 999) < 0.5);
    v_res := jsonb_build_object('challenger', jsonb_build_array(a, a2), 'opponent', jsonb_build_array(b, b2), 'rerolls', v_i);
  else
    loop
      a := public.shb_rng_int(v_seed, v_i * 2, 52); b := public.shb_rng_int(v_seed, v_i * 2 + 1, 52);
      exit when (a % 13) <> (b % 13) or v_i > 20;
      v_i := v_i + 1;
    end loop;
    -- Rang: 0 = Ass (hoch) ... Ass zählt 14
    v_cwin := (case when a % 13 = 0 then 14 else a % 13 + 1 end) > (case when b % 13 = 0 then 14 else b % 13 + 1 end);
    v_res := jsonb_build_object('challenger', a, 'opponent', b, 'redraws', v_i);
  end if;
  v_winner := case when v_cwin then d.challenger else d.opponent end;
  v_loser := case when v_cwin then d.opponent else d.challenger end;
  v_res := v_res || jsonb_build_object('seed', encode(v_seed, 'hex'));
  update public.duels set status = 'finished', winner = v_winner, result = v_res, resolved_at = now() where id = d.id;
  perform public.shb_apply_ledger(v_winner, d.stake * 2, 'duel_payout', 'Duell gewonnen', 'duel', d.id, null, 'duel:' || d.id::text || ':payout');
  select display_name into v_cname from public.profiles where id = d.challenger;
  select display_name into v_oname from public.profiles where id = d.opponent;
  perform public.shb_notify(v_winner, 'duel', 'Duell gewonnen! 🏆',
    '+' || (d.stake * 2) || ' Credits gegen ' || case when v_cwin then v_oname else v_cname end, jsonb_build_object('duel_id', d.id));
  perform public.shb_notify(v_loser, 'duel', 'Duell verloren',
    case when v_cwin then v_cname else v_oname end || ' hat das Duell um ' || d.stake || ' Credits gewonnen.', jsonb_build_object('duel_id', d.id));
  return jsonb_build_object('id', d.id, 'won', v_winner = v_uid, 'winner', v_winner, 'result', v_res,
    'balance', (select balance from public.wallets where user_id = v_uid));
end;
$$;

-- Ablehnen (Gegner) oder Zurückziehen (Herausforderer) – Einsatz geht zurück
create or replace function public.cancel_duel(p_duel uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.shb_require_user(); d public.duels; v_status text;
begin
  select * into d from public.duels where id = p_duel for update;
  if not found or (d.challenger <> v_uid and d.opponent <> v_uid) then raise exception 'DUEL_NOT_FOUND'; end if;
  if d.status <> 'pending' then raise exception 'DUEL_NOT_OPEN'; end if;
  v_status := case when v_uid = d.opponent then 'declined' else 'cancelled' end;
  update public.duels set status = v_status, resolved_at = now() where id = d.id;
  perform public.shb_apply_ledger(d.challenger, d.stake, 'duel_refund',
    case when v_status = 'declined' then 'Duell abgelehnt – Einsatz zurück' else 'Duell zurückgezogen – Einsatz zurück' end,
    'duel', d.id, null, 'duel:' || d.id::text || ':refund');
  if v_status = 'declined' then
    perform public.shb_notify(d.challenger, 'duel', 'Duell abgelehnt',
      (select display_name from public.profiles where id = d.opponent) || ' hat abgelehnt. Einsatz zurück.', jsonb_build_object('duel_id', d.id));
  end if;
  return jsonb_build_object('status', v_status, 'balance', (select balance from public.wallets where user_id = v_uid));
end;
$$;

create or replace function public.get_my_duels()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.shb_require_user();
begin
  perform public.shb_expire_duels();
  return jsonb_build_object(
    'max_stake', coalesce((public.shb_setting('duel_max_stake') #>> '{}')::bigint, 5000),
    'items', (select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) from (
      select d.id, d.game, d.stake, d.message, d.status, d.result, d.created_at, d.expires_at, d.resolved_at,
             d.challenger = v_uid as mine, d.winner = v_uid as won, d.winner is not null as has_winner,
             pc.display_name as challenger_name, pc.avatar_seed as challenger_seed,
             po.display_name as opponent_name, po.avatar_seed as opponent_seed
        from public.duels d join public.profiles pc on pc.id = d.challenger join public.profiles po on po.id = d.opponent
       where d.challenger = v_uid or d.opponent = v_uid
       order by (d.status = 'pending') desc, d.created_at desc limit 40) x));
end;
$$;

-- ---------------------------------------------------------------------------
-- Kasten-Prognose: Tipp, wer am Rundenende Letzter ist. Änderbar bis 24 h vor Rundenende.
-- ---------------------------------------------------------------------------
create table if not exists public.period_predictions (
  period_key text not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  predicted_user uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  rewarded boolean not null default false,
  primary key (period_key, user_id)
);
alter table public.period_predictions enable row level security;

create or replace function public.set_prediction(p_user uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.shb_require_user(); v_key text := public.shb_period_key(now());
begin
  if now() > public.shb_period_end(now()) - interval '24 hours' then raise exception 'PREDICTION_LOCKED'; end if;
  if not exists (select 1 from public.profiles where id = p_user and status = 'active') then raise exception 'INVALID_RECIPIENT'; end if;
  perform public.shb_rate_limit(v_uid, 'prediction', 20, 3600);
  insert into public.period_predictions (period_key, user_id, predicted_user) values (v_key, v_uid, p_user)
  on conflict (period_key, user_id) do update set predicted_user = excluded.predicted_user, updated_at = now();
  return public.get_prediction_state();
end;
$$;

create or replace function public.get_prediction_state()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := public.shb_require_user(); v_key text := public.shb_period_key(now()); v_last text;
begin
  select week_key into v_last from public.weekly_results order by finalized_at desc limit 1;
  return jsonb_build_object(
    'period_key', v_key,
    'locks_at', public.shb_period_end(now()) - interval '24 hours',
    'period_end', public.shb_period_end(now()),
    'reward', coalesce((public.shb_setting('prediction_reward') #>> '{}')::bigint, 500),
    'my_pick', (select predicted_user from public.period_predictions where period_key = v_key and user_id = v_uid),
    'tips', (select count(*) from public.period_predictions where period_key = v_key),
    -- Auflösung der letzten Runde: wer hat was getippt (erst nach der Abrechnung sichtbar)
    'last', case when v_last is null then null else jsonb_build_object('period_key', v_last,
      'loser', (select p.display_name from public.weekly_results w join public.profiles p on p.id = w.loser_user_id where w.week_key = v_last),
      'tips', (select coalesce(jsonb_agg(jsonb_build_object('name', pu.display_name, 'pick', pp.display_name, 'correct', x.rewarded)), '[]'::jsonb)
                 from public.period_predictions x join public.profiles pu on pu.id = x.user_id join public.profiles pp on pp.id = x.predicted_user
                where x.period_key = v_last)) end);
end;
$$;

-- Bei Abrechnung: richtige Tipps belohnen
create or replace function public.shb_reward_predictions()
returns trigger language plpgsql security definer set search_path = '' as $$
declare x record; v_reward bigint := coalesce((public.shb_setting('prediction_reward') #>> '{}')::bigint, 500); v_name text;
begin
  if new.loser_user_id is null then return new; end if;
  select display_name into v_name from public.profiles where id = new.loser_user_id;
  for x in select * from public.period_predictions where period_key = new.week_key and predicted_user = new.loser_user_id and not rewarded loop
    update public.period_predictions set rewarded = true where period_key = x.period_key and user_id = x.user_id;
    perform public.shb_apply_ledger(x.user_id, v_reward, 'prediction_reward', 'Richtiger Kasten-Tipp', 'prediction', null, null,
      'pred:' || x.period_key || ':' || x.user_id::text);
    perform public.shb_notify(x.user_id, 'prediction', 'Richtig getippt! 🎯', v_name || ' bringt den Kasten. +' || v_reward || ' Credits.',
      jsonb_build_object('amount', v_reward));
  end loop;
  return new;
end;
$$;
drop trigger if exists on_week_result_predictions on public.weekly_results;
create trigger on_week_result_predictions after insert on public.weekly_results
  for each row execute function public.shb_reward_predictions();

-- Cron: abgelaufene Duelle alle 10 Minuten erstatten
do $$
begin
  if exists (select 1 from cron.job where jobname = 'shb_duels') then perform cron.unschedule('shb_duels'); end if;
  perform cron.schedule('shb_duels', '*/10 * * * *', 'select public.shb_expire_duels();');
end $$;

-- Admin darf die neuen Einstellungen ändern
create or replace function public.admin_update_setting(p_key text, p_value jsonb, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_admin uuid := public.shb_require_admin(); v_old jsonb;
begin
  if p_reason is null or char_length(btrim(p_reason)) < 3 then raise exception 'REASON_REQUIRED'; end if;
  if p_key not in ('daily_bonus_amount', 'weekly_bonus_amount', 'weekly_task_label', 'confetti_enabled', 'max_win_per_round',
                   'gift_daily_limit', 'duel_max_stake', 'prediction_reward') then
    raise exception 'SETTING_NOT_EDITABLE';
  end if;
  if p_key in ('daily_bonus_amount', 'weekly_bonus_amount', 'gift_daily_limit', 'duel_max_stake', 'prediction_reward')
     and ((p_value #>> '{}')::bigint < 0 or (p_value #>> '{}')::bigint > 1000000) then
    raise exception 'INVALID_VALUE';
  end if;
  if p_key = 'max_win_per_round' and ((p_value #>> '{}')::bigint < 1000 or (p_value #>> '{}')::bigint > 100000000) then
    raise exception 'INVALID_VALUE';
  end if;
  if p_key = 'weekly_task_label' and char_length(p_value #>> '{}') not between 3 and 60 then raise exception 'INVALID_VALUE'; end if;
  select value into v_old from public.app_settings where key = p_key;
  insert into public.app_settings (key, value, updated_by, updated_at) values (p_key, p_value, v_admin, now())
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();
  perform public.shb_audit('setting_update', null, jsonb_build_object('key', p_key, 'before', v_old, 'after', p_value, 'reason', p_reason));
end;
$$;

revoke execute on function public.shb_gifts_today(uuid), public.shb_expire_duels(), public.shb_reward_predictions() from public, anon, authenticated;
revoke execute on function public.send_credits(uuid, bigint, text, text), public.get_my_gifts(), public.create_duel(uuid, text, bigint, text, text),
  public.accept_duel(uuid), public.cancel_duel(uuid), public.get_my_duels(), public.set_prediction(uuid), public.get_prediction_state() from public, anon;
grant execute on function public.send_credits(uuid, bigint, text, text), public.get_my_gifts(), public.create_duel(uuid, text, bigint, text, text),
  public.accept_duel(uuid), public.cancel_duel(uuid), public.get_my_duels(), public.set_prediction(uuid), public.get_prediction_state() to authenticated;
