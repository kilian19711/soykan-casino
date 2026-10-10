# Spielregeln

Alle Ergebnisse werden serverseitig mit kryptografisch sicherem Zufall bestimmt. Standardlimits: 10–50.000 Credits pro Runde (alle Slots bis 25.000, Bingo und Rubbellos bis 20.000, Digital Lottery bis 10.000), im Admin änderbar.

Multiplikatoren verstehen sich als **Auszahlung inklusive Einsatz** (2× = Einsatz verdoppelt), sofern nicht anders angegeben. Die Quoten stammen aus `scripts/calibrate.mjs` (`node scripts/calibrate.mjs`).

## Originalspiele

| Spiel | Regeln | Auszahlung | Theor. Quote |
| --- | --- | --- | --- |
| **Roulette** | Europäisch, 0–36, mehrere Einsätze pro Runde | Zahl 35:1, Dutzend/Kolonne 2:1, Rot/Schwarz, Gerade/Ungerade, 1–18/19–36 je 1:1 | 97,3 % |
| **Blackjack** | 6 Decks, Hit/Stand/Double/Split (1×, Asse je 1 Karte), Dealer steht auf allen 17 | Blackjack 3:2, Gewinn 1:1, Push = Einsatz zurück | ≈ 99 % |
| **Crash** | Start 3 s nach Einsatz, Multiplikator e^(0,00006·t ms), Cashout vor Crash, optional Auto-Cashout | Einsatz × Cashout-Multiplikator | 99 % |
| **Plinko** | 8/12/16 Reihen, Risiko niedrig/mittel/hoch | Einsatz × Feld-Multiplikator | 98,2–99,4 % |
| **Mines** | Raster 4×4/5×5/6×6, 1…n−1 Minen, aufdecken oder auszahlen | 0,99 × Π (Felder−i)/(Felder−Minen−i) | 99 % |
| **Dice** | Wurf 0,00–99,99, Über/Unter, Chance 1–98 % | 99 / Chance | 99 % |
| **Limbo** | Ziel 1,01×–1.000.000× | Einsatz × Ziel, wenn Ergebnis ≥ Ziel | 99 % |
| **Shisha Slots** | 3×3, 5 Linien (Einsatz/5 pro Linie), eigene Symbole | 3× Sieben 200×, Saphir 50×, Glocke 22×, Minze 13×, Kirsche 9×, 2 Kirschen 2× (je Linieneinsatz); SHB-Coin-Bonus 3/4/5+ = 5/15/50× Einsatz | ≈ 98,8 % |

## Sticky Diamonds (game_key `shisha_diamonds`)

- 5 Walzen × 3 Reihen, 10 feste Linien, Linieneinsatz = Einsatz / 10. Gewertet wird von links nach rechts.
- **Diamant = Wild**: ersetzt alle Symbole außer dem Stern. Eine Linie aus lauter Diamanten zahlt wie Sieben.
- Liniengewinne (× Linieneinsatz, für 2/3/4/5 gleiche):

| Symbol | 2 | 3 | 4 | 5 |
| --- | --- | --- | --- | --- |
| Kirsche, Zitrone, Orange | – | 8 | 20 | 64 |
| Pflaume | – | 13 | 32 | 96 |
| Glocke | – | 17 | 48 | 160 |
| Trauben, Melone | 3 | 24 | 64 | 240 |
| Sieben | – | 64 | 240 | 1.200 |

- **Stern = Scatter** (zählt überall): 3/4/5 Sterne zahlen 2/10/50× Gesamteinsatz und lösen **10/15/20 Freispiele** aus. In den Freispielen bleibt jeder Diamant bis zum Ende kleben. Sterne in Freispielen zahlen, lösen aber keine neuen Freispiele aus.
- **Risikospiel** nach jedem Gewinn: Farbe (rot/schwarz) verdoppelt, Symbol (♠ ♥ ♦ ♣) vervierfacht; falsch = alles weg. Höchstens 5 Mal, ab 500× Einsatz wird automatisch eingesammelt. Das Risikospiel ist fair (Quote 100 %), ändert also nichts an der Gesamtquote.
- Quote ca. 96 %. Server-RPCs: `sticky_spin`, `sticky_gamble`, `sticky_collect`.

## Weitere Spiele

