-- Serverseitige Spiellogik. Ergebnisse werden ausschließlich hier bestimmt.
-- Zufall: pro Runde ein 32-Byte-Seed aus gen_random_bytes (CSPRNG); Zufallswerte = HMAC-SHA256(seed, index).
-- Der Seed-Hash wird beim Start gespeichert, der Seed nach Abschluss offengelegt (nachprüfbar).

-- ---------------------------------------------------------------------------
-- Zufall
-- ---------------------------------------------------------------------------
create or replace function public.shb_rng(p_seed bytea, p_idx int)
returns double precision language sql immutable set search_path = '' as $$
  select (('x' || encode(substr(extensions.hmac(convert_to(p_idx::text, 'UTF8'), p_seed, 'sha256'), 1, 6), 'hex'))::bit(48)::bigint)::double precision
         / 281474976710656.0;
$$;

create or replace function public.shb_rng_int(p_seed bytea, p_idx int, p_n int)
returns int language sql immutable set search_path = '' as $$
  select least(floor(public.shb_rng(p_seed, p_idx) * p_n)::int, p_n - 1);
$$;

-- Multiplikator in Hundertsteln mit 1 % Hausvorteil: P(m >= x) = 0.99 / x
create or replace function public.shb_multiplier_h(p_seed bytea, p_idx int)
returns bigint language sql immutable set search_path = '' as $$
  select least(100000000, greatest(100, floor(99.0 / (1.0 - public.shb_rng(p_seed, p_idx)))::bigint));
$$;

