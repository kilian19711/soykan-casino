# Supabase-Einrichtung

Projekt: **Shishabar Casino** (Ref `DEIN-PROJEKT-REF`, Region eu-west-1).

## Status

Alle Migrationen (1–8) und alle drei Edge Functions sind live eingespielt. Es gibt bewusst keinen Dev-Branch: DB-Logik wird auf live nur in DO-Blöcken getestet, die mit `raise exception` enden (Rollback), Vorlage `supabase/tests/sticky_test.sql`.

## Verbindung prüfen

```bash
supabase login
supabase link --project-ref DEINE_SUPABASE_PROJECT_ID   # hier: DEIN-PROJEKT-REF
supabase migration list
```

## Migrationen

`supabase/migrations/` – idempotent (`if not exists`, `create or replace`, `on conflict do nothing`):

1. `…01_schema.sql` – Tabellen, Constraints, Indizes
2. `…02_helpers_rls.sql` – Hilfsfunktionen, Ledger, Trigger, RLS, Realtime-Publication
3. `…03_core_rpc.sql` – Benutzer-/Admin-RPCs, Bonus, Spielzeit, Wochenabschluss
4. `…04_games.sql` – Spiellogik der 8 Spiele
5. `…05_seed_grants_cron.sql` – Einstellungen, Spielkatalog, erwartete Mitglieder, Funktionsrechte, pg_cron
6. `20261009000006_more_games.sql` – generische Engines `play_game` und `step_start/step_action/step_cashout`, 30 weitere Spiele
7. `20261009000007_daily_bonus_social_push.sql` – Tagesbonus, Ankündigungen, Einstellungen (`profiles.preferences`), Web-Push (`push_subscriptions`, `private.config`), Erfolge, Live-Feed, Wochen-Rückblick
8. `20261009000008_shisha_diamonds_v2.sql` – Shisha Diamonds v2 (`sticky_spin`, `sticky_gamble`, `sticky_collect`)

```bash
supabase db push
```

**Vor jedem `db push`:** Migrationen prüfen, bestehende Tabellen inspizieren, Backup anlegen (Dashboard → Database → Backups bzw. `supabase db dump -f backup.sql`), RLS-Policies prüfen. Keine destruktiven Änderungen ohne Bestätigung.

## Edge Functions

```bash
supabase functions deploy admin-invite-user
supabase functions deploy admin-send-password-reset
supabase functions deploy push-dispatch --no-verify-jwt   # prüft stattdessen den Header x-dispatch-secret
supabase secrets set APP_URL=https://DEINE-NETLIFY-DOMAIN   # optional, sonst Origin des Aufrufers
```

`SUPABASE_URL` und `SUPABASE_SERVICE_ROLE_KEY` stellt Supabase den Functions automatisch bereit.

## Auth-Einstellungen (Dashboard → Authentication) – **noch manuell nötig**

1. **URL Configuration:** Site URL = Netlify-URL; Redirect URLs: `https://DEINE-DOMAIN/**` und `http://localhost:5173/**`.
2. **Sign In / Providers → Email:** „Allow new users to sign up" **deaktivieren** (Zugang nur per Einladung).
3. **E-Mail-Vorlagen** (optional deutsch): „Invite user" und „Reset password". Der Link-Platzhalter `{{ .ConfirmationURL }}` bleibt.
4. **Mailversand:** Der eingebaute Supabase-Mailversand reicht (ca. 5 Einladungen pro Tag). Bei Rate-Limit Nutzer per „Add user“ mit Auto-Confirm anlegen.

## Cron

`pg_cron` ist aktiv:
- `shb_finalize_week` – stündlich Minute 2: schließt die zuletzt beendete Woche ab (idempotent; Wochen ohne Aktivität werden übersprungen).
- `shb_maintenance` – minütlich: verwaiste Crash-Runden abrechnen, alte Rate-Limit-Einträge löschen, Sessions schließen.
- `shb_announce` – stündlich Minute 1: Ankündigungen um 0, 10 und 18 Uhr (Europe/Berlin), höchstens einmal pro Tag.
- `shb_push` – minütlich: ruft per pg_net die Edge Function `push-dispatch` auf, wenn ungepushte Benachrichtigungen vorliegen.

Fallback ohne Cron: Admin → Wochenabschluss → „Vorwoche abschließen".

## Backup & Wiederherstellung

- Pro-Plan: tägliche Backups im Dashboard; Free-Plan: regelmäßig `supabase db dump -f backup_$(date +%F).sql --data-only` sichern.
- Wiederherstellen: `psql "$DATABASE_URL" -f backup.sql` in ein leeres Projekt, nachdem die Migrationen eingespielt wurden.