### Multiplikator

| Spiel | Regeln | Auszahlung | Quote |
| --- | --- | --- | --- |
| **Wheel** | 20 Segmente, Risiko niedrig/mittel/hoch | niedrig: 0/1,2/1,5×; mittel: 0–3,2×; hoch: ein Feld 19,8× | 99 % |
| **Coinflip** | Kopf oder Zahl | 1,98× | 99 % |
| **Color Wheel** | 54 Felder: 24 grau, 15 rot, 9 blau, 5 grün, 1 gold; auf eine Farbe setzen | rot 3,5×, blau 5,8×, grün 10,5×, gold 52× | 96,3–97,2 % |
| **Bonus Wheel** | gewichtetes Rad | 0 / 0,5 / 1 / 1,5 / 2 / 3 / 5 / 10 / 25 / 50× | 98,9 % |
| **Goal Multiplier** | Elfmeter in eine von 3 Ecken, Torwart wählt zufällig | Tor 1,47× | 98 % |
| **Rocket Multiplier** | Zielmultiplikator 1,01×–1.000.000× (wie Limbo) | Ziel × Einsatz, wenn erreicht | 99 % |
| **Drop Ball** | Kugel fällt durch 10 Reihen in 11 Fächer | 11 / 4 / 1,9 / 1,2 / 0,75 / 0,5 / 0,75 / 1,2 / 1,9 / 4 / 11× | 97,9 % |

### Tischspiele und Würfel

| Spiel | Regeln | Auszahlung | Quote |
| --- | --- | --- | --- |
| **Sic Bo** | 3 Würfel, mehrere Einsätze pro Runde | Klein (4–10) / Groß (11–17) 2× (verliert bei Pasch-Drilling); Summe 4–17: 68 / 34 / 20 / 13,5 / 9,7 / 8,2 / 7,6× (symmetrisch); beliebiger Drilling 34×; bestimmter Drilling 205×; Einzelzahl 2/3/4× bei 1/2/3 Treffern | 92,6–97,2 % |
| **Poker Dice** | 5 Würfel | Fünfling 120×, Vierling 12×, Full House 5×, Straße 2,8×, Drilling 1,3×, Zwei Paare 0,75× | 97,8 % |
| **Dice Duel** | je 2 Würfel gegen das Haus, höhere Summe gewinnt | 1,95×, Gleichstand = Einsatz zurück | 97,8 % |

### Karten

| Spiel | Regeln | Auszahlung | Quote |
| --- | --- | --- | --- |
| **Baccarat** | Punto-Banco-Regeln (8 Decks, dritte Karte nach Tableau) | Spieler 2×, Bank 1,95×, Unentschieden 9×; bei Unentschieden Spieler/Bank-Einsatz zurück | 98,9 / 98,8 / 85,9 % |
| **Dragon Tiger** | je eine Karte, höhere gewinnt (Ass niedrig) | Dragon/Tiger 2×, Tie 12×; bei Tie halber Einsatz zurück | 96,2 / 92,3 % |
| **Andar Bahar** | Joker wird aufgedeckt, Karten abwechselnd auf Andar/Bahar, bis der Rang des Jokers fällt | Andar 1,9×, Bahar 2× | 97,8 / 97,0 % |
| **Card Duel** | je eine Karte gegen das Haus (Ass hoch) | 1,95×, Gleichstand = Einsatz zurück | 97,7 % |
| **Hi-Lo** | Nächste Karte höher oder niedriger? Gleicher Rang zählt als Treffer. Bis zu 5 Karten überspringen. Nach einem Treffer jederzeit auszahlen | pro Treffer × 0,99 / Trefferwahrscheinlichkeit | 99 % |
| **Video Poker** | Jacks or Better 9/6: 5 Karten, beliebige halten, einmal tauschen | Royal Flush 800×, Straight Flush 50×, Vierling 25×, Full House 9×, Flush 6×, Straße 4×, Drilling 3×, Zwei Paare 2×, Buben-Paar oder besser 1× | 99,5 % (optimale Strategie) |

### Raster

