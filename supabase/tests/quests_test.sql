-- Test für Migration 9 + 10: spielt beide im DO-Block ein, testet und endet IMMER mit einer Exception (Rollback).
do $test$
declare
  v_out text := ''; v_n int; v_u uuid; v_admin uuid; v_q jsonb; v_r jsonb; v_c jsonb; v_qid uuid; v_bal bigint; v_rounds bigint;
begin
  set local statement_timeout = '110s';
  set local lock_timeout = '5s';
  execute $mig$-- Migration 9: Abrechnung alle 3 Wochen, Erfolge v2 (100 Credits je neuem Erfolg, Fortschritt), Daily Quests.
-- Abrechnung: erste Runde 09.10.2026 bis So 01.11.2026 23:59 (Europe/Berlin), danach alle 3 Wochen.
-- Bereits freigeschaltete oder beim Einspielen schon erreichte Erfolge bringen keine Belohnung.

-- ---------------------------------------------------------------------------
-- Einstellungen und Buchungsarten
-- ---------------------------------------------------------------------------
insert into public.app_settings (key, value) values
  ('period_anchor_end', '"2026-11-02 00:00"'),   -- Ende der ersten Runde (lokale Berliner Zeit, exklusiv)
  ('period_first_start', '"2026-10-09 00:00"'),
  ('period_weeks', '3'),
  ('achievement_reward', '100')
on conflict (key) do nothing;

alter table public.credit_ledger drop constraint if exists credit_ledger_entry_type_check;
alter table public.credit_ledger add constraint credit_ledger_entry_type_check check (entry_type in (
  'weekly_bonus', 'game_bet', 'game_payout', 'admin_credit', 'admin_debit', 'credit_request', 'achievement_reward', 'quest_reward'
));

