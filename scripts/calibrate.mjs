// Berechnet die Auszahlungsquoten (RTP) der Spieltabellen exakt bzw. per Simulation.
// Aufruf: node scripts/calibrate.mjs
const C = (n, k) => {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
};
const out = (name, v) => console.log(name.padEnd(34), (v * 100).toFixed(2) + ' %');

// ---- Wheel: 20 Segmente
const wheel = {
  low: [1.5, 1.2, 1.2, 1.2, 0, 1.2, 1.2, 1.2, 1.2, 0, 1.5, 1.2, 1.2, 1.2, 0, 1.2, 1.2, 1.2, 1.2, 0],
  medium: [0, 2, 0, 1.6, 0, 2.1, 0, 1.6, 0, 3.2, 0, 1.9, 0, 2.1, 0, 1.6, 0, 1.7, 0, 2],
  high: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 19.8],
};
for (const [k, t] of Object.entries(wheel)) out('wheel ' + k, t.reduce((a, b) => a + b) / t.length);

// ---- Bonus Wheel: Gewichte
const bonus = [
  [0, 40.5], [0.5, 20], [1, 12], [1.5, 8], [2, 6], [3, 4], [5, 2.6], [10, 1], [25, 0.3], [50, 0.1],
];
const bw = bonus.reduce((a, [, w]) => a + w, 0);
out('bonus_wheel', bonus.reduce((a, [m, w]) => a + (m * w) / bw, 0));

// ---- Color Wheel: 54 Segmente
const colors = { grau: [24, 0], rot: [15, 3.5], blau: [9, 5.8], gruen: [5, 10.5], gold: [1, 52] };
for (const [k, [n, m]] of Object.entries(colors)) out('color_wheel ' + k, (n / 54) * m);

// ---- Keno: 40 Zahlen, 10 gezogen, 1–10 gewählt
const keno = {
  1: [0.7, 1.85],
  2: [0, 2, 3.8],
  3: [0, 1.1, 1.38, 26],
  4: [0, 0, 2.2, 7.9, 90],
  5: [0, 0, 1.5, 4.2, 13, 300],
  6: [0, 0, 1.1, 2, 6.2, 100, 700],
  7: [0, 0, 1.1, 1.6, 3.5, 15, 225, 700],
  8: [0, 0, 1.1, 1.5, 2, 5.5, 39, 100, 800],
  9: [0, 0, 1.1, 1.3, 1.7, 2.5, 7.5, 50, 250, 1000],
  10: [0, 0, 1.1, 1.2, 1.3, 1.8, 3.5, 13, 50, 250, 1000],
};
for (const [p, t] of Object.entries(keno)) {
  const k = Number(p);
  let ev = 0;
  for (let h = 0; h <= k; h++) ev += ((C(10, h) * C(30, k - h)) / C(40, k)) * (t[h] ?? 0);
  out('keno pick ' + k, ev);
}

// ---- Number Draw: 1–5 aus 36, 6 gezogen
const nd = { 1: [0, 5.8], 2: [0, 2, 17], 3: [0, 1, 5.5, 92], 4: [0, 0.5, 3, 30, 500], 5: [0, 0.4, 2, 12, 140, 2600] };
for (const [p, t] of Object.entries(nd)) {
  const k = Number(p);
  let ev = 0;
  for (let h = 0; h <= k; h++) ev += ((C(6, h) * C(30, k - h)) / C(36, k)) * (t[h] ?? 0);
  out('number_draw pick ' + k, ev);
}

// ---- Digital Lottery: 5 aus 30, 5 gezogen
const lot = [0, 0, 1.5, 17, 230, 22000];
{
  let ev = 0;
  for (let h = 0; h <= 5; h++) ev += ((C(5, h) * C(25, 5 - h)) / C(30, 5)) * lot[h];
  out('digital_lottery', ev);
}

