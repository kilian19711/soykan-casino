# QA-Checkliste

## Automatisiert

| Ebene | Befehl | Stand 2026-10-08 |
| --- | --- | --- |
| Lint | `npm run lint` | ✅ 0 Fehler/Warnungen |
| Unit/Komponenten | `npm run test` | ✅ 49/49 |
| Build | `npm run build` | ✅ |
| E2E | `npm run test:e2e` | ✅ 44 bestanden, 4 übersprungen (benötigen Testkonto) |
| Datenbank | `supabase/tests/integration_test.sql` | ✅ 45/45 |

**Unit-/Komponententests** decken ab: Roulette-, Blackjack-, Dice-, Limbo-, Crash-, Mines-Logik, Plinko-/Slots-Quoten, Einsatzvalidierung, Formatierung (Spielzeit, Countdown), Fehlercodes, Idempotency-IDs, Serverzeit-Countdown, Routenschutz (Login, eingeladen, gesperrt, Admin), Formularvalidierung, Doppelklick-Schutz, Modal/Escape, Toasts (aria-live), Leaderboard-Sortierung, Spielzeit-Heartbeat (Pause im Hintergrund), PWA-Manifest, keine Secrets/Zahlungen/innerHTML im Client, RLS/search_path/Constraints in Migrationen.

**DB-Integrationstest** (läuft komplett in einer Transaktion und rollt zurück): Bonus + doppelte Abholung, doppelte Idempotency-ID, zu niedriger Kontostand, Mindesteinsatz, Roulette-Abrechnung, Plinko, Limbo, Slots, Mines-Cashout (idempotent), Blackjack-Abrechnung, Crash-Cashout-Schutz, nachprüfbarer Seed, RLS (Wallet, Ledger, Anfragen, Runden, Audit, Settings, Secrets), Admin-Rollenprüfung, Gutschrift/Abzug/Grund/kein Minus, Anfrage genehmigen/nur einmal, Audit-Log, Leaderboard-Sortierung, Dashboard, Spielzeit-Heartbeat, Wochenabschluss inkl. Gleichstand und Idempotenz, Ledger-Konsistenz, Benachrichtigungen.

Ausführen: Inhalt im Supabase SQL Editor ausführen. Ergebnis steht in der Fehlermeldung `TEST_RESULT: {"failed": [] …}` (die Exception ist gewollt, sie rollt alle Testdaten zurück). Nur auf einer Datenbank ohne bestehenden Admin ausführbar.

**Angemeldete E2E-Flows:** `E2E_EMAIL=… E2E_PASSWORD=… npm run test:e2e` mit einem Testkonto.

## Manuell (nach dem ersten Admin-Login)

- [ ] Einladung senden → E-Mail kommt an → Passwort setzen → Profil-Setup
- [ ] Abgelaufenen Einladungslink öffnen → verständlicher Hinweis
- [ ] Passwort vergessen → Reset-Mail → neues Passwort
- [ ] Wochenbonus abholen, zweiter Klick → „bereits abgeholt"
- [ ] Jedes der 8 Spiele: Gewinn, Verlust, zu hoher Einsatz, Doppelklick
- [ ] Mines/Blackjack/Crash: Seite während Runde neu laden → Runde wird fortgesetzt
- [ ] Zwei Geräte: Admin bucht Credits → Kontostand + Toast erscheinen live beim Benutzer
- [ ] Leaderboard aktualisiert sich live
- [ ] Benutzer sperren → Benutzer kann nicht mehr spielen
- [ ] Admin: Wochenabschluss manuell → Benachrichtigung an alle
- [ ] iPhone SE, iPhone mit Dynamic Island, Tablet, Desktop ≥ 1280 px: keine abgeschnittenen Buttons, kein horizontales Scrollen, Modals vollständig sichtbar
- [ ] PWA zum Home-Bildschirm hinzufügen, offline öffnen → Offline-Hinweis
- [ ] „Bewegung reduzieren" aktiv → keine Partikel/Animationen
