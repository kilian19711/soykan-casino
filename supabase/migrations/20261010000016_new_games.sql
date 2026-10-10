-- Migration 16: neue Spiele – Pferderennen, Hütchenspiel, Diamonds, Pump (Stake-Stil) und Jackpot-Slot mit gemeinsamem Topf.
-- Eigene RPCs (play_extra, pump_*, jackpot_spin); play_game/step_* bleiben unverändert.

-- ---------------------------------------------------------------------------
-- Rechenfunktionen (deterministisch aus dem Server-Seed, nachprüfbar)
-- ---------------------------------------------------------------------------
-- Pferderennen: 6 Pferde mit unterschiedlichen Chancen; komplette Zielreihenfolge für die Animation
create or replace function public.shb_g_horse(p_seed bytea, p jsonb, c jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  v_pick int := (p ->> 'horse')::int; v_w numeric[] := array(select (x #>> '{}')::numeric from jsonb_array_elements(c -> 'weights') x);
  v_left int[] := array(select generate_series(0, jsonb_array_length(c -> 'weights') - 1)); v_order int[] := '{}';
  v_total numeric; v_x numeric; v_k int;
begin
  if v_pick is null or v_pick < 0 or v_pick >= cardinality(v_w) then raise exception 'INVALID_PARAMS'; end if;
  -- gewichtete Ziehung ohne Zurücklegen: 1. Platz, 2. Platz, ...
  for step in 1 .. cardinality(v_w) loop
    v_total := (select sum(v_w[h + 1]) from unnest(v_left) h);
    v_x := public.shb_rng(p_seed, step)::numeric * v_total;
    foreach v_k in array v_left loop
      v_x := v_x - v_w[v_k + 1];
      exit when v_x < 0;
    end loop;
    v_order := v_order || v_k;
    v_left := array_remove(v_left, v_k);
  end loop;
  return jsonb_build_object('horse', v_pick, 'order', to_jsonb(v_order), 'winner', v_order[1], 'win', v_order[1] = v_pick,
    'mult', case when v_order[1] = v_pick then (c -> 'pays' ->> v_pick)::numeric else 0 end);
end;
$$;

-- Hütchenspiel: Kugel unter einem von 3 Bechern, Vertauschungen für die Animation
create or replace function public.shb_g_shell(p_seed bytea, p jsonb, c jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare v_pick int := (p ->> 'cup')::int; v_start int := public.shb_rng_int(p_seed, 0, 3); v_ball int; v_swaps jsonb := '[]'::jsonb;
        a int; b int; v_n int := 7 + public.shb_rng_int(p_seed, 1, 4);
begin
  if v_pick is null or v_pick not between 0 and 2 then raise exception 'INVALID_PARAMS'; end if;
  v_ball := v_start;
  for i in 1 .. v_n loop
    a := public.shb_rng_int(p_seed, 10 + i * 2, 3);
    b := (a + 1 + public.shb_rng_int(p_seed, 11 + i * 2, 2)) % 3;
    v_swaps := v_swaps || jsonb_build_array(jsonb_build_array(a, b));
    if v_ball = a then v_ball := b; elsif v_ball = b then v_ball := a; end if;
  end loop;
  return jsonb_build_object('cup', v_pick, 'start', v_start, 'swaps', v_swaps, 'ball', v_ball, 'win', v_ball = v_pick,
    'mult', case when v_ball = v_pick then (c ->> 'pay')::numeric else 0 end);
end;
$$;

-- Diamonds (wie Stake): 5 Edelsteine aus 7 Farben, Auszahlung nach Muster
create or replace function public.shb_g_diamonds(p_seed bytea, p jsonb, c jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare v_g int[] := '{}'; v_counts int[]; v_hand text;
begin
  for i in 0 .. 4 loop v_g := v_g || public.shb_rng_int(p_seed, i, 7); end loop;
  v_counts := array(select count(*)::int from unnest(v_g) x group by x order by 1 desc);
  v_hand := case when v_counts[1] = 5 then 'five' when v_counts[1] = 4 then 'four'
                 when v_counts[1] = 3 and v_counts[2] = 2 then 'full' when v_counts[1] = 3 then 'three'
                 when v_counts[1] = 2 and v_counts[2] = 2 then 'twopair' when v_counts[1] = 2 then 'pair' else 'none' end;
  return jsonb_build_object('gems', to_jsonb(v_g), 'hand', v_hand, 'mult', (c -> 'pay' ->> v_hand)::numeric);
end;
$$;

-- ---------------------------------------------------------------------------
-- play_extra: Einzelrunden der neuen Spiele
-- ---------------------------------------------------------------------------
create or replace function public.play_extra(p_game_key text, p_bet bigint, p_params jsonb, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.shb_require_user(); v_cfg jsonb := public.shb_game_config(p_game_key);
  v_round uuid; v_seed bytea; v_res jsonb;
begin
  perform public.shb_check_idem(p_idempotency_key);
  select id into v_round from public.game_rounds where idempotency_key = v_uid::text || ':' || p_idempotency_key;
  if v_round is not null then return public.shb_round_json(v_round); end if;
  if v_cfg ->> 'engine' is distinct from 'extra' then raise exception 'GAME_NOT_FOUND'; end if;
  p_params := coalesce(p_params, '{}'::jsonb);
  v_round := public.shb_begin_round(v_uid, p_game_key, p_bet, p_idempotency_key, '{}'::jsonb);
  select server_seed into v_seed from public.game_round_secrets where round_id = v_round;
  v_res := case v_cfg ->> 'fn'
    when 'horse' then public.shb_g_horse(v_seed, p_params, v_cfg)
    when 'shell' then public.shb_g_shell(v_seed, p_params, v_cfg)
    when 'diamonds' then public.shb_g_diamonds(v_seed, p_params, v_cfg)
    else null end;
  if v_res is null then raise exception 'GAME_NOT_FOUND'; end if;
  perform public.shb_finish_round(v_round, floor(p_bet * (v_res ->> 'mult')::numeric)::bigint, v_res);
  return public.shb_round_json(v_round);
end;
$$;

-- ---------------------------------------------------------------------------
-- Pump (wie Stake): 25 Positionen, je nach Stufe 1/3/5/10 davon platzen den Ballon.
-- Multiplikator nach n Pumpen = RTP × C(25,n) / C(25−b,n). Jederzeit auszahlen.
-- ---------------------------------------------------------------------------
create or replace function public.shb_pump_mult(p_n int, p_bad int, p_rtp numeric)
returns numeric language plpgsql immutable set search_path = '' as $$
declare v numeric := p_rtp;
begin
  for i in 0 .. p_n - 1 loop v := v * (25 - i)::numeric / (25 - p_bad - i); end loop;
  return round(v, 4);
end;
$$;

create or replace function public.pump_start(p_bet bigint, p_difficulty text, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.shb_require_user(); v_cfg jsonb := public.shb_game_config('pump');
  v_bad int := (v_cfg -> 'levels' ->> p_difficulty)::int; v_round uuid; v_seed bytea; v_perm int[];
begin
  perform public.shb_check_idem(p_idempotency_key);
  select id into v_round from public.game_rounds where idempotency_key = v_uid::text || ':' || p_idempotency_key;
  if v_round is not null then return public.shb_round_json(v_round); end if;
  if v_bad is null then raise exception 'INVALID_PARAMS'; end if;
  if exists (select 1 from public.game_rounds where user_id = v_uid and game_key = 'pump' and status = 'active') then
    raise exception 'ACTIVE_ROUND_EXISTS';
  end if;
  v_round := public.shb_begin_round(v_uid, 'pump', p_bet, p_idempotency_key, '{}'::jsonb);
  select server_seed into v_seed from public.game_round_secrets where round_id = v_round;
  -- Reihenfolge der 25 Pump-Positionen; die ersten b Positionen in der Permutation sind "Platzer"
  v_perm := public.shb_shuffle(v_seed, 25, 0);
  update public.game_round_secrets set state = jsonb_build_object('bad', to_jsonb(v_perm[1:v_bad])) where round_id = v_round;
  update public.game_rounds set result = jsonb_build_object('difficulty', p_difficulty, 'bad', v_bad, 'pumps', 0, 'multiplier', 1,
    'next_multiplier', public.shb_pump_mult(1, v_bad, (v_cfg ->> 'rtp')::numeric), 'max_pumps', 25 - v_bad, 'state', 'playing', 'actions', 0)
   where id = v_round;
  return public.shb_round_json(v_round);
end;
$$;

create or replace function public.pump_action(p_round uuid, p_seq int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.shb_require_user(); v_r public.game_rounds; v_res jsonb; v_sec jsonb; v_cfg jsonb := public.shb_game_config('pump');
  v_n int; v_bad int; v_mult numeric; v_rtp numeric := (v_cfg ->> 'rtp')::numeric;
begin
  select * into v_r from public.game_rounds where id = p_round and user_id = v_uid and game_key = 'pump' for update;
  if not found then raise exception 'ROUND_NOT_FOUND'; end if;
  if v_r.status <> 'active' then return public.shb_round_json(p_round); end if;
  v_res := v_r.result;
  if p_seq is distinct from (v_res ->> 'actions')::int then return public.shb_round_json(p_round); end if;
  select state into v_sec from public.game_round_secrets where round_id = p_round;
  v_n := (v_res ->> 'pumps')::int; v_bad := (v_res ->> 'bad')::int;
  v_res := v_res || jsonb_build_object('actions', p_seq + 1);
  -- Pumpe Nr. v_n (0-basiert) platzt, wenn diese Position zu den Platzern gehört
  if (v_sec -> 'bad') @> to_jsonb(v_n) then
    perform public.shb_finish_round(p_round, 0, v_res || jsonb_build_object('state', 'popped', 'multiplier', 0, 'popped_at', v_n + 1));
    return public.shb_round_json(p_round);
  end if;
  v_mult := public.shb_pump_mult(v_n + 1, v_bad, v_rtp);
  v_res := v_res || jsonb_build_object('pumps', v_n + 1, 'multiplier', v_mult,
    'next_multiplier', case when v_n + 2 <= 25 - v_bad then public.shb_pump_mult(v_n + 2, v_bad, v_rtp) else null end);
  if v_n + 1 >= 25 - v_bad then
    perform public.shb_finish_round(p_round, floor(v_r.bet_amount * v_mult)::bigint, v_res || jsonb_build_object('state', 'cashed_out'));
    return public.shb_round_json(p_round);
  end if;
  update public.game_rounds set result = v_res where id = p_round;
  return public.shb_round_json(p_round);
end;
$$;

create or replace function public.pump_cashout(p_round uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.shb_require_user(); v_r public.game_rounds;
begin
  select * into v_r from public.game_rounds where id = p_round and user_id = v_uid and game_key = 'pump' for update;
  if not found then raise exception 'ROUND_NOT_FOUND'; end if;
  if v_r.status <> 'active' then return public.shb_round_json(p_round); end if;
  if coalesce((v_r.result ->> 'pumps')::int, 0) = 0 then raise exception 'NOTHING_REVEALED'; end if;
  perform public.shb_finish_round(p_round, floor(v_r.bet_amount * (v_r.result ->> 'multiplier')::numeric)::bigint,
    v_r.result || jsonb_build_object('state', 'cashed_out'));
  return public.shb_round_json(p_round);
end;
$$;

-- ---------------------------------------------------------------------------
-- Jackpot-Slot: 3×3, 5 Linien + gemeinsamer Jackpot-Topf.
-- 2 % jedes Einsatzes fließen in den Topf (bis max_win_per_round). Jackpot-Chance pro Spin = Einsatz / jackpot_odds.
-- ---------------------------------------------------------------------------
create table if not exists public.jackpot_state (
  id int primary key default 1 check (id = 1),
  pot bigint not null default 10000,
  last_winner uuid references public.profiles(id) on delete set null,
  last_win bigint,
  last_won_at timestamptz,
  updated_at timestamptz not null default now()
);
insert into public.jackpot_state (id, pot) values (1, 10000) on conflict do nothing;
alter table public.jackpot_state enable row level security;
drop policy if exists jackpot_state_select on public.jackpot_state;
create policy jackpot_state_select on public.jackpot_state for select to authenticated using (true);
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'jackpot_state') then
    alter publication supabase_realtime add table public.jackpot_state;
  end if;
end $$;

create or replace function public.jackpot_spin(p_bet bigint, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.shb_require_user(); v_cfg jsonb := public.shb_game_config('jackpot_slot');
  v_round uuid; v_seed bytea; v_res jsonb; v_pot bigint; v_cap bigint := coalesce((public.shb_setting('max_win_per_round') #>> '{}')::bigint, 100000);
  v_hit boolean; v_jp bigint := 0; v_base bigint; v_name text;
begin
  perform public.shb_check_idem(p_idempotency_key);
  select id into v_round from public.game_rounds where idempotency_key = v_uid::text || ':' || p_idempotency_key;
  if v_round is not null then return public.shb_round_json(v_round); end if;
  v_round := public.shb_begin_round(v_uid, 'jackpot_slot', p_bet, p_idempotency_key, '{}'::jsonb);
  select server_seed into v_seed from public.game_round_secrets where round_id = v_round;
  v_res := public.shb_g_slots3x3(v_seed, '{}'::jsonb, v_cfg);
  v_base := floor(p_bet * (v_res ->> 'mult')::numeric)::bigint;
  select pot into v_pot from public.jackpot_state where id = 1 for update;
  v_hit := public.shb_rng(v_seed, 7777) < p_bet::numeric / (v_cfg ->> 'jackpot_odds')::numeric;
  if v_hit then
    v_jp := least(v_pot, greatest(0, v_cap - greatest(v_base - p_bet, 0)));
    update public.jackpot_state set pot = (v_cfg ->> 'jackpot_seed')::bigint, last_winner = v_uid, last_win = v_jp, last_won_at = now(), updated_at = now() where id = 1;
    select display_name into v_name from public.profiles where id = v_uid;
    insert into public.notifications (user_id, type, title, message, metadata, pushed_at)
    select p.id, 'jackpot', 'JACKPOT! 💰', v_name || ' hat den Jackpot geknackt: ' || v_jp || ' Credits!', jsonb_build_object('amount', v_jp), now()
      from public.profiles p where p.status = 'active';
  else
    update public.jackpot_state set pot = least(pot + greatest(1, floor(p_bet * (v_cfg ->> 'jackpot_share')::numeric)::bigint), v_cap), updated_at = now() where id = 1;
  end if;
  v_res := v_res || jsonb_build_object('jackpot', v_hit, 'jackpot_win', v_jp, 'pot_before', v_pot);
  perform public.shb_finish_round(v_round, v_base + v_jp, v_res);
  return public.shb_round_json(v_round) || jsonb_build_object('pot', (select pot from public.jackpot_state where id = 1));
end;
$$;

create or replace function public.get_jackpot()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('pot', j.pot, 'last_win', j.last_win, 'last_won_at', j.last_won_at,
    'last_winner', (select display_name from public.profiles where id = j.last_winner))
    from public.jackpot_state j where j.id = 1 and auth.uid() is not null;
$$;

-- ---------------------------------------------------------------------------
-- Spiel-Konfiguration
-- ---------------------------------------------------------------------------
insert into public.game_configs (game_key, display_name, enabled, config) values
('horse_race', 'Pferderennen', true, '{"implemented":true,"engine":"extra","fn":"horse","category":"multiplier","min_bet":10,"max_bet":50000,
  "names":["Blitz","Shisha","Donner","Minze","Komet","Lucky"],
  "weights":[30,22,18,13,10,7],"pays":[3.2,4.35,5.3,7.35,9.6,13.7]}'),
('shell_game', 'Hütchenspiel', true, '{"implemented":true,"engine":"extra","fn":"shell","category":"multiplier","min_bet":10,"max_bet":50000,"pay":2.88}'),
('diamonds', 'Diamonds', true, '{"implemented":true,"engine":"extra","fn":"diamonds","category":"grid","min_bet":10,"max_bet":50000,
  "pay":{"five":50,"four":5,"full":4,"three":3,"twopair":2,"pair":0.1,"none":0}}'),
('pump', 'Pump', true, '{"implemented":true,"engine":"pump","category":"multiplier","min_bet":10,"max_bet":50000,"rtp":0.98,
  "levels":{"easy":1,"medium":3,"hard":5,"expert":10}}'),
('jackpot_slot', 'Jackpot-Slot', true, '{"implemented":true,"engine":"jackpot","category":"slots","min_bet":10,"max_bet":25000,
  "jackpot_share":0.02,"jackpot_odds":2000000,"jackpot_seed":10000,"scatter":"coin","pair_symbol":"cherry","pair_pay":1.9,
  "symbols":[{"key":"cherry","weight":30,"pay3":8.5},{"key":"lemon","weight":24,"pay3":12.6},{"key":"plum","weight":18,"pay3":21},
             {"key":"melon","weight":12,"pay3":47},{"key":"seven","weight":6,"pay3":190},{"key":"coin","weight":5,"pay3":0}]}')
on conflict (game_key) do update set display_name = excluded.display_name, config = excluded.config, updated_at = now();

revoke execute on function public.shb_g_horse(bytea, jsonb, jsonb), public.shb_g_shell(bytea, jsonb, jsonb), public.shb_g_diamonds(bytea, jsonb, jsonb),
  public.shb_pump_mult(int, int, numeric) from public, anon, authenticated;
revoke execute on function public.play_extra(text, bigint, jsonb, text), public.pump_start(bigint, text, text), public.pump_action(uuid, int),
  public.pump_cashout(uuid), public.jackpot_spin(bigint, text), public.get_jackpot() from public, anon;
grant execute on function public.play_extra(text, bigint, jsonb, text), public.pump_start(bigint, text, text), public.pump_action(uuid, int),
  public.pump_cashout(uuid), public.jackpot_spin(bigint, text), public.get_jackpot() to authenticated;
