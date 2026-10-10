-- NEUSTART: alle Spieldaten zurücksetzen, jeder aktive Spieler startet mit START_CREDITS.
-- Bleibt erhalten: Konten/Logins, Profile (Name, Avatar, Profilbild), Push-Abos, Spiel- und App-Einstellungen, Audit-Log.
-- Wird gelöscht: Runden, Buchungen, Spielzeit, Boni, Credit-Anfragen, Abrechnungen, Benachrichtigungen,
--               Erfolge, Daily Quests, Statistiken, Fehler-Log, Geschenke, Duelle, Kasten-Tipps; Jackpot zurück auf 10.000.
-- Erste neue 3-Wochen-Runde: ab RESET_START (Montag 00:00 Berlin) bis 3 Wochen später Sonntag 23:59.
--
-- TEST (Rollback): die letzte Zeile "commit;" durch "rollback;" ersetzen.
-- Ausführen: im Supabase-Dashboard → SQL Editor, komplett einfügen und starten.

begin;

-- >>> Werte vor dem Ausführen prüfen <<<
create temporary table reset_params on commit drop as
select 10000::bigint as start_credits,
       '2026-10-12 00:00'::timestamp as reset_start;   -- Montag nach dem Neustart-Sonntag (lokale Berliner Zeit)

-- Spieldaten löschen (Reihenfolge wegen Fremdschlüsseln)
delete from public.game_round_secrets;
delete from public.game_rounds;
delete from public.game_sessions;
delete from public.bonus_claims;
delete from public.credit_requests;
delete from public.weekly_snapshots;
delete from public.weekly_results;
delete from public.notifications;
delete from public.achievements;
delete from public.daily_quests;
delete from public.player_stats;
delete from public.client_errors;
delete from public.announcement_log;
delete from public.rate_limit_events;
delete from public.credit_gifts;
delete from public.duels;
delete from public.period_predictions;
update public.jackpot_state set pot = 10000, last_winner = null, last_win = null, last_won_at = null, updated_at = now();
delete from public.credit_ledger;

-- Kontostände auf 0 und dann sauber über das Ledger auf das Startguthaben buchen
update public.wallets set balance = 0;
select public.shb_apply_ledger(p.id, (select start_credits from reset_params), 'admin_credit', 'Neustart: Startguthaben',
         'reset', null, null, 'reset:' || to_char(now(), 'YYYYMMDDHH24MI') || ':' || p.id::text)
  from public.profiles p where p.status in ('active', 'invited');
insert into public.player_stats (user_id) select id from public.profiles on conflict do nothing;

-- Neue 3-Wochen-Runde ab Montag
update public.app_settings set value = to_jsonb(to_char((select reset_start from reset_params), 'YYYY-MM-DD HH24:MI')), updated_at = now()
 where key = 'period_first_start';
update public.app_settings set value = to_jsonb(to_char((select reset_start from reset_params) + interval '21 days', 'YYYY-MM-DD HH24:MI')), updated_at = now()
 where key = 'period_anchor_end';

insert into public.audit_logs (action, metadata)
values ('full_reset', jsonb_build_object('start_credits', (select start_credits from reset_params), 'reset_start', (select reset_start from reset_params)));

-- Kontrolle
select p.display_name, w.balance from public.profiles p join public.wallets w on w.user_id = p.id order by p.display_name;
select key, value from public.app_settings where key in ('period_first_start', 'period_anchor_end');

commit;
