import { SlotSymbol } from './games/SlotSymbols';
// Katalog-Metadaten und eigene Kachel-Grafiken (SVG) für alle Spiele.
import type { ReactNode } from 'react';

export const ACTIVE_GAMES = [
  'shisha_diamonds', 'roulette', 'blackjack', 'crash', 'plinko', 'mines', 'dice', 'limbo', 'slots',
  'wheel', 'coinflip', 'hilo', 'towers', 'keno', 'video_poker', 'baccarat', 'neon_slots', 'cluster_slots', 'fruit_slots', 'classic_slots',
  'sicbo', 'dragon_tiger', 'andar_bahar', 'bingo', 'scratch_card', 'color_wheel', 'bonus_wheel', 'gem_hunt', 'treasure_grid', 'safe_cracker',
  'lucky_seven', 'poker_dice', 'dice_duel', 'card_duel', 'number_draw', 'digital_lottery', 'goal_multiplier', 'rocket_multiplier', 'drop_ball',
  'jackpot_slot', 'pump', 'horse_race', 'shell_game', 'diamonds',
] as const;
export type ActiveGameKey = (typeof ACTIVE_GAMES)[number];

export const CATEGORY_LABELS: Record<string, string> = {
  table: 'Tischspiele',
  multiplier: 'Multiplikator',
  grid: 'Raster',
  slots: 'Slots',
  cards: 'Karten',
  lottery: 'Lotterie',
};

export const GAME_TAGLINES: Record<string, string> = {
  roulette: 'Europäisch · eine Null',
  blackjack: 'Dealer steht auf 17',
  crash: 'Rechtzeitig aussteigen',
  plinko: 'Kugel trifft Multiplikator',
  mines: 'Felder aufdecken, Minen meiden',
  dice: 'Über oder unter dem Ziel',
  limbo: 'Zielmultiplikator knacken',
  slots: 'Shisha Slots · 5 Linien',
  shisha_diamonds: 'Sticky Wilds in den Freispielen',
  wheel: 'Glücksrad mit 3 Risikostufen',
  coinflip: 'Kopf oder Zahl',
  hilo: 'Höher oder niedriger?',
  towers: 'Klettere den Turm hinauf',
  keno: '10 aus 40',
  video_poker: 'Jacks or Better',
  baccarat: 'Spieler, Bank, Unentschieden',
  neon_slots: '5 Walzen · Wilds',
  cluster_slots: 'Edelstein-Cluster',
  fruit_slots: 'Früchte · 5 Linien',
  classic_slots: 'Drei Walzen, eine Linie',
  sicbo: 'Drei Würfel, viele Wetten',
  dragon_tiger: 'Die höhere Karte gewinnt',
  andar_bahar: 'Wo landet der Joker?',
  bingo: '5×5-Karte, 30 Kugeln',
  scratch_card: 'Drei gleiche gewinnen',
  color_wheel: 'Setz auf eine Farbe',
  bonus_wheel: 'Bis zu 50×',
  gem_hunt: 'Edelsteinsuche',
  treasure_grid: 'Öffne drei Kisten',
  safe_cracker: 'Welcher Tresor?',
  lucky_seven: 'Jede 7 zählt',
  poker_dice: 'Poker mit Würfeln',
  dice_duel: 'Würfel gegen das Haus',
  card_duel: 'Karte gegen das Haus',
  number_draw: '6 aus 36',
  digital_lottery: '5 aus 30',
  goal_multiplier: 'Elfmeter',
  rocket_multiplier: 'Wie hoch fliegt sie?',
  drop_ball: 'Pachinko-Style',
  jackpot_slot: 'Gemeinsamer Jackpot-Topf',
  pump: 'Pump, bis es knallt',
  horse_race: '6 Pferde, eine Siegerin',
  shell_game: 'Wo ist die Kugel?',
  diamonds: '5 Edelsteine, ein Muster',
};

