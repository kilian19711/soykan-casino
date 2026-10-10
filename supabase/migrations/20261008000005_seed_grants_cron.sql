-- Seed-Daten (nur Konfiguration, keine Fake-Konten), Funktionsrechte und Cron-Jobs.

insert into public.app_settings (key, value) values
  ('admin_email', '"admin@example.com"'),
  ('weekly_bonus_amount', '1000'),
  ('weekly_task_label', '"Kasten mitbringen"'),
  ('confetti_enabled', 'true')
on conflict (key) do nothing;

insert into public.expected_members (username, display_name, is_admin) values
  ('Spieler1', 'Spieler 1', false), ('Spieler2', 'Spieler 2', false), ('Spieler3', 'Spieler 3', false),
  ('Admin', 'Admin', true)
on conflict (username) do nothing;

-- Die acht fertigen Spiele
insert into public.game_configs (game_key, display_name, enabled, config) values
  ('roulette', 'Roulette', true, '{"implemented":true,"min_bet":10,"max_bet":50000,"category":"table"}'),
  ('blackjack', 'Blackjack', true, '{"implemented":true,"min_bet":10,"max_bet":50000,"category":"table"}'),
  ('crash', 'Crash', true, '{"implemented":true,"min_bet":10,"max_bet":50000,"category":"multiplier"}'),
  ('plinko', 'Plinko', true, '{"implemented":true,"min_bet":10,"max_bet":50000,"category":"multiplier","tables":{
    "8":{"low":[2.8,2,1.41,0.9,0.5,0.9,1.41,2,2.8],
         "medium":[4.6,2.8,1.57,0.8,0.3,0.8,1.57,2.8,4.6],
         "high":[7.1,3.5,1.63,0.69,0.2,0.69,1.63,3.5,7.1]},
    "12":{"low":[3.9,3,2.3,1.66,1.19,0.8,0.5,0.8,1.19,1.66,2.3,3,3.9],
          "medium":[8.6,5.4,3.4,2.1,1.21,0.65,0.3,0.65,1.21,2.1,3.4,5.4,8.6],
          "high":[18,9.3,4.7,2.4,1.14,0.52,0.2,0.52,1.14,2.4,4.7,9.3,18]},
    "16":{"low":[5.5,4.3,3.3,2.6,1.96,1.47,1.07,0.75,0.5,0.75,1.07,1.47,1.96,2.6,3.3,4.3,5.5],
          "medium":[17,11,6.8,4.3,2.7,1.67,1.01,0.58,0.3,0.58,1.01,1.67,2.7,4.3,6.8,11,17],
          "high":[49,25,13,6.6,3.4,1.7,0.86,0.42,0.2,0.42,0.86,1.7,3.4,6.6,13,25,49]}}}'),
  ('mines', 'Mines', true, '{"implemented":true,"min_bet":10,"max_bet":50000,"category":"grid"}'),
  ('dice', 'Dice', true, '{"implemented":true,"min_bet":10,"max_bet":50000,"category":"multiplier"}'),
  ('limbo', 'Limbo', true, '{"implemented":true,"min_bet":10,"max_bet":50000,"category":"multiplier"}'),
  ('slots', 'Shisha Slots', true, '{"implemented":true,"min_bet":10,"max_bet":25000,"category":"slots","cherry_pair_pay":2,
    "symbols":[{"key":"cherry","weight":30,"pay3":9},{"key":"leaf","weight":24,"pay3":13},{"key":"bell","weight":18,"pay3":22},
               {"key":"gem","weight":12,"pay3":50},{"key":"seven","weight":6,"pay3":200},{"key":"coin","weight":5,"pay3":0}]}')
on conflict (game_key) do nothing;

