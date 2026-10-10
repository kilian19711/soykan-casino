-- Migration 11: Profilbilder + realistische Limits
-- 1) Profilbilder: öffentlicher Storage-Bucket "avatars" (max. 300 KB, nur Bilder). Jeder schreibt nur in seinen Ordner <user_id>/.
--    Das Bild wird in profiles.avatar_seed als 'img:<pfad>' gespeichert, damit es überall erscheint, wo Avatare angezeigt werden.
-- 2) Maximalgewinn wie bei echten Casinos: höchstens 100.000 Credits Gewinn pro Runde
--    (Einstellung max_win_per_round, im Admin änderbar). Höchsteinsätze und Auszahlungsquoten (RTP 95–99 %) bleiben.

-- ---------------------------------------------------------------------------
-- Profilbilder
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 307200, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 307200, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists avatars_select_own on storage.objects;
create policy avatars_select_own on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists avatars_insert_own on storage.objects;
create policy avatars_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists avatars_update_own on storage.objects;
create policy avatars_update_own on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists avatars_delete_own on storage.objects;
create policy avatars_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Setzt (p_path) oder entfernt (null) das eigene Profilbild
create or replace function public.set_my_avatar(p_path text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.shb_require_user(); v_seed text;
begin
  perform public.shb_rate_limit(v_uid, 'profile_update', 10, 60);
  if p_path is null then
    v_seed := (select username from public.profiles where id = v_uid);
  else
    if p_path !~ ('^' || v_uid::text || '/[0-9]{10,16}\.(jpg|webp|png)$') then raise exception 'INVALID_PARAMS'; end if;
    v_seed := 'img:' || p_path;
  end if;
  update public.profiles set avatar_seed = v_seed where id = v_uid;
  return v_seed;
end;
$$;

-- Bildpfad darf beim normalen Profil-Speichern nicht überschrieben werden müssen (Farbwahl ersetzt das Bild)
create or replace function public.update_my_profile(p_display_name text, p_avatar_seed text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.shb_require_user();
begin
  p_display_name := btrim(p_display_name);
  if p_display_name is null or char_length(p_display_name) < 1 or char_length(p_display_name) > 40 then
    raise exception 'INVALID_DISPLAY_NAME';
  end if;
  if p_avatar_seed is not null and (char_length(p_avatar_seed) > 40 or p_avatar_seed like 'img:%') then
    raise exception 'INVALID_AVATAR_SEED';
  end if;
  perform public.shb_rate_limit(v_uid, 'profile_update', 10, 60);
  update public.profiles
     set display_name = p_display_name, avatar_seed = coalesce(nullif(btrim(p_avatar_seed), ''), avatar_seed)
   where id = v_uid;
end;
$$;

revoke execute on function public.set_my_avatar(text) from public, anon;
grant execute on function public.set_my_avatar(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Limits
-- ---------------------------------------------------------------------------
insert into public.app_settings (key, value) values ('max_win_per_round', '100000') on conflict (key) do nothing;


-- Rundenabschluss mit Gewinnobergrenze (gilt für alle Spiele, auch Crash und Risikospiel)
create or replace function public.shb_finish_round(p_round uuid, p_payout bigint, p_result jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_r public.game_rounds;
  v_seed bytea;
  v_name text;
  v_cap bigint := coalesce((public.shb_setting('max_win_per_round') #>> '{}')::bigint, 0);
  v_capped boolean := false;
begin
  select * into v_r from public.game_rounds where id = p_round for update;
  if v_r.status <> 'active' then raise exception 'ROUND_NOT_ACTIVE'; end if;
  if p_payout < 0 then raise exception 'INVALID_PAYOUT'; end if;
  -- Obergrenze = Einsatz + Maximalgewinn
  if v_cap > 0 and p_payout > v_r.bet_amount + v_cap then
    p_payout := v_r.bet_amount + v_cap;
    v_capped := true;
  end if;
  select server_seed into v_seed from public.game_round_secrets where round_id = p_round;
  select display_name into v_name from public.game_configs where game_key = v_r.game_key;

  if p_payout > 0 then
    perform public.shb_apply_ledger(v_r.user_id, p_payout, 'game_payout', 'Auszahlung ' || v_name, 'game_round', p_round,
      null, 'game:' || p_round::text || ':payout');
  end if;

  update public.game_rounds
     set status = 'settled', payout_amount = p_payout, profit_amount = p_payout - v_r.bet_amount,
         result = coalesce(p_result, '{}'::jsonb) || jsonb_build_object('server_seed', encode(v_seed, 'hex'))
                  || case when v_capped then jsonb_build_object('capped', true, 'max_win', v_cap) else '{}'::jsonb end,
         completed_at = now()
   where id = p_round;
end;
$$;

-- Admin darf den Maximalgewinn einstellen
create or replace function public.admin_update_setting(p_key text, p_value jsonb, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_admin uuid := public.shb_require_admin(); v_old jsonb;
begin
  if p_reason is null or char_length(btrim(p_reason)) < 3 then raise exception 'REASON_REQUIRED'; end if;
  if p_key not in ('daily_bonus_amount', 'weekly_bonus_amount', 'weekly_task_label', 'confetti_enabled', 'max_win_per_round') then
    raise exception 'SETTING_NOT_EDITABLE';
  end if;
  if p_key in ('daily_bonus_amount', 'weekly_bonus_amount') and ((p_value #>> '{}')::bigint < 0 or (p_value #>> '{}')::bigint > 1000000) then
    raise exception 'INVALID_VALUE';
  end if;
  if p_key = 'max_win_per_round' and ((p_value #>> '{}')::bigint < 1000 or (p_value #>> '{}')::bigint > 100000000) then
    raise exception 'INVALID_VALUE';
  end if;
  if p_key = 'weekly_task_label' and char_length(p_value #>> '{}') not between 3 and 60 then raise exception 'INVALID_VALUE'; end if;
  select value into v_old from public.app_settings where key = p_key;
  insert into public.app_settings (key, value, updated_by, updated_at) values (p_key, p_value, v_admin, now())
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();
  perform public.shb_audit('setting_update', null, jsonb_build_object('key', p_key, 'before', v_old, 'after', p_value, 'reason', p_reason));
end;
$$;

-- Für die App: Maximalgewinn anzeigen
create or replace function public.get_game_limits()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('max_win_per_round', coalesce((public.shb_setting('max_win_per_round') #>> '{}')::bigint, 0))
   where auth.uid() is not null;
$$;
revoke execute on function public.get_game_limits() from public, anon;
grant execute on function public.get_game_limits() to authenticated;