// ---- Poker Dice: 5 Würfel
function pokerDiceHand(d) {
  const c = {};
  d.forEach((x) => (c[x] = (c[x] || 0) + 1));
  const v = Object.values(c).sort((a, b) => b - a);
  const s = [...d].sort().join('');
  if (v[0] === 5) return 'five';
  if (v[0] === 4) return 'four';
  if (v[0] === 3 && v[1] === 2) return 'full';
  if (s === '12345' || s === '23456') return 'straight';
  if (v[0] === 3) return 'three';
  if (v[0] === 2 && v[1] === 2) return 'twopair';
  return 'none';
}
const pdPay = { five: 120, four: 12, full: 5, straight: 2.8, three: 1.3, twopair: 0.75, none: 0 };
{
  let ev = 0;
  for (let i = 0; i < 7776; i++) {
    const d = [];
    let x = i;
    for (let j = 0; j < 5; j++) (d.push((x % 6) + 1), (x = Math.floor(x / 6)));
    ev += pdPay[pokerDiceHand(d)];
  }
  out('poker_dice', ev / 7776);
}

// ---- Lucky Seven: 3 Walzen mit Ziffern 0–9
{
  let ev = 0;
  for (let a = 0; a < 10; a++)
    for (let b = 0; b < 10; b++)
      for (let c = 0; c < 10; c++) {
        const s = [a, b, c].filter((x) => x === 7).length;
        let m = 0;
        if (s === 3) m = 200;
        else if (a === b && b === c) m = 40;
        else if (s === 2) m = 8;
        else if (s === 1) m = 0.8;
        ev += m;
      }
  out('lucky_seven', ev / 1000);
}

// ---- Classic Slots: 3 Walzen, 1 Linie, Gewichte
const classic = [
  ['bar', 8, 40], ['cherry', 10, 30], ['bell', 9, 35], ['seven', 3, 400], ['lemon', 12, 22], ['blank', 18, 0],
];
{
  const tw = classic.reduce((a, s) => a + s[1], 0);
  let ev = 0;
  for (const [, w, pay] of classic) ev += (w / tw) ** 3 * pay;
  const pc = 10 / tw;
  ev += pc * pc * (1 - pc) * 5 + pc * (1 - pc) * 2; // 2 Kirschen (Walze 1+2) 5×, 1 Kirsche (Walze 1) 2×
  out('classic_slots', ev);
}

// ---- Dice Duel / Card Duel / Coinflip / Dragon Tiger / Goal / Safe Cracker
{
  let w = 0, t = 0;
  for (let a = 2; a <= 12; a++) for (let b = 2; b <= 12; b++) {
    const pa = (6 - Math.abs(a - 7)) / 36, pb = (6 - Math.abs(b - 7)) / 36;
    if (a > b) w += pa * pb; else if (a === b) t += pa * pb;
  }
  out('dice_duel (1.95, push)', w * 1.95 + t);
}
out('card_duel (1.95, push)', (6 / 13) * 1.95 + 1 / 13);
out('coinflip 1.98', 0.5 * 1.98);
out('dragon_tiger side (2, tie halbe)', (6 / 13) * 2 + (1 / 13) * 0.5);
out('dragon_tiger tie 12x', (1 / 13) * 12);
out('goal 1.47 (2/3)', (2 / 3) * 1.47);
out('safe_cracker', [0, 0, 0.4, 1, 2, 2.5].reduce((a, b) => a + b) / 6);

// ---- Treasure Grid: 16 Felder, 3 Picks, Auszahlung = Mittelwert
out('treasure_grid', [0, 0, 0, 0, 0, 0.2, 0.3, 0.5, 0.5, 0.8, 1, 1, 1.2, 1.5, 2.7, 6].reduce((a, b) => a + b) / 16);

// ---- Scratch Card (Gewinntabelle)
const scratch = [[0, 101.7], [1, 15], [2, 9], [3, 5], [5, 4], [10, 2.5], [20, 1.2], [50, 0.25], [100, 0.05]];
{
  const tw = scratch.reduce((a, [, w]) => a + w, 0);
  out('scratch_card', scratch.reduce((a, [m, w]) => a + (m * w) / tw, 0));
}