const PALETTES: Record<string, [string, string]> = {
  roulette: ['#3b1d1d', '#7f1d1d'],
  blackjack: ['#0f2e22', '#14532d'],
  crash: ['#1b1440', '#4c1d95'],
  plinko: ['#11253f', '#1d4ed8'],
  mines: ['#2a2410', '#854d0e'],
  dice: ['#10263a', '#0e7490'],
  limbo: ['#2d1238', '#86198f'],
  slots: ['#2b1d08', '#b45309'],
  shisha_diamonds: ['#082f49', '#0369a1'],
  wheel: ['#1e1b4b', '#7c3aed'],
  coinflip: ['#2b1d08', '#a16207'],
  hilo: ['#0f2e22', '#166534'],
  towers: ['#1f2937', '#4b5563'],
  keno: ['#1e1b4b', '#4338ca'],
  video_poker: ['#0f2e22', '#065f46'],
  baccarat: ['#3b0d0d', '#991b1b'],
  neon_slots: ['#0b0b1e', '#6d28d9'],
  cluster_slots: ['#1a1033', '#9333ea'],
  fruit_slots: ['#14290f', '#15803d'],
  classic_slots: ['#2b1d08', '#78350f'],
  sicbo: ['#3b0d0d', '#b91c1c'],
  dragon_tiger: ['#3a1206', '#c2410c'],
  andar_bahar: ['#2a1438', '#a21caf'],
  bingo: ['#0c2a3a', '#0e7490'],
  scratch_card: ['#1f2937', '#64748b'],
  color_wheel: ['#1e293b', '#db2777'],
  bonus_wheel: ['#2b1d08', '#ca8a04'],
  gem_hunt: ['#062b26', '#0f766e'],
  treasure_grid: ['#2b1d08', '#92400e'],
  safe_cracker: ['#111827', '#374151'],
  lucky_seven: ['#3b0d0d', '#dc2626'],
  poker_dice: ['#10263a', '#1d4ed8'],
  dice_duel: ['#10263a', '#0891b2'],
  card_duel: ['#0f2e22', '#15803d'],
  number_draw: ['#1e1b4b', '#2563eb'],
  digital_lottery: ['#0c2a3a', '#0284c7'],
  goal_multiplier: ['#052e16', '#16a34a'],
  rocket_multiplier: ['#0b1026', '#4c1d95'],
  drop_ball: ['#11253f', '#1e40af'],
  jackpot_slot: ['#3b0764', '#a21caf'],
  pump: ['#4c0519', '#e11d48'],
  horse_race: ['#052e16', '#15803d'],
  shell_game: ['#3b0d0d', '#b91c1c'],
  diamonds: ['#0c1a3a', '#4f46e5'],
};

const EXTRA_ART: Record<string, { glyph?: string; symbol?: string; color?: string; size?: number; caption?: string }> = {
  shisha_diamonds: { symbol: 'sd_diamond', caption: 'STICKY WILDS' },
  wheel: { glyph: '◎', size: 60, caption: 'WHEEL' },
  coinflip: { symbol: 'coin', caption: 'KOPF / ZAHL' },
  hilo: { glyph: '↑↓', caption: 'HÖHER · NIEDRIGER' },
  towers: { glyph: '▥', size: 56, color: '#e2e8f0', caption: 'TOWERS' },
  keno: { glyph: '10/40', size: 26, color: '#c7d2fe', caption: 'KENO' },
  video_poker: { glyph: 'A♠', color: '#fff', caption: 'JACKS OR BETTER' },
  baccarat: { glyph: '9', size: 56, color: '#fecaca', caption: 'BACCARAT' },
  neon_slots: { symbol: 'n_bolt', caption: 'NEON' },
  cluster_slots: { symbol: 'c_purple', caption: 'CLUSTER' },
  fruit_slots: { symbol: 'melon', caption: 'FRUITS' },
  classic_slots: { symbol: 'bar', caption: 'CLASSIC' },
  sicbo: { glyph: '⚂⚄⚅', size: 34, color: '#fff', caption: 'SIC BO' },
  dragon_tiger: { glyph: 'D·T', size: 36, color: '#fed7aa', caption: 'DRAGON TIGER' },
  andar_bahar: { glyph: 'A|B', size: 36, color: '#f5d0fe', caption: 'ANDAR BAHAR' },
  bingo: { glyph: 'BINGO', size: 26, color: '#a5f3fc' },
  scratch_card: { symbol: 'star', caption: 'RUBBELLOS' },
  color_wheel: { glyph: '●●●', size: 30, color: '#f9a8d4', caption: 'COLOR WHEEL' },
  bonus_wheel: { glyph: '50×', size: 40, caption: 'BONUS WHEEL' },
  gem_hunt: { symbol: 'c_green', caption: 'GEM HUNT' },
  treasure_grid: { glyph: '?', size: 60, caption: 'SCHATZKISTEN' },
  safe_cracker: { glyph: '◉', size: 56, color: '#e5e7eb', caption: 'SAFE CRACKER' },
  lucky_seven: { symbol: 'seven', caption: 'LUCKY 7' },
  poker_dice: { glyph: '⚀⚁⚂', size: 34, color: '#fff', caption: 'POKER DICE' },
  dice_duel: { glyph: '⚄ vs ⚅', size: 28, color: '#fff', caption: 'DICE DUEL' },
  card_duel: { glyph: 'K vs Q', size: 28, color: '#fff', caption: 'CARD DUEL' },
  number_draw: { glyph: '6/36', size: 30, color: '#bfdbfe', caption: 'NUMBER DRAW' },
  digital_lottery: { glyph: '5/30', size: 30, color: '#bae6fd', caption: 'LOTTERY' },
  goal_multiplier: { glyph: '1:0', size: 42, color: '#fff', caption: 'GOAL' },
  rocket_multiplier: { glyph: '▲', size: 52, color: '#e2e8f0', caption: 'ROCKET' },
  drop_ball: { glyph: '●', size: 40, color: '#f3c969', caption: 'DROP BALL' },
  jackpot_slot: { symbol: 'seven', caption: 'JACKPOT' },
  pump: { glyph: '🎈', size: 52, caption: 'PUMP' },
  horse_race: { glyph: '🏇', size: 52, caption: 'PFERDERENNEN' },
  shell_game: { glyph: '🥤🥤🥤', size: 30, caption: 'HÜTCHENSPIEL' },
  diamonds: { glyph: '💎', size: 52, caption: 'DIAMONDS' },
};