-- ---------------------------------------------------------------------------
-- Abrechnungszeitraum (3 Wochen)
-- ---------------------------------------------------------------------------
create or replace function public.shb_period_end(p_ts timestamptz default now())
returns timestamptz language plpgsql stable set search_path = '' as $$
declare
  v_anchor timestamp := (public.shb_setting('period_anchor_end') #>> '{}')::timestamp;
  v_len int := 7 * coalesce((public.shb_setting('period_weeks') #>> '{}')::int, 3);
  v_local timestamp := p_ts at time zone 'Europe/Berlin';
  v_days int := v_local::date - v_anchor::date;
  v_end timestamp;
begin
  v_end := v_anchor + make_interval(days => v_len * (floor(v_days::numeric / v_len)::int + 1));
  if v_end < v_anchor then v_end := v_anchor; end if;   -- alles vor dem Anker gehört zur ersten Runde
  return v_end at time zone 'Europe/Berlin';
end;
$$;

create or replace function public.shb_period_start(p_ts timestamptz default now())
returns timestamptz language plpgsql stable set search_path = '' as $$
declare
  v_anchor timestamp := (public.shb_setting('period_anchor_end') #>> '{}')::timestamp;
  v_len int := 7 * coalesce((public.shb_setting('period_weeks') #>> '{}')::int, 3);
  v_end timestamp := public.shb_period_end(p_ts) at time zone 'Europe/Berlin';
begin
  if v_end = v_anchor then
    return (public.shb_setting('period_first_start') #>> '{}')::timestamp at time zone 'Europe/Berlin';
  end if;
  return (v_end - make_interval(days => v_len)) at time zone 'Europe/Berlin';
end;
$$;

-- Schlüssel = letzter Tag der Runde, z. B. 'P2026-11-01'
create or replace function public.shb_period_key(p_ts timestamptz default now())
returns text language sql stable set search_path = '' as $$
  select 'P' || to_char((public.shb_period_end(p_ts) at time zone 'Europe/Berlin') - interval '1 day', 'YYYY-MM-DD');
$$;

-- Abschluss einer Runde (Name bleibt für bestehende Aufrufer). p_week_start = beliebiger Zeitpunkt in der Runde.
create or replace function public.shb_finalize_week(p_week_start timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_start timestamptz := public.shb_period_start(p_week_start);
  v_end timestamptz := public.shb_period_end(p_week_start);
  v_key text := public.shb_period_key(p_week_start);
  v_label text := coalesce(public.shb_setting('weekly_task_label') #>> '{}', 'Kasten mitbringen');
  v_loser uuid; v_loser_balance bigint; v_loser_name text; v_result_id uuid; v_top uuid;
begin
  perform pg_advisory_xact_lock(hashtext('finalize_week:' || v_key));
  if exists (select 1 from public.weekly_results where week_key = v_key) then
    return jsonb_build_object('week_key', v_key, 'already_finalized', true);
  end if;

  insert into public.weekly_snapshots (week_key, user_id, balance, playtime_seconds)
  select v_key, p.id, w.balance, public.shb_playtime(p.id, v_start, v_end)
    from public.profiles p join public.wallets w on w.user_id = p.id
   where p.status = 'active'
  on conflict (week_key, user_id) do nothing;

  select s.user_id, s.balance, p.display_name into v_loser, v_loser_balance, v_loser_name
    from public.weekly_snapshots s join public.profiles p on p.id = s.user_id
   where s.week_key = v_key
   order by s.balance asc, s.playtime_seconds desc,
            coalesce((select max(l.created_at) from public.credit_ledger l where l.user_id = s.user_id), p.created_at) asc,
            p.username asc
   limit 1;

  insert into public.weekly_results (week_key, loser_user_id, loser_balance, task_label)
  values (v_key, v_loser, coalesce(v_loser_balance, 0), v_label)
  on conflict (week_key) do nothing
  returning id into v_result_id;

  if v_result_id is not null then
    insert into public.notifications (user_id, type, title, message, metadata)
    select p.id, 'week_finalized', 'Abrechnung der Runde',
           case when v_loser is null then 'Die Runde wurde abgerechnet.'
                when p.id = v_loser then 'Du hast den niedrigsten Kontostand. Aufgabe: ' || v_label
                else coalesce(v_loser_name, '?') || ' hat den niedrigsten Kontostand. Aufgabe: ' || v_label end,
           jsonb_build_object('week_key', v_key, 'loser_user_id', v_loser)
      from public.profiles p where p.status = 'active';

    -- Rundensieger (höchster Kontostand) für den Erfolg "Rundensieger"
    select s.user_id into v_top from public.weekly_snapshots s where s.week_key = v_key order by s.balance desc limit 1;
    if v_top is not null then
      perform public.shb_stats_row(v_top);
      update public.player_stats set period_wins = period_wins + 1 where user_id = v_top;
      perform public.shb_check_achievements(v_top, null, true);
    end if;
  end if;

  return jsonb_build_object('week_key', v_key, 'already_finalized', v_result_id is null,
    'loser_user_id', v_loser, 'loser_balance', v_loser_balance);
end;
$$;

-- Cron: rechnet die zuletzt beendete Runde ab (idempotent). Vor dem Ende der ersten Runde passiert nichts.
create or replace function public.finalize_week()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_prev timestamptz := public.shb_period_start(now()) - interval '1 second';
begin
  if public.shb_period_end(v_prev) > now() then
    return jsonb_build_object('skipped', true, 'reason', 'PERIOD_RUNNING');
  end if;
  if not exists (select 1 from public.credit_ledger
                  where created_at >= public.shb_period_start(v_prev) and created_at < public.shb_period_end(v_prev)) then
    return jsonb_build_object('skipped', true, 'reason', 'NO_ACTIVITY');
  end if;
  return public.shb_finalize_week(v_prev);
end;
$$;

create or replace function public.admin_finalize_week(p_current_week boolean default false, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_admin uuid := public.shb_require_admin(); v_res jsonb; v_prev timestamptz;
begin
  if p_reason is null or char_length(btrim(p_reason)) < 3 then raise exception 'REASON_REQUIRED'; end if;
  perform public.shb_rate_limit(v_admin, 'admin_action', 60, 60);
  if p_current_week then
    v_res := public.shb_finalize_week(now());
  else
    v_prev := public.shb_period_start(now()) - interval '1 second';
    if public.shb_period_end(v_prev) > now() then raise exception 'NOTHING_TO_FINALIZE'; end if;
    v_res := public.shb_finalize_week(v_prev);
  end if;
  perform public.shb_audit('finalize_week', null, v_res || jsonb_build_object('reason', p_reason, 'current_week', p_current_week));
  return v_res;
end;
$$;

-- ---------------------------------------------------------------------------
-- Spielerstatistik (Grundlage für Erfolge und deren Fortschritt)
-- ---------------------------------------------------------------------------
create table if not exists public.player_stats (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  rounds bigint not null default 0,
  wins bigint not null default 0,
  wagered bigint not null default 0,
  best_mult numeric not null default 0,
  best_profit bigint not null default 0,
  win_streak int not null default 0,
  best_win_streak int not null default 0,
  loss_streak int not null default 0,
  best_loss_streak int not null default 0,
  bonus_streak int not null default 0,
  best_bonus_streak int not null default 0,
  last_bonus_day date,
  quests_done int not null default 0,
  perfect_days int not null default 0,
  period_wins int not null default 0
);
alter table public.player_stats enable row level security;

create or replace function public.shb_stats_row(p_user uuid)
returns void language sql security definer set search_path = '' as $$
  insert into public.player_stats (user_id) values (p_user) on conflict do nothing;
$$;

-- ---------------------------------------------------------------------------
-- Erfolge v2: Definitionen
-- metric: rounds, wins, wagered, best_mult, best_profit, best_win_streak, best_loss_streak, games,
--         best_bonus_streak, quests_done, perfect_days, balance, kasten, period_wins, event
-- event: Runde von game_key mit Multiplikator >= target und result @> cond (Fortschritt 0/1)
-- ---------------------------------------------------------------------------
create table if not exists public.achievement_defs (
  key text primary key,
  title text not null,
  description text not null,
  icon text not null,
  metric text not null,
  target numeric not null,
  game_key text,
  cond jsonb,
  sort int not null default 0
);
alter table public.achievement_defs enable row level security;
drop policy if exists achievement_defs_select on public.achievement_defs;
create policy achievement_defs_select on public.achievement_defs for select to authenticated using (true);

alter table public.achievements add column if not exists reward bigint not null default 0;

insert into public.achievement_defs (key, title, description, icon, metric, target, game_key, cond, sort) values
-- Runden
('first_round', 'Erste Runde', 'Spiele deine erste Runde.', '1', 'rounds', 1, null, null, 10),
('rounds_50', 'Warmgespielt', 'Spiele 50 Runden.', '50', 'rounds', 50, null, null, 11),
('rounds_100', '100 Runden', 'Spiele 100 Runden.', 'C', 'rounds', 100, null, null, 12),
('rounds_500', 'Stammgast', 'Spiele 500 Runden.', '500', 'rounds', 500, null, null, 13),
('rounds_1000', '1.000 Runden', 'Spiele 1.000 Runden.', 'M', 'rounds', 1000, null, null, 14),
('rounds_2500', 'Inventar', 'Spiele 2.500 Runden.', '2,5K', 'rounds', 2500, null, null, 15),
('rounds_5000', 'Dauerbrenner', 'Spiele 5.000 Runden.', '5K', 'rounds', 5000, null, null, 16),
('rounds_10000', 'Legende der Shishabar', 'Spiele 10.000 Runden.', '10K', 'rounds', 10000, null, null, 17),
-- Gewinne
('first_win', 'Erster Gewinn', 'Beende eine Runde mit Gewinn.', '+', 'wins', 1, null, null, 20),
('wins_10', 'Läuft bei dir', 'Gewinne 10 Runden.', 'W', 'wins', 10, null, null, 21),
('wins_100', 'Glückspilz', 'Gewinne 100 Runden.', '♣', 'wins', 100, null, null, 22),
('wins_500', 'Gewinnertyp', 'Gewinne 500 Runden.', '★', 'wins', 500, null, null, 23),
('wins_2000', 'Unaufhaltsam', 'Gewinne 2.000 Runden.', '♚', 'wins', 2000, null, null, 24),
-- Multiplikatoren
('win_2x', 'Verdoppelt', 'Gewinne mindestens das Doppelte deines Einsatzes.', '2×', 'best_mult', 2, null, null, 30),
('win_10x', '10×-Gewinn', 'Gewinne mindestens das Zehnfache.', '10×', 'best_mult', 10, null, null, 31),
('win_50x', '50×-Gewinn', 'Gewinne mindestens das 50-Fache.', '50×', 'best_mult', 50, null, null, 32),
('win_100x', '100×-Gewinn', 'Gewinne mindestens das Hundertfache.', '100×', 'best_mult', 100, null, null, 33),
('win_500x', '500×-Gewinn', 'Gewinne mindestens das 500-Fache.', '500×', 'best_mult', 500, null, null, 34),
('win_1000x', 'Jackpot', 'Gewinne mindestens das 1.000-Fache.', '1K×', 'best_mult', 1000, null, null, 35),
-- Gewinn in einer Runde
('profit_1k', '+1.000', '1.000 Credits Gewinn in einer Runde.', '$', 'best_profit', 1000, null, null, 40),
('profit_10k', '+10.000', '10.000 Credits Gewinn in einer Runde.', '$$', 'best_profit', 10000, null, null, 41),
('profit_50k', '+50.000', '50.000 Credits Gewinn in einer Runde.', '$$$', 'best_profit', 50000, null, null, 42),
('profit_250k', 'Bank gesprengt', '250.000 Credits Gewinn in einer Runde.', '₿', 'best_profit', 250000, null, null, 43),
-- Serien
('streak_3', 'Hattrick', 'Gewinne 3 Runden in Folge.', '3', 'best_win_streak', 3, null, null, 50),
('streak_5', 'Heiße Hand', 'Gewinne 5 Runden in Folge.', '5', 'best_win_streak', 5, null, null, 51),
('streak_10', 'Unbesiegbar', 'Gewinne 10 Runden in Folge.', '10', 'best_win_streak', 10, null, null, 52),
('loss_streak_10', 'Pechsträhne', '10 Verluste in Folge – Kopf hoch!', '☂', 'best_loss_streak', 10, null, null, 53),
-- Vielfalt
('explorer_5', 'Neugierig', 'Spiele 5 verschiedene Spiele.', '⌕', 'games', 5, null, null, 60),
('explorer_10', 'Entdecker', 'Spiele 10 verschiedene Spiele.', '⌖', 'games', 10, null, null, 61),
('explorer_25', 'Weltenbummler', 'Spiele 25 verschiedene Spiele.', '✦', 'games', 25, null, null, 62),
('explorer_all', 'Kenner', 'Spiele alle 39 Spiele mindestens einmal.', '∞', 'games', 39, null, null, 63),
-- Umsatz
('wagered_10k', 'Kleiner Einsatz', 'Setze insgesamt 10.000 Credits.', '◔', 'wagered', 10000, null, null, 70),
('wagered_100k', 'High Roller', 'Setze insgesamt 100.000 Credits.', '◑', 'wagered', 100000, null, null, 71),
('wagered_1m', 'Millionenumsatz', 'Setze insgesamt 1.000.000 Credits.', '◕', 'wagered', 1000000, null, null, 72),
('wagered_10m', 'Wal', 'Setze insgesamt 10.000.000 Credits.', '●', 'wagered', 10000000, null, null, 73),
-- Kontostand
('balance_50k', 'Gut gepolstert', 'Erreiche einen Kontostand von 50.000 Credits.', '▲', 'balance', 50000, null, null, 80),
('balance_250k', 'Reich', 'Erreiche einen Kontostand von 250.000 Credits.', '▲▲', 'balance', 250000, null, null, 81),
('balance_1m', 'Millionär', 'Erreiche einen Kontostand von 1.000.000 Credits.', '♔', 'balance', 1000000, null, null, 82),
-- Treue
('bonus_3', 'Dranbleiben', 'Hol dir den Tagesbonus 3 Tage in Folge.', 'D3', 'best_bonus_streak', 3, null, null, 90),
('bonus_7', 'Wochenkarte', 'Hol dir den Tagesbonus 7 Tage in Folge.', 'D7', 'best_bonus_streak', 7, null, null, 91),
('bonus_30', 'Monatskarte', 'Hol dir den Tagesbonus 30 Tage in Folge.', 'D30', 'best_bonus_streak', 30, null, null, 92),
-- Quests
('quest_1', 'Auftrag erledigt', 'Schließe deine erste Daily Quest ab.', 'Q', 'quests_done', 1, null, null, 100),
('quest_10', 'Questjäger', 'Schließe 10 Daily Quests ab.', 'Q10', 'quests_done', 10, null, null, 101),
('quest_50', 'Questmeister', 'Schließe 50 Daily Quests ab.', 'Q50', 'quests_done', 50, null, null, 102),
('quest_perfect_1', 'Perfekter Tag', 'Schließe an einem Tag alle 3 Daily Quests ab.', '✓✓', 'perfect_days', 1, null, null, 103),
('quest_perfect_7', 'Perfekte Woche', 'Schaffe 7 perfekte Tage.', '✓7', 'perfect_days', 7, null, null, 104),
-- Spielspezifisch
('blackjack', 'Blackjack!', 'Bekomme einen Blackjack.', 'A', 'event', 0, 'blackjack', '{"hands":[{"outcome":"blackjack"}]}', 110),
('diamond_feature', 'Diamantenregen', 'Löse die Freispiele bei Shisha Diamonds aus.', '◆', 'event', 0, 'shisha_diamonds', '{"feature":true}', 111),
('diamond_20', 'Sternenhimmel', '5 Sterne bei Shisha Diamonds: 20 Freispiele.', '✸', 'event', 0, 'shisha_diamonds', '{"stars":5}', 112),
('crash_10x', 'Raketenpilot', 'Zahle bei Crash mit mindestens 10× aus.', '↗', 'event', 10, 'crash', null, 113),
('limbo_100x', 'Limbo-König', 'Gewinne bei Limbo mit mindestens 100×.', '⇡', 'event', 100, 'limbo', null, 114),
('plinko_100x', 'Plinko-Treffer', 'Triff bei Plinko mindestens 100×.', '▼', 'event', 100, 'plinko', null, 115),
('keno_100x', 'Zahlenmagier', 'Gewinne bei Keno mindestens 100×.', '#', 'event', 100, 'keno', null, 116),
('vp_four', 'Vierling', 'Vierling oder besser im Video Poker.', '♠', 'event', 25, 'video_poker', null, 117),
('mines_10x', 'Minenräumer', 'Zahle bei Mines mit mindestens 10× aus.', '✱', 'event', 10, 'mines', null, 118),
-- Runde / Kasten
('period_win', 'Rundensieger', 'Beende eine 3-Wochen-Runde mit dem höchsten Kontostand.', '♛', 'period_wins', 1, null, null, 120),
('kasten_1', 'Kastenträger', 'Einmal Letzter einer Runde gewesen.', '▣', 'kasten', 1, null, null, 121),
('kasten_3', 'Kasten-König', 'Dreimal Letzter einer Runde.', '▦', 'kasten', 3, null, null, 122)
on conflict (key) do update set title = excluded.title, description = excluded.description, icon = excluded.icon,
  metric = excluded.metric, target = excluded.target, game_key = excluded.game_key, cond = excluded.cond, sort = excluded.sort;

-- Aktueller Fortschrittswert eines Spielers für eine Kennzahl
create or replace function public.shb_metric_value(p_user uuid, p_metric text)
returns numeric language plpgsql stable security definer set search_path = '' as $$
declare s public.player_stats;
begin
  select * into s from public.player_stats where user_id = p_user;
  return case p_metric
    when 'rounds' then s.rounds when 'wins' then s.wins when 'wagered' then s.wagered
    when 'best_mult' then s.best_mult when 'best_profit' then s.best_profit
    when 'best_win_streak' then s.best_win_streak when 'best_loss_streak' then s.best_loss_streak
    when 'best_bonus_streak' then s.best_bonus_streak when 'quests_done' then s.quests_done
    when 'perfect_days' then s.perfect_days when 'period_wins' then s.period_wins
    when 'games' then (select count(distinct game_key) from public.game_rounds where user_id = p_user and status = 'settled')
    when 'balance' then (select balance from public.wallets where user_id = p_user)
    when 'kasten' then (select count(*) from public.weekly_results where loser_user_id = p_user)
    else 0 end;
end;
$$;

-- Prüft alle offenen Erfolge eines Spielers. p_round: gerade abgerechnete Runde (für Ereignis-Erfolge).
-- p_reward = false: freischalten ohne Belohnung (Bestandsübernahme beim Einspielen).
create or replace function public.shb_check_achievements(p_user uuid, p_round public.game_rounds, p_reward boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  d public.achievement_defs; v_val numeric; v_ok boolean; v_reward bigint := 0; v_ratio numeric;
  v_amount bigint := coalesce((public.shb_setting('achievement_reward') #>> '{}')::bigint, 100);
  v_cache jsonb := '{}'::jsonb;
begin
  for d in select * from public.achievement_defs a
            where not exists (select 1 from public.achievements x where x.user_id = p_user and x.key = a.key)
            order by a.sort loop
    if d.metric = 'event' then
      v_ok := false;
      if p_round.id is not null and p_round.game_key = d.game_key and p_round.payout_amount > 0 then
        v_ratio := p_round.payout_amount::numeric / p_round.bet_amount;
        v_ok := v_ratio >= d.target and (d.cond is null or p_round.result @> d.cond);
      end if;
    else
      if not v_cache ? d.metric then
        v_cache := v_cache || jsonb_build_object(d.metric, coalesce(public.shb_metric_value(p_user, d.metric), 0));
      end if;
      v_val := (v_cache ->> d.metric)::numeric;
      v_ok := v_val >= d.target;
    end if;
    continue when not v_ok;

    v_reward := case when p_reward then v_amount else 0 end;
    insert into public.achievements (user_id, key, reward) values (p_user, d.key, v_reward) on conflict do nothing;
    continue when not found;
    if v_reward > 0 then
      perform public.shb_apply_ledger(p_user, v_reward, 'achievement_reward', 'Erfolg: ' || d.title,
        'achievement', null, null, 'ach:' || p_user::text || ':' || d.key);
      perform public.shb_notify(p_user, 'achievement', 'Erfolg freigeschaltet: ' || d.title,
        '+' || v_reward || ' Credits · ' || d.description, jsonb_build_object('key', d.key, 'amount', v_reward));
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Daily Quests
-- ---------------------------------------------------------------------------
-- game_mode: none = alle Spiele, any = ein Spiel aus allen aktiven, win = ein Spiel mit hoher Gewinnchance
create table if not exists public.quest_templates (
  key text primary key,
  tier text not null check (tier in ('easy', 'medium', 'hard')),
  metric text not null check (metric in ('rounds', 'wins', 'wagered', 'won', 'mult', 'games', 'streak', 'bonus')),
  title text not null,
  targets int[] not null,
  param numeric,
  game_mode text not null default 'none' check (game_mode in ('none', 'any', 'win')),
  weight int not null default 1
);
alter table public.quest_templates enable row level security;

delete from public.quest_templates;
insert into public.quest_templates (key, tier, metric, title, targets, param, game_mode, weight) values
('e_rounds', 'easy', 'rounds', 'Spiele {n} Runden', '{10,15,20}', null, 'none', 3),
('e_rounds_game', 'easy', 'rounds', 'Spiele {n} Runden {game}', '{5,8,10}', null, 'any', 4),
('e_wins', 'easy', 'wins', 'Gewinne {n} Runden', '{3,5}', null, 'none', 3),
('e_games', 'easy', 'games', 'Spiele {n} verschiedene Spiele', '{3}', null, 'none', 2),
('e_wagered', 'easy', 'wagered', 'Setze insgesamt {n} Credits', '{500,1000}', null, 'none', 2),
('e_bonus', 'easy', 'bonus', 'Hol dir deinen Tagesbonus', '{1}', null, 'none', 1),
('m_rounds_game', 'medium', 'rounds', 'Spiele {n} Runden {game}', '{15,20,25}', null, 'any', 3),
('m_wins_game', 'medium', 'wins', 'Gewinne {n} Runden {game}', '{3,5}', null, 'win', 4),
('m_wins', 'medium', 'wins', 'Gewinne {n} Runden', '{10,15}', null, 'none', 3),
('m_games', 'medium', 'games', 'Spiele {n} verschiedene Spiele', '{5,6}', null, 'none', 2),
('m_wagered', 'medium', 'wagered', 'Setze insgesamt {n} Credits', '{2500,5000}', null, 'none', 2),
('m_mult', 'medium', 'mult', 'Erziele einen Gewinn von mindestens {x}×', '{1}', 5, 'none', 2),
('m_streak', 'medium', 'streak', 'Gewinne {n} Runden in Folge', '{3}', null, 'none', 2),
('h_mult', 'hard', 'mult', 'Erziele einen Gewinn von mindestens {x}×', '{1}', 15, 'none', 3),
('h_wins_game', 'hard', 'wins', 'Gewinne {n} Runden {game}', '{8,10}', null, 'win', 3),
('h_streak', 'hard', 'streak', 'Gewinne {n} Runden in Folge', '{4,5}', null, 'none', 2),
('h_games', 'hard', 'games', 'Spiele {n} verschiedene Spiele', '{8,10}', null, 'none', 2),
('h_wagered', 'hard', 'wagered', 'Setze insgesamt {n} Credits', '{10000,20000}', null, 'none', 2),
('h_won', 'hard', 'won', 'Gewinne insgesamt {n} Credits', '{2000,5000}', null, 'none', 2),
('h_rounds', 'hard', 'rounds', 'Spiele {n} Runden', '{60,80}', null, 'none', 2);

create table if not exists public.daily_quests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  day_key text not null,
  slot int not null check (slot between 1 and 3),
  tier text not null,
  template_key text not null,
  title text not null,
  metric text not null,
  game_key text,
  param numeric,
  target numeric not null,
  progress numeric not null default 0,
  streak int not null default 0,
  reward bigint not null,
  created_at timestamptz not null default now(),
  seen_at timestamptz,
  completed_at timestamptz,
  claimed_at timestamptz,
  unique (user_id, day_key, slot)
);
create index if not exists daily_quests_user_day_idx on public.daily_quests (user_id, day_key);
alter table public.daily_quests enable row level security;
drop policy if exists daily_quests_select on public.daily_quests;
create policy daily_quests_select on public.daily_quests for select to authenticated using (user_id = (select auth.uid()));

-- Spiele mit hoher Gewinnchance für "Gewinne X Runden {Spiel}"
create or replace function public.shb_quest_win_games()
returns text[] language sql immutable set search_path = '' as $$
  select array['roulette','blackjack','crash','plinko','mines','dice','limbo','coinflip','hilo','towers','baccarat',
               'dragon_tiger','andar_bahar','card_duel','dice_duel','video_poker','goal_multiplier','wheel','gem_hunt','drop_ball'];
$$;

create or replace function public.shb_fmt_int(p numeric)
returns text language sql immutable set search_path = '' as $$
  select replace(to_char(p, 'FM999,999,999'), ',', '.');
$$;

-- Legt die 3 Quests des Tages an, falls noch nicht vorhanden. Spiele bevorzugt aus den zuletzt gespielten.
create or replace function public.shb_ensure_quests(p_user uuid, p_day text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_day text := coalesce(p_day, public.shb_day_key(now()));
  v_tiers text[] := array['easy', 'medium', 'hard'];
  v_rewards int[] := array[100, 200, 300];
  v_enabled text[]; v_recent text[]; v_used_games text[] := '{}'; v_used_tpl text[] := '{}';
  t public.quest_templates; v_game text; v_pool text[]; v_target int; v_title text; v_name text;
begin
  if exists (select 1 from public.daily_quests where user_id = p_user and day_key = v_day) then return; end if;
  v_enabled := array(select game_key from public.game_configs where enabled and coalesce((config ->> 'implemented')::boolean, false));
  v_recent := array(select distinct game_key from public.game_rounds
                     where user_id = p_user and status = 'settled' and completed_at > now() - interval '14 days' and game_key = any(v_enabled));
  for i in 1 .. 3 loop
    -- gewichtete Zufallsauswahl einer Vorlage; Kennzahl nicht doppelt am selben Tag
    select * into t from public.quest_templates q
     where q.tier = v_tiers[i] and q.metric <> all(v_used_tpl)
     order by -ln(1 - random()) / q.weight limit 1;
    v_used_tpl := v_used_tpl || t.metric;
    v_game := null;
    if t.game_mode <> 'none' then
      v_pool := case when t.game_mode = 'win' then array(select x from unnest(v_enabled) x where x = any(public.shb_quest_win_games()))
                     else v_enabled end;
      v_pool := array(select x from unnest(v_pool) x where x <> all(v_used_games));
      if random() < 0.6 and exists (select 1 from unnest(v_pool) x where x = any(v_recent)) then
        v_pool := array(select x from unnest(v_pool) x where x = any(v_recent));
      end if;
      v_game := v_pool[1 + floor(random() * greatest(cardinality(v_pool), 1))::int];
      if v_game is null then
        -- kein passendes Spiel aktiv: Variante ohne Spiel derselben Stufe
        select * into t from public.quest_templates q where q.tier = v_tiers[i] and q.game_mode = 'none'
         order by random() limit 1;
      else
        v_used_games := v_used_games || v_game;
      end if;
    end if;
    v_target := t.targets[1 + floor(random() * cardinality(t.targets))::int];
    select display_name into v_name from public.game_configs where game_key = v_game;
    v_title := replace(replace(replace(t.title, '{n}', public.shb_fmt_int(v_target)), '{x}', coalesce(public.shb_fmt_int(t.param), '')),
                       '{game}', coalesce('in ' || v_name, ''));
    insert into public.daily_quests (user_id, day_key, slot, tier, template_key, title, metric, game_key, param, target, reward)
    values (p_user, v_day, i, v_tiers[i], t.key, btrim(v_title), t.metric, v_game, t.param, v_target, v_rewards[i])
    on conflict (user_id, day_key, slot) do nothing;
  end loop;
end;
$$;

-- Fortschritt erhöhen und ggf. abschließen (Benachrichtigung ohne Push, Pop-up in der App)
create or replace function public.shb_quest_set_progress(p_id uuid, p_progress numeric)
returns void language plpgsql security definer set search_path = '' as $$
declare q public.daily_quests;
begin
  update public.daily_quests set progress = least(p_progress, target)
   where id = p_id and completed_at is null returning * into q;
  if found and q.progress >= q.target then
    update public.daily_quests set completed_at = now() where id = p_id;
    insert into public.notifications (user_id, type, title, message, metadata, pushed_at)
    values (q.user_id, 'quest_completed', 'Quest geschafft!', q.title,
            jsonb_build_object('quest_id', q.id, 'amount', q.reward, 'tier', q.tier), now());
  end if;
end;
$$;

create or replace function public.shb_quest_round(p_round public.game_rounds)
returns void language plpgsql security definer set search_path = '' as $$
declare
  q public.daily_quests; v_day text := public.shb_day_key(now());
  v_win boolean := p_round.payout_amount > p_round.bet_amount;
  v_ratio numeric := p_round.payout_amount::numeric / p_round.bet_amount;
  v_new numeric; v_streak int;
begin
  perform public.shb_ensure_quests(p_round.user_id, v_day);
  for q in select * from public.daily_quests where user_id = p_round.user_id and day_key = v_day and completed_at is null for update loop
    continue when q.game_key is not null and q.game_key <> p_round.game_key;
    v_new := null;
    if q.metric = 'rounds' then v_new := q.progress + 1;
    elsif q.metric = 'wins' and v_win then v_new := q.progress + 1;
    elsif q.metric = 'wagered' then v_new := q.progress + p_round.bet_amount;
    elsif q.metric = 'won' and p_round.profit_amount > 0 then v_new := q.progress + p_round.profit_amount;
    elsif q.metric = 'mult' and v_ratio >= q.param then v_new := 1;
    elsif q.metric = 'games' then
      v_new := (select count(distinct game_key) from public.game_rounds
                 where user_id = p_round.user_id and status = 'settled' and completed_at >= (date_trunc('day', now() at time zone 'Europe/Berlin') at time zone 'Europe/Berlin'));
    elsif q.metric = 'streak' then
      v_streak := case when v_win then q.streak + 1 else 0 end;
      update public.daily_quests set streak = v_streak where id = q.id;
      v_new := greatest(q.progress, v_streak);
    end if;
    if v_new is not null and v_new <> q.progress then perform public.shb_quest_set_progress(q.id, v_new); end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Trigger: Runde abgerechnet -> Statistik, Quests, Erfolge (ersetzt den alten Erfolgs-Trigger)
-- ---------------------------------------------------------------------------
create or replace function public.shb_round_achievements()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_ratio numeric; v_win boolean;
begin
  if new.status <> 'settled' or old.status = 'settled' then return new; end if;
  v_ratio := case when new.bet_amount > 0 then new.payout_amount::numeric / new.bet_amount else 0 end;
  v_win := new.payout_amount > new.bet_amount;
  perform public.shb_stats_row(new.user_id);
  update public.player_stats set
    rounds = rounds + 1,
    wins = wins + v_win::int,
    wagered = wagered + new.bet_amount,
    best_mult = greatest(best_mult, v_ratio),
    best_profit = greatest(best_profit, new.profit_amount),
    win_streak = case when v_win then win_streak + 1 else 0 end,
    best_win_streak = greatest(best_win_streak, case when v_win then win_streak + 1 else 0 end),
    loss_streak = case when new.payout_amount = 0 then loss_streak + 1 else 0 end,
    best_loss_streak = greatest(best_loss_streak, case when new.payout_amount = 0 then loss_streak + 1 else 0 end)
   where user_id = new.user_id;
  perform public.shb_quest_round(new);
  perform public.shb_check_achievements(new.user_id, new, true);
  return new;
end;
$$;

-- Tagesbonus abgeholt -> Bonus-Serie, Quest "Tagesbonus", Erfolge
create or replace function public.shb_bonus_claimed()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_day date := (new.claimed_at at time zone 'Europe/Berlin')::date; q public.daily_quests;
begin
  perform public.shb_stats_row(new.user_id);
  update public.player_stats set
    bonus_streak = case when last_bonus_day = v_day - 1 then bonus_streak + 1 when last_bonus_day = v_day then bonus_streak else 1 end,
    last_bonus_day = v_day
   where user_id = new.user_id;
  update public.player_stats set best_bonus_streak = greatest(best_bonus_streak, bonus_streak) where user_id = new.user_id;
  perform public.shb_ensure_quests(new.user_id, public.shb_day_key(new.claimed_at));
  for q in select * from public.daily_quests where user_id = new.user_id and day_key = public.shb_day_key(new.claimed_at)
            and metric = 'bonus' and completed_at is null loop
    perform public.shb_quest_set_progress(q.id, 1);
  end loop;
  perform public.shb_check_achievements(new.user_id, null, true);
  return new;
end;
$$;
drop trigger if exists on_bonus_claimed on public.bonus_claims;
create trigger on_bonus_claimed after insert on public.bonus_claims for each row execute function public.shb_bonus_claimed();

-- Rundenverlierer -> Kasten-Erfolge (mit Belohnung)
create or replace function public.shb_week_achievements()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.loser_user_id is not null then
    perform public.shb_stats_row(new.loser_user_id);
    perform public.shb_check_achievements(new.loser_user_id, null, true);
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPCs für die App
-- ---------------------------------------------------------------------------
create or replace function public.get_my_quests()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.shb_require_user(); v_day text := public.shb_day_key(now());
begin
  perform public.shb_ensure_quests(v_uid, v_day);
  return jsonb_build_object('server_now', now(), 'day_key', v_day, 'resets_at', public.shb_day_end(now()),
    'quests', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'slot', slot, 'tier', tier, 'title', title, 'metric', metric,
                 'game_key', game_key, 'target', target, 'progress', progress, 'reward', reward, 'seen', seen_at is not null,
                 'completed_at', completed_at, 'claimed_at', claimed_at) order by slot), '[]'::jsonb)
                 from public.daily_quests where user_id = v_uid and day_key = v_day));
end;
$$;

create or replace function public.mark_quests_seen()
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.shb_require_user();
begin
  update public.daily_quests set seen_at = now() where user_id = v_uid and day_key = public.shb_day_key(now()) and seen_at is null;
end;
$$;

-- Belohnung abholen (nur am selben Tag, idempotent)
create or replace function public.claim_daily_quest(p_quest_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.shb_require_user(); q public.daily_quests; v_balance bigint; v_all boolean;
begin
  perform public.shb_rate_limit(v_uid, 'quest_claim', 30, 60);
  select * into q from public.daily_quests where id = p_quest_id and user_id = v_uid for update;
  if not found then raise exception 'QUEST_NOT_FOUND'; end if;
  if q.claimed_at is not null then raise exception 'QUEST_ALREADY_CLAIMED'; end if;
  if q.completed_at is null then raise exception 'QUEST_NOT_COMPLETED'; end if;
  if q.day_key <> public.shb_day_key(now()) then raise exception 'QUEST_EXPIRED'; end if;
  update public.daily_quests set claimed_at = now() where id = q.id;
  v_balance := public.shb_apply_ledger(v_uid, q.reward, 'quest_reward', 'Daily Quest: ' || q.title,
    'daily_quest', q.id, null, 'quest:' || q.id::text);
  perform public.shb_stats_row(v_uid);
  select count(*) = 3 into v_all from public.daily_quests where user_id = v_uid and day_key = q.day_key and claimed_at is not null;
  update public.player_stats set quests_done = quests_done + 1, perfect_days = perfect_days + v_all::int where user_id = v_uid;
  perform public.shb_check_achievements(v_uid, null, true);
  return jsonb_build_object('amount', q.reward, 'balance', (select balance from public.wallets where user_id = v_uid));
end;
$$;

-- Erfolge mit Fortschritt. Für andere Spieler nur der Freischaltstatus.
create or replace function public.get_achievements(p_user uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := public.shb_require_user(); v_target uuid := coalesce(p_user, v_uid); v_own boolean := v_target = v_uid;
begin
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'key', d.key, 'title', d.title, 'description', d.description, 'icon', d.icon, 'target', d.target, 'metric', d.metric,
      'progress', case when a.key is not null then greatest(d.target, 1)
                       when not v_own or d.metric = 'event' then 0
                       else least(coalesce(m.val, 0), d.target) end,
      'unlocked_at', a.unlocked_at, 'reward', coalesce(a.reward, 0)) order by (a.key is null), d.sort), '[]'::jsonb)
    from public.achievement_defs d
    left join public.achievements a on a.user_id = v_target and a.key = d.key
    left join lateral (select public.shb_metric_value(v_target, d.metric) as val where v_own and d.metric <> 'event') m on true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Dashboard / Leaderboard / Admin auf Runden umstellen (+ Quest-Status)
-- ---------------------------------------------------------------------------
create or replace function public.get_dashboard_state()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_amount bigint := coalesce((public.shb_setting('daily_bonus_amount') #>> '{}')::bigint, 250);
  v_claimed boolean; v_balance bigint; v_rank bigint; v_last jsonb; v_lowest jsonb; v_profile jsonb; v_quests jsonb;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select to_jsonb(p) - 'updated_at' into v_profile from public.profiles p where p.id = v_uid;
  select balance into v_balance from public.wallets where user_id = v_uid;
  select exists (select 1 from public.bonus_claims where user_id = v_uid and week_key = public.shb_day_key(v_now)) into v_claimed;
  select r.rnk into v_rank from (
    select l.user_id, rank() over (order by l.balance desc) as rnk
      from public.leaderboard_entries l join public.profiles p on p.id = l.user_id where p.status = 'active'
  ) r where r.user_id = v_uid;
  select jsonb_build_object('week_key', w.week_key, 'loser_user_id', w.loser_user_id, 'loser_display_name', p.display_name,
      'loser_username', p.username, 'loser_balance', w.loser_balance, 'task_label', w.task_label, 'finalized_at', w.finalized_at)
    into v_last from public.weekly_results w left join public.profiles p on p.id = w.loser_user_id
   order by w.finalized_at desc limit 1;
  select jsonb_build_object('user_id', p.id, 'display_name', p.display_name, 'username', p.username, 'balance', l.balance)
    into v_lowest from public.leaderboard_entries l join public.profiles p on p.id = l.user_id
   where p.status = 'active' order by l.balance asc, p.username asc limit 1;
  -- Quests werden erst beim Abruf angelegt; existieren heute noch keine, gelten sie als neu
  select jsonb_build_object(
      'unseen', not exists (select 1 from public.daily_quests where user_id = v_uid and day_key = public.shb_day_key(v_now))
                or exists (select 1 from public.daily_quests where user_id = v_uid and day_key = public.shb_day_key(v_now) and seen_at is null),
      'claimable', (select count(*) from public.daily_quests where user_id = v_uid and day_key = public.shb_day_key(v_now)
                     and completed_at is not null and claimed_at is null))
    into v_quests;
  return jsonb_build_object(
    'server_now', v_now, 'week_key', public.shb_period_key(v_now),
    'week_start', public.shb_period_start(v_now), 'week_end', public.shb_period_end(v_now),
    'period_weeks', coalesce((public.shb_setting('period_weeks') #>> '{}')::int, 3),
    'profile', v_profile, 'balance', coalesce(v_balance, 0), 'rank', v_rank,
    'bonus', jsonb_build_object('amount', v_amount, 'claimed', v_claimed, 'period', 'day',
      'next_available_at', case when v_claimed then public.shb_day_end(v_now) else v_now end),
    'playtime_total', public.shb_playtime(v_uid),
    'playtime_week', public.shb_playtime(v_uid, public.shb_week_start(v_now), null),
    'last_weekly_result', v_last, 'current_lowest', v_lowest,
    'task_label', coalesce(public.shb_setting('weekly_task_label') #>> '{}', 'Kasten mitbringen'),
    'unread_notifications', (select count(*) from public.notifications where user_id = v_uid and read_at is null),
    'pending_requests', (select count(*) from public.credit_requests where user_id = v_uid and status = 'pending'),
    'quests', v_quests
  );
end;
$$;

-- Leaderboard: Veränderung seit der letzten Abrechnung
create or replace function public.get_leaderboard()
returns table (
  user_id uuid, username text, display_name text, avatar_seed text, balance bigint,
  week_change bigint, playtime_seconds integer, rounds_count bigint, bonus_claimed boolean, rank bigint
) language plpgsql stable security definer set search_path = '' as $$
declare
  v_prev text := (select week_key from public.weekly_results order by finalized_at desc limit 1);
  v_day text := public.shb_day_key(now());
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  return query
  select p.id, p.username, p.display_name, p.avatar_seed, l.balance,
         case when s.balance is null then null else l.balance - s.balance end,
         public.shb_playtime(p.id),
         (select count(*) from public.game_rounds r where r.user_id = p.id and r.status = 'settled'),
         exists (select 1 from public.bonus_claims b where b.user_id = p.id and b.week_key = v_day),
         rank() over (order by l.balance desc)
    from public.profiles p
    join public.leaderboard_entries l on l.user_id = p.id
    left join public.weekly_snapshots s on s.user_id = p.id and s.week_key = v_prev
   where p.status = 'active'
   order by l.balance desc, p.username asc;
end;
$$;

create or replace function public.admin_get_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_last jsonb; v_prev timestamptz := public.shb_period_start(now()) - interval '1 second';
begin
  perform public.shb_require_admin();
  select jsonb_build_object('week_key', w.week_key, 'loser_display_name', p.display_name, 'loser_balance', w.loser_balance,
                            'finalized_at', w.finalized_at, 'task_label', w.task_label)
    into v_last
    from public.weekly_results w left join public.profiles p on p.id = w.loser_user_id
   order by w.finalized_at desc limit 1;
  return jsonb_build_object(
    'server_now', now(),
    'week_key', public.shb_period_key(now()),
    'week_end', public.shb_period_end(now()),
    'active_users', (select count(*) from public.profiles where status = 'active'),
    'invited_users', (select count(*) from public.profiles where status = 'invited'),
    'suspended_users', (select count(*) from public.profiles where status = 'suspended'),
    'total_credits', (select coalesce(sum(balance), 0) from public.wallets),
    'open_requests', (select count(*) from public.credit_requests where status = 'pending'),
    'live_sessions', (select count(*) from public.game_sessions where ended_at is null and last_heartbeat_at > now() - interval '2 minutes'),
    'rounds_today', (select count(*) from public.game_rounds where started_at > now() - interval '24 hours'),
    'stale_active_rounds', (select count(*) from public.game_rounds where status = 'active' and started_at < now() - interval '1 day'),
    'last_weekly_result', v_last,
    'previous_week_finalized', public.shb_period_end(v_prev) > now()
                               or exists (select 1 from public.weekly_results where week_key = public.shb_period_key(v_prev)),
    'cron_enabled', exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron')
  );
end;
$$;

-- Ankündigung um 0 Uhr: Tagesbonus + neue Quests (Quests für alle aktiven Spieler anlegen)
create or replace function public.shb_announce(p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := p_now;
  v_hour int := extract(hour from v_now at time zone 'Europe/Berlin')::int;
  v_day text := public.shb_day_key(v_now);
  v_amount bigint := coalesce((public.shb_setting('daily_bonus_amount') #>> '{}')::bigint, 250);
  v_kind text; v_title text; v_msg text; v_n int := 0; v_p uuid;
begin
  if v_hour = 0 then
    v_kind := 'bonus_ready'; v_title := 'Neue Daily Quests sind da';
    v_msg := '3 neue Quests (bis zu 600 Credits) und +' || v_amount || ' Credits Tagesbonus warten auf dich!';
    for v_p in select id from public.profiles where status = 'active' loop
      perform public.shb_ensure_quests(v_p, v_day);
    end loop;
  elsif v_hour = 10 then
    v_kind := 'reminder_10'; v_title := 'Die Spiele warten auf dich';
    v_msg := 'Guten Morgen! Hol dir deinen Tagesbonus und schau dir deine Daily Quests an.';
  elsif v_hour = 18 then
    v_kind := 'reminder_18'; v_title := 'Feierabend im Casino';
    v_msg := 'Die Spiele warten auf dich – deine Daily Quests laufen noch bis Mitternacht.';
  else
    return jsonb_build_object('skipped', true);
  end if;
  insert into public.announcement_log (kind, day_key) values (v_kind, v_day) on conflict do nothing;
  if not found then return jsonb_build_object('skipped', true, 'reason', 'already_sent'); end if;

  insert into public.notifications (user_id, type, title, message, metadata)
  select p.id, 'announcement', v_title,
         case when v_kind <> 'bonus_ready' and exists (select 1 from public.bonus_claims b where b.user_id = p.id and b.week_key = v_day)
              then 'Die Spiele warten auf dich – schau mal wieder rein!' else v_msg end,
         jsonb_build_object('kind', v_kind)
    from public.profiles p
   where p.status = 'active'
     and coalesce((p.preferences ->> 'announcements')::boolean, true);
  get diagnostics v_n = row_count;
  return jsonb_build_object('kind', v_kind, 'sent', v_n);
end;
$$;

-- ---------------------------------------------------------------------------
-- Bestand übernehmen: Statistik aus vorhandenen Runden, erreichte Erfolge OHNE Belohnung freischalten
-- ---------------------------------------------------------------------------
do $$
declare v_p uuid; r record; s public.player_stats; v_prev date; v_streak int;
begin
  for v_p in select id from public.profiles loop
    insert into public.player_stats (user_id) values (v_p) on conflict do nothing;
    select * into s from public.player_stats where user_id = v_p;
    if s.rounds > 0 then continue; end if;   -- schon befüllt (Migration erneut ausgeführt)
    s.win_streak := 0; s.loss_streak := 0; s.best_win_streak := 0; s.best_loss_streak := 0;
    for r in select bet_amount, payout_amount from public.game_rounds where user_id = v_p and status = 'settled' order by completed_at loop
      s.win_streak := case when r.payout_amount > r.bet_amount then s.win_streak + 1 else 0 end;
      s.loss_streak := case when r.payout_amount = 0 then s.loss_streak + 1 else 0 end;
      s.best_win_streak := greatest(s.best_win_streak, s.win_streak);
      s.best_loss_streak := greatest(s.best_loss_streak, s.loss_streak);
    end loop;
    v_prev := null; v_streak := 0; s.best_bonus_streak := 0;
    for r in select distinct (claimed_at at time zone 'Europe/Berlin')::date as d from public.bonus_claims where user_id = v_p order by 1 loop
      v_streak := case when v_prev = r.d - 1 then v_streak + 1 else 1 end;
      s.best_bonus_streak := greatest(s.best_bonus_streak, v_streak);
      v_prev := r.d;
    end loop;
    update public.player_stats ps set
      rounds = x.rounds, wins = x.wins, wagered = x.wagered, best_mult = x.best_mult, best_profit = x.best_profit,
      win_streak = s.win_streak, best_win_streak = s.best_win_streak, loss_streak = s.loss_streak, best_loss_streak = s.best_loss_streak,
      bonus_streak = v_streak, best_bonus_streak = s.best_bonus_streak, last_bonus_day = v_prev
    from (select count(*) as rounds, count(*) filter (where payout_amount > bet_amount) as wins, coalesce(sum(bet_amount), 0) as wagered,
                 coalesce(max(payout_amount::numeric / bet_amount), 0) as best_mult, greatest(coalesce(max(profit_amount), 0), 0) as best_profit
            from public.game_rounds where user_id = v_p and status = 'settled') x
    where ps.user_id = v_p;
    perform public.shb_check_achievements(v_p, null, false);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Rechte
-- ---------------------------------------------------------------------------
revoke execute on function public.shb_period_end(timestamptz), public.shb_period_start(timestamptz), public.shb_period_key(timestamptz),
  public.shb_stats_row(uuid), public.shb_metric_value(uuid, text), public.shb_check_achievements(uuid, public.game_rounds, boolean),
  public.shb_quest_win_games(), public.shb_fmt_int(numeric), public.shb_ensure_quests(uuid, text),
  public.shb_quest_set_progress(uuid, numeric), public.shb_quest_round(public.game_rounds), public.shb_bonus_claimed()
  from public, anon, authenticated;
revoke execute on function public.get_my_quests(), public.mark_quests_seen(), public.claim_daily_quest(uuid), public.get_achievements(uuid)
  from public, anon;
grant execute on function public.get_my_quests(), public.mark_quests_seen(), public.claim_daily_quest(uuid), public.get_achievements(uuid)
  to authenticated;
$mig$;
  execute $mig$-- Migration 10: Admin-Werkzeuge
-- 1) Fehler-Sammlung: App-Fehler (Abstürze, unbehandelte Fehler, Serverfehler) werden gruppiert gespeichert,
--    der Admin sieht sie übersichtlich und löscht sie nach dem Beheben.
-- 2) Aufräumen: Logs/Altdaten in einem Zeitraum löschen (nie Kontostände, Buchungen, Runden oder Spielzeit).

-- ---------------------------------------------------------------------------
-- Fehler-Sammlung
-- ---------------------------------------------------------------------------
create table if not exists public.client_errors (
  id uuid primary key default gen_random_uuid(),
  fingerprint text unique not null,
  kind text not null check (kind in ('crash', 'error', 'rejection', 'server')),
  message text not null,
  stack text,
  context jsonb not null default '{}'::jsonb,   -- letzte URL, Spiel, Gerät, App-Version, Fehlercode
  count int not null default 1,
  users uuid[] not null default '{}',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists client_errors_last_idx on public.client_errors (last_seen_at desc);
alter table public.client_errors enable row level security;

-- Von der App aufgerufen. Gleiche Fehler (Art + Meldung + erste Stack-Zeile) werden hochgezählt statt dupliziert.
create or replace function public.log_client_error(p_kind text, p_message text, p_stack text, p_context jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_fp text; v_msg text := left(coalesce(btrim(p_message), '?'), 500);
begin
  if v_uid is null then return; end if;
  if p_kind not in ('crash', 'error', 'rejection', 'server') then return; end if;
  -- leises Rate-Limit: zu viele Meldungen werden verworfen statt einen Fehler zu werfen
  if (select count(*) from public.rate_limit_events where user_id = v_uid and action = 'client_error'
       and created_at > now() - interval '10 minutes') >= 20 then return; end if;
  insert into public.rate_limit_events (user_id, action) values (v_uid, 'client_error');
  v_fp := md5(p_kind || '|' || v_msg || '|' || coalesce(split_part(left(p_stack, 2000), E'\n', 2), ''));
  insert into public.client_errors (fingerprint, kind, message, stack, context, users)
  values (v_fp, p_kind, v_msg, left(p_stack, 4000), coalesce(p_context, '{}'::jsonb) - 'password' - 'token', array[v_uid])
  on conflict (fingerprint) do update set
    count = public.client_errors.count + 1,
    last_seen_at = now(),
    context = excluded.context,
    users = case when v_uid = any(public.client_errors.users) then public.client_errors.users
                 else (public.client_errors.users || v_uid)[1:50] end;
end;
$$;

create or replace function public.admin_list_errors()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.shb_require_admin();
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id, 'kind', e.kind, 'message', e.message, 'stack', e.stack, 'context', e.context, 'count', e.count,
      'first_seen_at', e.first_seen_at, 'last_seen_at', e.last_seen_at,
      'users', (select coalesce(jsonb_agg(p.display_name), '[]'::jsonb) from public.profiles p where p.id = any(e.users)))
      order by e.last_seen_at desc), '[]'::jsonb)
    from (select * from public.client_errors order by last_seen_at desc limit 300) e);
end;
$$;

-- p_ids = null löscht alle gesammelten Fehler
create or replace function public.admin_delete_errors(p_ids uuid[])
returns int language plpgsql security definer set search_path = '' as $$
declare v_admin uuid := public.shb_require_admin(); v_n int;
begin
  perform public.shb_rate_limit(v_admin, 'admin_action', 60, 60);
  delete from public.client_errors where p_ids is null or id = any(p_ids);
  get diagnostics v_n = row_count;
  perform public.shb_audit('errors_delete', null, jsonb_build_object('count', v_n, 'all', p_ids is null));
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Aufräumen
-- ---------------------------------------------------------------------------
-- Zählt pro Bereich, was im Zeitraum [p_from, p_to) gelöscht würde.
create or replace function public.admin_cleanup_preview(p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_from timestamptz := coalesce(p_from, '-infinity'); v_to timestamptz := least(coalesce(p_to, now()), now());
begin
  perform public.shb_require_admin();
  return jsonb_build_object(
    'notifications_read', (select count(*) from public.notifications where read_at is not null and created_at >= v_from and created_at < v_to),
    'notifications_all', (select count(*) from public.notifications where created_at >= v_from and created_at < v_to),
    'client_errors', (select count(*) from public.client_errors where last_seen_at >= v_from and last_seen_at < v_to),
    'audit_logs', (select count(*) from public.audit_logs where created_at >= v_from and created_at < v_to),
    'rate_limits', (select count(*) from public.rate_limit_events where created_at >= v_from and created_at < v_to),
    'announcements', (select count(*) from public.announcement_log where sent_at >= v_from and sent_at < v_to),
    'cron_log', (select count(*) from cron.job_run_details where start_time >= v_from and start_time < v_to),
    'net_log', (select count(*) from net._http_response where created >= v_from and created < v_to)
  );
end;
$$;

-- Löscht die gewählten Bereiche im Zeitraum. Kontostände, Buchungen, Spielrunden, Spielzeit und Erfolge bleiben unangetastet.
create or replace function public.admin_cleanup(p_targets text[], p_from timestamptz, p_to timestamptz, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := public.shb_require_admin();
  v_from timestamptz := coalesce(p_from, '-infinity'); v_to timestamptz := least(coalesce(p_to, now()), now());
  v_res jsonb := '{}'::jsonb; v_n int; t text;
begin
  if p_reason is null or char_length(btrim(p_reason)) < 3 then raise exception 'REASON_REQUIRED'; end if;
  if p_targets is null or cardinality(p_targets) = 0 then raise exception 'INVALID_PARAMS'; end if;
  if v_from >= v_to then raise exception 'INVALID_PARAMS'; end if;
  perform public.shb_rate_limit(v_admin, 'admin_action', 60, 60);
  foreach t in array p_targets loop
    case t
      when 'notifications_read' then delete from public.notifications where read_at is not null and created_at >= v_from and created_at < v_to;
      when 'notifications_all' then delete from public.notifications where created_at >= v_from and created_at < v_to;
      when 'client_errors' then delete from public.client_errors where last_seen_at >= v_from and last_seen_at < v_to;
      when 'audit_logs' then delete from public.audit_logs where created_at >= v_from and created_at < v_to;
      when 'rate_limits' then delete from public.rate_limit_events where created_at >= v_from and created_at < v_to;
      when 'announcements' then delete from public.announcement_log where sent_at >= v_from and sent_at < v_to and day_key <> public.shb_day_key(now());
      when 'cron_log' then delete from cron.job_run_details where start_time >= v_from and start_time < v_to;
      when 'net_log' then delete from net._http_response where created >= v_from and created < v_to;
      else raise exception 'INVALID_PARAMS';
    end case;
    get diagnostics v_n = row_count;
    v_res := v_res || jsonb_build_object(t, v_n);
  end loop;
  -- der Aufräum-Eintrag selbst bleibt immer im Audit-Log
  perform public.shb_audit('cleanup', null, jsonb_build_object('targets', p_targets, 'from', p_from, 'to', p_to, 'deleted', v_res, 'reason', p_reason));
  return v_res;
end;
$$;

revoke execute on function public.log_client_error(text, text, text, jsonb), public.admin_list_errors(), public.admin_delete_errors(uuid[]),
  public.admin_cleanup_preview(timestamptz, timestamptz), public.admin_cleanup(text[], timestamptz, timestamptz, text) from public, anon;
grant execute on function public.log_client_error(text, text, text, jsonb), public.admin_list_errors(), public.admin_delete_errors(uuid[]),
  public.admin_cleanup_preview(timestamptz, timestamptz), public.admin_cleanup(text[], timestamptz, timestamptz, text) to authenticated;
$mig$;
  -- ===== Tests (nach dem Einspielen von Migration 9 + 10 im selben Block) =====
  v_out := v_out || 'period_end(10.10.)=' || (public.shb_period_end('2026-10-10 12:00+02') at time zone 'Europe/Berlin')::text;
  v_out := v_out || ' | period_start(10.10.)=' || (public.shb_period_start('2026-10-10 12:00+02') at time zone 'Europe/Berlin')::text;
  v_out := v_out || ' | key=' || public.shb_period_key('2026-10-10 12:00+02');
  v_out := v_out || ' | end(02.11. 01:00)=' || (public.shb_period_end('2026-11-02 01:00+01') at time zone 'Europe/Berlin')::text;
  v_out := v_out || ' | start(02.11.)=' || (public.shb_period_start('2026-11-02 01:00+01') at time zone 'Europe/Berlin')::text;
  v_out := v_out || ' | end(23.11.)=' || (public.shb_period_end('2026-11-23 00:00+01') at time zone 'Europe/Berlin')::text;
  v_out := v_out || ' | finalize_week=' || public.finalize_week()::text;
  v_out := v_out || E'\n';

  select count(*) into v_n from public.achievements;
  v_out := v_out || 'achievements gesamt=' || v_n || ' davon reward>0=' || (select count(*) from public.achievements where reward > 0)
    || ' ledger_ach=' || (select count(*) from public.credit_ledger where entry_type = 'achievement_reward') || E'\n';
  v_out := v_out || 'stats=' || (select jsonb_agg(jsonb_build_object('r', rounds, 'w', wins, 'bm', round(best_mult, 1), 'bs', best_bonus_streak)) from public.player_stats)::text || E'\n';

  select id into v_admin from public.profiles where role = 'admin' limit 1;
  select p.id into v_u from public.profiles p join public.wallets w on w.user_id = p.id
   where p.status = 'active' order by w.balance desc limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_u::text, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_u::text, true);

  v_q := public.get_my_quests();
  v_out := v_out || 'quests=' || (select jsonb_agg(jsonb_build_object('t', x ->> 'title', 'tier', x ->> 'tier', 'target', x ->> 'target', 'r', x ->> 'reward')) from jsonb_array_elements(v_q -> 'quests') x)::text || E'\n';
  v_out := v_out || 'dashboard.quests=' || (public.get_dashboard_state() -> 'quests')::text
    || ' week_end=' || (public.get_dashboard_state() ->> 'week_end') || E'\n';

  -- Quest-Generator mehrfach (Vielfalt, keine NULL-Titel)
  for i in 1 .. 15 loop
    delete from public.daily_quests where user_id = v_u and day_key = 'DTEST' || i;
    perform public.shb_ensure_quests(v_u, 'DTEST' || i);
  end loop;
  v_out := v_out || 'generator: rows=' || (select count(*) from public.daily_quests where day_key like 'DTEST%')
    || ' null_titles=' || (select count(*) from public.daily_quests where day_key like 'DTEST%' and (title is null or title like '%{%'))
    || ' beispiele=' || (select string_agg(distinct title, ' ; ') from (select title from public.daily_quests where day_key like 'DTEST%' limit 12) t) || E'\n';

  -- Runde spielen -> Statistik + Quest-Fortschritt
  select rounds into v_rounds from public.player_stats where user_id = v_u;
  select balance into v_bal from public.wallets where user_id = v_u;
  v_r := public.play_game('coinflip', 10, '{"side":"heads"}', 'qtest-' || gen_random_uuid());
  v_out := v_out || 'coinflip status=' || (v_r ->> 'status') || ' payout=' || coalesce(v_r ->> 'payout_amount', '?')
    || ' stats.rounds ' || v_rounds || '->' || (select rounds from public.player_stats where user_id = v_u)
    || ' quest_progress=' || (select jsonb_agg(jsonb_build_object('m', metric, 'g', game_key, 'p', progress)) from public.daily_quests where user_id = v_u and day_key = public.shb_day_key(now()))::text || E'\n';

  -- Quest abschließen + abholen
  select id into v_qid from public.daily_quests where user_id = v_u and day_key = public.shb_day_key(now()) and slot = 1;
  perform public.shb_quest_set_progress(v_qid, 1e9);
  v_out := v_out || 'nach complete: completed=' || (select completed_at is not null from public.daily_quests where id = v_qid)
    || ' notif=' || (select count(*) from public.notifications where user_id = v_u and type = 'quest_completed' and pushed_at is not null);
  select balance into v_bal from public.wallets where user_id = v_u;
  v_c := public.claim_daily_quest(v_qid);
  v_out := v_out || ' | claim=' || v_c::text || ' delta=' || ((v_c ->> 'balance')::bigint - v_bal)
    || ' quest_1 freigeschaltet=' || exists (select 1 from public.achievements where user_id = v_u and key = 'quest_1' and reward = 100);
  begin
    perform public.claim_daily_quest(v_qid);
    v_out := v_out || ' DOPPELT ABGEHOLT!';
  exception when others then v_out := v_out || ' zweites claim -> ' || sqlerrm;
  end;
  v_out := v_out || E'\n';
  v_out := v_out || 'achievements(api) anzahl=' || jsonb_array_length(public.get_achievements(null))
    || ' beispiel=' || (public.get_achievements(null) -> 0)::text || E'\n';
  v_out := v_out || 'leaderboard rows=' || (select count(*) from public.get_leaderboard()) || E'\n';
  perform public.mark_quests_seen();
  v_out := v_out || 'nach seen: ' || (public.get_dashboard_state() -> 'quests')::text || E'\n';

  -- Migration 10
  perform public.log_client_error('crash', 'Testfehler', E'Error: Testfehler\n    at foo (a.js:1:1)', '{"url":"/casino/dice"}');
  perform public.log_client_error('crash', 'Testfehler', E'Error: Testfehler\n    at foo (a.js:1:1)', '{"url":"/casino/dice"}');
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  v_out := v_out || 'errors=' || (select jsonb_agg(jsonb_build_object('m', x ->> 'message', 'c', x ->> 'count', 'u', x -> 'users')) from jsonb_array_elements(public.admin_list_errors()) x)::text;
  v_out := v_out || ' | preview=' || public.admin_cleanup_preview(null, now())::text;
  v_out := v_out || ' | cleanup=' || public.admin_cleanup(array['rate_limits','cron_log','net_log','notifications_read','client_errors'], null, now(), 'Test')::text;
  v_out := v_out || ' | admin_overview.week_end=' || (public.admin_get_overview() ->> 'week_end')
    || ' prev_fin=' || (public.admin_get_overview() ->> 'previous_week_finalized');
  begin
    perform public.admin_finalize_week(false, 'Test');
    v_out := v_out || ' | admin_finalize(prev) lief';
  exception when others then v_out := v_out || ' | admin_finalize(prev) -> ' || sqlerrm;
  end;
  v_out := v_out || ' | finalize(current)=' || public.admin_finalize_week(true, 'Test')::text;

  raise exception 'TEST-ENDE (Rollback): %', v_out;
end $test$;