-- ---------------------------------------------------------------------------
-- Gemeinsames Runden-Framework
-- ---------------------------------------------------------------------------
create or replace function public.shb_game_config(p_game_key text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_cfg jsonb; v_enabled boolean;
begin
  select config, enabled into v_cfg, v_enabled from public.game_configs where game_key = p_game_key;
  if v_cfg is null then raise exception 'GAME_NOT_FOUND'; end if;
  if not v_enabled then raise exception 'GAME_DISABLED'; end if;
  return v_cfg;
end;
$$;

create or replace function public.shb_check_idem(p_idem text)
returns void language plpgsql immutable set search_path = '' as $$
begin
  if p_idem is null or char_length(p_idem) < 8 or char_length(p_idem) > 100 then
    raise exception 'INVALID_IDEMPOTENCY_KEY';
  end if;
end;
$$;

create or replace function public.shb_round_json(p_round uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'round_id', r.id, 'game_key', r.game_key, 'status', r.status,
    'bet_amount', r.bet_amount, 'payout_amount', r.payout_amount, 'profit_amount', r.profit_amount,
    'result', r.result, 'server_seed_hash', r.server_seed_hash,
    'started_at', r.started_at, 'completed_at', r.completed_at,
    'balance', (select balance from public.wallets w where w.user_id = r.user_id),
    'server_now', now())
  from public.game_rounds r where r.id = p_round;
$$;

-- Startet eine Runde und bucht den Einsatz atomar ab. Gibt NULL zurück, wenn der Idempotency-Key bereits existiert.
create or replace function public.shb_begin_round(
  p_uid uuid, p_game_key text, p_bet bigint, p_idem text, p_result jsonb, p_secret_state jsonb default '{}'::jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_cfg jsonb := public.shb_game_config(p_game_key);
  v_seed bytea := extensions.gen_random_bytes(32);
  v_round uuid;
  v_name text;
begin
  if p_bet is null or p_bet < (v_cfg ->> 'min_bet')::bigint then raise exception 'BET_TOO_LOW'; end if;
  if p_bet > (v_cfg ->> 'max_bet')::bigint then raise exception 'BET_TOO_HIGH'; end if;
  perform public.shb_rate_limit(p_uid, 'game_round', 90, 60);

  insert into public.game_rounds (user_id, game_key, status, bet_amount, result, server_seed_hash, idempotency_key)
  values (p_uid, p_game_key, 'active', p_bet, coalesce(p_result, '{}'::jsonb),
          encode(extensions.digest(v_seed, 'sha256'), 'hex'), p_uid::text || ':' || p_idem)
  returning id into v_round;

  insert into public.game_round_secrets (round_id, server_seed, state) values (v_round, v_seed, coalesce(p_secret_state, '{}'::jsonb));

  select display_name into v_name from public.game_configs where game_key = p_game_key;
  perform public.shb_apply_ledger(p_uid, -p_bet, 'game_bet', 'Einsatz ' || v_name, 'game_round', v_round, null,
    'game:' || v_round::text || ':bet');
  return v_round;
end;
$$;

-- Zusätzlicher Einsatz innerhalb einer Runde (Blackjack Double/Split)
create or replace function public.shb_extra_bet(p_round uuid, p_amount bigint, p_tag text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_r public.game_rounds; v_name text;
begin
  select * into v_r from public.game_rounds where id = p_round;
  select display_name into v_name from public.game_configs where game_key = v_r.game_key;
  perform public.shb_apply_ledger(v_r.user_id, -p_amount, 'game_bet', 'Einsatz ' || v_name || ' (' || p_tag || ')',
    'game_round', p_round, null, 'game:' || p_round::text || ':' || p_tag);
  update public.game_rounds set bet_amount = bet_amount + p_amount where id = p_round;
end;
$$;

create or replace function public.shb_finish_round(p_round uuid, p_payout bigint, p_result jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_r public.game_rounds;
  v_seed bytea;
  v_name text;
begin
  select * into v_r from public.game_rounds where id = p_round for update;
  if v_r.status <> 'active' then raise exception 'ROUND_NOT_ACTIVE'; end if;
  if p_payout < 0 then raise exception 'INVALID_PAYOUT'; end if;
  select server_seed into v_seed from public.game_round_secrets where round_id = p_round;
  select display_name into v_name from public.game_configs where game_key = v_r.game_key;

  if p_payout > 0 then
    perform public.shb_apply_ledger(v_r.user_id, p_payout, 'game_payout', 'Auszahlung ' || v_name, 'game_round', p_round,
      null, 'game:' || p_round::text || ':payout');
  end if;

  update public.game_rounds
     set status = 'settled', payout_amount = p_payout, profit_amount = p_payout - v_r.bet_amount,
         result = coalesce(p_result, '{}'::jsonb) || jsonb_build_object('server_seed', encode(v_seed, 'hex')),
         completed_at = now()
   where id = p_round;
end;
$$;

-- Lädt eine eigene aktive Runde mit Zeilensperre.
create or replace function public.shb_lock_own_round(p_uid uuid, p_round uuid, p_game_key text)
returns public.game_rounds language plpgsql security definer set search_path = '' as $$
declare v_r public.game_rounds;
begin
  select * into v_r from public.game_rounds where id = p_round and user_id = p_uid and game_key = p_game_key for update;
  if not found then raise exception 'ROUND_NOT_FOUND'; end if;
  return v_r;
end;
$$;

create or replace function public.get_active_round(p_game_key text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_id uuid;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select id into v_id from public.game_rounds
   where user_id = v_uid and game_key = p_game_key and status = 'active'
   order by started_at desc limit 1;
  if v_id is null then return null; end if;
  return public.shb_round_json(v_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Dice: Wurf 0–9999 (= 0.00–99.99), Gewinnchance 1–98 %, Auszahlung 99 / Chance
-- ---------------------------------------------------------------------------
create or replace function public.play_dice(p_bet bigint, p_target int, p_over boolean, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.shb_require_user();
  v_round uuid; v_seed bytea; v_roll int; v_chance int; v_win boolean; v_payout bigint := 0;
begin
  perform public.shb_check_idem(p_idempotency_key);
  select id into v_round from public.game_rounds where idempotency_key = v_uid::text || ':' || p_idempotency_key;
  if v_round is not null then return public.shb_round_json(v_round); end if;

  if p_target is null or p_over is null then raise exception 'INVALID_PARAMS'; end if;
  v_chance := case when p_over then 9999 - p_target else p_target end;
  if v_chance < 100 or v_chance > 9800 then raise exception 'INVALID_PARAMS'; end if;

  v_round := public.shb_begin_round(v_uid, 'dice', p_bet, p_idempotency_key, '{}'::jsonb);
  select server_seed into v_seed from public.game_round_secrets where round_id = v_round;
  v_roll := public.shb_rng_int(v_seed, 0, 10000);
  v_win := case when p_over then v_roll > p_target else v_roll < p_target end;
  if v_win then v_payout := floor(p_bet::numeric * 9900 / v_chance)::bigint; end if;

  perform public.shb_finish_round(v_round, v_payout, jsonb_build_object(
    'roll', v_roll, 'target', p_target, 'over', p_over, 'chance', v_chance,
    'multiplier', round(9900.0 / v_chance, 4), 'win', v_win));
  return public.shb_round_json(v_round);
end;
$$;

-- ---------------------------------------------------------------------------
-- Limbo: Zielmultiplikator in Hundertsteln (101 = 1.01x)
-- ---------------------------------------------------------------------------
create or replace function public.play_limbo(p_bet bigint, p_target bigint, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.shb_require_user();
  v_round uuid; v_seed bytea; v_result bigint; v_win boolean; v_payout bigint := 0;
begin
  perform public.shb_check_idem(p_idempotency_key);
  select id into v_round from public.game_rounds where idempotency_key = v_uid::text || ':' || p_idempotency_key;
  if v_round is not null then return public.shb_round_json(v_round); end if;
  if p_target is null or p_target < 101 or p_target > 100000000 then raise exception 'INVALID_PARAMS'; end if;

  v_round := public.shb_begin_round(v_uid, 'limbo', p_bet, p_idempotency_key, '{}'::jsonb);
  select server_seed into v_seed from public.game_round_secrets where round_id = v_round;
  v_result := public.shb_multiplier_h(v_seed, 0);
  v_win := v_result >= p_target;
  if v_win then v_payout := floor(p_bet::numeric * p_target / 100)::bigint; end if;

  perform public.shb_finish_round(v_round, v_payout, jsonb_build_object(
    'result_multiplier', v_result, 'target_multiplier', p_target, 'win', v_win));
  return public.shb_round_json(v_round);
end;
$$;

-- ---------------------------------------------------------------------------
-- Plinko: Reihen 8/12/16, Risiko low/medium/high, Tabellen aus game_configs
-- ---------------------------------------------------------------------------
create or replace function public.play_plinko(p_bet bigint, p_rows int, p_risk text, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.shb_require_user();
  v_cfg jsonb := public.shb_game_config('plinko');
  v_round uuid; v_seed bytea; v_path int[] := '{}'; v_bucket int := 0; v_bit int; v_mult numeric; v_payout bigint;
begin
  perform public.shb_check_idem(p_idempotency_key);
  select id into v_round from public.game_rounds where idempotency_key = v_uid::text || ':' || p_idempotency_key;
  if v_round is not null then return public.shb_round_json(v_round); end if;
  if p_rows not in (8, 12, 16) or p_risk not in ('low', 'medium', 'high') then raise exception 'INVALID_PARAMS'; end if;

  v_round := public.shb_begin_round(v_uid, 'plinko', p_bet, p_idempotency_key, '{}'::jsonb);
  select server_seed into v_seed from public.game_round_secrets where round_id = v_round;
  for i in 0 .. p_rows - 1 loop
    v_bit := public.shb_rng_int(v_seed, i, 2);
    v_path := v_path || v_bit;
    v_bucket := v_bucket + v_bit;
  end loop;
  v_mult := (v_cfg -> 'tables' -> p_rows::text -> p_risk ->> v_bucket)::numeric;
  if v_mult is null then raise exception 'CONFIG_ERROR'; end if;
  v_payout := floor(p_bet * v_mult)::bigint;

  perform public.shb_finish_round(v_round, v_payout, jsonb_build_object(
    'rows', p_rows, 'risk', p_risk, 'path', to_jsonb(v_path), 'bucket', v_bucket, 'multiplier', v_mult));
  return public.shb_round_json(v_round);
end;
$$;

-- ---------------------------------------------------------------------------
-- Slots: 3 Walzen x 3 Reihen, 5 Gewinnlinien, Scatter-Bonus "SHB-Coin"
-- ---------------------------------------------------------------------------
create or replace function public.play_slots(p_bet bigint, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.shb_require_user();
  v_cfg jsonb := public.shb_game_config('slots');
  v_symbols jsonb := v_cfg -> 'symbols';
  v_round uuid; v_seed bytea;
  v_total_w int := 0; v_pick int; v_acc int; v_sym text;
  v_grid text[] := '{}';
  v_lines int[][] := array[[0,1,2],[3,4,5],[6,7,8],[0,4,8],[6,4,2]];
  v_line_pay numeric; v_total_pay numeric := 0; v_wins jsonb := '[]'::jsonb;
  a text; b text; c text; v_scatter int := 0; v_bonus numeric := 0; v_payout bigint; s jsonb;
begin
  perform public.shb_check_idem(p_idempotency_key);
  select id into v_round from public.game_rounds where idempotency_key = v_uid::text || ':' || p_idempotency_key;
  if v_round is not null then return public.shb_round_json(v_round); end if;

  v_round := public.shb_begin_round(v_uid, 'slots', p_bet, p_idempotency_key, '{}'::jsonb);
  select server_seed into v_seed from public.game_round_secrets where round_id = v_round;

  for s in select * from jsonb_array_elements(v_symbols) loop
    v_total_w := v_total_w + (s ->> 'weight')::int;
  end loop;

  -- Raster zeilenweise: Index = reihe * 3 + walze
  for i in 0 .. 8 loop
    v_pick := public.shb_rng_int(v_seed, i, v_total_w);
    v_acc := 0;
    for s in select * from jsonb_array_elements(v_symbols) loop
      v_acc := v_acc + (s ->> 'weight')::int;
      if v_pick < v_acc then v_sym := s ->> 'key'; exit; end if;
    end loop;
    v_grid := v_grid || v_sym;
    if v_sym = 'coin' then v_scatter := v_scatter + 1; end if;
  end loop;

  for li in 1 .. 5 loop
    a := v_grid[v_lines[li][1] + 1]; b := v_grid[v_lines[li][2] + 1]; c := v_grid[v_lines[li][3] + 1];
    v_line_pay := 0;
    if a = b and b = c and a <> 'coin' then
      v_line_pay := (select (x ->> 'pay3')::numeric from jsonb_array_elements(v_symbols) x where x ->> 'key' = a);
    elsif a = 'cherry' and b = 'cherry' then
      v_line_pay := (v_cfg ->> 'cherry_pair_pay')::numeric;
    end if;
    if coalesce(v_line_pay, 0) > 0 then
      v_total_pay := v_total_pay + v_line_pay;
      v_wins := v_wins || jsonb_build_object('line', li - 1, 'symbol', a, 'pay', v_line_pay);
    end if;
  end loop;

  if v_scatter >= 5 then v_bonus := 50; elsif v_scatter = 4 then v_bonus := 15; elsif v_scatter = 3 then v_bonus := 5; end if;

  -- Linien zahlen auf Linieneinsatz (= Einsatz / 5), Bonus auf Gesamteinsatz
  v_payout := floor(p_bet * v_total_pay / 5 + p_bet * v_bonus)::bigint;

  perform public.shb_finish_round(v_round, v_payout, jsonb_build_object(
    'grid', to_jsonb(v_grid), 'line_wins', v_wins, 'scatter_count', v_scatter, 'bonus_multiplier', v_bonus,
    'multiplier', round((v_total_pay / 5 + v_bonus), 4)));
  return public.shb_round_json(v_round);
end;
$$;

-- ---------------------------------------------------------------------------
-- Roulette (europäisch, eine Null)
-- ---------------------------------------------------------------------------
create or replace function public.shb_roulette_odds(p_type text)
returns int language sql immutable set search_path = '' as $$
  select case p_type
    when 'straight' then 35
    when 'dozen' then 2 when 'column' then 2
    when 'red' then 1 when 'black' then 1 when 'even' then 1 when 'odd' then 1 when 'low' then 1 when 'high' then 1
    else null end;
$$;

create or replace function public.shb_roulette_wins(p_type text, p_value int, p_n int)
returns boolean language sql immutable set search_path = '' as $$
  select case p_type
    when 'straight' then p_n = p_value
    when 'red' then p_n = any(array[1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36])
    when 'black' then p_n > 0 and not (p_n = any(array[1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]))
    when 'even' then p_n > 0 and p_n % 2 = 0
    when 'odd' then p_n % 2 = 1
    when 'low' then p_n between 1 and 18
    when 'high' then p_n between 19 and 36
    when 'dozen' then p_n > 0 and (p_n - 1) / 12 + 1 = p_value
    when 'column' then p_n > 0 and ((p_n - 1) % 3) + 1 = p_value
    else false end;
$$;

create or replace function public.play_roulette(p_bets jsonb, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.shb_require_user();
  v_round uuid; v_seed bytea; v_n int; v_total bigint := 0; v_payout bigint := 0;
  b jsonb; v_type text; v_value int; v_amount bigint; v_details jsonb := '[]'::jsonb; v_win boolean;
begin
  perform public.shb_check_idem(p_idempotency_key);
  select id into v_round from public.game_rounds where idempotency_key = v_uid::text || ':' || p_idempotency_key;
  if v_round is not null then return public.shb_round_json(v_round); end if;

  if jsonb_typeof(p_bets) <> 'array' or jsonb_array_length(p_bets) = 0 or jsonb_array_length(p_bets) > 60 then
    raise exception 'INVALID_PARAMS';
  end if;
  for b in select * from jsonb_array_elements(p_bets) loop
    v_type := b ->> 'type';
    v_value := coalesce((b ->> 'value')::int, 0);
    v_amount := (b ->> 'amount')::bigint;
    if public.shb_roulette_odds(v_type) is null or v_amount is null or v_amount < 1 then raise exception 'INVALID_PARAMS'; end if;
    if v_type = 'straight' and (v_value < 0 or v_value > 36) then raise exception 'INVALID_PARAMS'; end if;
    if v_type in ('dozen', 'column') and v_value not between 1 and 3 then raise exception 'INVALID_PARAMS'; end if;
    v_total := v_total + v_amount;
  end loop;

  v_round := public.shb_begin_round(v_uid, 'roulette', v_total, p_idempotency_key, '{}'::jsonb);
  select server_seed into v_seed from public.game_round_secrets where round_id = v_round;
  v_n := public.shb_rng_int(v_seed, 0, 37);

  for b in select * from jsonb_array_elements(p_bets) loop
    v_type := b ->> 'type';
    v_value := coalesce((b ->> 'value')::int, 0);
    v_amount := (b ->> 'amount')::bigint;
    v_win := public.shb_roulette_wins(v_type, v_value, v_n);
    if v_win then v_payout := v_payout + v_amount * (public.shb_roulette_odds(v_type) + 1); end if;
    v_details := v_details || jsonb_build_object('type', v_type, 'value', v_value, 'amount', v_amount, 'win', v_win,
      'payout', case when v_win then v_amount * (public.shb_roulette_odds(v_type) + 1) else 0 end);
  end loop;

  perform public.shb_finish_round(v_round, v_payout, jsonb_build_object('number', v_n, 'bets', v_details,
    'multiplier', round(v_payout::numeric / v_total, 4)));
  return public.shb_round_json(v_round);
end;
$$;

-- ---------------------------------------------------------------------------
-- Mines
-- ---------------------------------------------------------------------------
create or replace function public.shb_mines_multiplier(p_cells int, p_mines int, p_revealed int)
returns numeric language plpgsql immutable set search_path = '' as $$
declare v numeric := 0.99;
begin
  if p_revealed = 0 then return 1; end if;
  for i in 0 .. p_revealed - 1 loop
    v := v * (p_cells - i)::numeric / (p_cells - p_mines - i)::numeric;
  end loop;
  return round(v, 4);
end;
$$;

create or replace function public.mines_start(p_bet bigint, p_grid int, p_mines int, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.shb_require_user();
  v_round uuid; v_seed bytea; v_cells int; v_deck int[]; v_j int; v_tmp int; v_mines int[];
begin
  perform public.shb_check_idem(p_idempotency_key);
  select id into v_round from public.game_rounds where idempotency_key = v_uid::text || ':' || p_idempotency_key;
  if v_round is not null then return public.shb_round_json(v_round); end if;
  if p_grid not in (4, 5, 6) then raise exception 'INVALID_PARAMS'; end if;
  v_cells := p_grid * p_grid;
  if p_mines < 1 or p_mines > v_cells - 1 then raise exception 'INVALID_PARAMS'; end if;
  if exists (select 1 from public.game_rounds where user_id = v_uid and game_key = 'mines' and status = 'active') then
    raise exception 'ACTIVE_ROUND_EXISTS';
  end if;

  v_round := public.shb_begin_round(v_uid, 'mines', p_bet, p_idempotency_key,
    jsonb_build_object('grid', p_grid, 'mines', p_mines, 'revealed', '[]'::jsonb, 'multiplier', 1, 'next_multiplier',
      public.shb_mines_multiplier(v_cells, p_mines, 1), 'state', 'playing'));
  select server_seed into v_seed from public.game_round_secrets where round_id = v_round;

  -- Fisher-Yates
  v_deck := array(select generate_series(0, v_cells - 1));
  for i in reverse v_cells .. 2 loop
    v_j := public.shb_rng_int(v_seed, i, i) + 1;
    v_tmp := v_deck[i]; v_deck[i] := v_deck[v_j]; v_deck[v_j] := v_tmp;
  end loop;
  v_mines := v_deck[1:p_mines];
  update public.game_round_secrets set state = jsonb_build_object('mines', to_jsonb(v_mines)) where round_id = v_round;
  return public.shb_round_json(v_round);
end;
$$;

create or replace function public.mines_reveal(p_round_id uuid, p_cell int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.shb_require_user();
  v_r public.game_rounds := public.shb_lock_own_round(v_uid, p_round_id, 'mines');
  v_res jsonb := v_r.result;
  v_cells int := (v_res ->> 'grid')::int * (v_res ->> 'grid')::int;
  v_mines_n int := (v_res ->> 'mines')::int;
  v_mines jsonb; v_revealed jsonb := v_res -> 'revealed'; v_count int; v_mult numeric;
begin
  if v_r.status <> 'active' then return public.shb_round_json(p_round_id); end if;
  if p_cell is null or p_cell < 0 or p_cell >= v_cells then raise exception 'INVALID_PARAMS'; end if;
  if v_revealed @> to_jsonb(p_cell) then raise exception 'CELL_ALREADY_REVEALED'; end if;
  select state -> 'mines' into v_mines from public.game_round_secrets where round_id = p_round_id;

  if v_mines @> to_jsonb(p_cell) then
    perform public.shb_finish_round(p_round_id, 0, v_res || jsonb_build_object(
      'state', 'lost', 'hit', p_cell, 'mine_positions', v_mines, 'multiplier', 0));
    return public.shb_round_json(p_round_id);
  end if;

  v_revealed := v_revealed || to_jsonb(p_cell);
  v_count := jsonb_array_length(v_revealed);
  v_mult := public.shb_mines_multiplier(v_cells, v_mines_n, v_count);

  if v_count = v_cells - v_mines_n then
    perform public.shb_finish_round(p_round_id, floor(v_r.bet_amount * v_mult)::bigint, v_res || jsonb_build_object(
      'state', 'cashed_out', 'revealed', v_revealed, 'multiplier', v_mult, 'mine_positions', v_mines));
  else
    update public.game_rounds set result = v_res || jsonb_build_object(
      'revealed', v_revealed, 'multiplier', v_mult,
      'next_multiplier', public.shb_mines_multiplier(v_cells, v_mines_n, v_count + 1))
     where id = p_round_id;
  end if;
  return public.shb_round_json(p_round_id);
end;
$$;

create or replace function public.mines_cashout(p_round_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.shb_require_user();
  v_r public.game_rounds := public.shb_lock_own_round(v_uid, p_round_id, 'mines');
  v_mult numeric; v_mines jsonb;
begin
  if v_r.status <> 'active' then return public.shb_round_json(p_round_id); end if;
  if jsonb_array_length(v_r.result -> 'revealed') = 0 then raise exception 'NOTHING_REVEALED'; end if;
  v_mult := (v_r.result ->> 'multiplier')::numeric;
  select state -> 'mines' into v_mines from public.game_round_secrets where round_id = p_round_id;
  perform public.shb_finish_round(p_round_id, floor(v_r.bet_amount * v_mult)::bigint,
    v_r.result || jsonb_build_object('state', 'cashed_out', 'mine_positions', v_mines));
  return public.shb_round_json(p_round_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Blackjack (6 Decks, Dealer steht auf allen 17, Blackjack zahlt 3:2, ein Split erlaubt)
-- Karten: 0..51, Rang = c % 13 (0 = Ass, 1..9 = 2..10, 10 = B, 11 = D, 12 = K)
-- ---------------------------------------------------------------------------
create or replace function public.shb_bj_card_value(p_card int)
returns int language sql immutable set search_path = '' as $$
  select case when p_card % 13 = 0 then 1 when p_card % 13 >= 9 then 10 else p_card % 13 + 1 end;
$$;

create or replace function public.shb_bj_total(p_cards jsonb)
returns int language plpgsql immutable set search_path = '' as $$
declare v_sum int := 0; v_ace boolean := false; c jsonb;
begin
  for c in select * from jsonb_array_elements(p_cards) loop
    v_sum := v_sum + public.shb_bj_card_value((c #>> '{}')::int);
    if (c #>> '{}')::int % 13 = 0 then v_ace := true; end if;
  end loop;
  if v_ace and v_sum + 10 <= 21 then v_sum := v_sum + 10; end if;
  return v_sum;
end;
$$;

create or replace function public.shb_bj_draw(p_round uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare v_state jsonb; v_pos int; v_card int;
begin
  select state into v_state from public.game_round_secrets where round_id = p_round for update;
  v_pos := (v_state ->> 'pos')::int;
  v_card := (v_state -> 'shoe' ->> v_pos)::int;
  update public.game_round_secrets set state = jsonb_set(v_state, '{pos}', to_jsonb(v_pos + 1)) where round_id = p_round;
  return v_card;
end;
$$;

-- Dealer spielt aus und rechnet alle Hände ab.
create or replace function public.shb_bj_finish(p_round uuid, p_res jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_dealer jsonb; v_hole int; v_dt int; v_hands jsonb := p_res -> 'hands'; v_h jsonb; v_out jsonb := '[]'::jsonb;
  v_pt int; v_bet bigint; v_pay bigint; v_total bigint := 0; v_outcome text; v_all_bust boolean := true;
begin
  select (state ->> 'hole')::int into v_hole from public.game_round_secrets where round_id = p_round;
  v_dealer := (p_res -> 'dealer' -> 'cards') || to_jsonb(v_hole);

  for v_h in select * from jsonb_array_elements(v_hands) loop
    if public.shb_bj_total(v_h -> 'cards') <= 21 then v_all_bust := false; end if;
  end loop;

  if not v_all_bust then
    while public.shb_bj_total(v_dealer) < 17 loop
      v_dealer := v_dealer || to_jsonb(public.shb_bj_draw(p_round));
    end loop;
  end if;
  v_dt := public.shb_bj_total(v_dealer);

  for v_h in select * from jsonb_array_elements(v_hands) loop
    v_pt := public.shb_bj_total(v_h -> 'cards');
    v_bet := (v_h ->> 'bet')::bigint;
    if v_pt > 21 then v_outcome := 'bust'; v_pay := 0;
    elsif v_dt > 21 or v_pt > v_dt then v_outcome := 'win'; v_pay := v_bet * 2;
    elsif v_pt = v_dt then v_outcome := 'push'; v_pay := v_bet;
    else v_outcome := 'lose'; v_pay := 0; end if;
    v_total := v_total + v_pay;
    v_out := v_out || (v_h || jsonb_build_object('outcome', v_outcome, 'payout', v_pay, 'total', v_pt));
  end loop;

  perform public.shb_finish_round(p_round, v_total, p_res || jsonb_build_object(
    'hands', v_out, 'phase', 'settled',
    'dealer', jsonb_build_object('cards', v_dealer, 'hidden', false, 'total', v_dt)));
end;
$$;

create or replace function public.blackjack_start(p_bet bigint, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.shb_require_user();
  v_round uuid; v_seed bytea; v_shoe int[]; v_j int; v_tmp int; v_n int := 312;
  v_p jsonb; v_d_up int; v_hole int; v_pt int; v_dt int; v_res jsonb; v_payout bigint; v_outcome text;
begin
  perform public.shb_check_idem(p_idempotency_key);
  select id into v_round from public.game_rounds where idempotency_key = v_uid::text || ':' || p_idempotency_key;
  if v_round is not null then return public.shb_round_json(v_round); end if;
  if exists (select 1 from public.game_rounds where user_id = v_uid and game_key = 'blackjack' and status = 'active') then
    raise exception 'ACTIVE_ROUND_EXISTS';
  end if;

  v_round := public.shb_begin_round(v_uid, 'blackjack', p_bet, p_idempotency_key, '{}'::jsonb);
  select server_seed into v_seed from public.game_round_secrets where round_id = v_round;

  v_shoe := array(select g % 52 from generate_series(0, v_n - 1) g);
  for i in reverse v_n .. 2 loop
    v_j := public.shb_rng_int(v_seed, i, i) + 1;
    v_tmp := v_shoe[i]; v_shoe[i] := v_shoe[v_j]; v_shoe[v_j] := v_tmp;
  end loop;

  -- Austeilen: Spieler, Dealer, Spieler, Dealer (verdeckt)
  v_p := jsonb_build_array(v_shoe[1], v_shoe[3]);
  v_d_up := v_shoe[2];
  v_hole := v_shoe[4];
  update public.game_round_secrets set state = jsonb_build_object('shoe', to_jsonb(v_shoe), 'pos', 4, 'hole', v_hole)
   where round_id = v_round;

  v_res := jsonb_build_object(
    'phase', 'player', 'active_hand', 0, 'actions', 0,
    'hands', jsonb_build_array(jsonb_build_object('cards', v_p, 'bet', p_bet, 'status', 'playing', 'doubled', false)),
    'dealer', jsonb_build_object('cards', jsonb_build_array(v_d_up), 'hidden', true));

  v_pt := public.shb_bj_total(v_p);
  v_dt := public.shb_bj_total(jsonb_build_array(v_d_up, v_hole));
  if v_pt = 21 or v_dt = 21 then
    if v_pt = 21 and v_dt = 21 then v_outcome := 'push'; v_payout := p_bet;
    elsif v_pt = 21 then v_outcome := 'blackjack'; v_payout := floor(p_bet * 2.5)::bigint;
    else v_outcome := 'dealer_blackjack'; v_payout := 0; end if;
    perform public.shb_finish_round(v_round, v_payout, v_res || jsonb_build_object(
      'phase', 'settled',
      'hands', jsonb_build_array(jsonb_build_object('cards', v_p, 'bet', p_bet, 'status', 'stood', 'doubled', false,
        'outcome', v_outcome, 'payout', v_payout, 'total', v_pt)),
      'dealer', jsonb_build_object('cards', jsonb_build_array(v_d_up, v_hole), 'hidden', false, 'total', v_dt)));
  else
    update public.game_rounds set result = v_res where id = v_round;
  end if;
  return public.shb_round_json(v_round);
end;
$$;

-- p_action_seq = Anzahl bereits ausgeführter Aktionen (Schutz gegen doppelte Requests)
create or replace function public.blackjack_action(p_round_id uuid, p_action text, p_action_seq int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.shb_require_user();
  v_r public.game_rounds := public.shb_lock_own_round(v_uid, p_round_id, 'blackjack');
  v_res jsonb := v_r.result;
  v_idx int := (v_res ->> 'active_hand')::int;
  v_hand jsonb := v_res -> 'hands' -> v_idx;
  v_cards jsonb := v_hand -> 'cards';
  v_bet bigint := (v_hand ->> 'bet')::bigint;
  v_card int; v_hands jsonb; v_h1 jsonb; v_h2 jsonb; v_total int; v_done boolean := false;
begin
  if v_r.status <> 'active' or v_res ->> 'phase' <> 'player' then return public.shb_round_json(p_round_id); end if;
  if p_action_seq is distinct from (v_res ->> 'actions')::int then
    -- Doppelter oder veralteter Request: aktuellen Stand zurückgeben, nichts ausführen
    return public.shb_round_json(p_round_id);
  end if;

  if p_action = 'hit' then
    v_card := public.shb_bj_draw(p_round_id);
    v_cards := v_cards || to_jsonb(v_card);
    v_total := public.shb_bj_total(v_cards);
    v_hand := v_hand || jsonb_build_object('cards', v_cards,
      'status', case when v_total > 21 then 'bust' when v_total = 21 then 'stood' else 'playing' end);
    v_done := v_total >= 21;
  elsif p_action = 'stand' then
    v_hand := v_hand || jsonb_build_object('status', 'stood');
    v_done := true;
  elsif p_action = 'double' then
    if jsonb_array_length(v_cards) <> 2 then raise exception 'ACTION_NOT_ALLOWED'; end if;
    perform public.shb_extra_bet(p_round_id, v_bet, 'double' || v_idx);
    v_card := public.shb_bj_draw(p_round_id);
    v_cards := v_cards || to_jsonb(v_card);
    v_total := public.shb_bj_total(v_cards);
    v_hand := v_hand || jsonb_build_object('cards', v_cards, 'bet', v_bet * 2, 'doubled', true,
      'status', case when v_total > 21 then 'bust' else 'stood' end);
    v_done := true;
  elsif p_action = 'split' then
    if jsonb_array_length(v_res -> 'hands') <> 1 or jsonb_array_length(v_cards) <> 2
       or public.shb_bj_card_value((v_cards ->> 0)::int) <> public.shb_bj_card_value((v_cards ->> 1)::int) then
      raise exception 'ACTION_NOT_ALLOWED';
    end if;
    perform public.shb_extra_bet(p_round_id, v_bet, 'split');
    v_h1 := jsonb_build_object('cards', jsonb_build_array((v_cards ->> 0)::int, public.shb_bj_draw(p_round_id)),
      'bet', v_bet, 'status', 'playing', 'doubled', false, 'split', true);
    v_h2 := jsonb_build_object('cards', jsonb_build_array((v_cards ->> 1)::int, public.shb_bj_draw(p_round_id)),
      'bet', v_bet, 'status', 'playing', 'doubled', false, 'split', true);
    -- Geteilte Asse erhalten nur eine Karte
    if (v_cards ->> 0)::int % 13 = 0 then
      v_h1 := v_h1 || '{"status":"stood"}'::jsonb;
      v_h2 := v_h2 || '{"status":"stood"}'::jsonb;
    end if;
    if public.shb_bj_total(v_h1 -> 'cards') = 21 then v_h1 := v_h1 || '{"status":"stood"}'::jsonb; end if;
    if public.shb_bj_total(v_h2 -> 'cards') = 21 then v_h2 := v_h2 || '{"status":"stood"}'::jsonb; end if;
    v_res := v_res || jsonb_build_object('hands', jsonb_build_array(v_h1, v_h2), 'active_hand', 0,
      'actions', (v_res ->> 'actions')::int + 1);
    if v_h1 ->> 'status' <> 'playing' then
      v_res := jsonb_set(v_res, '{active_hand}', '1'::jsonb);
      if v_h2 ->> 'status' <> 'playing' then
        perform public.shb_bj_finish(p_round_id, v_res);
        return public.shb_round_json(p_round_id);
      end if;
    end if;
    update public.game_rounds set result = v_res where id = p_round_id;
    return public.shb_round_json(p_round_id);
  else
    raise exception 'INVALID_ACTION';
  end if;

  v_hands := jsonb_set(v_res -> 'hands', array[v_idx::text], v_hand);
  v_res := v_res || jsonb_build_object('hands', v_hands, 'actions', (v_res ->> 'actions')::int + 1);

  if v_done then
    if v_idx + 1 < jsonb_array_length(v_hands) then
      v_res := jsonb_set(v_res, '{active_hand}', to_jsonb(v_idx + 1));
    else
      perform public.shb_bj_finish(p_round_id, v_res);
      return public.shb_round_json(p_round_id);
    end if;
  end if;
  update public.game_rounds set result = v_res where id = p_round_id;
  return public.shb_round_json(p_round_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Crash: Multiplikator m(t) = e^(0.00006 * t_ms), Start 3 Sekunden nach Einsatz.
-- Crash-Punkt wird beim Start serverseitig festgelegt und bleibt bis zum Ende geheim.
-- ---------------------------------------------------------------------------
create or replace function public.shb_crash_current_h(p_run_start timestamptz)
returns bigint language sql stable set search_path = '' as $$
  select case when now() < p_run_start then 100
    else floor(100 * exp(0.00006 * extract(epoch from (now() - p_run_start)) * 1000))::bigint end;
$$;

create or replace function public.crash_start(p_bet bigint, p_auto_cashout bigint, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.shb_require_user();
  v_round uuid; v_seed bytea; v_crash bigint; v_run_start timestamptz := now() + interval '3 seconds';
begin
  perform public.shb_check_idem(p_idempotency_key);
  select id into v_round from public.game_rounds where idempotency_key = v_uid::text || ':' || p_idempotency_key;
  if v_round is not null then return public.shb_round_json(v_round); end if;
  if p_auto_cashout is not null and (p_auto_cashout < 101 or p_auto_cashout > 100000000) then raise exception 'INVALID_PARAMS'; end if;
  if exists (select 1 from public.game_rounds where user_id = v_uid and game_key = 'crash' and status = 'active') then
    raise exception 'ACTIVE_ROUND_EXISTS';
  end if;

  v_round := public.shb_begin_round(v_uid, 'crash', p_bet, p_idempotency_key,
    jsonb_build_object('phase', 'waiting', 'run_start', v_run_start, 'auto_cashout', p_auto_cashout, 'growth', 0.00006));
  select server_seed into v_seed from public.game_round_secrets where round_id = v_round;
  v_crash := public.shb_multiplier_h(v_seed, 0);
  update public.game_round_secrets set state = jsonb_build_object('crash', v_crash) where round_id = v_round;
  return public.shb_round_json(v_round);
end;
$$;

-- Interne Abrechnung (Cashout oder Crash). Gibt true zurück, wenn abgerechnet wurde.
create or replace function public.shb_crash_resolve(p_round uuid, p_cashout boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_r public.game_rounds;
  v_crash bigint; v_run_start timestamptz; v_auto bigint; v_cur bigint; v_crash_ms numeric;
begin
  select * into v_r from public.game_rounds where id = p_round for update;
  if v_r.status <> 'active' then return true; end if;
  select (state ->> 'crash')::bigint into v_crash from public.game_round_secrets where round_id = p_round;
  v_run_start := (v_r.result ->> 'run_start')::timestamptz;
  v_auto := (v_r.result ->> 'auto_cashout')::bigint;
  v_cur := public.shb_crash_current_h(v_run_start);
  v_crash_ms := ln(v_crash / 100.0) / 0.00006;

  -- Auto-Cashout greift, wenn das Ziel vor dem Crash erreicht wird
  if v_auto is not null and v_auto <= v_crash and v_cur >= v_auto then
    perform public.shb_finish_round(p_round, floor(v_r.bet_amount * v_auto / 100.0)::bigint, v_r.result || jsonb_build_object(
      'phase', 'settled', 'crash_point', v_crash, 'cashout_multiplier', v_auto, 'win', true, 'auto', true));
    return true;
  end if;

  if v_cur >= v_crash or now() >= v_run_start + make_interval(secs => v_crash_ms / 1000.0) then
    perform public.shb_finish_round(p_round, 0, v_r.result || jsonb_build_object(
      'phase', 'settled', 'crash_point', v_crash, 'cashout_multiplier', null, 'win', false));
    return true;
  end if;

  if p_cashout then
    if now() < v_run_start then raise exception 'ROUND_NOT_STARTED'; end if;
    perform public.shb_finish_round(p_round, floor(v_r.bet_amount * v_cur / 100.0)::bigint, v_r.result || jsonb_build_object(
      'phase', 'settled', 'crash_point', v_crash, 'cashout_multiplier', v_cur, 'win', true, 'auto', false));
    return true;
  end if;
  return false;
end;
$$;

create or replace function public.crash_cashout(p_round_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.shb_require_user();
begin
  perform public.shb_lock_own_round(v_uid, p_round_id, 'crash');
  perform public.shb_crash_resolve(p_round_id, true);
  return public.shb_round_json(p_round_id);
end;
$$;

-- Polling: rechnet ab, sobald der Crash-Zeitpunkt erreicht ist; liefert sonst den aktuellen Multiplikator.
create or replace function public.crash_poll(p_round_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_r public.game_rounds;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  v_r := public.shb_lock_own_round(v_uid, p_round_id, 'crash');
  if v_r.status = 'active' then
    perform public.shb_crash_resolve(p_round_id, false);
  end if;
  return public.shb_round_json(p_round_id) || jsonb_build_object(
    'current_multiplier', public.shb_crash_current_h((v_r.result ->> 'run_start')::timestamptz));
end;
$$;

-- Gemeinsame Rundenanzeige: die letzten Crash-Punkte aller Spieler (ohne Personenbezug)
create or replace function public.get_crash_history(p_limit int default 20)
returns table (crash_point bigint, completed_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select (result ->> 'crash_point')::bigint, completed_at
    from public.game_rounds
   where game_key = 'crash' and status = 'settled' and auth.uid() is not null
   order by completed_at desc
   limit least(greatest(p_limit, 1), 50);
$$;

-- Wartung (Cron): abgelaufene Crash-Runden abrechnen, alte Rate-Limit-Einträge löschen.
create or replace function public.shb_maintenance()
returns void language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  for v_id in select id from public.game_rounds where game_key = 'crash' and status = 'active'
                and started_at < now() - interval '10 seconds' loop
    perform public.shb_crash_resolve(v_id, false);
  end loop;
  delete from public.rate_limit_events where created_at < now() - interval '2 hours';
  update public.game_sessions set ended_at = last_heartbeat_at
   where ended_at is null and last_heartbeat_at < now() - interval '5 minutes';
end;
$$;
