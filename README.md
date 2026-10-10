# Freundes-Casino (Vorlage)

> **Neu hier?** Lies [SETUP_MIT_CLAUDE.md](SETUP_MIT_CLAUDE.md) – dort steht, wie du das Casino mit Claude für deine eigene Gruppe einrichtest.

Private, mobile-first Social-Casino-PWA für eine geschlossene Gruppe.

> **Dieses Projekt verwendet ausschließlich virtuelle SHB-Credits ohne Echtgeldwert. Es gibt keine Einzahlungen, Auszahlungen oder Käufe.**

**Stack:** React 18 · TypeScript · Vite · React Router · eigenes CSS-Designsystem · Zod · Supabase (Auth, Postgres, RLS, Realtime, Edge Functions, pg_cron) · Netlify · Vitest · Playwright

## Schnellstart (lokal)

```bash
npm install
cp .env.example .env.local   # VITE_SUPABASE_URL und VITE_SUPABASE_ANON_KEY eintragen
npm run dev                  # http://localhost:5173
```

| Skript | Zweck |
| --- | --- |
| `npm run dev` | Entwicklungsserver |
| `npm run lint` | ESLint (0 Warnungen erlaubt) |
| `npm run test` | Vitest Unit-/Komponententests |
| `npm run test:e2e` | Playwright E2E (Desktop, iPhone SE, iPhone 15, Tablet) |
| `npm run build` | TypeScript-Check + Produktions-Build nach `dist/` |
| `npm run icons` | PNG-App-Icons aus `public/icons/icon.svg` erzeugen |

Datenbank-Integrationstest: `supabase/tests/integration_test.sql` (siehe [docs/QA_CHECKLIST.md](docs/QA_CHECKLIST.md)).

## Umgebungsvariablen

| Variable | Wo | Hinweis |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | `.env.local` / Netlify | öffentlich |
| `VITE_SUPABASE_ANON_KEY` | `.env.local` / Netlify | öffentlicher Publishable/Anon-Key |
| `SUPABASE_SERVICE_ROLE_KEY` | **nur** Supabase Edge Functions (automatisch gesetzt) | niemals ins Frontend/Repo |
| `APP_URL` | Supabase Function Secret (optional) | z. B. `https://DEINE-SEITE.netlify.app` für Einladungslinks |
| VAPID-Schlüssel, Push-Secret | **nur** DB-Tabelle `private.config` | siehe [Admin-Leitfaden](docs/ADMIN_GUIDE.md#push-benachrichtigungen) |

## Dokumentation

- [Architektur](docs/ARCHITECTURE.md)
- [Supabase-Einrichtung](docs/SUPABASE_SETUP.md) – Migrationen, Edge Functions, Auth-E-Mail, SMTP, Cron, Backup
- [Netlify-Deployment](docs/NETLIFY_DEPLOYMENT.md)
- [Admin-Leitfaden](docs/ADMIN_GUIDE.md) – erster Admin-Login, Benutzer einladen, Tagesbonus, Push
- [Spielregeln](docs/GAME_RULES.md)
- [Sicherheit](docs/SECURITY.md)
- [iPhone-Installation](docs/PWA_IPHONE.md)
- [QA-Checkliste](docs/QA_CHECKLIST.md)

## Status

Fertig: Auth (Login, Einladung, Passwort setzen/zurücksetzen/ändern, Sperren), Wallet & Ledger, Credit-Anfragen, **Tagesbonus** mit Ankündigungen um 0/10/18 Uhr, **Web-Push**, Erfolge/Abzeichen, Live-Feed großer Gewinne, Wochen-Rückblick, Spielzeit-Tracking, Leaderboard mit Realtime und Presence, Wochenabschluss mit Wochenverlierer (pg_cron + Admin-Fallback), Benachrichtigungen, kompletter Adminbereich, PWA.

**44 Spiele** sind spielbar: 8 Originale (Roulette, Blackjack, Crash, Plinko, Mines, Dice, Limbo, Shisha Slots), Shisha Diamonds (Sticky Wilds, Freispiele, Risikospiel) und 35 weitere (u. a. Jackpot-Slot, Pump, Pferderennen, Hütchenspiel, Diamonds). Dazu Live-Duelle, Spiel-Duelle, Schenken und Kasten-Tipp. Regeln und Quoten: [docs/GAME_RULES.md](docs/GAME_RULES.md).
