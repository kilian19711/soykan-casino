-- Migration 18: Live-Duelle – beide sitzen im selben Duell-Raum, tippen "Bereit", dann laufen die Runden synchron
-- auf beiden Geräten ab. Der Server legt beim zweiten "Bereit" alle Runden fest (fair, nachprüfbar über den Seed),
-- zahlt sofort aus und speichert einen Startzeitpunkt; die Apps spielen die Runden danach im Gleichtakt ab.
-- Spiele: live_dice (2 Würfel), live_card (höhere Karte), live_plinko (höherer Multiplikator), live_coin (Münzwurf).
-- Jede Runde hat einen Sieger (Gleichstand wird in der Runde neu gewürfelt), Rundenzahl ungerade -> immer eindeutig.

alter table public.duels drop constraint if exists duels_game_check;
alter table public.duels add constraint duels_game_check check (game in ('coinflip', 'dice', 'highcard', 'match', 'live'));
alter table public.duels drop constraint if exists duels_status_check;
alter table public.duels add constraint duels_status_check check (status in ('pending', 'lobby', 'running', 'finished', 'declined', 'cancelled', 'expired'));
alter table public.duels
  add column if not exists c_ready boolean not null default false,
  add column if not exists o_ready boolean not null default false,
  add column if not exists start_at timestamptz;

-- Teilnehmer dürfen ihre Duelle lesen (für Echtzeit-Updates im Duell-Raum)
drop policy if exists duels_select_own on public.duels;
create policy duels_select_own on public.duels for select to authenticated
  using ((select auth.uid()) in (challenger, opponent));
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'duels') then
    alter publication supabase_realtime add table public.duels;
  end if;
end $$;

-- Plinko-Tabelle für Live-Duelle (12 Reihen, 13 Fächer)
create or replace function public.shb_live_plinko_table()
returns numeric[] language sql immutable set search_path = '' as $$
  select array[16, 6, 3, 1.6, 1.2, 1, 0.5, 1, 1.2, 1.6, 3, 6, 16]::numeric[];
$$;

-- Alle Runden eines Live-Duells aus dem Seed berechnen
create or replace function public.shb_live_rounds(p_seed bytea, p_game text, p_rounds int)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare v_out jsonb := '[]'::jsonb; v_idx int := 0; a jsonb; b jsonb; av numeric; bv numeric; v_path int[]; v_bucket int; v_tbl numeric[] := public.shb_live_plinko_table();
begin
  for r in 1 .. p_rounds loop
    loop
      if p_game = 'live_dice' then
        a := jsonb_build_array(public.shb_rng_int(p_seed, v_idx, 6) + 1, public.shb_rng_int(p_seed, v_idx + 1, 6) + 1);
        b := jsonb_build_array(public.shb_rng_int(p_seed, v_idx + 2, 6) + 1, public.shb_rng_int(p_seed, v_idx + 3, 6) + 1);
        av := (a ->> 0)::int + (a ->> 1)::int; bv := (b ->> 0)::int + (b ->> 1)::int;
        v_idx := v_idx + 4;
      elsif p_game = 'live_card' then
        a := to_jsonb(public.shb_rng_int(p_seed, v_idx, 52)); b := to_jsonb(public.shb_rng_int(p_seed, v_idx + 1, 52));
        av := case when (a::text)::int % 13 = 0 then 14 else (a::text)::int % 13 + 1 end;
        bv := case when (b::text)::int % 13 = 0 then 14 else (b::text)::int % 13 + 1 end;
        v_idx := v_idx + 2;
      elsif p_game = 'live_plinko' then
        v_path := '{}'; v_bucket := 0;
        for i in 0 .. 11 loop v_path := v_path || public.shb_rng_int(p_seed, v_idx + i, 2); v_bucket := v_bucket + v_path[i + 1]; end loop;
        a := jsonb_build_object('path', to_jsonb(v_path), 'mult', v_tbl[v_bucket + 1]); av := v_tbl[v_bucket + 1];
        v_path := '{}'; v_bucket := 0;
        for i in 0 .. 11 loop v_path := v_path || public.shb_rng_int(p_seed, v_idx + 12 + i, 2); v_bucket := v_bucket + v_path[i + 1]; end loop;
        b := jsonb_build_object('path', to_jsonb(v_path), 'mult', v_tbl[v_bucket + 1]); bv := v_tbl[v_bucket + 1];
        v_idx := v_idx + 24;
      else -- live_coin: Kopf (challenger) oder Zahl (opponent)
        av := case when public.shb_rng(p_seed, v_idx) < 0.5 then 1 else 0 end; bv := 1 - av;
        a := to_jsonb(av = 1); b := to_jsonb(bv = 1);
        v_idx := v_idx + 1;
      end if;
      exit when av <> bv or v_idx > 4000;
    end loop;
    v_out := v_out || jsonb_build_array(jsonb_build_object('c', a, 'o', b, 'winner', case when av > bv then 'c' else 'o' end));
  end loop;
  return v_out;
