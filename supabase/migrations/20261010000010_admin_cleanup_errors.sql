-- Migration 10: Admin-Werkzeuge
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