function Frame({ gameKey, children }: { gameKey: string; children: ReactNode }) {
  const [a, b] = PALETTES[gameKey] ?? ['#1a1e2a', '#252a38'];
  const id = `g-${gameKey}`;
  return (
    <svg viewBox="0 0 160 120" role="img" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={a} />
          <stop offset="1" stopColor={b} />
        </linearGradient>
      </defs>
      <rect width="160" height="120" fill={`url(#${id})`} />
      <circle cx="140" cy="10" r="50" fill="#fff" opacity=".04" />
      {children}
    </svg>
  );
}

export function GameArt({ gameKey }: { gameKey: string }) {
  switch (gameKey) {
    case 'roulette':
      return (
        <Frame gameKey={gameKey}>
          <circle cx="80" cy="60" r="40" fill="#1a0f0f" stroke="#d8a84e" strokeWidth="3" />
          {Array.from({ length: 18 }).map((_, i) => {
            const a1 = (i / 18) * Math.PI * 2;
            const a2 = ((i + 1) / 18) * Math.PI * 2;
            return (
              <path
                key={i}
                d={`M80 60 L${80 + 36 * Math.cos(a1)} ${60 + 36 * Math.sin(a1)} A36 36 0 0 1 ${80 + 36 * Math.cos(a2)} ${60 + 36 * Math.sin(a2)}Z`}
                fill={i === 0 ? '#15803d' : i % 2 ? '#b91c1c' : '#111827'}
              />
            );
          })}
          <circle cx="80" cy="60" r="16" fill="#d8a84e" />
          <circle cx="80" cy="60" r="7" fill="#7a5418" />
          <circle cx="104" cy="38" r="4" fill="#f8fafc" />
        </Frame>
      );
    case 'blackjack':
      return (
        <Frame gameKey={gameKey}>
          <g transform="rotate(-12 64 62)">
            <rect x="40" y="28" width="44" height="62" rx="6" fill="#f8fafc" />
            <text x="48" y="48" fontSize="16" fontWeight="800" fill="#111827" fontFamily="Inter">A</text>
            <text x="62" y="76" fontSize="22" fill="#111827">♠</text>
          </g>
          <g transform="rotate(10 96 62)">
            <rect x="76" y="30" width="44" height="62" rx="6" fill="#f8fafc" />
            <text x="84" y="50" fontSize="16" fontWeight="800" fill="#b91c1c" fontFamily="Inter">K</text>
            <text x="98" y="78" fontSize="22" fill="#b91c1c">♥</text>
          </g>
          <text x="80" y="112" textAnchor="middle" fontSize="12" fontWeight="800" fill="#f3c969" fontFamily="JetBrains Mono">21</text>
        </Frame>
      );
    case 'crash':
      return (
        <Frame gameKey={gameKey}>
          <path d="M14 104 C60 100 96 80 140 22" stroke="#f3c969" strokeWidth="4" fill="none" strokeLinecap="round" />
          <path d="M14 104 C60 100 96 80 140 22 L140 110 L14 110Z" fill="#f3c969" opacity=".12" />
          <circle cx="140" cy="22" r="7" fill="#fff6d8" />
          <text x="22" y="34" fontSize="18" fontWeight="800" fill="#fff" fontFamily="JetBrains Mono">4.20×</text>
        </Frame>
      );
    case 'plinko':
      return (
        <Frame gameKey={gameKey}>
          {Array.from({ length: 5 }).map((_, r) =>
            Array.from({ length: r + 3 }).map((__, c) => (
              <circle key={`${r}-${c}`} cx={80 - (r + 2) * 9 + c * 18} cy={22 + r * 16} r="2.6" fill="#cbd5e1" />
            )),
          )}
          <circle cx="86" cy="46" r="5.5" fill="#f3c969" />
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <rect key={i} x={20 + i * 17.5} y="100" width="15" height="12" rx="3" fill={i === 3 ? '#475569' : i === 0 || i === 6 ? '#d8a84e' : '#3b82f6'} />
          ))}
        </Frame>
      );
    case 'mines':
      return (
        <Frame gameKey={gameKey}>
          {Array.from({ length: 16 }).map((_, i) => {
            const x = 36 + (i % 4) * 23;
            const y = 14 + Math.floor(i / 4) * 23;
            const gem = i === 5 || i === 10 || i === 3;
            const mine = i === 12;
            return (
              <g key={i}>
                <rect x={x} y={y} width="20" height="20" rx="4" fill={gem ? '#14532d' : mine ? '#7f1d1d' : '#334155'} />
                {gem && <path d={`M${x + 10} ${y + 4} l5 5 -5 7 -5 -7z`} fill="#4ade80" />}
                {mine && <circle cx={x + 10} cy={y + 10} r="5" fill="#111" stroke="#f87171" strokeWidth="1.5" />}
              </g>
            );
          })}
        </Frame>
      );
    case 'dice':
      return (
        <Frame gameKey={gameKey}>
          <rect x="50" y="30" width="60" height="60" rx="12" fill="#f8fafc" transform="rotate(-8 80 60)" />
          {[
            [64, 44],
            [80, 60],
            [96, 76],
            [96, 44],
            [64, 76],
          ].map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r="5" fill="#0e7490" transform="rotate(-8 80 60)" />
          ))}
          <rect x="16" y="104" width="128" height="6" rx="3" fill="#1e293b" />
          <rect x="16" y="104" width="76" height="6" rx="3" fill="#22c55e" />
        </Frame>
      );
    case 'limbo':
      return (
        <Frame gameKey={gameKey}>
          <circle cx="80" cy="58" r="34" fill="none" stroke="#f0abfc" strokeWidth="2" opacity=".5" />
          <circle cx="80" cy="58" r="24" fill="none" stroke="#f0abfc" strokeWidth="2" opacity=".35" />
          <text x="80" y="66" textAnchor="middle" fontSize="22" fontWeight="800" fill="#fff" fontFamily="JetBrains Mono">
            2.00×
          </text>
          <text x="80" y="106" textAnchor="middle" fontSize="10" fontWeight="700" fill="#f3c969" fontFamily="Inter" letterSpacing="2">
            ZIEL
          </text>
        </Frame>
      );
    case 'slots':
      return (
        <Frame gameKey={gameKey}>
          <rect x="22" y="24" width="116" height="72" rx="10" fill="#1c1408" stroke="#d8a84e" strokeWidth="2.5" />
          {[0, 1, 2].map((i) => (
            <g key={i}>
              <rect x={30 + i * 36} y="32" width="30" height="56" rx="5" fill="#f8fafc" />
              <text x={45 + i * 36} y="68" textAnchor="middle" fontSize="22" fontWeight="900" fill="#b91c1c" fontFamily="Inter">
                7
              </text>
            </g>
          ))}
          <rect x="22" y="58" width="116" height="2" fill="#f3c969" opacity=".7" />
        </Frame>
      );
    default: {
      const art = EXTRA_ART[gameKey];
      if (art) {
        return (
          <Frame gameKey={gameKey}>
            <circle cx="80" cy="58" r="40" fill="#000" opacity=".18" />
            {art.symbol ? (
              <g transform="translate(48 26)">
                <SlotSymbol symbol={art.symbol} size={64} />
              </g>
            ) : (
              <text x="80" y="76" textAnchor="middle" fontSize={art.size ?? 44} fontWeight="900" fill={art.color ?? '#f3c969'} fontFamily="JetBrains Mono, Inter">
                {art.glyph}
              </text>
            )}
            {art.caption && (
              <text x="80" y="110" textAnchor="middle" fontSize="10" fontWeight="800" fill="#fff" opacity=".85" fontFamily="Inter" letterSpacing="2">
                {art.caption}
              </text>
            )}
          </Frame>
        );
      }
      const label = gameKey.replace(/_/g, ' ').slice(0, 12).toUpperCase();
      return (
        <Frame gameKey={gameKey}>
          <rect x="30" y="30" width="100" height="60" rx="12" fill="none" stroke="#3b4256" strokeWidth="2" strokeDasharray="5 5" />
          <text x="80" y="65" textAnchor="middle" fontSize="11" fontWeight="700" fill="#6b7280" fontFamily="Inter" letterSpacing="1">
            {label}
          </text>
        </Frame>
      );
    }
  }
}