| Spiel | Regeln | Auszahlung | Quote |
| --- | --- | --- | --- |
| **Towers** | 8 Etagen, pro Etage ein sicheres Feld wählen. Leicht 4 Felder/1 Bombe, Mittel 3/1, Schwer 2/1, Experte 3/2. Jederzeit auszahlen | 0,99 × (Felder / sichere Felder)^Etagen | 99 % |
| **Gem Hunt** | wie Towers: 10 Etagen, 5 Felder, 1 Bombe | 0,99 × 1,25^Etagen | 99 % |
| **Treasure Grid** | 16 Kisten, 3 öffnen | Durchschnitt der 3 Kistenwerte × Einsatz (Werte: 5× 0, 0,2, 0,3, 2× 0,5, 0,8, 2× 1, 1,2, 1,5, 2,7, 6) | 98,1 % |
| **Safe Cracker** | einen von 6 Tresoren wählen | Inhalt 0 / 0 / 0,4 / 1 / 2 / 2,5× | 98,3 % |

### Slots

Alle Linien-Slots teilen den Einsatz gleichmäßig auf die Linien auf; Linienwerte gelten pro Linieneinsatz.

| Spiel | Regeln | Auszahlung | Quote |
| --- | --- | --- | --- |
| **Classic Slots** | 3 Walzen, eine Linie | 3× Sieben 400×, BAR 40×, Glocke 35×, Kirsche 30×, Zitrone 22×; 2 Kirschen links 5×, 1 Kirsche links 2× | 97,1 % |
| **Fruit Slots** | 3×3, 5 Linien (wie Shisha Slots) | Sieben 200×, Melone 50×, Pflaume 22×, Zitrone 13×, Kirsche 9×, 2 Kirschen 2×; Coin-Scatter 3/4/5+ = 5/15/50× Einsatz | nicht berechnet |
| **Neon Slots** | 5×3, 10 Linien, Wild ersetzt alles (5 Wilds = Krone) | für 3/4/5: A 4,3/17/43, K 5,2/21/52, Q 6,9/26/69, Stern 13/52/172, Blitz 26/103/430, Krone 69/344/1.720 | 96,4 % |
| **Cluster Slots** | 6×6, Gewinn ab 5 waagerecht/senkrecht verbundenen gleichen Steinen | × Gesamteinsatz für 5/6/7/8/9+: Rot 0,43–5,4, Blau 0,54–6,5, Grün 0,75–8,6, Lila 1,1–13, Gold 2,2–27 | 97,3 % |
| **Lucky Seven** | 3 Ziffern 0–9 | 777 200×, sonstiger Drilling 40×, zwei Siebenen 8×, eine Sieben 0,8× | 97,0 % |

### Lotterie

| Spiel | Regeln | Auszahlung | Quote |
| --- | --- | --- | --- |
| **Keno** | 1–10 Zahlen aus 40 wählen, 10 werden gezogen | Tabelle nach Anzahl gewählter Zahlen und Treffer, max. 1.000× | 98,8–99,1 % |
| **Number Draw** | 1–5 Zahlen aus 36, 6 werden gezogen | z. B. 1 aus 1: 5,8×; 5 aus 5: 2.600× | 96,7–98,3 % |
| **Digital Lottery** | genau 5 aus 30, 5 werden gezogen | 2 Treffer 1,5×, 3: 17×, 4: 230×, 5: 22.000× | 95,6 % |
| **Bingo** | 5×5-Karte (freie Mitte), 30 von 75 Kugeln | 1 Linie 4,9×, 2: 20×, 3: 120×, 4: 500×, 5+: 1.000× | 98,0 % |
| **Scratch Card** | 9 Felder, 3 gleiche gewinnen (nie zwei Dreier) | Blatt 1×, Kirsche 2×, Zitrone 3×, Glocke 5×, Stern 10×, Edelstein 20×, Sieben 50×, Coin 100× | 97,0 % |

Die vollständigen Auszahlungstabellen stehen in `game_configs.config` (Migration `20261009000006_more_games.sql`) und können im Admin-Bereich nicht verändert werden, nur Aktivierung und Einsatzlimits.

## Neue Spiele (Migration 16)