// ---- Sic Bo
{
  let small = 0, big = 0, tot = {}, anyTriple = 0;
  for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) for (let c = 1; c <= 6; c++) {
    const s = a + b + c, triple = a === b && b === c;
    if (triple) anyTriple++;
    if (!triple && s >= 4 && s <= 10) small++;
    if (!triple && s >= 11 && s <= 17) big++;
    tot[s] = (tot[s] || 0) + 1;
  }
  out('sicbo small', (small / 216) * 2);
  out('sicbo any triple 34x', (anyTriple / 216) * 34);
  out('sicbo specific triple 205x', (1 / 216) * 205);
  const totPay = { 4: 68, 5: 34, 6: 20, 7: 13.5, 8: 9.7, 9: 8.2, 10: 7.6, 11: 7.6, 12: 8.2, 13: 9.7, 14: 13.5, 15: 20, 16: 34, 17: 68 };
  for (const [s, m] of Object.entries(totPay)) out('sicbo total ' + s, (tot[s] / 216) * m);
}

// ---- Andar Bahar (Simulation)
function rng() { return Math.random(); }
{
  let andar = 0, N = 400000;
  for (let i = 0; i < N; i++) {
    const deck = []; for (let c = 0; c < 52; c++) deck.push(c);
    for (let j = 51; j > 0; j--) { const k = Math.floor(rng() * (j + 1)); [deck[j], deck[k]] = [deck[k], deck[j]]; }
    const joker = deck[0] % 13;
    for (let j = 1; j < 52; j++) if (deck[j] % 13 === joker) { if (j % 2 === 1) andar++; break; }
  }
  const pa = andar / N;
  out('andar 1.9', pa * 1.9);
  out('bahar 2.0', (1 - pa) * 2.0);
}

// ---- Baccarat (Simulation, 8 Decks)
{
  const v = (c) => { const r = c % 13; return r >= 9 ? 0 : r + 1; };
  let p = 0, b = 0, t = 0, N = 400000;
  const shoe = []; for (let i = 0; i < 416; i++) shoe.push(i % 52);
  for (let i = 0; i < N; i++) {
    const draw = () => shoe[Math.floor(rng() * 416)];
    const P = [draw(), draw()], B = [draw(), draw()];
    const tot = (h) => h.reduce((a, c) => a + v(c), 0) % 10;
    let pt = tot(P), bt = tot(B);
    if (pt < 8 && bt < 8) {
      let p3 = null;
      if (pt <= 5) { p3 = draw(); P.push(p3); pt = tot(P); }
      const bDraw = p3 === null ? bt <= 5 : (() => { const x = v(p3); if (bt <= 2) return true; if (bt === 3) return x !== 8; if (bt === 4) return x >= 2 && x <= 7; if (bt === 5) return x >= 4 && x <= 7; if (bt === 6) return x === 6 || x === 7; return false; })();
      if (bDraw) { B.push(draw()); bt = tot(B); }
    }
    if (pt > bt) p++; else if (bt > pt) b++; else t++;
  }
  out('baccarat player 2x', (p / N) * 2 + t / N);
  out('baccarat banker 1.95x', (b / N) * 1.95 + t / N);
  out('baccarat tie 9x', (t / N) * 9);
}

