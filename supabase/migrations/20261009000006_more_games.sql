-- Erweiterung: generische Spiele-Engine + 30 weitere Spiele + Shisha Diamonds.
-- Einfache Spiele: play_game(game_key, bet, params, key) – Start und Abrechnung atomar.
-- Mehrstufige Spiele: step_start / step_action / step_cashout.
-- Alle Tabellen sind in scripts/calibrate.mjs nachgerechnet (Auszahlungsquote ca. 95–99 %).

-- ---------------------------------------------------------------------------
-- Hilfsfunktionen
-- ---------------------------------------------------------------------------
create or replace function public.shb_shuffle(p_seed bytea, p_n int, p_offset int)
returns int[] language plpgsql immutable set search_path = '' as $$
declare a int[] := array(select generate_series(0, p_n - 1)); j int; t int;
begin
  for i in reverse p_n .. 2 loop
    j := public.shb_rng_int(p_seed, p_offset + i, i) + 1;
    t := a[i]; a[i] := a[j]; a[j] := t;
  end loop;
  return a;
end;
$$;

-- Gewichteter Index (0-basiert) aus einem jsonb-Array von Gewichten
create or replace function public.shb_pick_weighted(p_seed bytea, p_idx int, p_weights jsonb)
returns int language plpgsql immutable set search_path = '' as $$
declare v_total numeric := 0; v_x numeric; w jsonb; i int := 0;
begin
  for w in select * from jsonb_array_elements(p_weights) loop v_total := v_total + (w #>> '{}')::numeric; end loop;
  v_x := public.shb_rng(p_seed, p_idx)::numeric * v_total;
  for w in select * from jsonb_array_elements(p_weights) loop
    v_x := v_x - (w #>> '{}')::numeric;
    if v_x < 0 then return i; end if;
    i := i + 1;
  end loop;
  return jsonb_array_length(p_weights) - 1;
end;
$$;

-- Validiert eine Liste eindeutiger Zahlen in [lo, hi] mit Länge in [min_n, max_n]
create or replace function public.shb_valid_picks(p_picks jsonb, p_lo int, p_hi int, p_min int, p_max int)
returns int[] language plpgsql immutable set search_path = '' as $$
declare v int[];
begin
  if jsonb_typeof(p_picks) <> 'array' then raise exception 'INVALID_PARAMS'; end if;
  v := array(select (x #>> '{}')::int from jsonb_array_elements(p_picks) x);
  if cardinality(v) < p_min or cardinality(v) > p_max then raise exception 'INVALID_PARAMS'; end if;
  if (select count(distinct x) from unnest(v) x) <> cardinality(v) then raise exception 'INVALID_PARAMS'; end if;
  if exists (select 1 from unnest(v) x where x < p_lo or x > p_hi) then raise exception 'INVALID_PARAMS'; end if;
  return v;
end;
$$;

-- Zieht k verschiedene Zahlen aus [1, n]
create or replace function public.shb_draw_numbers(p_seed bytea, p_n int, p_k int, p_offset int)
returns int[] language sql immutable set search_path = '' as $$
  select array(select x + 1 from unnest((public.shb_shuffle(p_seed, p_n, p_offset))[1:p_k]) x);
$$;

-- Generische Linienauswertung für 5x3-Slots (Raster zeilenweise, Index = reihe*5 + walze)
create or replace function public.shb_lines_5x3(p_grid text[], p_cfg jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  v_lines jsonb := p_cfg -> 'lines'; v_line jsonb; v_wild text := p_cfg ->> 'wild';
  v_syms text[]; v_base text; v_n int; v_pay numeric; v_total numeric := 0; v_wins jsonb := '[]'::jsonb; li int := 0;
begin
  for v_line in select * from jsonb_array_elements(v_lines) loop
    v_syms := array(select p_grid[(r.value #>> '{}')::int * 5 + r.ordinality::int] from jsonb_array_elements(v_line) with ordinality r);
    v_base := null;
    for i in 1 .. 5 loop
      if v_syms[i] is distinct from v_wild then v_base := v_syms[i]; exit; end if;
    end loop;
    v_base := coalesce(v_base, p_cfg ->> 'wild_as');
    v_n := 0;
    for i in 1 .. 5 loop
      exit when not coalesce(v_syms[i] = v_base or v_syms[i] = v_wild, false);
      v_n := v_n + 1;
    end loop;
    v_pay := (p_cfg -> 'pays' -> v_base ->> (v_n - 1))::numeric;
    if v_n >= 3 and coalesce(v_pay, 0) > 0 then
      v_total := v_total + v_pay;
      v_wins := v_wins || jsonb_build_object('line', li, 'symbol', v_base, 'count', v_n, 'pay', v_pay);
    end if;
    li := li + 1;
  end loop;
  return jsonb_build_object('pay', v_total, 'wins', v_wins);
end;
$$;

create or replace function public.shb_fill_grid(p_seed bytea, p_cells int, p_symbols jsonb, p_offset int)
returns text[] language plpgsql immutable set search_path = '' as $$
declare v_keys text[] := array(select x ->> 'key' from jsonb_array_elements(p_symbols) x);
        v_w jsonb := (select jsonb_agg(x -> 'weight') from jsonb_array_elements(p_symbols) x);
        g text[] := '{}';
begin
  for i in 0 .. p_cells - 1 loop
    g := g || v_keys[public.shb_pick_weighted(p_seed, p_offset + i, v_w) + 1];
  end loop;
  return g;
end;
$$;

-- ---------------------------------------------------------------------------
-- Einfache Spiele: Rechenfunktionen (liefern jsonb mit 'mult' = Auszahlung / Gesamteinsatz)
-- ---------------------------------------------------------------------------
create or replace function public.shb_g_coinflip(p_seed bytea, p jsonb, c jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare v_side text := p ->> 'side'; v_out text;
begin
  if v_side not in ('heads', 'tails') then raise exception 'INVALID_PARAMS'; end if;
  v_out := case public.shb_rng_int(p_seed, 0, 2) when 0 then 'heads' else 'tails' end;
  return jsonb_build_object('side', v_side, 'outcome', v_out, 'win', v_out = v_side,
    'mult', case when v_out = v_side then (c ->> 'pay')::numeric else 0 end);
end;
$$;

create or replace function public.shb_g_wheel(p_seed bytea, p jsonb, c jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare v_risk text := p ->> 'risk'; v_t jsonb := c -> 'tables' -> (p ->> 'risk'); v_i int;
begin
  if v_t is null then raise exception 'INVALID_PARAMS'; end if;
  v_i := public.shb_rng_int(p_seed, 0, jsonb_array_length(v_t));
  return jsonb_build_object('risk', v_risk, 'index', v_i, 'mult', (v_t ->> v_i)::numeric);
end;
$$;

create or replace function public.shb_g_color_wheel(p_seed bytea, p jsonb, c jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare v_color text := p ->> 'color'; v_i int; v_hit text;
begin
  if c -> 'pay' -> v_color is null then raise exception 'INVALID_PARAMS'; end if;
  v_i := public.shb_rng_int(p_seed, 0, jsonb_array_length(c -> 'layout'));
  v_hit := c -> 'layout' ->> v_i;
  return jsonb_build_object('color', v_color, 'index', v_i, 'hit', v_hit, 'win', v_hit = v_color,
    'mult', case when v_hit = v_color then (c -> 'pay' ->> v_color)::numeric else 0 end);
end;
$$;

create or replace function public.shb_g_bonus_wheel(p_seed bytea, p jsonb, c jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare v_i int := public.shb_pick_weighted(p_seed, 0, (select jsonb_agg(x -> 1) from jsonb_array_elements(c -> 'segments') x));
begin
  return jsonb_build_object('index', v_i, 'mult', (c -> 'segments' -> v_i ->> 0)::numeric);
end;
$$;

-- Keno / Number Draw / Digital Lottery: gemeinsame Ziehungslogik
create or replace function public.shb_g_draw(p_seed bytea, p jsonb, c jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  v_picks int[] := public.shb_valid_picks(p -> 'picks', 1, (c ->> 'pool')::int, (c ->> 'min_picks')::int, (c ->> 'max_picks')::int);
  v_drawn int[] := public.shb_draw_numbers(p_seed, (c ->> 'pool')::int, (c ->> 'draw')::int, 0);
  v_hits int := (select count(*) from unnest(v_picks) x where x = any(v_drawn));
begin
  return jsonb_build_object('picks', to_jsonb(v_picks), 'drawn', to_jsonb(v_drawn), 'hits', v_hits,
    'mult', coalesce((c -> 'pay' -> cardinality(v_picks)::text ->> v_hits)::numeric, 0));
end;
$$;

create or replace function public.shb_g_bingo(p_seed bytea, p jsonb, c jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare v_card int[] := array_fill(0, array[25]); v_col int[]; v_drawn int[]; v_marked boolean[] := array_fill(false, array[25]);
        v_lines int := 0; v_l int[]; v_all int[][] := array[
          [0,1,2,3,4],[5,6,7,8,9],[10,11,12,13,14],[15,16,17,18,19],[20,21,22,23,24],
          [0,5,10,15,20],[1,6,11,16,21],[2,7,12,17,22],[3,8,13,18,23],[4,9,14,19,24],
          [0,6,12,18,24],[4,8,12,16,20]];
begin
  for col in 0 .. 4 loop
    v_col := public.shb_shuffle(p_seed, 15, 100 + col * 20);
    for r in 0 .. 4 loop v_card[r * 5 + col + 1] := col * 15 + v_col[r + 1] + 1; end loop;
  end loop;
  v_drawn := public.shb_draw_numbers(p_seed, 75, (c ->> 'draw')::int, 300);
  for i in 1 .. 25 loop v_marked[i] := i = 13 or v_card[i] = any(v_drawn); end loop;
  for li in 1 .. 12 loop
    if v_marked[v_all[li][1] + 1] and v_marked[v_all[li][2] + 1] and v_marked[v_all[li][3] + 1]
       and v_marked[v_all[li][4] + 1] and v_marked[v_all[li][5] + 1] then v_lines := v_lines + 1; end if;
  end loop;
  return jsonb_build_object('card', to_jsonb(v_card), 'drawn', to_jsonb(v_drawn), 'marked', to_jsonb(v_marked),
    'lines', v_lines, 'mult', (c -> 'pay' ->> least(v_lines, jsonb_array_length(c -> 'pay') - 1))::numeric);
end;
$$;

create or replace function public.shb_bacc_val(p_card int)
returns int language sql immutable set search_path = '' as $$
  select case when p_card % 13 >= 9 then 0 else p_card % 13 + 1 end;
$$;

create or replace function public.shb_g_baccarat(p_seed bytea, p jsonb, c jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  v_bet text := p ->> 'bet'; v_shoe int[] := public.shb_shuffle(p_seed, 416, 0); v_pos int := 5;
  v_p int[]; v_b int[]; pt int; bt int; v_p3 int; v_x int; v_draw boolean; v_win text; v_mult numeric := 0;
begin
  if v_bet not in ('player', 'banker', 'tie') then raise exception 'INVALID_PARAMS'; end if;
  v_p := array[v_shoe[1] % 52, v_shoe[3] % 52];
  v_b := array[v_shoe[2] % 52, v_shoe[4] % 52];
  pt := (public.shb_bacc_val(v_p[1]) + public.shb_bacc_val(v_p[2])) % 10;
  bt := (public.shb_bacc_val(v_b[1]) + public.shb_bacc_val(v_b[2])) % 10;
  if pt < 8 and bt < 8 then
    if pt <= 5 then
      v_p3 := v_shoe[v_pos] % 52; v_pos := v_pos + 1;
      v_p := v_p || v_p3; pt := (pt + public.shb_bacc_val(v_p3)) % 10;
      v_x := public.shb_bacc_val(v_p3);
      v_draw := case when bt <= 2 then true when bt = 3 then v_x <> 8 when bt = 4 then v_x between 2 and 7
                     when bt = 5 then v_x between 4 and 7 when bt = 6 then v_x in (6, 7) else false end;
    else
      v_draw := bt <= 5;
    end if;
    if v_draw then
      v_b := v_b || (v_shoe[v_pos] % 52); bt := (bt + public.shb_bacc_val(v_shoe[v_pos] % 52)) % 10;
    end if;
  end if;
  v_win := case when pt > bt then 'player' when bt > pt then 'banker' else 'tie' end;
  if v_win = v_bet then v_mult := (c -> 'pay' ->> v_bet)::numeric;
  elsif v_win = 'tie' then v_mult := 1; end if;
  return jsonb_build_object('bet', v_bet, 'player', to_jsonb(v_p), 'banker', to_jsonb(v_b), 'player_total', pt,
    'banker_total', bt, 'winner', v_win, 'mult', v_mult);
end;
$$;

create or replace function public.shb_g_dragon_tiger(p_seed bytea, p jsonb, c jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare v_bet text := p ->> 'bet'; v_d int := public.shb_rng_int(p_seed, 0, 52); v_t int := public.shb_rng_int(p_seed, 1, 52);
        dr int := v_d % 13 + 1; tr int := v_t % 13 + 1; v_win text; v_mult numeric := 0;
begin
  if v_bet not in ('dragon', 'tiger', 'tie') then raise exception 'INVALID_PARAMS'; end if;
  v_win := case when dr > tr then 'dragon' when tr > dr then 'tiger' else 'tie' end;
  if v_win = v_bet then v_mult := (c -> 'pay' ->> v_bet)::numeric;
  elsif v_win = 'tie' then v_mult := 0.5; end if;
  return jsonb_build_object('bet', v_bet, 'dragon', v_d, 'tiger', v_t, 'winner', v_win, 'mult', v_mult);
end;
$$;

create or replace function public.shb_g_andar_bahar(p_seed bytea, p jsonb, c jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare v_side text := p ->> 'side'; v_deck int[] := public.shb_shuffle(p_seed, 52, 0); v_joker int; v_win text; v_deal int[] := '{}';
begin
  if v_side not in ('andar', 'bahar') then raise exception 'INVALID_PARAMS'; end if;
  v_joker := v_deck[1];
  for j in 2 .. 52 loop
    v_deal := v_deal || v_deck[j];
    if v_deck[j] % 13 = v_joker % 13 then
      v_win := case when j % 2 = 0 then 'andar' else 'bahar' end;
      exit;
    end if;
  end loop;
  return jsonb_build_object('side', v_side, 'joker', v_joker, 'dealt', to_jsonb(v_deal), 'winner', v_win,
    'mult', case when v_win = v_side then (c -> 'pay' ->> v_side)::numeric else 0 end);
end;
$$;

create or replace function public.shb_g_poker_dice(p_seed bytea, p jsonb, c jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare v_d int[] := '{}'; v_counts int[]; v_sorted text; v_hand text;
begin
  for i in 0 .. 4 loop v_d := v_d || (public.shb_rng_int(p_seed, i, 6) + 1); end loop;
  v_counts := array(select count(*)::int from unnest(v_d) x group by x order by 1 desc);
  v_sorted := array_to_string(array(select x from unnest(v_d) x order by x), '');
  v_hand := case when v_counts[1] = 5 then 'five' when v_counts[1] = 4 then 'four'
                 when v_counts[1] = 3 and v_counts[2] = 2 then 'full'
                 when v_sorted in ('12345', '23456') then 'straight'
                 when v_counts[1] = 3 then 'three'
                 when v_counts[1] = 2 and v_counts[2] = 2 then 'twopair' else 'none' end;
  return jsonb_build_object('dice', to_jsonb(v_d), 'hand', v_hand, 'mult', (c -> 'pay' ->> v_hand)::numeric);
end;
$$;

create or replace function public.shb_g_scratch_card(p_seed bytea, p jsonb, c jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  v_prizes jsonb := c -> 'prizes'; v_i int; v_mult numeric; v_syms text[] := array['cherry','lemon','bell','gem','seven','coin','star','leaf'];
  v_win text; v_grid text[] := '{}'; v_pool text[] := '{}'; v_order int[];
begin
  v_i := public.shb_pick_weighted(p_seed, 0, (select jsonb_agg(x -> 1) from jsonb_array_elements(v_prizes) x));
  v_mult := (v_prizes -> v_i ->> 0)::numeric;
  if v_mult > 0 then
    v_win := v_prizes -> v_i ->> 2;
    v_grid := array[v_win, v_win, v_win];
  end if;
  -- Restliche Felder: jedes andere Symbol höchstens zweimal (also nie ein zweiter Dreier)
  for s in 1 .. 8 loop
    if v_syms[s] is distinct from v_win then v_pool := v_pool || v_syms[s] || v_syms[s]; end if;
  end loop;
  v_order := public.shb_shuffle(p_seed, cardinality(v_pool), 10);
  for k in 1 .. (9 - cardinality(v_grid)) loop
    v_grid := v_grid || v_pool[v_order[k] + 1];
  end loop;
  v_order := public.shb_shuffle(p_seed, 9, 40);
  v_grid := array(select v_grid[v_order[k] + 1] from generate_series(1, 9) k);
  return jsonb_build_object('grid', to_jsonb(v_grid), 'symbol', v_win, 'mult', v_mult);
end;
$$;

create or replace function public.shb_g_classic_slots(p_seed bytea, p jsonb, c jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare v_r text[] := public.shb_fill_grid(p_seed, 3, c -> 'symbols', 0); v_mult numeric := 0;
begin
  if v_r[1] = v_r[2] and v_r[2] = v_r[3] then
    v_mult := coalesce((select (x ->> 'pay3')::numeric from jsonb_array_elements(c -> 'symbols') x where x ->> 'key' = v_r[1]), 0);
  elsif v_r[1] = 'cherry' and v_r[2] = 'cherry' then v_mult := (c ->> 'two_cherry')::numeric;
  elsif v_r[1] = 'cherry' then v_mult := (c ->> 'one_cherry')::numeric;
  end if;
  return jsonb_build_object('reels', to_jsonb(v_r), 'mult', v_mult);
end;
$$;

-- 3x3 / 5 Linien (wie Shisha Slots), eigene Symbol-Konfiguration
create or replace function public.shb_g_slots3x3(p_seed bytea, p jsonb, c jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  v_grid text[] := public.shb_fill_grid(p_seed, 9, c -> 'symbols', 0);
  v_lines int[][] := array[[0,1,2],[3,4,5],[6,7,8],[0,4,8],[6,4,2]];
  a text; b text; d text; v_pay numeric; v_total numeric := 0; v_wins jsonb := '[]'::jsonb; v_sc int; v_bonus numeric := 0;
  v_scatter text := c ->> 'scatter'; v_pair text := c ->> 'pair_symbol';
begin
  v_sc := (select count(*) from unnest(v_grid) x where x = v_scatter);
  for li in 1 .. 5 loop
    a := v_grid[v_lines[li][1] + 1]; b := v_grid[v_lines[li][2] + 1]; d := v_grid[v_lines[li][3] + 1];
    v_pay := 0;
    if a = b and b = d and a <> v_scatter then
      v_pay := (select (x ->> 'pay3')::numeric from jsonb_array_elements(c -> 'symbols') x where x ->> 'key' = a);
    elsif a = v_pair and b = v_pair then v_pay := (c ->> 'pair_pay')::numeric;
    end if;
    if coalesce(v_pay, 0) > 0 then
      v_total := v_total + v_pay;
      v_wins := v_wins || jsonb_build_object('line', li - 1, 'symbol', a, 'pay', v_pay);
    end if;
  end loop;
  if v_sc >= 5 then v_bonus := 50; elsif v_sc = 4 then v_bonus := 15; elsif v_sc = 3 then v_bonus := 5; end if;
  return jsonb_build_object('grid', to_jsonb(v_grid), 'line_wins', v_wins, 'scatter_count', v_sc,
    'bonus_multiplier', v_bonus, 'mult', round(v_total / 5 + v_bonus, 4));
end;
$$;

create or replace function public.shb_g_neon_slots(p_seed bytea, p jsonb, c jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare v_grid text[] := public.shb_fill_grid(p_seed, 15, c -> 'symbols', 0); v_l jsonb := public.shb_lines_5x3(v_grid, c);
begin
  return jsonb_build_object('grid', to_jsonb(v_grid), 'line_wins', v_l -> 'wins',
    'mult', round((v_l ->> 'pay')::numeric / jsonb_array_length(c -> 'lines'), 4));
end;
$$;

create or replace function public.shb_g_cluster_slots(p_seed bytea, p jsonb, c jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  v_grid text[] := public.shb_fill_grid(p_seed, 36, c -> 'symbols', 0);
  v_seen boolean[] := array_fill(false, array[36]); v_stack int[]; v_cells int[]; v_cur int; r int; q int; n int;
  v_total numeric := 0; v_clusters jsonb := '[]'::jsonb; v_pay numeric;
begin
  for i in 0 .. 35 loop
    continue when v_seen[i + 1];
    v_seen[i + 1] := true; v_stack := array[i]; v_cells := '{}';
    while cardinality(v_stack) > 0 loop
      v_cur := v_stack[cardinality(v_stack)]; v_stack := v_stack[1:cardinality(v_stack) - 1];
      v_cells := v_cells || v_cur; r := v_cur / 6; q := v_cur % 6;
      foreach n in array array[case when r < 5 then v_cur + 6 end, case when r > 0 then v_cur - 6 end,
                               case when q < 5 then v_cur + 1 end, case when q > 0 then v_cur - 1 end] loop
        if n is not null and not v_seen[n + 1] and v_grid[n + 1] = v_grid[i + 1] then
          v_seen[n + 1] := true; v_stack := v_stack || n;
        end if;
      end loop;
    end loop;
    if cardinality(v_cells) >= 5 then
      v_pay := (select (x -> 'pays' ->> least(cardinality(v_cells), 9))::numeric
                  from jsonb_array_elements(c -> 'symbols') x where x ->> 'key' = v_grid[i + 1]);
      v_total := v_total + coalesce(v_pay, 0);
      v_clusters := v_clusters || jsonb_build_object('symbol', v_grid[i + 1], 'cells', to_jsonb(v_cells), 'pay', v_pay);
    end if;
  end loop;
  return jsonb_build_object('grid', to_jsonb(v_grid), 'clusters', v_clusters, 'mult', round(v_total, 4));
end;
$$;

create or replace function public.shb_g_lucky_seven(p_seed bytea, p jsonb, c jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare a int := public.shb_rng_int(p_seed, 0, 10); b int := public.shb_rng_int(p_seed, 1, 10); d int := public.shb_rng_int(p_seed, 2, 10);
        s int; v_m numeric := 0;
begin
  s := (a = 7)::int + (b = 7)::int + (d = 7)::int;
  if s = 3 then v_m := (c -> 'pay' ->> 'triple7')::numeric;
  elsif a = b and b = d then v_m := (c -> 'pay' ->> 'triple')::numeric;
  elsif s = 2 then v_m := (c -> 'pay' ->> 'two7')::numeric;
  elsif s = 1 then v_m := (c -> 'pay' ->> 'one7')::numeric; end if;
  return jsonb_build_object('digits', jsonb_build_array(a, b, d), 'sevens', s, 'mult', v_m);
end;
$$;

create or replace function public.shb_g_dice_duel(p_seed bytea, p jsonb, c jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare v_p int[] := array[public.shb_rng_int(p_seed, 0, 6) + 1, public.shb_rng_int(p_seed, 1, 6) + 1];
        v_h int[] := array[public.shb_rng_int(p_seed, 2, 6) + 1, public.shb_rng_int(p_seed, 3, 6) + 1];
        ps int := v_p[1] + v_p[2]; hs int := v_h[1] + v_h[2];
begin
  return jsonb_build_object('player', to_jsonb(v_p), 'house', to_jsonb(v_h), 'winner',
    case when ps > hs then 'player' when hs > ps then 'house' else 'tie' end,
    'mult', case when ps > hs then (c ->> 'pay')::numeric when ps = hs then 1 else 0 end);
end;
$$;

create or replace function public.shb_g_card_duel(p_seed bytea, p jsonb, c jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare v_p int := public.shb_rng_int(p_seed, 0, 52); v_h int := public.shb_rng_int(p_seed, 1, 52);
        pr int := case when v_p % 13 = 0 then 14 else v_p % 13 + 1 end;
        hr int := case when v_h % 13 = 0 then 14 else v_h % 13 + 1 end;
begin
  return jsonb_build_object('player', v_p, 'house', v_h, 'winner',
    case when pr > hr then 'player' when hr > pr then 'house' else 'tie' end,
    'mult', case when pr > hr then (c ->> 'pay')::numeric when pr = hr then 1 else 0 end);
end;
$$;

create or replace function public.shb_g_goal(p_seed bytea, p jsonb, c jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare v_shot int := (p ->> 'corner')::int; v_keeper int := public.shb_rng_int(p_seed, 0, 3);
begin
  if v_shot is null or v_shot not between 0 and 2 then raise exception 'INVALID_PARAMS'; end if;
  return jsonb_build_object('corner', v_shot, 'keeper', v_keeper, 'goal', v_shot <> v_keeper,
    'mult', case when v_shot <> v_keeper then (c ->> 'pay')::numeric else 0 end);
end;
$$;

create or replace function public.shb_g_rocket(p_seed bytea, p jsonb, c jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare v_target bigint := (p ->> 'target')::bigint; v_res bigint := public.shb_multiplier_h(p_seed, 0);
begin
  if v_target is null or v_target < 101 or v_target > 100000000 then raise exception 'INVALID_PARAMS'; end if;
  return jsonb_build_object('target', v_target, 'result', v_res, 'win', v_res >= v_target,
    'mult', case when v_res >= v_target then v_target / 100.0 else 0 end);
end;
$$;

create or replace function public.shb_g_drop_ball(p_seed bytea, p jsonb, c jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare v_rows int := jsonb_array_length(c -> 'table') - 1; v_path int[] := '{}'; v_b int := 0; v_bit int;
begin
  for i in 0 .. v_rows - 1 loop
    v_bit := public.shb_rng_int(p_seed, i, 2); v_path := v_path || v_bit; v_b := v_b + v_bit;
  end loop;
  return jsonb_build_object('path', to_jsonb(v_path), 'bucket', v_b, 'mult', (c -> 'table' ->> v_b)::numeric);
end;
$$;

create or replace function public.shb_g_safe_cracker(p_seed bytea, p jsonb, c jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare v_pick int := (p ->> 'safe')::int; v_n int := jsonb_array_length(c -> 'contents');
        v_order int[] := public.shb_shuffle(p_seed, v_n, 0); v_contents jsonb := '[]'::jsonb;
begin
  if v_pick is null or v_pick < 0 or v_pick >= v_n then raise exception 'INVALID_PARAMS'; end if;
  for i in 1 .. v_n loop v_contents := v_contents || (c -> 'contents' -> v_order[i]); end loop;
  return jsonb_build_object('safe', v_pick, 'contents', v_contents, 'mult', (v_contents ->> v_pick)::numeric);
end;
$$;

-- Sic Bo: mehrere Einsätze, 'mult' bezieht sich auf den Gesamteinsatz
create or replace function public.shb_g_sicbo(p_seed bytea, p jsonb, c jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  v_d int[] := array[public.shb_rng_int(p_seed, 0, 6) + 1, public.shb_rng_int(p_seed, 1, 6) + 1, public.shb_rng_int(p_seed, 2, 6) + 1];
  v_sum int; v_triple boolean; b jsonb; v_type text; v_val int; v_amt bigint; v_total bigint := 0; v_pay numeric := 0;
  v_win numeric; v_det jsonb := '[]'::jsonb; v_cnt int;
begin
  v_sum := v_d[1] + v_d[2] + v_d[3];
  v_triple := v_d[1] = v_d[2] and v_d[2] = v_d[3];
  for b in select * from jsonb_array_elements(p -> 'bets') loop
    v_type := b ->> 'type'; v_val := coalesce((b ->> 'value')::int, 0); v_amt := (b ->> 'amount')::bigint;
    v_total := v_total + v_amt;
    v_cnt := (v_d[1] = v_val)::int + (v_d[2] = v_val)::int + (v_d[3] = v_val)::int;
    v_win := case v_type
      when 'small' then case when not v_triple and v_sum between 4 and 10 then 2 else 0 end
      when 'big' then case when not v_triple and v_sum between 11 and 17 then 2 else 0 end
      when 'total' then case when v_sum = v_val then (c -> 'total_pay' ->> v_val::text)::numeric else 0 end
      when 'any_triple' then case when v_triple then (c ->> 'any_triple')::numeric else 0 end
      when 'triple' then case when v_triple and v_d[1] = v_val then (c ->> 'triple')::numeric else 0 end
      when 'single' then case when v_cnt > 0 then v_cnt + 1 else 0 end
      else null end;
    if v_win is null then raise exception 'INVALID_PARAMS'; end if;
    v_pay := v_pay + v_amt * v_win;
    v_det := v_det || jsonb_build_object('type', v_type, 'value', v_val, 'amount', v_amt, 'payout', floor(v_amt * v_win));
  end loop;
  return jsonb_build_object('dice', to_jsonb(v_d), 'sum', v_sum, 'bets', v_det, 'mult', v_pay / v_total);
end;
$$;

-- Shisha Diamonds: 5x3, 10 Linien, ab 6 Diamanten Hold & Spin (3 Respins, Diamanten bleiben kleben)
create or replace function public.shb_g_shisha_diamonds(p_seed bytea, p jsonb, c jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  v_grid text[] := public.shb_fill_grid(p_seed, 15, c -> 'symbols', 0); v_l jsonb;
  v_vals jsonb := c -> 'diamond_values'; v_vw jsonb := (select jsonb_agg(x -> 1) from jsonb_array_elements(c -> 'diamond_values') x);
  v_dia int[] := array_fill(0, array[15]); v_idx int := 1000; v_spins int; v_hit boolean; v_steps jsonb := '[]'::jsonb;
  v_feature numeric := 0; v_full boolean := false; v_cnt int;
begin
  -- Linien ohne Wild; Diamanten zahlen nicht auf Linien
  v_l := public.shb_lines_5x3(v_grid, c);
  for i in 1 .. 15 loop
    if v_grid[i] = 'sd_diamond' then
      v_dia[i] := (v_vals -> public.shb_pick_weighted(p_seed, v_idx, v_vw) ->> 0)::int; v_idx := v_idx + 1;
    end if;
  end loop;
  v_cnt := (select count(*) from unnest(v_dia) x where x > 0);
  if v_cnt >= (c ->> 'trigger')::int then
    v_spins := 3;
    v_steps := v_steps || jsonb_build_object('values', to_jsonb(v_dia), 'spins', v_spins);
    while v_spins > 0 loop
      v_hit := false;
      for i in 1 .. 15 loop
        if v_dia[i] = 0 and public.shb_rng(p_seed, v_idx) < (c ->> 'respin_chance')::float8 then
          v_dia[i] := (v_vals -> public.shb_pick_weighted(p_seed, v_idx + 1, v_vw) ->> 0)::int; v_hit := true;
        end if;
        v_idx := v_idx + 2;
      end loop;
      v_spins := case when v_hit then 3 else v_spins - 1 end;
      v_steps := v_steps || jsonb_build_object('values', to_jsonb(v_dia), 'spins', v_spins);
      if (select bool_and(x > 0) from unnest(v_dia) x) then v_full := true; exit; end if;
    end loop;
    v_feature := (select sum(x) from unnest(v_dia) x) / 10.0 + case when v_full then (c ->> 'grand')::numeric else 0 end;
  end if;
  return jsonb_build_object('grid', to_jsonb(v_grid), 'diamonds', to_jsonb(v_dia), 'line_wins', v_l -> 'wins',
    'feature', v_cnt >= (c ->> 'trigger')::int, 'feature_steps', v_steps, 'feature_win', v_feature, 'grand', v_full,
    'mult', round((v_l ->> 'pay')::numeric / jsonb_array_length(c -> 'lines') + v_feature, 4));
end;
$$;

-- ---------------------------------------------------------------------------
-- play_game: Einstieg für alle einfachen Spiele
-- ---------------------------------------------------------------------------
create or replace function public.play_game(p_game_key text, p_bet bigint, p_params jsonb, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.shb_require_user();
  v_cfg jsonb := public.shb_game_config(p_game_key);
  v_round uuid; v_seed bytea; v_res jsonb; v_total bigint := p_bet; v_payout bigint; b jsonb;
begin
  perform public.shb_check_idem(p_idempotency_key);
  select id into v_round from public.game_rounds where idempotency_key = v_uid::text || ':' || p_idempotency_key;
  if v_round is not null then return public.shb_round_json(v_round); end if;
  if v_cfg ->> 'engine' is distinct from 'simple' then raise exception 'GAME_NOT_FOUND'; end if;
  p_params := coalesce(p_params, '{}'::jsonb);

  -- Spiele mit mehreren Einsätzen: Gesamteinsatz aus den Einzeleinsätzen
  if v_cfg ->> 'fn' = 'sicbo' then
    if jsonb_typeof(p_params -> 'bets') <> 'array' or jsonb_array_length(p_params -> 'bets') not between 1 and 30 then
      raise exception 'INVALID_PARAMS';
    end if;
    v_total := 0;
    for b in select * from jsonb_array_elements(p_params -> 'bets') loop
      if (b ->> 'amount')::bigint is null or (b ->> 'amount')::bigint < 1 then raise exception 'INVALID_PARAMS'; end if;
      v_total := v_total + (b ->> 'amount')::bigint;
    end loop;
  end if;

  v_round := public.shb_begin_round(v_uid, p_game_key, v_total, p_idempotency_key, '{}'::jsonb);
  select server_seed into v_seed from public.game_round_secrets where round_id = v_round;

  v_res := case v_cfg ->> 'fn'
    when 'coinflip' then public.shb_g_coinflip(v_seed, p_params, v_cfg)
    when 'wheel' then public.shb_g_wheel(v_seed, p_params, v_cfg)
    when 'color_wheel' then public.shb_g_color_wheel(v_seed, p_params, v_cfg)
    when 'bonus_wheel' then public.shb_g_bonus_wheel(v_seed, p_params, v_cfg)
    when 'draw' then public.shb_g_draw(v_seed, p_params, v_cfg)
    when 'bingo' then public.shb_g_bingo(v_seed, p_params, v_cfg)
    when 'baccarat' then public.shb_g_baccarat(v_seed, p_params, v_cfg)
    when 'dragon_tiger' then public.shb_g_dragon_tiger(v_seed, p_params, v_cfg)
    when 'andar_bahar' then public.shb_g_andar_bahar(v_seed, p_params, v_cfg)
    when 'poker_dice' then public.shb_g_poker_dice(v_seed, p_params, v_cfg)
    when 'scratch_card' then public.shb_g_scratch_card(v_seed, p_params, v_cfg)
    when 'classic_slots' then public.shb_g_classic_slots(v_seed, p_params, v_cfg)
    when 'slots3x3' then public.shb_g_slots3x3(v_seed, p_params, v_cfg)
    when 'neon_slots' then public.shb_g_neon_slots(v_seed, p_params, v_cfg)
    when 'cluster_slots' then public.shb_g_cluster_slots(v_seed, p_params, v_cfg)
    when 'lucky_seven' then public.shb_g_lucky_seven(v_seed, p_params, v_cfg)
    when 'dice_duel' then public.shb_g_dice_duel(v_seed, p_params, v_cfg)
    when 'card_duel' then public.shb_g_card_duel(v_seed, p_params, v_cfg)
    when 'goal' then public.shb_g_goal(v_seed, p_params, v_cfg)
    when 'rocket' then public.shb_g_rocket(v_seed, p_params, v_cfg)
    when 'drop_ball' then public.shb_g_drop_ball(v_seed, p_params, v_cfg)
    when 'safe_cracker' then public.shb_g_safe_cracker(v_seed, p_params, v_cfg)
    when 'sicbo' then public.shb_g_sicbo(v_seed, p_params, v_cfg)
    when 'shisha_diamonds' then public.shb_g_shisha_diamonds(v_seed, p_params, v_cfg)
    else null end;
  if v_res is null then raise exception 'GAME_NOT_FOUND'; end if;

  v_payout := floor(v_total * (v_res ->> 'mult')::numeric)::bigint;
  perform public.shb_finish_round(v_round, v_payout, v_res);
  return public.shb_round_json(v_round);
end;
$$;

-- ---------------------------------------------------------------------------
-- Mehrstufige Spiele: Hi-Lo, Towers, Gem Hunt, Treasure Grid, Video Poker
-- ---------------------------------------------------------------------------
create or replace function public.shb_vp_hand(p_cards int[])
returns text language plpgsql immutable set search_path = '' as $$
declare v_r int[] := array(select case when x % 13 = 0 then 14 else x % 13 + 1 end from unnest(p_cards) x order by 1);
        v_flush boolean := (select count(distinct x / 13) from unnest(p_cards) x) = 1;
        v_counts int[]; v_straight boolean; v_pair_rank int;
begin
  v_counts := array(select count(*)::int from unnest(v_r) x group by x order by 1 desc);
  v_straight := (select count(distinct x) from unnest(v_r) x) = 5
                and (v_r[5] - v_r[1] = 4 or v_r = array[2,3,4,5,14]);
  if v_straight and v_flush and v_r[1] = 10 then return 'royal'; end if;
  if v_straight and v_flush then return 'straight_flush'; end if;
  if v_counts[1] = 4 then return 'four'; end if;
  if v_counts[1] = 3 and v_counts[2] = 2 then return 'full'; end if;
  if v_flush then return 'flush'; end if;
  if v_straight then return 'straight'; end if;
  if v_counts[1] = 3 then return 'three'; end if;
  if v_counts[1] = 2 and v_counts[2] = 2 then return 'two_pair'; end if;
  if v_counts[1] = 2 then
    select x into v_pair_rank from unnest(v_r) x group by x having count(*) = 2;
    if v_pair_rank >= 11 then return 'jacks'; end if;
  end if;
  return 'none';
end;
$$;

create or replace function public.step_start(p_game_key text, p_bet bigint, p_params jsonb, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.shb_require_user();
  v_cfg jsonb := public.shb_game_config(p_game_key);
  v_fn text := v_cfg ->> 'fn';
  v_round uuid; v_seed bytea; v_res jsonb; v_secret jsonb := '{}'::jsonb; v_level jsonb; v_cols int; v_bombs int;
  v_floors int; v_rows jsonb := '[]'::jsonb; v_perm int[]; v_deck int[];
begin
  perform public.shb_check_idem(p_idempotency_key);
  select id into v_round from public.game_rounds where idempotency_key = v_uid::text || ':' || p_idempotency_key;
  if v_round is not null then return public.shb_round_json(v_round); end if;
  if v_cfg ->> 'engine' is distinct from 'step' then raise exception 'GAME_NOT_FOUND'; end if;
  if exists (select 1 from public.game_rounds where user_id = v_uid and game_key = p_game_key and status = 'active') then
    raise exception 'ACTIVE_ROUND_EXISTS';
  end if;
  p_params := coalesce(p_params, '{}'::jsonb);

  if v_fn = 'tower' then
    v_level := v_cfg -> 'levels' -> coalesce(p_params ->> 'difficulty', v_cfg ->> 'default_level');
    if v_level is null then raise exception 'INVALID_PARAMS'; end if;
  end if;

  v_round := public.shb_begin_round(v_uid, p_game_key, p_bet, p_idempotency_key, '{}'::jsonb);
  select server_seed into v_seed from public.game_round_secrets where round_id = v_round;

  if v_fn = 'hilo' then
    v_res := jsonb_build_object('card', public.shb_rng_int(v_seed, 0, 52), 'history', '[]'::jsonb, 'step', 0,
      'draws', 1, 'skips', 0, 'multiplier', 1, 'state', 'playing');
  elsif v_fn = 'tower' then
    v_cols := (v_level ->> 'cols')::int; v_bombs := (v_level ->> 'bombs')::int; v_floors := (v_cfg ->> 'floors')::int;
    for f in 0 .. v_floors - 1 loop
      v_perm := public.shb_shuffle(v_seed, v_cols, f * 10);
      v_rows := v_rows || to_jsonb(v_perm[1:v_bombs]);
    end loop;
    v_secret := jsonb_build_object('bombs', v_rows);
    v_res := jsonb_build_object('difficulty', coalesce(p_params ->> 'difficulty', v_cfg ->> 'default_level'), 'cols', v_cols,
      'bombs', v_bombs, 'floors', v_floors, 'floor', 0, 'picks', '[]'::jsonb, 'multiplier', 1, 'state', 'playing',
      'next_multiplier', round(0.99 * power(v_cols::numeric / (v_cols - v_bombs), 1), 4));
  elsif v_fn = 'treasure' then
    v_perm := public.shb_shuffle(v_seed, jsonb_array_length(v_cfg -> 'values'), 0);
    v_secret := jsonb_build_object('values', (select jsonb_agg(v_cfg -> 'values' -> x order by o) from unnest(v_perm) with ordinality t(x, o)));
    v_res := jsonb_build_object('cells', jsonb_array_length(v_cfg -> 'values'), 'picks', '[]'::jsonb, 'found', '[]'::jsonb,
      'max_picks', (v_cfg ->> 'picks')::int, 'state', 'playing');
  elsif v_fn = 'video_poker' then
    v_deck := public.shb_shuffle(v_seed, 52, 0);
    v_secret := jsonb_build_object('deck', to_jsonb(v_deck));
    v_res := jsonb_build_object('hand', to_jsonb(v_deck[1:5]), 'state', 'deal',
      'hand_name', public.shb_vp_hand(v_deck[1:5]));
  else
    raise exception 'GAME_NOT_FOUND';
  end if;

  update public.game_round_secrets set state = v_secret where round_id = v_round;
  update public.game_rounds set result = v_res || jsonb_build_object('actions', 0) where id = v_round;
  return public.shb_round_json(v_round);
end;
$$;

create or replace function public.step_action(p_round_id uuid, p_action jsonb, p_seq int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.shb_require_user();
  v_r public.game_rounds; v_cfg jsonb; v_fn text; v_res jsonb; v_sec jsonb; v_seed bytea;
  v_card int; v_next int; v_rank int; v_nrank int; v_p numeric; v_guess text; v_ok boolean; v_mult numeric;
  v_col int; v_floor int; v_bombrow jsonb; v_cols int; v_bombs int; v_floors int;
  v_cell int; v_picks jsonb; v_found jsonb; v_hold jsonb; v_hand int[]; v_deck int[]; v_pos int; v_name text;
begin
  select * into v_r from public.game_rounds where id = p_round_id and user_id = v_uid for update;
  if not found then raise exception 'ROUND_NOT_FOUND'; end if;
  if v_r.status <> 'active' then return public.shb_round_json(p_round_id); end if;
  v_res := v_r.result;
  if p_seq is distinct from (v_res ->> 'actions')::int then return public.shb_round_json(p_round_id); end if;
  select config into v_cfg from public.game_configs where game_key = v_r.game_key;
  v_fn := v_cfg ->> 'fn';
  select state, server_seed into v_sec, v_seed from public.game_round_secrets where round_id = p_round_id;
  v_res := jsonb_set(v_res, '{actions}', to_jsonb(p_seq + 1));

  if v_fn = 'hilo' then
    v_guess := p_action ->> 'guess';
    if v_guess not in ('higher', 'lower', 'skip') then raise exception 'INVALID_ACTION'; end if;
    v_card := (v_res ->> 'card')::int; v_rank := v_card % 13 + 1;
    v_next := public.shb_rng_int(v_seed, (v_res ->> 'draws')::int, 52); v_nrank := v_next % 13 + 1;
    v_res := v_res || jsonb_build_object('draws', (v_res ->> 'draws')::int + 1);
    if v_guess = 'skip' then
      if (v_res ->> 'skips')::int >= (v_cfg ->> 'max_skips')::int then raise exception 'ACTION_NOT_ALLOWED'; end if;
      v_res := v_res || jsonb_build_object('card', v_next, 'skips', (v_res ->> 'skips')::int + 1,
        'history', (v_res -> 'history') || jsonb_build_object('card', v_card, 'guess', 'skip', 'ok', true));
    else
      v_p := case when v_guess = 'higher' then (14 - v_rank) / 13.0 else v_rank / 13.0 end;
      if v_p >= 1 then raise exception 'ACTION_NOT_ALLOWED'; end if;
      v_ok := case when v_guess = 'higher' then v_nrank >= v_rank else v_nrank <= v_rank end;
      v_res := v_res || jsonb_build_object('card', v_next,
        'history', (v_res -> 'history') || jsonb_build_object('card', v_card, 'guess', v_guess, 'ok', v_ok, 'next', v_next));
      if v_ok then
        v_mult := round((v_res ->> 'multiplier')::numeric * 0.99 / v_p, 4);
        v_res := v_res || jsonb_build_object('multiplier', v_mult, 'step', (v_res ->> 'step')::int + 1);
      else
        perform public.shb_finish_round(p_round_id, 0, v_res || jsonb_build_object('state', 'lost', 'multiplier', 0));
        return public.shb_round_json(p_round_id);
      end if;
    end if;

  elsif v_fn = 'tower' then
    v_col := (p_action ->> 'col')::int; v_floor := (v_res ->> 'floor')::int;
    v_cols := (v_res ->> 'cols')::int; v_bombs := (v_res ->> 'bombs')::int; v_floors := (v_res ->> 'floors')::int;
    if v_col is null or v_col < 0 or v_col >= v_cols then raise exception 'INVALID_PARAMS'; end if;
    v_bombrow := v_sec -> 'bombs' -> v_floor;
    v_res := v_res || jsonb_build_object('picks', (v_res -> 'picks') || to_jsonb(v_col));
    if v_bombrow @> to_jsonb(v_col) then
      perform public.shb_finish_round(p_round_id, 0, v_res || jsonb_build_object('state', 'lost', 'multiplier', 0,
        'bomb_rows', v_sec -> 'bombs'));
      return public.shb_round_json(p_round_id);
    end if;
    v_mult := round(0.99 * power(v_cols::numeric / (v_cols - v_bombs), v_floor + 1), 4);
    v_res := v_res || jsonb_build_object('floor', v_floor + 1, 'multiplier', v_mult,
      'next_multiplier', round(0.99 * power(v_cols::numeric / (v_cols - v_bombs), v_floor + 2), 4));
    if v_floor + 1 >= v_floors then
      perform public.shb_finish_round(p_round_id, floor(v_r.bet_amount * v_mult)::bigint,
        v_res || jsonb_build_object('state', 'cashed_out', 'bomb_rows', v_sec -> 'bombs'));
      return public.shb_round_json(p_round_id);
    end if;

  elsif v_fn = 'treasure' then
    v_cell := (p_action ->> 'cell')::int; v_picks := v_res -> 'picks';
    if v_cell is null or v_cell < 0 or v_cell >= (v_res ->> 'cells')::int or v_picks @> to_jsonb(v_cell) then
      raise exception 'INVALID_PARAMS';
    end if;
    v_picks := v_picks || to_jsonb(v_cell);
    v_found := (v_res -> 'found') || (v_sec -> 'values' -> v_cell);
    v_res := v_res || jsonb_build_object('picks', v_picks, 'found', v_found);
    if jsonb_array_length(v_picks) >= (v_res ->> 'max_picks')::int then
      v_mult := round((select sum((x #>> '{}')::numeric) from jsonb_array_elements(v_found) x) / jsonb_array_length(v_found), 4);
      perform public.shb_finish_round(p_round_id, floor(v_r.bet_amount * v_mult)::bigint,
        v_res || jsonb_build_object('state', 'finished', 'multiplier', v_mult, 'all_values', v_sec -> 'values'));
      return public.shb_round_json(p_round_id);
    end if;

  elsif v_fn = 'video_poker' then
    v_hold := p_action -> 'hold';
    if jsonb_typeof(v_hold) <> 'array' or jsonb_array_length(v_hold) <> 5 then raise exception 'INVALID_PARAMS'; end if;
    v_deck := array(select (x #>> '{}')::int from jsonb_array_elements(v_sec -> 'deck') x);
    v_hand := v_deck[1:5]; v_pos := 6;
    for i in 1 .. 5 loop
      if not (v_hold ->> (i - 1))::boolean then v_hand[i] := v_deck[v_pos]; v_pos := v_pos + 1; end if;
    end loop;
    v_name := public.shb_vp_hand(v_hand);
    v_mult := (v_cfg -> 'pay' ->> v_name)::numeric;
    perform public.shb_finish_round(p_round_id, floor(v_r.bet_amount * v_mult)::bigint, v_res || jsonb_build_object(
      'hand', to_jsonb(v_hand), 'held', v_hold, 'hand_name', v_name, 'state', 'finished', 'multiplier', v_mult));
    return public.shb_round_json(p_round_id);
  else
    raise exception 'GAME_NOT_FOUND';
  end if;

  update public.game_rounds set result = v_res where id = p_round_id;
  return public.shb_round_json(p_round_id);
end;
$$;

create or replace function public.step_cashout(p_round_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.shb_require_user(); v_r public.game_rounds; v_fn text; v_mult numeric; v_sec jsonb;
begin
  select * into v_r from public.game_rounds where id = p_round_id and user_id = v_uid for update;
  if not found then raise exception 'ROUND_NOT_FOUND'; end if;
  if v_r.status <> 'active' then return public.shb_round_json(p_round_id); end if;
  select config ->> 'fn' into v_fn from public.game_configs where game_key = v_r.game_key;
  if v_fn not in ('hilo', 'tower') then raise exception 'ACTION_NOT_ALLOWED'; end if;
  v_mult := (v_r.result ->> 'multiplier')::numeric;
  if v_mult <= 1 and coalesce((v_r.result ->> 'step')::int, (v_r.result ->> 'floor')::int, 0) = 0 then
    raise exception 'NOTHING_REVEALED';
  end if;
  select state into v_sec from public.game_round_secrets where round_id = p_round_id;
  perform public.shb_finish_round(p_round_id, floor(v_r.bet_amount * v_mult)::bigint,
    v_r.result || jsonb_build_object('state', 'cashed_out') ||
    case when v_fn = 'tower' then jsonb_build_object('bomb_rows', v_sec -> 'bombs') else '{}'::jsonb end);
  return public.shb_round_json(p_round_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Konfiguration der neuen Spiele (Katalogeinträge aktualisieren / anlegen)
-- ---------------------------------------------------------------------------
delete from public.game_configs where game_key in ('high_low_cards', 'memory_cards') and not exists (
  select 1 from public.game_rounds r where r.game_key in ('high_low_cards', 'memory_cards'));

insert into public.game_configs (game_key, display_name, enabled, config) values
('coinflip', 'Coinflip', true, '{"implemented":true,"engine":"simple","fn":"coinflip","category":"multiplier","min_bet":10,"max_bet":50000,"pay":1.98}'),
('wheel', 'Wheel', true, '{"implemented":true,"engine":"simple","fn":"wheel","category":"multiplier","min_bet":10,"max_bet":50000,"tables":{
  "low":[1.5,1.2,1.2,1.2,0,1.2,1.2,1.2,1.2,0,1.5,1.2,1.2,1.2,0,1.2,1.2,1.2,1.2,0],
  "medium":[0,2,0,1.6,0,2.1,0,1.6,0,3.2,0,1.9,0,2.1,0,1.6,0,1.7,0,2],
  "high":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,19.8]}}'),
('color_wheel', 'Color Wheel', true, '{"implemented":true,"engine":"simple","fn":"color_wheel","category":"multiplier","min_bet":10,"max_bet":50000,
  "pay":{"rot":3.5,"blau":5.8,"gruen":10.5,"gold":52},
  "layout":["grau","rot","blau","grau","gruen","rot","grau","grau","rot","blau","grau","grau","rot","grau","blau","rot","gruen","grau","grau","rot","blau","grau","rot","grau","grau","rot","gruen","blau","gold","grau","grau","rot","grau","blau","rot","grau","grau","gruen","rot","blau","grau","rot","grau","grau","rot","blau","grau","grau","gruen","rot","grau","blau","rot","grau"]}'),
('bonus_wheel', 'Bonus Wheel', true, '{"implemented":true,"engine":"simple","fn":"bonus_wheel","category":"multiplier","min_bet":10,"max_bet":50000,
  "segments":[[0,40.5],[0.5,20],[1,12],[1.5,8],[2,6],[3,4],[5,2.6],[10,1],[25,0.3],[50,0.1]]}'),
('keno', 'Keno', true, '{"implemented":true,"engine":"simple","fn":"draw","category":"lottery","min_bet":10,"max_bet":50000,"pool":40,"draw":10,"min_picks":1,"max_picks":10,
  "pay":{"1":[0.7,1.85],"2":[0,2,3.8],"3":[0,1.1,1.38,26],"4":[0,0,2.2,7.9,90],"5":[0,0,1.5,4.2,13,300],"6":[0,0,1.1,2,6.2,100,700],
         "7":[0,0,1.1,1.6,3.5,15,225,700],"8":[0,0,1.1,1.5,2,5.5,39,100,800],"9":[0,0,1.1,1.3,1.7,2.5,7.5,50,250,1000],"10":[0,0,1.1,1.2,1.3,1.8,3.5,13,50,250,1000]}}'),
('number_draw', 'Number Draw', true, '{"implemented":true,"engine":"simple","fn":"draw","category":"lottery","min_bet":10,"max_bet":50000,"pool":36,"draw":6,"min_picks":1,"max_picks":5,
  "pay":{"1":[0,5.8],"2":[0,2,17],"3":[0,1,5.5,92],"4":[0,0.5,3,30,500],"5":[0,0.4,2,12,140,2600]}}'),
('digital_lottery', 'Digital Lottery', true, '{"implemented":true,"engine":"simple","fn":"draw","category":"lottery","min_bet":10,"max_bet":10000,"pool":30,"draw":5,"min_picks":5,"max_picks":5,
  "pay":{"5":[0,0,1.5,17,230,22000]}}'),
('bingo', 'Bingo', true, '{"implemented":true,"engine":"simple","fn":"bingo","category":"lottery","min_bet":10,"max_bet":20000,"draw":30,"pay":[0,4.9,20,120,500,1000]}'),
('baccarat', 'Baccarat', true, '{"implemented":true,"engine":"simple","fn":"baccarat","category":"cards","min_bet":10,"max_bet":50000,"pay":{"player":2,"banker":1.95,"tie":9}}'),
('dragon_tiger', 'Dragon Tiger', true, '{"implemented":true,"engine":"simple","fn":"dragon_tiger","category":"cards","min_bet":10,"max_bet":50000,"pay":{"dragon":2,"tiger":2,"tie":12}}'),
('andar_bahar', 'Andar Bahar', true, '{"implemented":true,"engine":"simple","fn":"andar_bahar","category":"cards","min_bet":10,"max_bet":50000,"pay":{"andar":1.9,"bahar":2}}'),
('card_duel', 'Card Duel', true, '{"implemented":true,"engine":"simple","fn":"card_duel","category":"cards","min_bet":10,"max_bet":50000,"pay":1.95}'),
('sicbo', 'Sic Bo', true, '{"implemented":true,"engine":"simple","fn":"sicbo","category":"table","min_bet":10,"max_bet":50000,"any_triple":34,"triple":205,
  "total_pay":{"4":68,"5":34,"6":20,"7":13.5,"8":9.7,"9":8.2,"10":7.6,"11":7.6,"12":8.2,"13":9.7,"14":13.5,"15":20,"16":34,"17":68}}'),
('poker_dice', 'Poker Dice', true, '{"implemented":true,"engine":"simple","fn":"poker_dice","category":"table","min_bet":10,"max_bet":50000,
  "pay":{"five":120,"four":12,"full":5,"straight":2.8,"three":1.3,"twopair":0.75,"none":0}}'),
('dice_duel', 'Dice Duel', true, '{"implemented":true,"engine":"simple","fn":"dice_duel","category":"table","min_bet":10,"max_bet":50000,"pay":1.95}'),
('scratch_card', 'Scratch Card', true, '{"implemented":true,"engine":"simple","fn":"scratch_card","category":"lottery","min_bet":10,"max_bet":20000,
  "prizes":[[0,101.7,null],[1,15,"leaf"],[2,9,"cherry"],[3,5,"lemon"],[5,4,"bell"],[10,2.5,"star"],[20,1.2,"gem"],[50,0.25,"seven"],[100,0.05,"coin"]]}'),
('classic_slots', 'Classic Slots', true, '{"implemented":true,"engine":"simple","fn":"classic_slots","category":"slots","min_bet":10,"max_bet":25000,"two_cherry":5,"one_cherry":2,
  "symbols":[{"key":"bar","weight":8,"pay3":40},{"key":"cherry","weight":10,"pay3":30},{"key":"bell","weight":9,"pay3":35},{"key":"seven","weight":3,"pay3":400},{"key":"lemon","weight":12,"pay3":22},{"key":"blank","weight":18,"pay3":0}]}'),
('fruit_slots', 'Fruit Slots', true, '{"implemented":true,"engine":"simple","fn":"slots3x3","category":"slots","min_bet":10,"max_bet":25000,"scatter":"coin","pair_symbol":"cherry","pair_pay":2,
  "symbols":[{"key":"cherry","weight":30,"pay3":9},{"key":"lemon","weight":24,"pay3":13},{"key":"plum","weight":18,"pay3":22},{"key":"melon","weight":12,"pay3":50},{"key":"seven","weight":6,"pay3":200},{"key":"coin","weight":5,"pay3":0}]}'),
('neon_slots', 'Neon Slots', true, '{"implemented":true,"engine":"simple","fn":"neon_slots","category":"slots","min_bet":10,"max_bet":25000,"wild":"n_wild","wild_as":"n_crown",
  "symbols":[{"key":"n_a","weight":30},{"key":"n_k","weight":26},{"key":"n_q","weight":22},{"key":"n_star","weight":14},{"key":"n_bolt","weight":9},{"key":"n_crown","weight":4},{"key":"n_wild","weight":4}],
  "pays":{"n_a":[0,0,4.3,17,43],"n_k":[0,0,5.2,21,52],"n_q":[0,0,6.9,26,69],"n_star":[0,0,13,52,172],"n_bolt":[0,0,26,103,430],"n_crown":[0,0,69,344,1720]},
  "lines":[[1,1,1,1,1],[0,0,0,0,0],[2,2,2,2,2],[0,1,2,1,0],[2,1,0,1,2],[0,0,1,2,2],[2,2,1,0,0],[1,0,0,0,1],[1,2,2,2,1],[0,1,1,1,0]]}'),
('cluster_slots', 'Cluster Slots', true, '{"implemented":true,"engine":"simple","fn":"cluster_slots","category":"slots","min_bet":10,"max_bet":25000,
  "symbols":[{"key":"c_red","weight":26,"pays":[0,0,0,0,0,0.43,0.75,1.3,2.2,5.4]},{"key":"c_blue","weight":24,"pays":[0,0,0,0,0,0.54,0.97,1.6,2.7,6.5]},
             {"key":"c_green","weight":22,"pays":[0,0,0,0,0,0.75,1.3,2.2,3.8,8.6]},{"key":"c_purple","weight":16,"pays":[0,0,0,0,0,1.1,1.9,3.2,5.4,13]},
             {"key":"c_gold","weight":12,"pays":[0,0,0,0,0,2.2,3.8,6.5,11,27]}]}'),
('lucky_seven', 'Lucky Seven', true, '{"implemented":true,"engine":"simple","fn":"lucky_seven","category":"slots","min_bet":10,"max_bet":25000,"pay":{"triple7":200,"triple":40,"two7":8,"one7":0.8}}'),
('goal_multiplier', 'Goal Multiplier', true, '{"implemented":true,"engine":"simple","fn":"goal","category":"multiplier","min_bet":10,"max_bet":50000,"pay":1.47}'),
('rocket_multiplier', 'Rocket Multiplier', true, '{"implemented":true,"engine":"simple","fn":"rocket","category":"multiplier","min_bet":10,"max_bet":50000}'),
('drop_ball', 'Drop Ball', true, '{"implemented":true,"engine":"simple","fn":"drop_ball","category":"multiplier","min_bet":10,"max_bet":50000,"table":[11,4,1.9,1.2,0.75,0.5,0.75,1.2,1.9,4,11]}'),
('safe_cracker', 'Safe Cracker', true, '{"implemented":true,"engine":"simple","fn":"safe_cracker","category":"grid","min_bet":10,"max_bet":50000,"contents":[0,0,0.4,1,2,2.5]}'),
('shisha_diamonds', 'Shisha Diamonds', true, '{"implemented":true,"engine":"simple","fn":"shisha_diamonds","category":"slots","min_bet":10,"max_bet":25000,
  "trigger":6,"respin_chance":0.085,"grand":100,"wild":null,"wild_as":"sd_mint",
  "symbols":[{"key":"sd_mint","weight":30},{"key":"sd_lemon","weight":26},{"key":"sd_plum","weight":22},{"key":"sd_bell","weight":14},{"key":"sd_seven","weight":6},{"key":"sd_diamond","weight":18}],
  "pays":{"sd_mint":[0,0,9.2,28,74],"sd_lemon":[0,0,11,37,92],"sd_plum":[0,0,14,47,128],"sd_bell":[0,0,28,92,277],"sd_seven":[0,0,74,277,1108]},
  "diamond_values":[[2,40],[4,25],[6,15],[10,10],[20,6],[50,3],[100,1]],
  "lines":[[1,1,1,1,1],[0,0,0,0,0],[2,2,2,2,2],[0,1,2,1,0],[2,1,0,1,2],[0,0,1,2,2],[2,2,1,0,0],[1,0,0,0,1],[1,2,2,2,1],[0,1,1,1,0]]}'),
('hilo', 'Hi-Lo', true, '{"implemented":true,"engine":"step","fn":"hilo","category":"cards","min_bet":10,"max_bet":50000,"max_skips":5}'),
('towers', 'Towers', true, '{"implemented":true,"engine":"step","fn":"tower","category":"grid","min_bet":10,"max_bet":50000,"floors":8,"default_level":"medium",
  "levels":{"easy":{"cols":4,"bombs":1},"medium":{"cols":3,"bombs":1},"hard":{"cols":2,"bombs":1},"expert":{"cols":3,"bombs":2}}}'),
('gem_hunt', 'Gem Hunt', true, '{"implemented":true,"engine":"step","fn":"tower","category":"grid","min_bet":10,"max_bet":50000,"floors":10,"default_level":"hunt",
  "levels":{"hunt":{"cols":5,"bombs":1}}}'),
('treasure_grid', 'Treasure Grid', true, '{"implemented":true,"engine":"step","fn":"treasure","category":"grid","min_bet":10,"max_bet":50000,"picks":3,
  "values":[0,0,0,0,0,0.2,0.3,0.5,0.5,0.8,1,1,1.2,1.5,2.7,6]}'),
('video_poker', 'Video Poker', true, '{"implemented":true,"engine":"step","fn":"video_poker","category":"cards","min_bet":10,"max_bet":50000,
  "pay":{"royal":800,"straight_flush":50,"four":25,"full":9,"flush":6,"straight":4,"three":3,"two_pair":2,"jacks":1,"none":0}}')
on conflict (game_key) do update set display_name = excluded.display_name, enabled = excluded.enabled, config = excluded.config, updated_at = now();

-- ---------------------------------------------------------------------------
-- Rechte
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.shb_is_admin(), public.activate_my_account(), public.update_my_profile(text, text),
  public.mark_notifications_read(uuid[]), public.start_game_session(text), public.heartbeat_game_session(uuid),
  public.end_game_session(uuid), public.claim_weekly_bonus(text), public.request_credits(bigint, text),
  public.cancel_credit_request(uuid), public.get_leaderboard(), public.get_dashboard_state(), public.get_server_time(),
  public.get_active_round(text), public.play_dice(bigint, int, boolean, text), public.play_limbo(bigint, bigint, text),
  public.play_plinko(bigint, int, text, text), public.play_slots(bigint, text), public.play_roulette(jsonb, text),
  public.mines_start(bigint, int, int, text), public.mines_reveal(uuid, int), public.mines_cashout(uuid),
  public.blackjack_start(bigint, text), public.blackjack_action(uuid, text, int),
  public.crash_start(bigint, bigint, text), public.crash_cashout(uuid), public.crash_poll(uuid),
  public.get_crash_history(int), public.admin_finalize_week(boolean, text), public.admin_list_users(),
  public.admin_adjust_credits(uuid, bigint, text, text), public.admin_review_credit_request(uuid, boolean, text),
  public.admin_set_user_status(uuid, text, text), public.admin_update_profile(uuid, text, text, text),
  public.admin_update_game_config(text, boolean, jsonb, text), public.admin_update_setting(text, jsonb, text),
  public.admin_get_overview(),
  public.play_game(text, bigint, jsonb, text), public.step_start(text, bigint, jsonb, text),
  public.step_action(uuid, jsonb, int), public.step_cashout(uuid)
to authenticated;
grant execute on function public.shb_service_audit(uuid, text, uuid, jsonb), public.finalize_week() to service_role;
