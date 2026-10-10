# Installation auf dem iPhone

1. **Safari öffnen** und die App-Adresse aufrufen (z. B. die Netlify-URL).
2. Auf **Teilen** tippen (Quadrat mit Pfeil nach oben).
3. **„Zum Home-Bildschirm"** auswählen.
4. **Hinzufügen** bestätigen.

Die App startet danach im Vollbild mit dem goldenen SHB-Icon. Sie funktioniert auch ganz normal im mobilen Browser.

## Technik

- `manifest.webmanifest` (Name „Shishabar Online Casino", Kurzname „Shishabar", standalone, Theme `#0d0f14`, Icons 192/512 + maskable)
- `apple-touch-icon.png`, `viewport-fit=cover`, Safe-Area-Abstände für Notch/Dynamic Island und Home-Indikator
- Service Worker `public/sw.js`: App-Shell-Caching; Supabase-Daten werden **nie** gecacht. Offline erscheint ein klarer Hinweis statt veralteter Kontostände.
- Hochformat, große Touch-Flächen (≥ 44 px), Bottom-Navigation, 16-px-Eingabefelder (kein iOS-Zoom).

Icons neu erzeugen: `npm run icons`.