// ---- Cluster Slots 6x6 (Simulation)
const clusterSyms = [['red', 26, [0, 0, 0, 0, 0, 0.43, 0.75, 1.3, 2.2, 5.4]], ['blue', 24, [0, 0, 0, 0, 0, 0.54, 0.97, 1.6, 2.7, 6.5]], ['green', 22, [0, 0, 0, 0, 0, 0.75, 1.3, 2.2, 3.8, 8.6]], ['purple', 16, [0, 0, 0, 0, 0, 1.1, 1.9, 3.2, 5.4, 13]], ['gold', 12, [0, 0, 0, 0, 0, 2.2, 3.8, 6.5, 11, 27]]];
function clusterPay(grid) {
  const seen = new Array(36).fill(false);
  let total = 0;
  for (let i = 0; i < 36; i++) {
    if (seen[i]) continue;
    const s = grid[i], stack = [i], cells = [];
    seen[i] = true;
    while (stack.length) {
      const c = stack.pop(); cells.push(c);
      const r = Math.floor(c / 6), q = c % 6;
      for (const [dr, dq] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nr = r + dr, nq = q + dq, n = nr * 6 + nq;
        if (nr < 0 || nr > 5 || nq < 0 || nq > 5 || seen[n] || grid[n] !== s) continue;
        seen[n] = true; stack.push(n);
      }
    }
    if (cells.length >= 5) { const t = clusterSyms.find((x) => x[0] === s)[2]; total += t[Math.min(cells.length, 9)]; }
  }
  return total;
}
{
  const tw = clusterSyms.reduce((a, s) => a + s[1], 0);
  let ev = 0, N = 200000;
  for (let i = 0; i < N; i++) {
    const g = [];
    for (let j = 0; j < 36; j++) { let x = rng() * tw; for (const s of clusterSyms) { if ((x -= s[1]) < 0) { g.push(s[0]); break; } } }
    ev += clusterPay(g);
  }
  out('cluster_slots', ev / N);
}

// ---- Neon Slots 5x3, 10 Linien (Simulation)
const neonSyms = [['n_a', 30, [0, 0, 4.3, 17, 43]], ['n_k', 26, [0, 0, 5.2, 21, 52]], ['n_q', 22, [0, 0, 6.9, 26, 69]], ['n_star', 14, [0, 0, 13, 52, 172]], ['n_bolt', 9, [0, 0, 26, 103, 430]], ['n_crown', 4, [0, 0, 69, 344, 1720]], ['n_wild', 4, null]];
const neonLines = [[1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2], [0, 1, 2, 1, 0], [2, 1, 0, 1, 2], [0, 0, 1, 2, 2], [2, 2, 1, 0, 0], [1, 0, 0, 0, 1], [1, 2, 2, 2, 1], [0, 1, 1, 1, 0]];
function neonPay(g) {
  let tot = 0;
  for (const line of neonLines) {
    const syms = line.map((row, reel) => g[row * 5 + reel]);
    let base = syms.find((s) => s !== 'n_wild') ?? 'n_crown';
    let n = 0;
    for (const s of syms) { if (s === base || s === 'n_wild') n++; else break; }
    if (n >= 3) tot += neonSyms.find((x) => x[0] === base)[2][n - 1] / 10;
  }
  return tot;
}
{
  const tw = neonSyms.reduce((a, s) => a + s[1], 0);
  let ev = 0, N = 300000;
  for (let i = 0; i < N; i++) {
    const g = [];
    for (let j = 0; j < 15; j++) { let x = rng() * tw; for (const s of neonSyms) { if ((x -= s[1]) < 0) { g.push(s[0]); break; } } }
    ev += neonPay(g);
  }
  out('neon_slots', ev / N);
}

