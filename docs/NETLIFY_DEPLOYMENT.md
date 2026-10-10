# Netlify-Deployment

Netlify hostet nur das Frontend. Datenbank, Spiellogik, Cron und Edge Functions bleiben in Supabase.

`netlify.toml` ist vorbereitet: Build `npm run build`, Publish `dist`, SPA-Redirect auf `/index.html`, Sicherheits-Header, Node 20.

## Vor jedem Deploy

```bash
npm install
npm run lint
npm run test
npm run build
```

## Umgebungsvariablen in Netlify

Site configuration → Environment variables:
- `VITE_SUPABASE_URL` = `https://DEIN-PROJEKT-REF.supabase.co`
- `VITE_SUPABASE_ANON_KEY` = Publishable Key aus Supabase → Project Settings → API

**Niemals** den Service-Role-Key in Netlify oder als `VITE_`-Variable eintragen.

## Option A – Git (empfohlen)

1. Repository bei GitHub/GitLab anlegen und pushen.
2. Netlify → Add new site → Import from Git → Repository wählen. Build-Einstellungen werden aus `netlify.toml` übernommen.
3. Umgebungsvariablen setzen, deployen. Jeder Push deployt automatisch.

## Option B – Netlify CLI

```bash
npm i -g netlify-cli
netlify login
netlify init        # oder: netlify link
netlify deploy --build            # Vorschau
netlify deploy --build --prod     # Produktion
```

## Option C – Manueller Upload

`npm run build` lokal ausführen (mit gesetzten `VITE_`-Variablen in `.env.local`), dann den Ordner `dist/` per Drag & Drop unter app.netlify.com → Sites hochladen.

## Danach

- Netlify-URL in Supabase als **Site URL** und **Redirect URL** eintragen (siehe SUPABASE_SETUP.md).
- Optional `APP_URL` als Function-Secret setzen.
- Custom Domain: Netlify → Domain management.
