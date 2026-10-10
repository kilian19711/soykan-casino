# Admin-Leitfaden

## Erster Admin-Login

Die Admin-Adresse ist in `app_settings.admin_email` = **admin@example.com** hinterlegt. Der erste Auth-Benutzer mit dieser Adresse erhält automatisch die Rolle `admin` (es kann nur einen Admin geben).

1. Supabase-Dashboard → Authentication → Users → **Invite user** → `admin@example.com`.
   (Site URL / Redirect URLs müssen vorher gesetzt sein, siehe SUPABASE_SETUP.md.)
2. Link in der E-Mail öffnen → App zeigt „Passwort festlegen" → Passwort setzen.
3. Das Konto ist jetzt aktiv; im Menü erscheint **Admin**.

Alternative: Dashboard → Add user → „Create new user" mit Auto-Confirm, eigenes Passwort setzen, dann normal anmelden (die App aktiviert das Konto beim ersten Login).

## Mitspieler einladen

Admin → **Einladungen**. Rechts stehen die erwarteten Mitglieder (aus der Tabelle `expected_members`).
1. „Übernehmen" klicken → Anzeigename und Benutzername sind ausgefüllt.
2. E-Mail-Adresse eintragen → „Einladung senden".
3. Der Benutzer erscheint unter „Offene Einladungen" (Status *eingeladen*) und kann dort erneut eingeladen werden.
4. Nach dem Setzen des Passworts wird er automatisch *aktiv* und erscheint im Leaderboard.

Hinweis: Der eingebaute Supabase-Mailversand reicht für uns (ca. 5 Einladungen pro Tag). Bei Rate-Limit den Nutzer im Supabase-Dashboard per **Add user** mit Auto-Confirm anlegen; er setzt sein Passwort dann über „Passwort vergessen“.

## Tägliche Aufgaben

| Bereich | Was |
| --- | --- |
| Übersicht | aktive Benutzer, Credits im System, offene Anfragen, Live-Sessions, Warnungen |
| Benutzer | Suche, Detail, Gutschrift/Abzug (mit Bestätigung), Sperren/Entsperren, Reset-Link, Einladung erneut |
| Credit-Anfragen | genehmigen (bucht sofort) oder mit Grund ablehnen |
| Credit-Anpassungen | freie Buchung + Verlauf aller Admin-Buchungen |
| Spielverläufe / Spielzeit | Runden mit Seed-Details, Sessions |
| Wochenabschluss | automatisch per Cron; manuell „Vorwoche abschließen" oder „aktuelle Woche vorzeitig" |
| Spiele | aktivieren/deaktivieren, Mindest-/Höchsteinsatz (nur implementierte Spiele aktivierbar) |
| System | Tagesbonus-Betrag, Text der Wochenaufgabe |
| Audit-Log | alle Admin-Aktionen mit Grund, Zeit, Ziel und Details |

Jede Admin-Aktion verlangt einen Grund und wird im Audit-Log gespeichert.

## Tagesbonus

- Jeder Spieler kann **einmal pro Kalendertag** (00:00–23:59 Uhr, Europe/Berlin) den Tagesbonus abholen. Nicht abgeholte Boni verfallen.
- Betrag: Admin → **System** → „Bonusbetrag pro Tag“ (Standard 250 Credits, Einstellung `daily_bonus_amount`). **0** schaltet den Bonus ab. Die Änderung gilt sofort und steht mit Grund im Audit-Log.
- Technisch heißt die RPC weiterhin `claim_weekly_bonus`; im Ledger erscheint die Buchung als „Tagesbonus JJJJ-MM-TT“.

## Ankündigungen

Der Cron-Job `shb_announce` (stündlich, Minute 1) erzeugt Benachrichtigungen für alle aktiven Spieler:

| Uhrzeit (Berlin) | Inhalt |
| --- | --- |
| 0 Uhr | „Dein Tagesbonus ist da“ |
| 10 Uhr | Erinnerung (wer den Bonus schon hat, bekommt einen neutralen Text) |
| 18 Uhr | Erinnerung „Feierabend im Casino“ |

Jede Ankündigung geht höchstens einmal pro Tag raus (`announcement_log`). Spieler können sie unter Profil → Benachrichtigungen abschalten.

## Push-Benachrichtigungen

- Spieler aktivieren Push pro Gerät unter **Profil → Benachrichtigungen → Aktivieren**. Auf dem iPhone geht das nur in der installierten App (Home-Bildschirm, ab iOS 16.4).
- Als Push aufs Handy gehen nur die Ankündigungen (0, 10, 18 Uhr); alles andere erscheint nur in der App. Versand: Der Cron-Job `shb_push` ruft minütlich die Edge Function `push-dispatch` auf. Benachrichtigungen, die älter als 15 Minuten sind, werden nicht mehr gepusht.
- VAPID-Schlüssel, Dispatch-Secret und Dispatch-URL liegen **nur** in der DB-Tabelle `private.config` (Schlüssel `vapid_public`, `vapid_private`, `vapid_subject`, `push_dispatch_secret`, `push_dispatch_url`), nie im Repo. Fehlt ein Eintrag, wird nichts versendet, und die App meldet „Push ist serverseitig noch nicht eingerichtet“.
- Abgelaufene Geräte (HTTP 404/410) werden automatisch aus `push_subscriptions` entfernt.

