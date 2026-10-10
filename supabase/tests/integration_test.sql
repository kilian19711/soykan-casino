-- Datenbank-Integrationstest für Shishabar Online Casino.
-- Läuft vollständig in einem DO-Block und endet IMMER mit einer Exception,
-- damit alle Testdaten zurückgerollt werden. Das Ergebnis steht in der Fehlermeldung:
--   "TEST_RESULT: {...}"  => alle Checks bestanden, wenn "failed": [] leer ist.
-- Ausführen: im Supabase SQL Editor oder via `psql -f supabase/tests/integration_test.sql`.

do $test$
declare
  v_admin uuid := gen_random_uuid();
  v_a uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
  v_c uuid := gen_random_uuid();
  v_d uuid := gen_random_uuid();
  v_res jsonb; v_res2 jsonb; v_round uuid; v_req uuid; v_cnt int; v_bal bigint; v_err text;
  v_passed text[] := '{}'; v_failed text[] := '{}';
  v_week jsonb; v_ok boolean;
begin
  -- Hilfs-Makro: Benutzerkontext setzen
  -- (role wird über set_config gesetzt; zurück zu postgres ist erlaubt, da session_user privilegiert ist)

  ---------------------------------------------------------------------------
  -- Setup (als postgres)
  ---------------------------------------------------------------------------
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
  values
    (v_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test-admin@shb.test', '{"username":"t_admin"}'),
    (v_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@shb.test', '{"username":"t_alpha","display_name":"Alpha"}'),
    (v_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@shb.test', '{"username":"t_beta","display_name":"Beta"}'),
    (v_c, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c@shb.test', '{"username":"t_charlie"}'),
    (v_d, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'd@shb.test', '{"username":"t_delta"}');

  -- Testadmin: echte Admin-Adresse ist ggf. noch nicht registriert -> für den Test temporär Admin setzen
  if not exists (select 1 from public.profiles where role = 'admin') then
    update public.profiles set role = 'admin' where id = v_admin;
  else
    raise exception 'TEST_SKIPPED: es existiert bereits ein Admin; Test bitte auf einer frischen Datenbank ausführen';
  end if;
  update public.profiles set status = 'active' where id in (v_admin, v_a, v_b, v_c, v_d);

  if (select count(*) from public.wallets where user_id in (v_a, v_b)) = 2 then v_passed := array_append(v_passed, ('wallet_created_by_trigger')::text);
  else v_failed := array_append(v_failed, ('wallet_created_by_trigger')::text); end if;

  ---------------------------------------------------------------------------
  -- Benutzer A
  ---------------------------------------------------------------------------
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_a::text, true);

  v_res := public.claim_weekly_bonus('bonus-test-0001');
  if (v_res ->> 'balance')::bigint = 1000 then v_passed := array_append(v_passed, ('bonus_claim')::text); else v_failed := array_append(v_failed, ('bonus_claim')::text); end if;

  begin
    perform public.claim_weekly_bonus('bonus-test-0002');
    v_failed := array_append(v_failed, ('bonus_double_claim_blocked')::text);
  exception when others then
    if sqlerrm = 'BONUS_ALREADY_CLAIMED' then v_passed := array_append(v_passed, ('bonus_double_claim_blocked')::text);
    else v_failed := array_append(v_failed, (('bonus_double_claim_blocked:' || sqlerrm))::text); end if;
  end;

  -- Dice + Idempotenz
  v_res := public.play_dice(100, 5000, false, 'dice-idem-0001');
  v_res2 := public.play_dice(100, 5000, false, 'dice-idem-0001');
  if v_res ->> 'round_id' = v_res2 ->> 'round_id'
     and (select count(*) from public.game_rounds where idempotency_key = v_a::text || ':dice-idem-0001') = 1
     and (select count(*) from public.credit_ledger where reference_id = (v_res ->> 'round_id')::uuid and entry_type = 'game_bet') = 1
  then v_passed := array_append(v_passed, ('idempotency_duplicate_request')::text);
  else v_failed := array_append(v_failed, ('idempotency_duplicate_request')::text); end if;

  if (v_res -> 'result' ->> 'roll')::int between 0 and 9999 and v_res -> 'result' ? 'server_seed'
     and encode(extensions.digest(decode(v_res -> 'result' ->> 'server_seed', 'hex'), 'sha256'), 'hex') = v_res ->> 'server_seed_hash'
  then v_passed := array_append(v_passed, ('dice_server_result_verifiable')::text);
  else v_failed := array_append(v_failed, ('dice_server_result_verifiable')::text); end if;

  -- Zu niedriger Kontostand
  begin
    perform public.play_limbo(49000, 200, 'limbo-poor-0001');
    v_failed := array_append(v_failed, ('insufficient_balance')::text);
  exception when others then
    if sqlerrm = 'INSUFFICIENT_BALANCE' then v_passed := array_append(v_passed, ('insufficient_balance')::text);
    else v_failed := array_append(v_failed, (('insufficient_balance:' || sqlerrm))::text); end if;
  end;

  -- Ungültige Parameter / Limits
  begin
    perform public.play_dice(5, 5000, false, 'dice-low-00001');
    v_failed := array_append(v_failed, ('bet_min_enforced')::text);
  exception when others then
    if sqlerrm = 'BET_TOO_LOW' then v_passed := array_append(v_passed, ('bet_min_enforced')::text); else v_failed := array_append(v_failed, (('bet_min_enforced:' || sqlerrm))::text); end if;
  end;

  -- Roulette mit mehreren Einsätzen
  v_res := public.play_roulette('[{"type":"red","amount":20},{"type":"straight","value":17,"amount":10},{"type":"dozen","value":2,"amount":10}]', 'roulette-0001');
  v_cnt := (v_res -> 'result' ->> 'number')::int;
  if (v_res ->> 'bet_amount')::bigint = 40
     and (v_res ->> 'payout_amount')::bigint =
         (case when v_cnt = any(array[1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]) then 40 else 0 end)
       + (case when v_cnt = 17 then 360 else 0 end)
       + (case when v_cnt between 13 and 24 then 30 else 0 end)
  then v_passed := array_append(v_passed, ('roulette_settlement')::text);
  else v_failed := array_append(v_failed, (('roulette_settlement:n=' || v_cnt))::text); end if;

  -- Plinko, Limbo, Slots
  v_res := public.play_plinko(10, 16, 'high', 'plinko-0001');
  if jsonb_array_length(v_res -> 'result' -> 'path') = 16 and v_res ->> 'status' = 'settled' then v_passed := array_append(v_passed, ('plinko')::text);
  else v_failed := array_append(v_failed, ('plinko')::text); end if;
  v_res := public.play_limbo(10, 200, 'limbo-0001');
  if ((v_res -> 'result' ->> 'result_multiplier')::bigint >= 200) = ((v_res ->> 'payout_amount')::bigint = 20) then v_passed := array_append(v_passed, ('limbo')::text);
  else v_failed := array_append(v_failed, ('limbo')::text); end if;
  v_res := public.play_slots(10, 'slots-0001');
  if jsonb_array_length(v_res -> 'result' -> 'grid') = 9 then v_passed := array_append(v_passed, ('slots')::text); else v_failed := array_append(v_failed, ('slots')::text); end if;

  -- Mines: Start, Geheimnis nicht lesbar, Aufdecken bis Ende oder Cashout
  v_res := public.mines_start(50, 5, 3, 'mines-0001');
  v_round := (v_res ->> 'round_id')::uuid;
  if v_res -> 'result' ? 'mine_positions' then v_failed := array_append(v_failed, ('mines_secret_hidden')::text); else v_passed := array_append(v_passed, ('mines_secret_hidden')::text); end if;
  begin
    select count(*) into v_cnt from public.game_round_secrets;
    if v_cnt = 0 then v_passed := array_append(v_passed, ('rls_secrets_unreadable')::text); else v_failed := array_append(v_failed, ('rls_secrets_unreadable')::text); end if;
  exception when insufficient_privilege then v_passed := array_append(v_passed, ('rls_secrets_unreadable')::text);
  end;
  v_res := public.mines_reveal(v_round, 0);
  if v_res ->> 'status' = 'active' then
    v_res := public.mines_cashout(v_round);
    v_res2 := public.mines_cashout(v_round);
    if v_res ->> 'status' = 'settled' and (v_res ->> 'payout_amount')::bigint = 56
       and v_res2 ->> 'payout_amount' = v_res ->> 'payout_amount'
       and (select count(*) from public.credit_ledger where reference_id = v_round and entry_type = 'game_payout') = 1
    then v_passed := array_append(v_passed, ('mines_cashout_idempotent')::text);
    else v_failed := array_append(v_failed, (('mines_cashout_idempotent:' || (v_res ->> 'payout_amount')))::text); end if;
  else
    if (v_res ->> 'payout_amount')::bigint = 0 then v_passed := array_append(v_passed, ('mines_cashout_idempotent(hit_mine)')::text);
    else v_failed := array_append(v_failed, ('mines_mine_hit')::text); end if;
  end if;

  -- Blackjack: Start, Stand, Doppel-Request mit alter Sequenz
  v_res := public.blackjack_start(100, 'bj-round-0001');
  v_round := (v_res ->> 'round_id')::uuid;
  if v_res ->> 'status' = 'active' then
    if (v_res -> 'result' -> 'dealer' -> 'cards') is not null and jsonb_array_length(v_res -> 'result' -> 'dealer' -> 'cards') = 1
    then v_passed := array_append(v_passed, ('blackjack_hole_card_hidden')::text); else v_failed := array_append(v_failed, ('blackjack_hole_card_hidden')::text); end if;
    v_res := public.blackjack_action(v_round, 'stand', 0);
    v_res2 := public.blackjack_action(v_round, 'stand', 0);
  end if;
  if v_res ->> 'status' = 'settled'
     and (v_res ->> 'payout_amount')::bigint = coalesce((select sum((h ->> 'payout')::bigint) from jsonb_array_elements(v_res -> 'result' -> 'hands') h), 0)
     and (select count(*) from public.credit_ledger where reference_id = v_round and entry_type = 'game_payout') <= 1
  then v_passed := array_append(v_passed, ('blackjack_settlement')::text);
  else v_failed := array_append(v_failed, ('blackjack_settlement')::text); end if;

  -- Crash: Cashout vor Start ist nicht möglich; Status "waiting"
  v_res := public.crash_start(20, null, 'crash-0001');
  v_round := (v_res ->> 'round_id')::uuid;
  if v_res -> 'result' ? 'crash_point' then v_failed := array_append(v_failed, ('crash_point_hidden')::text); else v_passed := array_append(v_passed, ('crash_point_hidden')::text); end if;
  begin
    perform public.crash_cashout(v_round);
    -- Falls sofort gecrasht (1.00x), ist die Runde bereits abgerechnet
    if (select status from public.game_rounds where id = v_round) = 'settled' then v_passed := array_append(v_passed, ('crash_cashout_guard(instant_crash)')::text);
    else v_failed := array_append(v_failed, ('crash_cashout_guard')::text); end if;
  exception when others then
    if sqlerrm = 'ROUND_NOT_STARTED' then v_passed := array_append(v_passed, ('crash_cashout_guard')::text); else v_failed := array_append(v_failed, (('crash_cashout_guard:' || sqlerrm))::text); end if;
  end;

  -- RLS: fremde Wallet / fremder Ledger / Admin-Funktion
  select count(*) into v_cnt from public.wallets where user_id = v_b;
  if v_cnt = 0 then v_passed := array_append(v_passed, ('rls_foreign_wallet')::text); else v_failed := array_append(v_failed, ('rls_foreign_wallet')::text); end if;
  select count(*) into v_cnt from public.credit_ledger where user_id <> v_a;
  if v_cnt = 0 then v_passed := array_append(v_passed, ('rls_foreign_ledger')::text); else v_failed := array_append(v_failed, ('rls_foreign_ledger')::text); end if;
  select count(*) into v_cnt from public.audit_logs;
  if v_cnt = 0 then v_passed := array_append(v_passed, ('rls_audit_hidden')::text); else v_failed := array_append(v_failed, ('rls_audit_hidden')::text); end if;
  select count(*) into v_cnt from public.app_settings;
  if v_cnt = 0 then v_passed := array_append(v_passed, ('rls_settings_hidden')::text); else v_failed := array_append(v_failed, ('rls_settings_hidden')::text); end if;
  begin
    perform public.admin_adjust_credits(v_a, 1000000, 'hack', 'hack-000001');
    v_failed := array_append(v_failed, ('admin_role_check')::text);
  exception when others then
    if sqlerrm = 'FORBIDDEN' then v_passed := array_append(v_passed, ('admin_role_check')::text); else v_failed := array_append(v_failed, (('admin_role_check:' || sqlerrm))::text); end if;
  end;
  begin
    perform public.shb_apply_ledger(v_a, 100000, 'admin_credit', 'hack', null, null, null, 'hack-ledger-1');
    v_failed := array_append(v_failed, ('internal_ledger_not_callable')::text);
  exception when insufficient_privilege then v_passed := array_append(v_passed, ('internal_ledger_not_callable')::text);
  end;
  begin
    update public.wallets set balance = 999999 where user_id = v_a;
    v_failed := array_append(v_failed, ('wallet_not_writable')::text);
  exception when insufficient_privilege then v_passed := array_append(v_passed, ('wallet_not_writable')::text);
  end;
  begin
    update public.profiles set role = 'admin' where id = v_a;
    v_failed := array_append(v_failed, ('role_not_writable')::text);
  exception when insufficient_privilege then v_passed := array_append(v_passed, ('role_not_writable')::text);
  end;

  -- Credit-Anfrage
  v_req := public.request_credits(500, 'Bitte um Nachschub');

  ---------------------------------------------------------------------------
  -- Benutzer B
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_b::text, true);
  select count(*) into v_cnt from public.credit_requests;
  if v_cnt = 0 then v_passed := array_append(v_passed, ('rls_foreign_requests')::text); else v_failed := array_append(v_failed, ('rls_foreign_requests')::text); end if;
  select count(*) into v_cnt from public.game_rounds;
  if v_cnt = 0 then v_passed := array_append(v_passed, ('rls_foreign_rounds')::text); else v_failed := array_append(v_failed, ('rls_foreign_rounds')::text); end if;
  select count(*) into v_cnt from public.get_leaderboard();
  if v_cnt >= 4 then v_passed := array_append(v_passed, ('leaderboard_visible')::text); else v_failed := array_append(v_failed, ('leaderboard_visible')::text); end if;
  select coalesce(bool_and(prev_balance >= balance), true) into v_ok
    from (select balance, lag(balance) over (order by ord) as prev_balance
            from public.get_leaderboard() with ordinality as t(user_id, username, display_name, avatar_seed, balance,
                 week_change, playtime_seconds, rounds_count, bonus_claimed, rank, ord)) s
   where prev_balance is not null;
  if v_ok then v_passed := array_append(v_passed, ('leaderboard_sorted')::text); else v_failed := array_append(v_failed, ('leaderboard_sorted')::text); end if;
  v_res := public.get_dashboard_state();
  if (v_res ->> 'server_now') is not null and (v_res ->> 'week_end')::timestamptz > now() then v_passed := array_append(v_passed, ('dashboard_state')::text);
  else v_failed := array_append(v_failed, ('dashboard_state')::text); end if;

  -- Spielzeit-Heartbeat
  v_round := public.start_game_session('ua');
  v_res := public.heartbeat_game_session(v_round);
  if (v_res ->> 'ok')::boolean and public.start_game_session('ua') = v_round then v_passed := array_append(v_passed, ('session_heartbeat_single_session')::text);
  else v_failed := array_append(v_failed, ('session_heartbeat_single_session')::text); end if;

  ---------------------------------------------------------------------------
  -- Admin
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  v_res := public.admin_adjust_credits(v_b, 500, 'Startguthaben Test', 'adj-test-0001');
  v_res2 := public.admin_adjust_credits(v_b, 500, 'Startguthaben Test', 'adj-test-0001');
  select balance into v_bal from public.wallets where user_id = v_b;
  if v_bal = 500 then v_passed := array_append(v_passed, ('admin_credit_idempotent')::text); else v_failed := array_append(v_failed, ('admin_credit_idempotent')::text); end if;

  v_res := public.admin_adjust_credits(v_b, -100, 'Korrektur Test', 'adj-test-0002');
  if (v_res ->> 'balance')::bigint = 400 then v_passed := array_append(v_passed, ('admin_debit')::text); else v_failed := array_append(v_failed, ('admin_debit')::text); end if;
  begin
    perform public.admin_adjust_credits(v_b, -10000, 'zu viel', 'adj-test-0003');
    v_failed := array_append(v_failed, ('admin_debit_no_negative')::text);
  exception when others then
    if sqlerrm = 'INSUFFICIENT_BALANCE' then v_passed := array_append(v_passed, ('admin_debit_no_negative')::text); else v_failed := array_append(v_failed, (('admin_debit_no_negative:' || sqlerrm))::text); end if;
  end;
  begin
    perform public.admin_adjust_credits(v_b, -10, '', 'adj-test-0004');
    v_failed := array_append(v_failed, ('admin_reason_required')::text);
  exception when others then
    if sqlerrm = 'REASON_REQUIRED' then v_passed := array_append(v_passed, ('admin_reason_required')::text); else v_failed := array_append(v_failed, (('admin_reason_required:' || sqlerrm))::text); end if;
  end;

  select balance into v_bal from public.wallets where user_id = v_a;
  v_res := public.admin_review_credit_request(v_req, true, 'ok');
  if (v_res ->> 'balance')::bigint = v_bal + 500 then v_passed := array_append(v_passed, ('credit_request_approve')::text); else v_failed := array_append(v_failed, ('credit_request_approve')::text); end if;
  begin
    perform public.admin_review_credit_request(v_req, false, 'nochmal');
    v_failed := array_append(v_failed, ('credit_request_review_once')::text);
  exception when others then
    if sqlerrm = 'REQUEST_ALREADY_REVIEWED' then v_passed := array_append(v_passed, ('credit_request_review_once')::text); else v_failed := array_append(v_failed, (sqlerrm)::text); end if;
  end;

  if (select count(*) from public.audit_logs where target_user_id = v_b) >= 2 then v_passed := array_append(v_passed, ('audit_log_written')::text);
  else v_failed := array_append(v_failed, ('audit_log_written')::text); end if;
  select count(*) into v_cnt from public.admin_list_users();
  if v_cnt >= 5 then v_passed := array_append(v_passed, ('admin_list_users')::text); else v_failed := array_append(v_failed, ('admin_list_users')::text); end if;

  -- Gleichstand: C und D haben 0 Credits; C hat mehr Spielzeit => C ist Wochenverlierer
  perform set_config('role', 'postgres', true);
  insert into public.game_sessions (user_id, started_at, last_heartbeat_at, ended_at, duration_seconds)
  values (v_c, now(), now(), now(), 600), (v_d, now(), now(), now(), 60);
  perform set_config('role', 'authenticated', true);

  v_week := public.admin_finalize_week(true, 'Testlauf');
  v_res := public.admin_finalize_week(true, 'Testlauf 2');
  if (v_week ->> 'loser_user_id')::uuid = v_c then v_passed := array_append(v_passed, ('weekly_loser_tiebreak_playtime')::text);
  else v_failed := array_append(v_failed, (('weekly_loser_tiebreak_playtime:' || coalesce(v_week ->> 'loser_user_id', 'null')))::text); end if;
  if (v_res ->> 'already_finalized')::boolean then v_passed := array_append(v_passed, ('finalize_week_idempotent')::text);
  else v_failed := array_append(v_failed, ('finalize_week_idempotent')::text); end if;

  ---------------------------------------------------------------------------
  -- Ledger-Konsistenz (als postgres)
  ---------------------------------------------------------------------------
  perform set_config('role', 'postgres', true);
  select count(*) into v_cnt from public.wallets w
   where w.user_id in (v_a, v_b, v_c, v_d)
     and w.balance <> coalesce((select sum(amount) from public.credit_ledger l where l.user_id = w.user_id), 0);
  if v_cnt = 0 then v_passed := array_append(v_passed, ('ledger_matches_wallets')::text); else v_failed := array_append(v_failed, ('ledger_matches_wallets')::text); end if;
  select count(*) into v_cnt from public.leaderboard_entries le join public.wallets w using (user_id) where le.balance <> w.balance;
  if v_cnt = 0 then v_passed := array_append(v_passed, ('leaderboard_mirror_in_sync')::text); else v_failed := array_append(v_failed, ('leaderboard_mirror_in_sync')::text); end if;
  select count(*) into v_cnt from public.notifications where user_id in (v_a, v_b, v_c, v_d) and type = 'week_finalized';
  if v_cnt = 4 then v_passed := array_append(v_passed, ('week_notifications')::text); else v_failed := array_append(v_failed, ('week_notifications')::text); end if;

  raise exception 'TEST_RESULT: %', jsonb_build_object('passed', to_jsonb(v_passed), 'failed', to_jsonb(v_failed),
    'passed_count', cardinality(v_passed), 'failed_count', cardinality(v_failed));
end
$test$;