end;
$$;

create or replace function public.create_live_duel(p_opponent uuid, p_game text, p_rounds int, p_stake bigint, p_message text, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.shb_require_user(); v_id uuid; v_name text; v_balance bigint;
  v_max bigint := coalesce((public.shb_setting('duel_max_stake') #>> '{}')::bigint, 5000);
  v_label text := case p_game when 'live_dice' then 'Würfel' when 'live_card' then 'Karten' when 'live_plinko' then 'Plinko' when 'live_coin' then 'Münzwurf' end;
begin
  perform public.shb_check_idem(p_idempotency_key);
  if exists (select 1 from public.credit_ledger where idempotency_key = 'duelc:' || v_uid::text || ':' || p_idempotency_key) then
    raise exception 'DUPLICATE_REQUEST';
  end if;
  perform public.shb_expire_duels();
  if p_opponent is null or p_opponent = v_uid or not exists (select 1 from public.profiles where id = p_opponent and status = 'active') then
    raise exception 'INVALID_RECIPIENT';
  end if;
  if v_label is null or p_rounds not in (1, 3, 5) then raise exception 'INVALID_PARAMS'; end if;
  if p_stake is null or p_stake < 10 or p_stake > v_max then raise exception 'INVALID_AMOUNT'; end if;
  perform public.shb_rate_limit(v_uid, 'duel', 20, 3600);
  if (select count(*) from public.duels where challenger = v_uid and status in ('pending', 'lobby')) >= 3 then raise exception 'TOO_MANY_DUELS'; end if;
  insert into public.duels (challenger, opponent, game, game_key, rounds, stake, message, c_ready, expires_at)
  values (v_uid, p_opponent, 'live', p_game, p_rounds, p_stake, nullif(left(btrim(coalesce(p_message, '')), 140), ''), true, now() + interval '30 minutes')
  returning id into v_id;
  v_balance := public.shb_apply_ledger(v_uid, -p_stake, 'duel_stake', 'Live-Duell-Einsatz (reserviert)', 'duel', v_id, null,
    'duelc:' || v_uid::text || ':' || p_idempotency_key);
  select display_name into v_name from public.profiles where id = v_uid;
  perform public.shb_notify(p_opponent, 'duel', v_name || ' wartet im Live-Duell!',
    v_label || ' · ' || p_rounds || ' Runde(n) um ' || p_stake || ' Credits. Jetzt im Casino unter „Duelle“ beitreten.', jsonb_build_object('duel_id', v_id, 'live', true));
  return jsonb_build_object('id', v_id, 'balance', v_balance);
end;
$$;

-- Beitreten (Gegner): Einsatz reservieren, in den Raum (Status lobby). Der Herausforderer ist schon bereit.
create or replace function public.join_live_duel(p_duel uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.shb_require_user(); d public.duels;
begin
  perform public.shb_expire_duels();
  select * into d from public.duels where id = p_duel for update;
  if not found or d.opponent <> v_uid or d.game <> 'live' then raise exception 'DUEL_NOT_FOUND'; end if;
  if d.status = 'lobby' then return public.get_duel(p_duel); end if;
  if d.status <> 'pending' then raise exception 'DUEL_NOT_OPEN'; end if;
  perform public.shb_apply_ledger(v_uid, -d.stake, 'duel_stake', 'Live-Duell-Einsatz', 'duel', d.id, null, 'duel:' || d.id::text || ':opp');
  update public.duels set status = 'lobby', accepted_at = now(), expires_at = now() + interval '15 minutes' where id = d.id;
  return public.get_duel(p_duel);
end;
$$;

-- Bereit melden. Sind beide bereit: Runden festlegen, Start in 4 Sekunden, sofort abrechnen.
create or replace function public.ready_live_duel(p_duel uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.shb_require_user(); d public.duels; v_seed bytea; v_rounds jsonb; v_cw int; v_winner uuid;
begin
  select * into d from public.duels where id = p_duel for update;
  if not found or v_uid not in (d.challenger, d.opponent) or d.game <> 'live' then raise exception 'DUEL_NOT_FOUND'; end if;
  if d.status <> 'lobby' then return public.get_duel(p_duel); end if;
  if v_uid = d.challenger then d.c_ready := true; else d.o_ready := true; end if;
  if not (d.c_ready and d.o_ready) then
    update public.duels set c_ready = d.c_ready, o_ready = d.o_ready where id = d.id;
    return public.get_duel(p_duel);
  end if;
  v_seed := extensions.gen_random_bytes(32);
  v_rounds := public.shb_live_rounds(v_seed, d.game_key, d.rounds);
  v_cw := (select count(*) from jsonb_array_elements(v_rounds) x where x ->> 'winner' = 'c');
  v_winner := case when v_cw * 2 > d.rounds then d.challenger else d.opponent end;
  update public.duels set c_ready = true, o_ready = true, status = 'finished', winner = v_winner, resolved_at = now(),
    start_at = now() + interval '4 seconds',
    result = jsonb_build_object('rounds', v_rounds, 'c_wins', v_cw, 'o_wins', d.rounds - v_cw, 'seed', encode(v_seed, 'hex'))
   where id = d.id;
  perform public.shb_apply_ledger(v_winner, d.stake * 2, 'duel_payout', 'Live-Duell gewonnen', 'duel', d.id, null, 'duel:' || d.id::text || ':payout');
  return public.get_duel(p_duel);
end;
$$;

-- Ein Duell (nur für Teilnehmer) inkl. Namen/Avataren – für den Duell-Raum
create or replace function public.get_duel(p_duel uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.shb_require_user(); v jsonb;
begin
  select jsonb_build_object('id', d.id, 'game', d.game, 'game_key', d.game_key, 'rounds', d.rounds, 'stake', d.stake, 'message', d.message,
      'status', d.status, 'result', d.result, 'start_at', d.start_at, 'expires_at', d.expires_at, 'c_ready', d.c_ready, 'o_ready', d.o_ready,
      'mine', d.challenger = v_uid, 'won', d.winner = v_uid, 'has_winner', d.winner is not null,
      'challenger_id', d.challenger, 'opponent_id', d.opponent, 'challenger_name', pc.display_name, 'challenger_seed', pc.avatar_seed, 'opponent_name', po.display_name, 'opponent_seed', po.avatar_seed,
      'server_now', now(), 'balance', (select balance from public.wallets where user_id = v_uid))
    into v
    from public.duels d join public.profiles pc on pc.id = d.challenger join public.profiles po on po.id = d.opponent
   where d.id = p_duel and v_uid in (d.challenger, d.opponent);
  if v is null then raise exception 'DUEL_NOT_FOUND'; end if;
  return v;
end;
$$;

-- Ablauf: offene (pending) und Raum (lobby) und laufende Spiel-Duelle erstatten
create or replace function public.shb_expire_duels()
returns int language plpgsql security definer set search_path = '' as $$
declare d public.duels; v_n int := 0;
begin
  for d in select * from public.duels where status in ('pending', 'lobby', 'running') and expires_at < now() for update skip locked loop
    update public.duels set status = 'expired', resolved_at = now() where id = d.id;
    perform public.shb_apply_ledger(d.challenger, d.stake, 'duel_refund', 'Duell abgelaufen – Einsatz zurück', 'duel', d.id, null,
      'duel:' || d.id::text || ':refund');
    perform public.shb_notify(d.challenger, 'duel', 'Duell abgelaufen', 'Das Duell wurde nicht rechtzeitig gespielt. Einsatz zurück.',
      jsonb_build_object('duel_id', d.id));
    if d.status in ('lobby', 'running') then
      perform public.shb_apply_ledger(d.opponent, d.stake, 'duel_refund', 'Duell abgelaufen – Einsatz zurück', 'duel', d.id, null,
        'duel:' || d.id::text || ':refund_opp');
      perform public.shb_notify(d.opponent, 'duel', 'Duell abgelaufen', 'Das Duell wurde nicht rechtzeitig gespielt. Einsatz zurück.',
        jsonb_build_object('duel_id', d.id));
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- Raum verlassen, bevor es losgeht: beide Einsätze zurück
create or replace function public.leave_live_duel(p_duel uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.shb_require_user(); d public.duels;
begin
  select * into d from public.duels where id = p_duel for update;
  if not found or v_uid not in (d.challenger, d.opponent) or d.game <> 'live' then raise exception 'DUEL_NOT_FOUND'; end if;
  if d.status = 'pending' then return public.cancel_duel(p_duel); end if;
  if d.status <> 'lobby' then raise exception 'DUEL_NOT_OPEN'; end if;
  update public.duels set status = 'cancelled', resolved_at = now() where id = d.id;
  perform public.shb_apply_ledger(d.challenger, d.stake, 'duel_refund', 'Live-Duell abgebrochen – Einsatz zurück', 'duel', d.id, null, 'duel:' || d.id::text || ':refund');
  perform public.shb_apply_ledger(d.opponent, d.stake, 'duel_refund', 'Live-Duell abgebrochen – Einsatz zurück', 'duel', d.id, null, 'duel:' || d.id::text || ':refund_opp');
  return public.get_duel(p_duel);
end;
$$;

revoke execute on function public.shb_live_plinko_table(), public.shb_live_rounds(bytea, text, int) from public, anon, authenticated;
revoke execute on function public.create_live_duel(uuid, text, int, bigint, text, text), public.join_live_duel(uuid), public.ready_live_duel(uuid),
  public.get_duel(uuid), public.leave_live_duel(uuid) from public, anon;
grant execute on function public.create_live_duel(uuid, text, int, bigint, text, text), public.join_live_duel(uuid), public.ready_live_duel(uuid),
  public.get_duel(uuid), public.leave_live_duel(uuid) to authenticated;
