-- Migration 12: Towers/Gem Hunt – Fallen pro Ebene korrekt speichern.
-- Fehler: v_rows || to_jsonb(int[]) hängt die Zahlen flach an ([1,0,2,…] statt [[1],[0],[2],…]).
-- Folge: bei "Experte" (2 Fallen pro Ebene) lag pro Ebene effektiv nur eine Falle an falscher Stelle
-- (Gewinnchance 2/3 statt 1/3 bei voller Auszahlung); im Frontend führte die flache Liste zum Absturz nach Rundenende.
-- Bereits laufende Runden mit flacher Liste werden in step_action weiter wie bisher ausgewertet.

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
      -- jede Ebene als eigenes Array anhängen (nicht flach zusammenfügen)
      v_rows := v_rows || jsonb_build_array(to_jsonb(v_perm[1:v_bombs]));
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
