-- Test für Shisha Diamonds v2: führt die Migration im DO-Block aus und endet IMMER mit einer Exception (alles wird zurückgerollt).
do $test$
declare
  v_cfg jsonb; v_sum numeric := 0; v_fs int := 0; v_r jsonb; v_u uuid := gen_random_uuid(); v_bal bigint; v_bal2 bigint;
  v_round jsonb; v_tries int := 0; v_out text := ''; v_maxst int := 0; v_n int := 1500;
begin
  set local statement_timeout = '110s';
  execute $mig$-- Shisha Diamonds v2 (nach dem Vorbild "Sticky Diamonds"): 5x3, 10 Linien, Diamant = Wild,
-- 3+ Sterne (Scatter) = Freispiele, in denen jeder Diamant bis zum Ende kleben bleibt.
-- Nach einem Gewinn: Risikospiel (Farbe ×2 / Symbol ×4) oder Einsammeln.
-- Paytable in scripts/calibrate.mjs nachgerechnet (Quote ca. 96 %, Risikospiel ist neutral).

-- Linienauswertung: Wild ersetzt alles außer Scatter, Gewinne ab 2 bzw. 3 gleichen von links
create or replace function public.shb_sd_lines(p_grid text[], p_cfg jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  v_line jsonb; v_syms text[]; v_base text; v_n int; v_pay numeric; v_total numeric := 0; v_wins jsonb := '[]'::jsonb; li int := 0;
begin
  for v_line in select * from jsonb_array_elements(p_cfg -> 'lines') loop
    v_syms := array(select p_grid[(r.value #>> '{}')::int * 5 + r.ordinality::int] from jsonb_array_elements(v_line) with ordinality r);
    v_base := null;
    for i in 1 .. 5 loop
      if v_syms[i] <> 'wild' then v_base := v_syms[i]; exit; end if;
    end loop;
    v_base := coalesce(v_base, 'seven');
    v_n := 0;
    if v_base <> 'star' then
      for i in 1 .. 5 loop
        exit when not (v_syms[i] = v_base or v_syms[i] = 'wild');
        v_n := v_n + 1;
      end loop;
    end if;
    v_pay := case when v_n >= 2 then (p_cfg -> 'pays' -> v_base ->> (v_n - 1))::numeric end;
    if coalesce(v_pay, 0) > 0 then
      v_total := v_total + v_pay;
      v_wins := v_wins || jsonb_build_object('line', li, 'symbol', v_base, 'count', v_n, 'pay', v_pay);
    end if;
    li := li + 1;
  end loop;
  return jsonb_build_object('pay', v_total, 'wins', v_wins);
end;
$$;

-- Ein kompletter Spin inkl. aller Freispiele. 'mult' bezogen auf den Gesamteinsatz.
create or replace function public.shb_sd_spin(p_seed bytea, c jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  v_lines int := jsonb_array_length(c -> 'lines');
  v_grid text[] := public.shb_fill_grid(p_seed, 15, c -> 'symbols', 0);
  v_l jsonb := public.shb_sd_lines(v_grid, c);
  v_stars int := (select count(*) from unnest(v_grid) x where x = 'star');
  v_scatter numeric := coalesce((c -> 'scatter_pay' ->> v_stars::text)::numeric, 0);
  v_fs int := coalesce((c -> 'free_spins' ->> v_stars::text)::int, 0);
  v_base numeric := (v_l ->> 'pay')::numeric / v_lines + v_scatter;
  v_sticky boolean[] := array_fill(false, array[15]); v_g text[]; v_fl jsonb; v_fsc numeric; v_fwin numeric := 0;
  v_spins jsonb := '[]'::jsonb; v_st int;
begin
  for s in 1 .. v_fs loop
    v_g := public.shb_fill_grid(p_seed, 15, c -> 'symbols', 100 + s * 20);
    for i in 1 .. 15 loop
      if v_sticky[i] then v_g[i] := 'wild'; elsif v_g[i] = 'wild' then v_sticky[i] := true; end if;
    end loop;
    v_fl := public.shb_sd_lines(v_g, c);
    v_st := (select count(*) from unnest(v_g) x where x = 'star');
    v_fsc := coalesce((c -> 'scatter_pay' ->> v_st::text)::numeric, 0);
    v_fwin := v_fwin + (v_fl ->> 'pay')::numeric / v_lines + v_fsc;
    v_spins := v_spins || jsonb_build_object('grid', to_jsonb(v_g), 'line_wins', v_fl -> 'wins', 'scatter_win', v_fsc,
      'win', round((v_fl ->> 'pay')::numeric / v_lines + v_fsc, 4),
      'sticky', (select coalesce(jsonb_agg(i - 1), '[]'::jsonb) from generate_series(1, 15) i where v_sticky[i]));
  end loop;
  return jsonb_build_object('grid', to_jsonb(v_grid), 'line_wins', v_l -> 'wins', 'stars', v_stars, 'scatter_win', v_scatter,
    'base_win', round(v_base, 4), 'feature', v_fs > 0, 'free_spins', v_spins, 'feature_win', round(v_fwin, 4),
    'spin_mult', round(v_base + v_fwin, 4));
end;
$$;

-- Spin starten. Ohne Gewinn wird die Runde sofort abgerechnet, sonst wartet sie auf Risiko/Einsammeln.
create or replace function public.sticky_spin(p_bet bigint, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.shb_require_user();
  v_cfg jsonb := public.shb_game_config('shisha_diamonds');
  v_round uuid; v_seed bytea; v_res jsonb; v_mult numeric;
begin
  perform public.shb_check_idem(p_idempotency_key);
  select id into v_round from public.game_rounds where idempotency_key = v_uid::text || ':' || p_idempotency_key;
  if v_round is not null then return public.shb_round_json(v_round); end if;
  if v_cfg ->> 'engine' is distinct from 'sticky' then raise exception 'GAME_NOT_FOUND'; end if;
  if exists (select 1 from public.game_rounds where user_id = v_uid and game_key = 'shisha_diamonds' and status = 'active') then
    raise exception 'ACTIVE_ROUND_EXISTS';
  end if;
  v_round := public.shb_begin_round(v_uid, 'shisha_diamonds', p_bet, p_idempotency_key, '{}'::jsonb);
  select server_seed into v_seed from public.game_round_secrets where round_id = v_round;
  v_res := public.shb_sd_spin(v_seed, v_cfg);
  v_mult := (v_res ->> 'spin_mult')::numeric;
  v_res := v_res || jsonb_build_object('multiplier', v_mult, 'step', 1, 'gambles', '[]'::jsonb, 'actions', 0,
    'state', case when v_mult > 0 then 'gamble' else 'lost' end, 'mult', v_mult);
  if v_mult > 0 then
    update public.game_rounds set result = v_res where id = v_round;
  else
    perform public.shb_finish_round(v_round, 0, v_res);
  end if;
  return public.shb_round_json(v_round);
end;
$$;

-- Risikospiel: Farbe (rot/schwarz, ×2) oder Symbol (♠ ♥ ♦ ♣, ×4). Verlust beendet die Runde.
create or replace function public.sticky_gamble(p_round_id uuid, p_pick text, p_seq int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.shb_require_user(); v_r public.game_rounds; v_res jsonb; v_seed bytea; v_cfg jsonb;
  v_card int; v_suit int; v_win boolean; v_mult numeric; v_n int;
begin
  select * into v_r from public.game_rounds where id = p_round_id and user_id = v_uid and game_key = 'shisha_diamonds' for update;
  if not found then raise exception 'ROUND_NOT_FOUND'; end if;
  if v_r.status <> 'active' then return public.shb_round_json(p_round_id); end if;
  v_res := v_r.result;
  if p_seq is distinct from (v_res ->> 'actions')::int then return public.shb_round_json(p_round_id); end if;
  if p_pick not in ('red', 'black', 'spades', 'hearts', 'diamonds', 'clubs') then raise exception 'INVALID_ACTION'; end if;
  v_cfg := public.shb_game_config('shisha_diamonds');
  v_n := jsonb_array_length(v_res -> 'gambles');
  if v_n >= (v_cfg ->> 'max_gambles')::int then raise exception 'ACTION_NOT_ALLOWED'; end if;
  select server_seed into v_seed from public.game_round_secrets where round_id = p_round_id;
  v_card := public.shb_rng_int(v_seed, 5000 + v_n, 52);
  v_suit := v_card / 13;
  v_win := case p_pick when 'red' then v_suit in (1, 2) when 'black' then v_suit in (0, 3)
                       when 'spades' then v_suit = 0 when 'hearts' then v_suit = 1 when 'diamonds' then v_suit = 2 else v_suit = 3 end;
  v_mult := case when not v_win then 0 when p_pick in ('red', 'black') then (v_res ->> 'multiplier')::numeric * 2
                 else (v_res ->> 'multiplier')::numeric * 4 end;
  v_res := v_res || jsonb_build_object('multiplier', v_mult, 'mult', v_mult, 'actions', p_seq + 1,
    'gambles', (v_res -> 'gambles') || jsonb_build_object('pick', p_pick, 'card', v_card, 'win', v_win));
  if not v_win then
    perform public.shb_finish_round(p_round_id, 0, v_res || jsonb_build_object('state', 'gamble_lost'));
  elsif v_mult >= (v_cfg ->> 'gamble_cap')::numeric or v_n + 1 >= (v_cfg ->> 'max_gambles')::int then
    perform public.shb_finish_round(p_round_id, floor(v_r.bet_amount * v_mult)::bigint, v_res || jsonb_build_object('state', 'collected'));
  else
    update public.game_rounds set result = v_res where id = p_round_id;
  end if;
  return public.shb_round_json(p_round_id);
end;
$$;

create or replace function public.sticky_collect(p_round_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.shb_require_user(); v_r public.game_rounds;
begin
  select * into v_r from public.game_rounds where id = p_round_id and user_id = v_uid and game_key = 'shisha_diamonds' for update;
  if not found then raise exception 'ROUND_NOT_FOUND'; end if;
  if v_r.status <> 'active' then return public.shb_round_json(p_round_id); end if;
  perform public.shb_finish_round(p_round_id, floor(v_r.bet_amount * (v_r.result ->> 'multiplier')::numeric)::bigint,
    v_r.result || jsonb_build_object('state', 'collected'));
  return public.shb_round_json(p_round_id);
end;
$$;

update public.game_configs set config = '{"implemented":true,"engine":"sticky","category":"slots","min_bet":10,"max_bet":25000,
  "max_gambles":5,"gamble_cap":500,
  "symbols":[{"key":"cherry","weight":22},{"key":"lemon","weight":20},{"key":"orange","weight":20},{"key":"plum","weight":18},{"key":"bell","weight":12},
             {"key":"grapes","weight":9},{"key":"melon","weight":9},{"key":"seven","weight":5},{"key":"wild","weight":4},{"key":"star","weight":3}],
  "pays":{"cherry":[0,0,8,20,64],"lemon":[0,0,8,20,64],"orange":[0,0,8,20,64],"plum":[0,0,13,32,96],"bell":[0,0,17,48,160],
          "grapes":[0,3,24,64,240],"melon":[0,3,24,64,240],"seven":[0,0,64,240,1200]},
  "scatter_pay":{"3":2,"4":10,"5":50},"free_spins":{"3":10,"4":15,"5":20},
  "lines":[[1,1,1,1,1],[0,0,0,0,0],[2,2,2,2,2],[0,1,2,1,0],[2,1,0,1,2],[0,0,1,2,2],[2,2,1,0,0],[1,0,0,0,1],[1,2,2,2,1],[0,1,1,1,0]]}'::jsonb,
  updated_at = now()
where game_key = 'shisha_diamonds';

revoke execute on function public.shb_sd_lines(text[], jsonb), public.shb_sd_spin(bytea, jsonb) from public, anon, authenticated;
revoke execute on function public.sticky_spin(bigint, text), public.sticky_gamble(uuid, text, int), public.sticky_collect(uuid) from public, anon;
grant execute on function public.sticky_spin(bigint, text), public.sticky_gamble(uuid, text, int), public.sticky_collect(uuid) to authenticated;
$mig$;
  select config into v_cfg from public.game_configs where game_key = 'shisha_diamonds';
  for i in 1 .. v_n loop
    v_r := public.shb_sd_spin(extensions.gen_random_bytes(32), v_cfg);
    v_sum := v_sum + (v_r ->> 'spin_mult')::numeric;
    if (v_r ->> 'feature')::boolean then
      v_fs := v_fs + 1;
      v_maxst := greatest(v_maxst, jsonb_array_length(v_r -> 'free_spins' -> -1 -> 'sticky'));
    end if;
  end loop;
  v_out := format('RTP %s%% (n=%s) FS=%s maxSticky=%s', round(v_sum / v_n * 100, 1), v_n, v_fs, v_maxst);

  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
  values (v_u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sticky-test@shb.test', '{"username":"t_sticky"}');
  update public.profiles set status = 'active' where id = v_u;
  perform public.shb_apply_ledger(v_u, 100000, 'admin_credit', 'Test', null, null, null, 'sticky-test-credit-1');
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_u, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_u::text, true);

  -- Spins bis zu einem Gewinn; Verlustspins sind sofort abgerechnet
  loop
    v_tries := v_tries + 1;
    select balance into v_bal from public.wallets where user_id = v_u;
    v_round := public.sticky_spin(100, 'sticky-test-spin-' || v_tries);
    exit when v_round ->> 'status' = 'active' or v_tries > 60;
    if v_round ->> 'status' <> 'settled' or (select balance from public.wallets where user_id = v_u) <> v_bal - 100 then
      raise exception 'TEST_FAIL loss settle %', v_round;
    end if;
  end loop;
  if v_round ->> 'status' <> 'active' then raise exception 'TEST_FAIL no win in 60'; end if;
  -- Doppelte Idempotenz liefert dieselbe Runde
  if (public.sticky_spin(100, 'sticky-test-spin-' || v_tries) ->> 'round_id') <> v_round ->> 'round_id' then raise exception 'TEST_FAIL idem'; end if;
  begin perform public.sticky_spin(100, 'sticky-test-other'); raise exception 'TEST_FAIL second active';
  exception when others then if sqlerrm not like '%ACTIVE_ROUND_EXISTS%' then raise; end if; end;
  begin perform public.sticky_gamble((v_round ->> 'round_id')::uuid, 'purple', 0); raise exception 'TEST_FAIL bad pick';
  exception when others then if sqlerrm not like '%INVALID_ACTION%' then raise; end if; end;
  -- Falscher seq => keine Änderung
  if (public.sticky_gamble((v_round ->> 'round_id')::uuid, 'red', 7) -> 'result' ->> 'actions') <> '0' then raise exception 'TEST_FAIL seq'; end if;
  v_r := public.sticky_gamble((v_round ->> 'round_id')::uuid, 'red', 0);
  v_out := v_out || format(' | gamble1 win=%s status=%s mult %s->%s', v_r -> 'result' -> 'gambles' -> 0 ->> 'win', v_r ->> 'status',
    v_round -> 'result' ->> 'multiplier', v_r -> 'result' ->> 'multiplier');
  if v_r ->> 'status' = 'active' then
    select balance into v_bal2 from public.wallets where user_id = v_u;
    v_r := public.sticky_collect((v_round ->> 'round_id')::uuid);
    if (v_r ->> 'payout_amount')::bigint <> floor(100 * (v_r -> 'result' ->> 'multiplier')::numeric)
       or (select balance from public.wallets where user_id = v_u) <> v_bal2 + (v_r ->> 'payout_amount')::bigint then
      raise exception 'TEST_FAIL collect %', v_r;
    end if;
    v_out := v_out || format(' | collected %s', v_r ->> 'payout_amount');
  elsif (v_r ->> 'payout_amount')::bigint <> 0 then raise exception 'TEST_FAIL lost gamble paid';
  end if;
  if (public.sticky_collect((v_round ->> 'round_id')::uuid) ->> 'status') <> 'settled' then raise exception 'TEST_FAIL recollect'; end if;
  -- Andere Engines lehnen das Spiel ab
  begin perform public.play_game('shisha_diamonds', 100, '{}', 'sticky-test-pg'); raise exception 'TEST_FAIL play_game';
  exception when others then if sqlerrm not like '%GAME_NOT_FOUND%' then raise; end if; end;
  raise exception 'TEST_OK %', v_out;
end $test$;