-- Katalog: geplante Spiele (deaktiviert, "In Entwicklung")
insert into public.game_configs (game_key, display_name, enabled, config)
select k, n, false, jsonb_build_object('implemented', false, 'min_bet', 10, 'max_bet', 50000, 'category', c)
from (values
  ('wheel','Wheel','multiplier'),('coinflip','Coinflip','multiplier'),('hilo','Hi-Lo','cards'),('towers','Towers','grid'),
  ('keno','Keno','lottery'),('bingo','Bingo','lottery'),('baccarat','Baccarat','table'),('sicbo','Sic Bo','table'),
  ('dragon_tiger','Dragon Tiger','cards'),('andar_bahar','Andar Bahar','cards'),('video_poker','Video Poker','cards'),
  ('poker_dice','Poker Dice','table'),('scratch_card','Scratch Card','lottery'),('number_draw','Number Draw','lottery'),
  ('bonus_wheel','Bonus Wheel','multiplier'),('classic_slots','Classic Slots','slots'),('neon_slots','Neon Slots','slots'),
  ('cluster_slots','Cluster Slots','slots'),('fruit_slots','Fruit Slots','slots'),('high_low_cards','High-Low-Karten','cards'),
  ('dice_duel','Dice Duel','table'),('memory_cards','Memory Cards','cards'),('color_wheel','Color Wheel','multiplier'),
  ('safe_cracker','Safe Cracker','grid'),('treasure_grid','Treasure Grid','grid'),('lucky_seven','Lucky Seven','slots'),
  ('digital_lottery','Digital Lottery','lottery'),('card_duel','Card Duel','cards'),('goal_multiplier','Goal Multiplier','multiplier'),
  ('rocket_multiplier','Rocket Multiplier','multiplier'),('drop_ball','Drop Ball','multiplier'),('gem_hunt','Gem Hunt','grid')
) as t(k, n, c)
on conflict (game_key) do nothing;

-- ---------------------------------------------------------------------------
-- Funktionsrechte: alles entziehen, dann explizite Whitelist
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

grant execute on function
  public.shb_is_admin(),
  public.activate_my_account(),
  public.update_my_profile(text, text),
  public.mark_notifications_read(uuid[]),
  public.start_game_session(text),
  public.heartbeat_game_session(uuid),
  public.end_game_session(uuid),
  public.claim_weekly_bonus(text),
  public.request_credits(bigint, text),
  public.cancel_credit_request(uuid),
  public.get_leaderboard(),
  public.get_dashboard_state(),
  public.get_server_time(),
  public.get_active_round(text),
  public.play_dice(bigint, int, boolean, text),
  public.play_limbo(bigint, bigint, text),
  public.play_plinko(bigint, int, text, text),
  public.play_slots(bigint, text),
  public.play_roulette(jsonb, text),
  public.mines_start(bigint, int, int, text),
  public.mines_reveal(uuid, int),
  public.mines_cashout(uuid),
  public.blackjack_start(bigint, text),
  public.blackjack_action(uuid, text, int),
  public.crash_start(bigint, bigint, text),
  public.crash_cashout(uuid),
  public.crash_poll(uuid),
  public.get_crash_history(int),
  public.admin_finalize_week(boolean, text),
  public.admin_list_users(),
  public.admin_adjust_credits(uuid, bigint, text, text),
  public.admin_review_credit_request(uuid, boolean, text),
  public.admin_set_user_status(uuid, text, text),
  public.admin_update_profile(uuid, text, text, text),
  public.admin_update_game_config(text, boolean, jsonb, text),
  public.admin_update_setting(text, jsonb, text),
  public.admin_get_overview()
to authenticated;

grant execute on function public.shb_service_audit(uuid, text, uuid, jsonb), public.finalize_week() to service_role;

-- ---------------------------------------------------------------------------
-- pg_cron: stündlicher idempotenter Wochenabschluss-Check (DST-sicher) + Wartung jede Minute
-- ---------------------------------------------------------------------------
create extension if not exists pg_cron;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'shb_finalize_week') then
    perform cron.unschedule('shb_finalize_week');
  end if;
  if exists (select 1 from cron.job where jobname = 'shb_maintenance') then
    perform cron.unschedule('shb_maintenance');
  end if;
  perform cron.schedule('shb_finalize_week', '2 * * * *', 'select public.finalize_week();');
  perform cron.schedule('shb_maintenance', '* * * * *', 'select public.shb_maintenance();');
end $$;