| Spiel | Regeln | Auszahlung | Quote |
| --- | --- | --- | --- |
| **Jackpot-Slot** | 3×3, 5 Linien wie Fruit Slots. 2 % jedes Einsatzes fließen in einen gemeinsamen Jackpot (Start 10.000, höchstens Maximalgewinn). Jackpot-Chance pro Spin = Einsatz ÷ 2.000.000 | Linien: Sieben 190×, Melone 47×, Pflaume 21×, Zitrone 12,6×, Kirsche 8,5× (je Linieneinsatz), 2 Kirschen 1,9×; Coin-Scatter 5/15/50× | ca. 93,5 % + Jackpot ≈ 95,5 % |
| **Pump** (Stake-Stil) | 25 Pump-Positionen, je nach Stufe platzen 1/3/5/10 davon. Nach jeder sicheren Pumpe auszahlbar | 0,98 × C(25,n) ÷ C(25−b,n) | 98 % |
| **Pferderennen** | 6 Pferde (Siegchance 30/22/18/13/10/7 %), auf eins setzen | 3,2 / 4,35 / 5,3 / 7,35 / 9,6 / 13,7× | ca. 96 % |
| **Hütchenspiel** | Kugel unter einem von 3 Bechern, Becher werden gemischt, Position tippen | 2,88× | 96 % |
| **Diamonds** (Stake-Stil) | 5 Edelsteine aus 7 Farben | 5 gleiche 50×, 4 gleiche 5×, Full House 4×, 3 gleiche 3×, 2 Paare 2×, 1 Paar 0,1× | ca. 98 % |

Für alle Spiele gilt der Maximalgewinn pro Runde (Standard 100.000 Credits, Admin → System).

## Duelle (Casino → Duelle)

- **Live-Duell:** Herausforderer wählt Gegner, Spiel (Würfel, Karten, Plinko, Münzwurf), 1 / Best of 3 / Best of 5 und Einsatz. Beide sitzen im Duell-Raum, tippen „Bereit“, dann laufen die Runden nach einem Countdown synchron auf beiden Geräten. Wer mehr Runden gewinnt, bekommt beide Einsätze. 50 : 50, kein Hausvorteil. Gleichstand in einer Runde wird neu ausgespielt.
- **Spiel-Duell:** Beide spielen 3/5/10/20 Runden im selben Casino-Spiel (z. B. Plinko, Mines, Crash). Wer prozentual mehr zurückholt (Auszahlung ÷ Einsatz), gewinnt. Gezählt werden die Runden nach der Annahme.
- Einsätze werden beim Erstellen/Annehmen reserviert. Ohne Beitritt (30 Min. live / 24 h Spiel-Duell), ohne Start im Raum (15 Min.) oder ohne fertige Runden (24 h) gibt es die Einsätze automatisch zurück. Raum verlassen = beide Einsätze zurück.
- Höchsteinsatz pro Duell: 5.000 Credits (`duel_max_stake`).

## Allgemeines

Autoplay ist nicht vorhanden. Offene mehrstufige Runden (Mines, Blackjack, Crash, Hi-Lo, Towers, Gem Hunt, Treasure Grid, Video Poker, Shisha-Diamonds-Risikospiel) werden nach einem Neuladen fortgesetzt; Crash-Runden ohne Cashout werden spätestens nach dem Crash automatisch (Cron) abgerechnet.

## Nachprüfbarkeit

Jede Runde speichert vorab SHA-256(Server-Seed). Nach Abschluss steht der Seed in der Runde (Historie → Details). Zufallswert i = erste 6 Byte von HMAC-SHA256(Seed, i) / 2⁴⁸.

## Neues Spiel ergänzen

- **Einzelrunde:** Rechenfunktion `shb_g_<spiel>(seed, params, config)` schreiben, die `mult` (Auszahlung / Gesamteinsatz) liefert, im `case` von `play_game` eintragen und per Migration einen `game_configs`-Eintrag mit `"engine":"simple","fn":"<spiel>"` anlegen.
- **Mehrstufig:** Zweig in `step_start` / `step_action` (ggf. `step_cashout`) ergänzen, `"engine":"step"`.
- Frontend: Komponente in `src/features/games/games/`, Eintrag in `GAME_COMPONENTS` (LobbyPage.tsx) und in `ACTIVE_GAMES`/Kachel-Metadaten (catalog.tsx).
- Quote vorher in `scripts/calibrate.mjs` nachrechnen; DB-Logik auf live nur in einem DO-Block testen, der mit `raise exception` endet (Vorlage `supabase/tests/sticky_test.sql`).
