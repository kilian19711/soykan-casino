# Architektur

```
Browser / iPhone-PWA (React, Netlify)
   │  supabase-js (Anon-Key + Benutzer-JWT)
   ├── RPC (PostgREST)  ──►  SECURITY-DEFINER-Funktionen in Postgres  ──►  Tabellen (RLS)
   ├── Realtime          ◄──  wallets, leaderboard_entries, notifications, credit_requests, weekly_results
   └── Edge Functions    ──►  admin-invite-user, admin-send-password-reset (Service-Role nur hier)
pg_cron: finalize_week() stündlich (idempotent), shb_maintenance() minütlich,
         shb_announce() stündlich, shb_dispatch_push() minütlich ──pg_net──► Edge Function push-dispatch ──► Web Push
```

**Netlify** liefert nur das statische Frontend (PWA, HTTPS, Build). Datenbank, Spiellogik, Cron und Edge Functions laufen ausschließlich in **Supabase**.

## Grundprinzipien

1. **Server ist die einzige Wahrheit.** Spielergebnisse, Auszahlungen, Kontostände, Bonus und Wochenabschluss werden nur in Postgres-Funktionen berechnet. Der Client sendet Einsatz + Spielparameter, nie Zufallswerte oder Ergebnisse.
2. **Ledger statt direkter Updates.** `shb_apply_ledger()` ist die einzige Stelle, die `wallets.balance` ändert – mit Zeilensperre, `balance >= 0`-Constraint und eindeutiger Idempotency-ID. Jede RPC läuft in einer Transaktion; jeder Fehler rollt alles zurück.
3. **RLS überall.** Clients haben keine INSERT/UPDATE/DELETE-Rechte auf Tabellen. Lesen nur eigener Daten (Admin: alles). Geheimnisse (Server-Seeds, Minen, Kartenstapel, Crash-Punkt) liegen in `game_round_secrets` ohne Policy.
4. **Nachprüfbarer Zufall.** Pro Runde 32 Byte `gen_random_bytes` (CSPRNG); Zufallswerte = HMAC-SHA256(Seed, Index). SHA-256 des Seeds wird vor der Runde gespeichert, der Seed nach Abschluss offengelegt.

## Datenmodell (Kurzfassung)

profiles (inkl. preferences) · wallets · credit_ledger · leaderboard_entries (öffentliche Spiegelung, per Trigger) · credit_requests · bonus_claims (unique user/week) · game_rounds · game_round_secrets · game_sessions · weekly_snapshots · weekly_results (unique week) · notifications · audit_logs · game_configs · app_settings · expected_members · rate_limit_events · achievements · push_subscriptions · announcement_log · private.config (Secrets)

## RPC-/Function-Übersicht (Mapping zur Spezifikation)

| Spezifikation | Umsetzung |
| --- | --- |
| Tagesbonus | `claim_weekly_bonus(key)` (Name historisch, zahlt täglich) |
| request-credits | `request_credits(amount, message)`, `cancel_credit_request` |
| admin-adjust-credits | `admin_adjust_credits(user, amount, reason, key)` |
| admin-review-credit-request | `admin_review_credit_request(id, approve, message)` |
| admin-invite-user | Edge Function `admin-invite-user` (auch „erneut senden") |
| admin-send-password-reset | Edge Function `admin-send-password-reset` |
| start-/settle-game-round | `play_dice/limbo/plinko/slots/roulette` (Start+Abrechnung atomar), `mines_start/reveal/cashout`, `blackjack_start/action`, `crash_start/cashout/poll` |
| weitere Spiele | `play_game(key, bet, params, key)` (Einzelrunde), `step_start/step_action/step_cashout` (mehrstufig), `sticky_spin/sticky_gamble/sticky_collect` (Shisha Diamonds) |
| Push / Einstellungen | `update_my_preferences`, `save_push_subscription`, `delete_push_subscription`, `get_push_public_key` |
| Soziales | `get_big_wins`, `get_week_recap`, Tabelle `achievements` (Trigger) |
| start-/heartbeat-/end-game-session | `start_game_session`, `heartbeat_game_session`, `end_game_session` |
| finalize-week | `finalize_week()` (Cron) / `admin_finalize_week()` |
| get-dashboard-state | `get_dashboard_state()` (inkl. Serverzeit) |

## Frontend-Struktur

```
src/app         App, Routing, Layout, AppData (Realtime, Kontostand)
src/components  Button(+Doppelklickschutz), Modal, Toast, Icons, Logo, UI-Bausteine
src/features    auth, dashboard, wallet, requests, leaderboard, history, profile, notifications, session, admin, games
src/features/games  shared.tsx (Framework), logic.ts (reine Logik), catalog.tsx (Kachel-Grafiken), engine.tsx (SimpleGame/Step-Hooks), games/* (alle Spiele; StickyDiamonds = Shisha Diamonds)
src/lib         api.ts (einziger Supabase-Zugriff), errors, format, misc (Serverzeit, Idempotency, Sound/Haptik)
supabase/       migrations, functions, tests
```

Countdowns nutzen den Server-Zeitversatz aus jeder RPC-Antwort (`server_now`), nicht die Geräteuhr.
