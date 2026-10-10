-- Migration 17: Spiel-Duelle – beide spielen N Runden im selben Casino-Spiel, wer prozentual mehr zurückholt
-- (Auszahlung ÷ Einsatz) gewinnt den Topf. Einsatzhöhe pro Runde ist egal, gezählt wird die Quote.
-- Zählen: jede nach der Annahme abgerechnete Runde im Duell-Spiel, bis jeder seine N Runden hat.
-- Nicht fertig nach 24 h ab Annahme -> beide Einsätze zurück.

alter table public.duels drop constraint if exists duels_game_check;
alter table public.duels add constraint duels_game_check check (game in ('coinflip', 'dice', 'highcard', 'match'));
alter table public.duels drop constraint if exists duels_status_check;
alter table public.duels add constraint duels_status_check check (status in ('pending', 'running', 'finished', 'declined', 'cancelled', 'expired'));
alter table public.duels
  add column if not exists game_key text,
  add column if not exists rounds int,
  add column if not exists accepted_at timestamptz,
  add column if not exists c_rounds int not null default 0,
  add column if not exists o_rounds int not null default 0,
  add column if not exists c_bet bigint not null default 0,
  add column if not exists c_pay bigint not null default 0,
  add column if not exists o_bet bigint not null default 0,
  add column if not exists o_pay bigint not null default 0;
create index if not exists duels_running_idx on public.duels (status, game_key) where status = 'running';

