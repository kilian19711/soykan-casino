# Sicherheit

## Maßnahmen

- **RLS auf allen 17 Tabellen.** Clients haben keinerlei Schreibrechte auf Tabellen (`revoke insert/update/delete`). Lesen: eigene Zeilen; Admin per `shb_is_admin()`. `profiles`, `leaderboard_entries`, `weekly_*`, `game_configs` sind für angemeldete Benutzer lesbar (ohne E-Mail-Adressen – diese liegen nur in `auth.users`).
- **Geheime Rundendaten** (`game_round_secrets`, `rate_limit_events`) haben bewusst keine Policy → für Clients unlesbar. (Der Supabase-Linter meldet das als INFO „RLS enabled, no policy" – gewollt.)
- **Funktionsrechte:** Alle Funktionen sind für `public/anon/authenticated` entzogen; nur eine Whitelist von RPCs ist für `authenticated` freigegeben. Interne Funktionen (`shb_apply_ledger`, `shb_finalize_week`, …) sind nicht aufrufbar. Der Linter-Hinweis „authenticated can execute SECURITY DEFINER function" betrifft genau diese gewollte Whitelist – jede Funktion prüft intern `shb_require_user()` bzw. `shb_require_admin()`.
- **SECURITY DEFINER** nur mit `set search_path = ''` und voll qualifizierten Namen (per Test geprüft).
- **Admin-Rolle** wird serverseitig geprüft (`profiles.role` ist nur per Migration/Bootstrap setzbar; Unique-Index erlaubt genau einen Admin). Das Frontend zeigt Adminseiten nur nach Server-Bestätigung `shb_is_admin()`; alle Admin-Daten sind zusätzlich per RLS/RPC geschützt.
- **Credits:** BIGINT, `check (balance >= 0)`, Zeilensperre, Idempotency-Keys (unique), atomare Transaktionen.
- **Rate-Limiting** serverseitig: Spielrunden 90/min, Credit-Anfragen 5/h, Bonus 10/min, Admin-Aktionen 60/min, Einladungen/Resets 30/h; Login zusätzlich clientseitig + Supabase-Auth-Limits.
- **Service-Role-Key** nur in Edge Functions (Umgebung von Supabase), nie im Repo/Frontend (per Test geprüft).
- **XSS:** React-Escaping, kein `dangerouslySetInnerHTML` (per Test geprüft). Sicherheits-Header in `netlify.toml`.
- **Keine E-Mails** in öffentlichen Antworten oder Fehlermeldungen; „Passwort vergessen" verrät nicht, ob ein Konto existiert.

## Security-Check

`supabase/tests/integration_test.sql` prüft u. a.: fremde Wallet/Ledger/Anfragen/Runden unlesbar, Secrets unlesbar, Admin-Funktionen für Benutzer verboten, interne Ledger-Funktion nicht aufrufbar, Wallet/Rolle nicht direkt schreibbar.

## Empfehlungen für den Betrieb

- Öffentliche Registrierung in Supabase deaktivieren.
- Eigenes SMTP einrichten.
- Leaked-Password-Protection und ggf. MFA für das Admin-Konto in Supabase Auth aktivieren.
