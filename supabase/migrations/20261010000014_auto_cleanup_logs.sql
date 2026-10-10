-- Migration 14: Automatisches Aufräumen der Protokolle am 1. und 15. jedes Monats (ca. alle 2 Wochen), 04:00 UTC.
-- Löscht nur Cron- und HTTP-Protokolle älter als 14 Tage. Spieldaten bleiben unangetastet.
create or replace function public.shb_cleanup_logs()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_cron int; v_net int;
begin
  delete from cron.job_run_details where end_time < now() - interval '14 days';
  get diagnostics v_cron = row_count;
  delete from net._http_response where created < now() - interval '14 days';
  get diagnostics v_net = row_count;
  insert into public.audit_logs (action, metadata)
  values ('auto_cleanup', jsonb_build_object('cron_log', v_cron, 'net_log', v_net));
  return jsonb_build_object('cron_log', v_cron, 'net_log', v_net);
end;
$$;
revoke execute on function public.shb_cleanup_logs() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'shb_cleanup_logs') then perform cron.unschedule('shb_cleanup_logs'); end if;
  perform cron.schedule('shb_cleanup_logs', '0 4 1,15 * *', 'select public.shb_cleanup_logs();');
end $$;
