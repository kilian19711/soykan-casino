# Eigenes Freundes-Casino einrichten (mit Claude)

Das ist eine Vorlage für ein **privates Social Casino** für eine Freundesgruppe: nur virtuelle Credits, kein Echtgeld.
Läuft als App auf dem Handy (PWA), mit über 40 Spielen, Daily Quests, Erfolgen, Duellen (auch live), Geschenken,
Leaderboard und einer Abrechnung alle 3 Wochen, bei der der Letzte eine Aufgabe erfüllen muss (Standard: „Kasten mitbringen“).

Alles läuft kostenlos auf **Supabase** (Datenbank, Login) und **Netlify** (Webseite).

## Was du brauchst

- Ein kostenloses Konto bei [Supabase](https://supabase.com) und bei [Netlify](https://netlify.com)
- [Node.js (LTS)](https://nodejs.org), [Git](https://git-scm.com) und die Claude-App mit Claude Code
- Die Claude-Verbindung zu Supabase (Connector) – dann kann Claude die Datenbank direkt einrichten

## So geht's

1. Dieses Repository herunterladen (Code → Download ZIP oder `git clone`) und den Ordner in Claude Code öffnen.
2. In Supabase ein **neues Projekt** anlegen (Region z. B. Frankfurt) und warten, bis es bereit ist.
3. In Claude diesen Prompt einfügen und die Platzhalter ausfüllen:

```
Lies README.md, SETUP_MIT_CLAUDE.md, docs/ und supabase/migrations/. Richte das Casino für meine Freundesgruppe ein:
- Name der App: <NAME, z. B. "Zocker-Bude">
- Meine Admin-E-Mail: <DEINE E-MAIL>
- Mitspieler (Anzeigenamen): <NAME1, NAME2, ...>
- Aufgabe für den Letzten: <z. B. "Kasten mitbringen">
- Supabase-Projekt: <PROJEKT-NAME oder REF>
Schritte:
1. Ersetze überall den alten App-Namen ("Shishabar"/"SHB") durch meinen Namen (Texte, Logo-Text, Manifest, Titel).
2. Trage meine Admin-E-Mail in die Seed-Migration (admin_email) und meine Mitspieler in expected_members ein.
3. Setze in Migration 9 period_first_start auf heute und period_anchor_end auf den Montag nach dem übernächsten Sonntag.
4. Spiele alle Migrationen der Reihe nach in mein Supabase-Projekt ein und deploye die Edge Functions.
5. Lege .env.local mit VITE_SUPABASE_URL und VITE_SUPABASE_ANON_KEY an (nicht ins Git).
6. Teste lokal (npm install, npm run lint, npx vitest run, npm run build) und starte die App lokal.
7. Erkläre mir danach Schritt für Schritt, was ich selbst in Supabase (Auth-URLs, Registrierung aus) und Netlify (Site anlegen, Umgebungsvariablen) einstellen muss, und deploye dann.
Frag mich, bevor du etwas live änderst. Antworte auf Deutsch.
```

4. Claude führt dich durch den Rest. Logins und Passwörter gibst du immer selbst ein.

## Gut zu wissen

- **Erster Admin:** Der erste Login mit der Admin-E-Mail bekommt automatisch Admin-Rechte (siehe docs/ADMIN_GUIDE.md).
- **Mitspieler einladen:** Admin → Einladungen. Der eingebaute Supabase-Mailversand schafft ca. 5 Einladungen pro Tag; sonst Nutzer im Supabase-Dashboard per „Add user“ anlegen.
- **Push-Nachrichten (optional):** brauchen eigene VAPID-Schlüssel, die nur in der Datenbank-Tabelle `private.config` liegen – Claude kann sie erzeugen und eintragen (siehe docs/ADMIN_GUIDE.md, Abschnitt Push).
- **Geheimnisse** (Schlüssel, Passwörter, `.env.local`) kommen nie ins Repository.
- **Neustart:** `supabase/scripts/full_reset.sql` setzt alle Kontostände und Spieldaten zurück (Logins bleiben).
- Spielregeln und Quoten: docs/GAME_RULES.md · Aufbau: docs/ARCHITECTURE.md · Sicherheit: docs/SECURITY.md

Viel Spaß – und nur virtuelle Credits, kein echtes Geld!
