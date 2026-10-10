# Arbeitsregeln für Claude in diesem Projekt

- Privates Social Casino für eine Freundesgruppe, nur virtuelle "Credits", kein Echtgeld. Antworten auf Deutsch.
- Erst lokal bauen und testen (`npm run lint`, `npx vitest run`, `npm run build`), dann **vor jeder Live-Änderung** (Netlify-Deploy, Migration, Edge Function, Supabase-Einstellung) ausdrücklich nachfragen.
- Alle Spielergebnisse werden in der Datenbank bestimmt (Postgres-Funktionen, `shb_rng`). Buchungen nur über `shb_apply_ledger` mit Idempotenz-Keys. Nie Kontostände direkt ändern.
- Datenbank-Logik auf dem Live-Projekt nur in DO-Blöcken testen, die mit `raise exception` enden (Rollback). Vorlage: `supabase/tests/sticky_test.sql`.
- Keine Secrets ins Repo oder Frontend. Keine Konten anlegen oder Passwörter eingeben – Logins macht der Admin selbst.
- Texte für Spieler in normaler Sprache, ohne Technik-Begriffe (kein "serverseitig", "Ledger", "Seed"). Der Admin-Bereich darf technisch sein.
- Bei relevanten Frontend-Änderungen die Cache-Version in `public/sw.js` hochzählen.
- Einrichtung einer neuen Instanz: siehe SETUP_MIT_CLAUDE.md.