create or replace function public.create_match_duel(p_opponent uuid, p_game_key text, p_rounds int, p_stake bigint, p_message text, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.shb_require_user(); v_id uuid; v_name text; v_balance bigint; v_game text;
  v_max bigint := coalesce((public.shb_setting('duel_max_stake') #>> '{}')::bigint, 5000);
begin
  perform public.shb_check_idem(p_idempotency_key);
  if exists (select 1 from public.credit_ledger where idempotency_key = 'duelc:' || v_uid::text || ':' || p_idempotency_key) then
    raise exception 'DUPLICATE_REQUEST';
  end if;
  perform public.shb_expire_duels();
  if p_opponent is null or p_opponent = v_uid or not exists (select 1 from public.profiles where id = p_opponent and status = 'active') then
    raise exception 'INVALID_RECIPIENT';
  end if;
  select display_name into v_game from public.game_configs
   where game_key = p_game_key and enabled and coalesce((config ->> 'implemented')::boolean, false);
  if v_game is null then raise exception 'GAME_NOT_FOUND'; end if;
  if p_rounds not in (3, 5, 10, 20) then raise exception 'INVALID_PARAMS'; end if;
  if p_stake is null or p_stake < 10 or p_stake > v_max then raise exception 'INVALID_AMOUNT'; end if;
  perform public.shb_rate_limit(v_uid, 'duel', 20, 3600);
  if (select count(*) from public.duels where challenger = v_uid and status = 'pending') >= 3 then raise exception 'TOO_MANY_DUELS'; end if;
  insert into public.duels (challenger, opponent, game, game_key, rounds, stake, message)
  values (v_uid, p_opponent, 'match', p_game_key, p_rounds, p_stake, nullif(left(btrim(coalesce(p_message, '')), 140), '')) returning id into v_id;
  v_balance := public.shb_apply_ledger(v_uid, -p_stake, 'duel_stake', 'Duell-Einsatz (reserviert)', 'duel', v_id, null,
    'duelc:' || v_uid::text || ':' || p_idempotency_key);
  select display_name into v_name from public.profiles where id = v_uid;
  perform public.shb_notify(p_opponent, 'duel', v_name || ' fordert dich heraus!',
    v_game || ' · ' || p_rounds || ' Runden um ' || p_stake || ' Credits. Annehmen im Casino unter „Duelle“.', jsonb_build_object('duel_id', v_id));
  return jsonb_build_object('id', v_id, 'balance', v_balance);
end;
$$;

-- Annahme: Sofort-Duelle wie bisher, Spiel-Duelle starten (Status running)
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
  select display_name into v_cname from public.profiles where id = d.challenger;
  select display_name into v_oname from public.profiles where id = d.opponent;

  if d.game = 'match' then
    update public.duels set status = 'running', accepted_at = now(), expires_at = now() + interval '24 hours' where id = d.id;
    perform public.shb_notify(d.challenger, 'duel', 'Duell angenommen! ⚔️',
      v_oname || ' hat angenommen. Spiel jetzt deine ' || d.rounds || ' Runden ' ||
      coalesce((select display_name from public.game_configs where game_key = d.game_key), d.game_key) || '.', jsonb_build_object('duel_id', d.id));
    return jsonb_build_object('id', d.id, 'running', true, 'game_key', d.game_key, 'balance', (select balance from public.wallets where user_id = v_uid));
  end if;

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
    v_cwin := (case when a % 13 = 0 then 14 else a % 13 + 1 end) > (case when b % 13 = 0 then 14 else b % 13 + 1 end);
    v_res := jsonb_build_object('challenger', a, 'opponent', b, 'redraws', v_i);
  end if;
  v_winner := case when v_cwin then d.challenger else d.opponent end;
  v_loser := case when v_cwin then d.opponent else d.challenger end;
  v_res := v_res || jsonb_build_object('seed', encode(v_seed, 'hex'));
  update public.duels set status = 'finished', winner = v_winner, result = v_res, resolved_at = now() where id = d.id;
  perform public.shb_apply_ledger(v_winner, d.stake * 2, 'duel_payout', 'Duell gewonnen', 'duel', d.id, null, 'duel:' || d.id::text || ':payout');
  perform public.shb_notify(v_winner, 'duel', 'Duell gewonnen! 🏆',
    '+' || (d.stake * 2) || ' Credits gegen ' || case when v_cwin then v_oname else v_cname end, jsonb_build_object('duel_id', d.id));
  perform public.shb_notify(v_loser, 'duel', 'Duell verloren',
    case when v_cwin then v_cname else v_oname end || ' hat das Duell um ' || d.stake || ' Credits gewonnen.', jsonb_build_object('duel_id', d.id));
  return jsonb_build_object('id', d.id, 'won', v_winner = v_uid, 'winner', v_winner, 'result', v_res,
    'balance', (select balance from public.wallets where user_id = v_uid));
end;
$$;

-- Abschluss eines Spiel-Duells (beide fertig): höhere Quote gewinnt, Gleichstand -> Münzwurf
create or replace function public.shb_resolve_match(p_duel uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare d public.duels; v_cq numeric; v_oq numeric; v_cwin boolean; v_winner uuid; v_loser uuid; v_game text;
begin
  select * into d from public.duels where id = p_duel for update;
  if d.status <> 'running' or d.c_rounds < d.rounds or d.o_rounds < d.rounds then return; end if;
  v_cq := case when d.c_bet > 0 then d.c_pay::numeric / d.c_bet else 0 end;
  v_oq := case when d.o_bet > 0 then d.o_pay::numeric / d.o_bet else 0 end;
  v_cwin := v_cq > v_oq or (v_cq = v_oq and random() < 0.5);
  v_winner := case when v_cwin then d.challenger else d.opponent end;
  v_loser := case when v_cwin then d.opponent else d.challenger end;
  update public.duels set status = 'finished', winner = v_winner, resolved_at = now(),
    result = jsonb_build_object('challenger_quote', round(v_cq * 100, 1), 'opponent_quote', round(v_oq * 100, 1)) where id = d.id;
  perform public.shb_apply_ledger(v_winner, d.stake * 2, 'duel_payout', 'Duell gewonnen', 'duel', d.id, null, 'duel:' || d.id::text || ':payout');
  select display_name into v_game from public.game_configs where game_key = d.game_key;
  perform public.shb_notify(v_winner, 'duel', 'Duell gewonnen! 🏆', v_game || ': ' || round((case when v_cwin then v_cq else v_oq end) * 100) || ' % gegen '
    || round((case when v_cwin then v_oq else v_cq end) * 100) || ' %. +' || (d.stake * 2) || ' Credits', jsonb_build_object('duel_id', d.id));
  perform public.shb_notify(v_loser, 'duel', 'Duell verloren', v_game || ': ' || round((case when v_cwin then v_oq else v_cq end) * 100) || ' % gegen '
    || round((case when v_cwin then v_cq else v_oq end) * 100) || ' %.', jsonb_build_object('duel_id', d.id));
end;
$$;

-- Trigger: abgerechnete Runde zählt für laufende Spiel-Duelle
create or replace function public.shb_duel_round()
returns trigger language plpgsql security definer set search_path = '' as $$
declare d record;
begin
  if new.status <> 'settled' or old.status = 'settled' then return new; end if;
  for d in select id, challenger, opponent, rounds, c_rounds, o_rounds from public.duels
            where status = 'running' and game_key = new.game_key and accepted_at <= new.started_at
              and (challenger = new.user_id or opponent = new.user_id) for update loop
    if d.challenger = new.user_id and d.c_rounds < d.rounds then
      update public.duels set c_rounds = c_rounds + 1, c_bet = c_bet + new.bet_amount, c_pay = c_pay + new.payout_amount where id = d.id;
    elsif d.opponent = new.user_id and d.o_rounds < d.rounds then
      update public.duels set o_rounds = o_rounds + 1, o_bet = o_bet + new.bet_amount, o_pay = o_pay + new.payout_amount where id = d.id;
    end if;
    perform public.shb_resolve_match(d.id);
  end loop;
  return new;
end;
$$;
drop trigger if exists on_round_settled_duels on public.game_rounds;
create trigger on_round_settled_duels after update of status on public.game_rounds
  for each row execute function public.shb_duel_round();

-- Ablauf: offene Duelle nach 24 h erstatten; laufende Spiel-Duelle nach 24 h beiden erstatten
create or replace function public.shb_expire_duels()
returns int language plpgsql security definer set search_path = '' as $$
declare d public.duels; v_n int := 0;
begin
  for d in select * from public.duels where status in ('pending', 'running') and expires_at < now() for update skip locked loop
    update public.duels set status = 'expired', resolved_at = now() where id = d.id;
    perform public.shb_apply_ledger(d.challenger, d.stake, 'duel_refund', 'Duell abgelaufen – Einsatz zurück', 'duel', d.id, null,
      'duel:' || d.id::text || ':refund');
    perform public.shb_notify(d.challenger, 'duel', 'Duell abgelaufen', 'Das Duell wurde nicht rechtzeitig beendet. Einsatz zurück.',
      jsonb_build_object('duel_id', d.id));
    if d.status = 'running' then
      perform public.shb_apply_ledger(d.opponent, d.stake, 'duel_refund', 'Duell abgelaufen – Einsatz zurück', 'duel', d.id, null,
        'duel:' || d.id::text || ':refund_opp');
      perform public.shb_notify(d.opponent, 'duel', 'Duell abgelaufen', 'Das Duell wurde nicht rechtzeitig beendet. Einsatz zurück.',
        jsonb_build_object('duel_id', d.id));
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

create or replace function public.get_my_duels()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.shb_require_user();
begin
  perform public.shb_expire_duels();
  return jsonb_build_object(
    'max_stake', coalesce((public.shb_setting('duel_max_stake') #>> '{}')::bigint, 5000),
    'items', (select coalesce(jsonb_agg(x order by x.sort_key, x.created_at desc), '[]'::jsonb) from (
      select d.id, d.game, d.game_key, gc.display_name as game_name, d.rounds, d.stake, d.message, d.status, d.result,
             d.created_at, d.expires_at, d.accepted_at, d.resolved_at,
             d.challenger = v_uid as mine, d.winner = v_uid as won, d.winner is not null as has_winner,
             pc.display_name as challenger_name, pc.avatar_seed as challenger_seed,
             po.display_name as opponent_name, po.avatar_seed as opponent_seed,
             d.c_rounds, d.o_rounds,
             case when d.c_bet > 0 then round(d.c_pay::numeric / d.c_bet * 100, 1) end as c_quote,
             case when d.o_bet > 0 then round(d.o_pay::numeric / d.o_bet * 100, 1) end as o_quote,
             case d.status when 'pending' then 0 when 'running' then 1 else 2 end as sort_key
        from public.duels d join public.profiles pc on pc.id = d.challenger join public.profiles po on po.id = d.opponent
        left join public.game_configs gc on gc.game_key = d.game_key
       where d.challenger = v_uid or d.opponent = v_uid
       order by case d.status when 'pending' then 0 when 'running' then 1 else 2 end, d.created_at desc limit 40) x));
end;
$$;

revoke execute on function public.shb_resolve_match(uuid), public.shb_duel_round() from public, anon, authenticated;
revoke execute on function public.create_match_duel(uuid, text, int, bigint, text, text) from public, anon;
grant execute on function public.create_match_duel(uuid, text, int, bigint, text, text) to authenticated;
