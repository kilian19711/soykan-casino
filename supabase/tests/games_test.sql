-- Test der neuen Spiele (nach Migration 20261009000006). Endet immer mit einer Exception => alles wird zurückgerollt.
-- 1) Auszahlungsquote jeder Rechenfunktion per Monte-Carlo (direkt, ohne Buchungen)
-- 2) Integrationslauf über play_game / step_* mit einem temporären Testbenutzer
do $test$
declare
  v_cfg jsonb; v_sum numeric; v_n int := 300; v_rtp jsonb := '{}'::jsonb; v_key text; v_params jsonb; v_r jsonb;
  v_u uuid := gen_random_uuid(); v_res jsonb; v_round uuid; f text[] := '{}'; p text[] := '{}'; v_bal bigint; v_cnt int;
  v_games text[] := array['coinflip','wheel','color_wheel','bonus_wheel','keno','number_draw','digital_lottery','bingo','baccarat',
    'dragon_tiger','andar_bahar','card_duel','sicbo','poker_dice','dice_duel','scratch_card','classic_slots','fruit_slots',
    'neon_slots','cluster_slots','lucky_seven','goal_multiplier','rocket_multiplier','drop_ball','safe_cracker','shisha_diamonds'];
begin
  foreach v_key in array v_games loop
    select config into v_cfg from public.game_configs where game_key = v_key;
    v_params := case v_key
      when 'coinflip' then '{"side":"heads"}' when 'wheel' then '{"risk":"medium"}' when 'color_wheel' then '{"color":"blau"}'
      when 'keno' then '{"picks":[1,2,3,4,5]}' when 'number_draw' then '{"picks":[3,9,27]}' when 'digital_lottery' then '{"picks":[1,2,3,4,5]}'
      when 'baccarat' then '{"bet":"banker"}' when 'dragon_tiger' then '{"bet":"dragon"}' when 'andar_bahar' then '{"side":"andar"}'
      when 'sicbo' then '{"bets":[{"type":"big","amount":10}]}' when 'goal_multiplier' then '{"corner":1}' when 'rocket_multiplier' then '{"target":200}'
      when 'safe_cracker' then '{"safe":2}' else '{}' end;
    v_sum := 0;
    for i in 1 .. (case when v_key in ('shisha_diamonds', 'cluster_slots', 'baccarat', 'bingo') then 60 else v_n end) loop
      v_r := case v_cfg ->> 'fn'
        when 'coinflip' then public.shb_g_coinflip(extensions.gen_random_bytes(32), v_params, v_cfg)
        when 'wheel' then public.shb_g_wheel(extensions.gen_random_bytes(32), v_params, v_cfg)
        when 'color_wheel' then public.shb_g_color_wheel(extensions.gen_random_bytes(32), v_params, v_cfg)
        when 'bonus_wheel' then public.shb_g_bonus_wheel(extensions.gen_random_bytes(32), v_params, v_cfg)
        when 'draw' then public.shb_g_draw(extensions.gen_random_bytes(32), v_params, v_cfg)
        when 'bingo' then public.shb_g_bingo(extensions.gen_random_bytes(32), v_params, v_cfg)
        when 'baccarat' then public.shb_g_baccarat(extensions.gen_random_bytes(32), v_params, v_cfg)
        when 'dragon_tiger' then public.shb_g_dragon_tiger(extensions.gen_random_bytes(32), v_params, v_cfg)
        when 'andar_bahar' then public.shb_g_andar_bahar(extensions.gen_random_bytes(32), v_params, v_cfg)
        when 'card_duel' then public.shb_g_card_duel(extensions.gen_random_bytes(32), v_params, v_cfg)
        when 'sicbo' then public.shb_g_sicbo(extensions.gen_random_bytes(32), v_params, v_cfg)
        when 'poker_dice' then public.shb_g_poker_dice(extensions.gen_random_bytes(32), v_params, v_cfg)
        when 'dice_duel' then public.shb_g_dice_duel(extensions.gen_random_bytes(32), v_params, v_cfg)
        when 'scratch_card' then public.shb_g_scratch_card(extensions.gen_random_bytes(32), v_params, v_cfg)
        when 'classic_slots' then public.shb_g_classic_slots(extensions.gen_random_bytes(32), v_params, v_cfg)
        when 'slots3x3' then public.shb_g_slots3x3(extensions.gen_random_bytes(32), v_params, v_cfg)
        when 'neon_slots' then public.shb_g_neon_slots(extensions.gen_random_bytes(32), v_params, v_cfg)
        when 'cluster_slots' then public.shb_g_cluster_slots(extensions.gen_random_bytes(32), v_params, v_cfg)
        when 'lucky_seven' then public.shb_g_lucky_seven(extensions.gen_random_bytes(32), v_params, v_cfg)
        when 'goal' then public.shb_g_goal(extensions.gen_random_bytes(32), v_params, v_cfg)
        when 'rocket' then public.shb_g_rocket(extensions.gen_random_bytes(32), v_params, v_cfg)
        when 'drop_ball' then public.shb_g_drop_ball(extensions.gen_random_bytes(32), v_params, v_cfg)
        when 'safe_cracker' then public.shb_g_safe_cracker(extensions.gen_random_bytes(32), v_params, v_cfg)
        when 'shisha_diamonds' then public.shb_g_shisha_diamonds(extensions.gen_random_bytes(32), v_params, v_cfg) end;
      v_sum := v_sum + (v_r ->> 'mult')::numeric;
      if v_key = 'scratch_card' and (v_r ->> 'mult')::numeric = 0 and
         exists (select 1 from jsonb_array_elements_text(v_r -> 'grid') g group by g having count(*) >= 3) then
        f := array_append(f, 'scratch_losing_card_has_triple'::text);
      end if;
    end loop;
    v_rtp := v_rtp || jsonb_build_object(v_key, round(v_sum / (case when v_key in ('shisha_diamonds', 'cluster_slots', 'baccarat', 'bingo') then 60 else v_n end) * 100, 1));
  end loop;

  -- Integrationslauf
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
  values (v_u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'games-test@shb.test', '{"username":"t_games"}');
  update public.profiles set status = 'active' where id = v_u;
  perform public.shb_apply_ledger(v_u, 100000, 'admin_credit', 'Test', null, null, null, 'games-test-credit-1');
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_u, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_u::text, true);

  foreach v_key in array v_games loop
    v_params := case v_key
      when 'coinflip' then '{"side":"tails"}' when 'wheel' then '{"risk":"low"}' when 'color_wheel' then '{"color":"rot"}'
      when 'keno' then '{"picks":[1,2,3]}' when 'number_draw' then '{"picks":[1]}' when 'digital_lottery' then '{"picks":[5,6,7,8,9]}'
      when 'baccarat' then '{"bet":"player"}' when 'dragon_tiger' then '{"bet":"tie"}' when 'andar_bahar' then '{"side":"bahar"}'
      when 'sicbo' then '{"bets":[{"type":"small","amount":10},{"type":"total","value":10,"amount":10},{"type":"single","value":3,"amount":10}]}'
      when 'goal_multiplier' then '{"corner":0}' when 'rocket_multiplier' then '{"target":150}' when 'safe_cracker' then '{"safe":0}' else '{}' end;
    begin
      v_res := public.play_game(v_key, 20, v_params, 'gt-' || v_key || '-0001');
      if v_res ->> 'status' = 'settled' and (v_res ->> 'payout_amount')::bigint = floor((v_res ->> 'bet_amount')::bigint * (v_res -> 'result' ->> 'mult')::numeric)
      then p := array_append(p, v_key); else f := array_append(f, ('play:' || v_key)::text); end if;
    exception when others then f := array_append(f, ('play:' || v_key || ':' || sqlerrm)::text);
    end;
  end loop;

  -- Ungültige Parameter werden abgelehnt (und nichts wird gebucht)
  select balance into v_bal from public.wallets where user_id = v_u;
  begin
    perform public.play_game('keno', 20, '{"picks":[1,1]}', 'gt-invalid-0001');
    f := array_append(f, 'invalid_params_not_rejected'::text);
  exception when others then
    if sqlerrm = 'INVALID_PARAMS' and (select balance from public.wallets where user_id = v_u) = v_bal then p := array_append(p, 'invalid_params'::text);
    else f := array_append(f, ('invalid_params:' || sqlerrm)::text); end if;
  end;
  begin
    perform public.play_game('dice', 20, '{}', 'gt-wrong-engine-01');
    f := array_append(f, 'engine_guard'::text);
  exception when others then p := array_append(p, 'engine_guard'::text);
  end;

  -- Hi-Lo
  v_res := public.step_start('hilo', 20, '{}', 'gt-hilo-000001');
  v_round := (v_res ->> 'round_id')::uuid;
  v_res := public.step_action(v_round, jsonb_build_object('guess', case when ((v_res -> 'result' ->> 'card')::int % 13) < 6 then 'higher' else 'lower' end), 0);
  if v_res ->> 'status' = 'active' then
    v_res := public.step_cashout(v_round);
    if (v_res ->> 'payout_amount')::bigint > 20 then p := array_append(p, 'hilo_cashout'::text); else f := array_append(f, 'hilo_cashout'::text); end if;
  else p := array_append(p, 'hilo_lost'::text); end if;
  -- doppelte Aktion mit alter Sequenznummer ändert nichts
  v_res := public.step_action(v_round, '{"guess":"higher"}', 0);
  if v_res ->> 'status' = 'settled' then p := array_append(p, 'hilo_seq_guard'::text); else f := array_append(f, 'hilo_seq_guard'::text); end if;

  -- Towers
  v_res := public.step_start('towers', 20, '{"difficulty":"easy"}', 'gt-tower-00001');
  v_round := (v_res ->> 'round_id')::uuid;
  if v_res -> 'result' ? 'bomb_rows' then f := array_append(f, 'tower_secret_leak'::text); end if;
  v_res := public.step_action(v_round, '{"col":0}', 0);
  if v_res ->> 'status' = 'active' then v_res := public.step_cashout(v_round); end if;
  if v_res ->> 'status' = 'settled' and v_res -> 'result' ? 'bomb_rows' then p := array_append(p, 'towers'::text); else f := array_append(f, 'towers'::text); end if;

  -- Gem Hunt
  v_res := public.step_start('gem_hunt', 20, '{}', 'gt-gem-0000001');
  v_round := (v_res ->> 'round_id')::uuid;
  v_res := public.step_action(v_round, '{"col":2}', 0);
  if v_res ->> 'status' in ('active', 'settled') then p := array_append(p, 'gem_hunt'::text); else f := array_append(f, 'gem_hunt'::text); end if;

  -- Treasure Grid (3 Picks, kein Cashout)
  v_res := public.step_start('treasure_grid', 20, '{}', 'gt-treasure-001');
  v_round := (v_res ->> 'round_id')::uuid;
  v_res := public.step_action(v_round, '{"cell":0}', 0);
  v_res := public.step_action(v_round, '{"cell":5}', 1);
  v_res := public.step_action(v_round, '{"cell":9}', 2);
  if v_res ->> 'status' = 'settled' and jsonb_array_length(v_res -> 'result' -> 'all_values') = 16 then p := array_append(p, 'treasure'::text);
  else f := array_append(f, 'treasure'::text); end if;

  -- Video Poker: alles halten
  v_res := public.step_start('video_poker', 20, '{}', 'gt-vpoker-0001');
  v_round := (v_res ->> 'round_id')::uuid;
  if v_res -> 'result' ? 'deck' then f := array_append(f, 'vp_deck_leak'::text); end if;
  v_res := public.step_action(v_round, '{"hold":[true,true,true,true,true]}', 0);
  if v_res ->> 'status' = 'settled' then p := array_append(p, 'video_poker'::text); else f := array_append(f, 'video_poker'::text); end if;

  -- Secrets nicht lesbar
  begin
    select count(*) into v_cnt from public.game_round_secrets;
    if v_cnt = 0 then p := array_append(p, 'secrets_hidden'::text); else f := array_append(f, 'secrets_hidden'::text); end if;
  exception when insufficient_privilege then p := array_append(p, 'secrets_hidden'::text);
  end;

  -- Ledger-Konsistenz
  perform set_config('role', 'postgres', true);
  if (select balance from public.wallets where user_id = v_u) = (select sum(amount) from public.credit_ledger where user_id = v_u)
  then p := array_append(p, 'ledger_consistent'::text); else f := array_append(f, 'ledger_consistent'::text); end if;

  -- Video-Poker-Handbewertung
  if public.shb_vp_hand(array[9,10,11,12,0]) = 'royal' and public.shb_vp_hand(array[0,13,26,39,1]) = 'four'
     and public.shb_vp_hand(array[10,23,3,4,5]) = 'jacks' and public.shb_vp_hand(array[1,14,3,4,5]) = 'none'
     and public.shb_vp_hand(array[0,14,28,42,4]) = 'straight' then p := array_append(p, 'vp_eval'::text);
  else f := array_append(f, 'vp_eval'::text); end if;

  raise exception 'TEST_RESULT: %', jsonb_build_object('failed', to_jsonb(f), 'passed_count', cardinality(p), 'rtp_percent', v_rtp);
end
$test$;