// ---- Shisha Diamonds 5x3, 10 Linien + Hold & Spin (Simulation)
const sdSyms = [['sd_mint', 30, [0, 0, 9.2, 28, 74]], ['sd_lemon', 26, [0, 0, 11, 37, 92]], ['sd_plum', 22, [0, 0, 14, 47, 128]], ['sd_bell', 14, [0, 0, 28, 92, 277]], ['sd_seven', 6, [0, 0, 74, 277, 1108]], ['sd_diamond', 18, null]];
const sdValues = [[2, 40], [4, 25], [6, 15], [10, 10], [20, 6], [50, 3], [100, 1]]; // × Einsatz/10
function sdSpin() {
  const tw = sdSyms.reduce((a, s) => a + s[1], 0);
  const g = [];
  for (let j = 0; j < 15; j++) { let x = rng() * tw; for (const s of sdSyms) { if ((x -= s[1]) < 0) { g.push(s[0]); break; } } }
  return g;
}
function sdValue() { const tw = sdValues.reduce((a, v) => a + v[1], 0); let x = rng() * tw; for (const [v, w] of sdValues) if ((x -= w) < 0) return v; return 1; }
let sdFeat = 0, sdTrig = 0;
function sdPlay() {
  const g = sdSpin();
  let tot = 0;
  for (const line of neonLines) {
    const syms = line.map((row, reel) => g[row * 5 + reel]);
    const base = syms[0];
    if (base === 'sd_diamond') continue;
    let n = 0; for (const s of syms) { if (s === base) n++; else break; }
    if (n >= 3) tot += sdSyms.find((x) => x[0] === base)[2][n - 1] / 10;
  }
  const dia = g.map((s) => (s === 'sd_diamond' ? sdValue() : 0));
  if (dia.filter(Boolean).length >= 6) {
    let spins = 3;
    while (spins > 0) {
      let hit = false;
      for (let i = 0; i < 15; i++) if (!dia[i] && rng() < 0.085) { dia[i] = sdValue(); hit = true; }
      spins = hit ? 3 : spins - 1;
      if (dia.every(Boolean)) break;
    }
    const f = dia.reduce((a, b) => a + b, 0) / 10 + (dia.every(Boolean) ? 100 : 0);
    tot += f; sdFeat += f; sdTrig++;
  }
  return tot;
}
{
  let ev = 0, N = 300000;
  for (let i = 0; i < N; i++) ev += sdPlay();
  out('shisha_diamonds', ev / N);
  out('  davon Feature', sdFeat / N);
  out('  Feature-Häufigkeit', sdTrig / N);
}

// ---- Drop Ball: 10 Reihen
const drop = [11, 4, 1.9, 1.2, 0.75, 0.5, 0.75, 1.2, 1.9, 4, 11];
out('drop_ball', drop.reduce((a, m, k) => a + (m * C(10, k)) / 1024, 0));

// ---- Video Poker Jacks or Better 9/6 (bekannt 99,54 %)
console.log('video_poker 9/6 Jacks or Better'.padEnd(34), '99.54 % (optimale Strategie)');
// ---- Hi-Lo / Towers / Gem Hunt: Multiplikator je Schritt = 0,99 / Gewinnwahrscheinlichkeit
console.log('hilo / towers / gem_hunt'.padEnd(34), '99.00 % pro Schritt');

// ---- Bingo: 5x5-Karte (Spalten B 1–15, I 16–30, …), freie Mitte, 30 von 75 Kugeln
const bingoPay = [0, 4.9, 20, 120, 500, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000];
function bingoLines(marked) {
  const L = [];
  for (let r = 0; r < 5; r++) L.push([0, 1, 2, 3, 4].map((c) => r * 5 + c));
  for (let c = 0; c < 5; c++) L.push([0, 1, 2, 3, 4].map((r) => r * 5 + c));
  L.push([0, 6, 12, 18, 24], [4, 8, 12, 16, 20]);
  return L.filter((l) => l.every((i) => marked[i])).length;
}
{
  let ev = 0, N = 300000;
  const dist = {};
  for (let i = 0; i < N; i++) {
    const card = [];
    for (let c = 0; c < 5; c++) {
      const col = Array.from({ length: 15 }, (_, k) => c * 15 + k + 1);
      for (let j = 14; j > 0; j--) { const k = Math.floor(rng() * (j + 1)); [col[j], col[k]] = [col[k], col[j]]; }
      for (let r = 0; r < 5; r++) card[r * 5 + c] = col[r];
    }
    const balls = Array.from({ length: 75 }, (_, k) => k + 1);
    for (let j = 74; j > 0; j--) { const k = Math.floor(rng() * (j + 1)); [balls[j], balls[k]] = [balls[k], balls[j]]; }
    const drawn = new Set(balls.slice(0, 30));
    const marked = card.map((n, idx) => idx === 12 || drawn.has(n));
    const l = bingoLines(marked);
    dist[l] = (dist[l] || 0) + 1;
    ev += bingoPay[l];
  }
  out('bingo', ev / N);
  console.log('  Linien-Verteilung', Object.fromEntries(Object.entries(dist).map(([k, v]) => [k, (v / N).toFixed(5)])));
}