**Fehlersuche, falls nichts ankommt:**
1. Hat die App „Push-Benachrichtigungen aktiv“ angezeigt? Gibt es in `push_subscriptions` eine Zeile für den Spieler?
2. Gibt es eine neue Benachrichtigung mit gesetztem `pushed_at`? Wenn nicht: Läuft der Cron-Job `shb_push`?
3. Supabase-Dashboard → Edge Functions → `push-dispatch` → Logs. `reason: no_vapid` = Schlüssel fehlen in `private.config`; 403 = Secret passt nicht.
4. Am Gerät prüfen, ob Mitteilungen für die App erlaubt sind.

## Erfolge, Live-Feed, Wochen-Rückblick

- **Erfolge** werden per Trigger automatisch vergeben (u. a. erste Runde, 100/1.000 Runden, 10×/100×-Gewinn, Blackjack, Freispiele in Shisha Diamonds, 10 Verluste in Folge, 10/25 verschiedene Spiele, Kastenträger). Jeder Erfolg erzeugt eine Benachrichtigung.
- **Live-Feed**: Gewinne der letzten 24 h ab 5× Einsatz und mindestens 200 Credits Gewinn. Jeder Spieler schaltet ihn im Profil selbst ein (standardmäßig aus).
- **Wochen-Rückblick** im Dashboard: Runden, Umsatz, größter Gewinn/Multiplikator/Verlust, beliebtestes Spiel, längste Spielzeit.

## Abrechnung alle 3 Wochen (ab Migration 9)

- Der Letzte wird nur noch **alle 3 Wochen** ermittelt. Die erste Runde läuft vom 09.10.2026 bis So 01.11.2026 23:59 Uhr (Berlin), danach jeweils 3 Wochen.
- Einstellungen in `app_settings`: `period_anchor_end` (Ende der ersten Runde), `period_first_start`, `period_weeks`.
- Admin → **Abrechnung**: „Vorherige Runde abrechnen“ (Fallback zum Cron) und „Aktuelle Runde vorzeitig abrechnen“.

## Erfolge und Daily Quests (ab Migration 9)

- **Erfolge** (58 Stück, Tabelle `achievement_defs`): Jeder neue Erfolg zahlt einmalig **100 Credits** (`achievement_reward`). Erfolge, die beim Einspielen schon freigeschaltet oder erreicht waren, zahlen nichts.
- **Daily Quests**: Jeder Spieler bekommt täglich 3 Quests (leicht 100 / mittel 200 / schwer 300 Credits). Das System wählt sie aus `quest_templates` und bevorzugt dabei zuletzt gespielte Spiele. Reset um Mitternacht (Berlin); nicht abgeholte Belohnungen verfallen.
- Um 0 Uhr kommt die Ankündigung „Neue Daily Quests sind da“ (auch als Push). Im Dashboard leuchtet der Quest-Knopf rot, bis man die neuen Quests geöffnet hat.

## Soziales (ab Migration 15–18)

- **Duelle:** Casino → oben rechts „Duelle“ (Live-Duelle und Spiel-Duelle, siehe Spielregeln). Cron `shb_duels` erstattet alle 10 Minuten abgelaufene Duelle.
- **Schenken:** Wallet → „Schenken“. Tageslimit pro Spieler `gift_daily_limit` (Standard 5.000).
- **Kasten-Tipp:** Dashboard → „Wer bringt ihn? Tippen“ (Seite `/tipp`). Tipps bis 24 h vor Rundenende änderbar; richtige Tipps bekommen bei der Abrechnung automatisch `prediction_reward` (Standard 500).
- Einstellungen `gift_daily_limit`, `duel_max_stake`, `prediction_reward` stehen in `app_settings` und sind über `admin_update_setting` änderbar (noch ohne eigenes Feld im Admin).

## Fehler (Debug) und Aufräumen (ab Migration 10)

- Admin → **Fehler**: Abstürze, unbehandelte Fehler und unerwartete Serverfehler aus der App, gleiche Fehler zusammengefasst (Anzahl, betroffene Spieler, Seite/Spiel, Gerät, Stack). Nach dem Beheben „Behoben – löschen“ oder „Alle löschen“.
- Admin → **Aufräumen**: Zeitraum wählen, Bereiche ankreuzen (Benachrichtigungen, Fehler, Cron-/HTTP-Protokoll, Rate-Limits, Ankündigungs-Log, Audit-Log), Vorschau prüfen, mit Grund löschen. Kontostände, Buchungen, Runden, Spielzeit und Erfolge werden nie gelöscht. Dort lässt sich auch der App-Cache auf dem eigenen Gerät leeren.
