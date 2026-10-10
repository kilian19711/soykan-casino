// Eigene Slot-Symbole als SVG (keine fremden Grafiken).
export const SLOT_SYMBOL_NAMES: Record<string, string> = {
  cherry: 'Kirschen', leaf: 'Minzblatt', bell: 'Glocke', gem: 'Saphir', seven: 'Sieben', coin: 'Coin (Bonus)',
  star: 'Stern', lemon: 'Zitrone', plum: 'Pflaume', melon: 'Melone', bar: 'BAR', blank: 'Leer',
  n_a: 'Neon A', n_k: 'Neon K', n_q: 'Neon Q', n_star: 'Neon-Stern', n_bolt: 'Blitz', n_crown: 'Krone', n_wild: 'Wild',
  c_red: 'Rubin', c_blue: 'Saphir', c_green: 'Smaragd', c_purple: 'Amethyst', c_gold: 'Goldnugget',
  sd_mint: 'Minze', sd_lemon: 'Zitrone', sd_plum: 'Pflaume', sd_bell: 'Glocke', sd_seven: 'Sieben', sd_diamond: 'Diamant',
};

const ALIAS: Record<string, string> = { sd_mint: 'leaf', sd_lemon: 'lemon', sd_plum: 'plum', sd_bell: 'bell', sd_seven: 'seven' };

function Gem({ color, light }: { color: string; light: string }) {
  return (
    <>
      <path d="M14 22 24 10h16l10 12-18 32Z" fill={color} />
      <path d="M14 22h36L32 54Z" fill={color} opacity=".75" />
      <path d="M24 10l-4 12h24l-4-12M32 22v32" stroke={light} strokeWidth="1.6" fill="none" />
    </>
  );
}

function NeonLetter({ ch, color }: { ch: string; color: string }) {
  return (
    <>
      <rect x="6" y="6" width="52" height="52" rx="12" fill="#0b0b1e" stroke={color} strokeWidth="2.5" />
      <text x="32" y="44" textAnchor="middle" fontFamily="Inter, Arial" fontWeight="900" fontSize="30" fill={color}
        style={{ filter: `drop-shadow(0 0 4px ${color})` }}>{ch}</text>
    </>
  );
}

export function SlotSymbol({ symbol, size = 56, value }: { symbol: string; size?: number; value?: number }) {
  const key = ALIAS[symbol] ?? symbol;
  const common = { width: size, height: size, viewBox: '0 0 64 64', role: 'img' as const, 'aria-label': SLOT_SYMBOL_NAMES[symbol] ?? symbol };
  switch (key) {
    case 'cherry':
      return (
        <svg {...common}>
          <path d="M32 10c-4 10-12 18-14 28M32 10c3 10 8 18 16 26" stroke="#15803d" strokeWidth="3.5" fill="none" strokeLinecap="round" />
          <path d="M32 10c6-4 14-3 18 2-6 3-12 3-18-2Z" fill="#22c55e" />
          <circle cx="18" cy="44" r="11" fill="#dc2626" />
          <circle cx="46" cy="42" r="11" fill="#b91c1c" />
          <circle cx="14" cy="40" r="3" fill="#fecaca" opacity=".8" />
          <circle cx="42" cy="38" r="3" fill="#fecaca" opacity=".8" />
        </svg>
      );
    case 'leaf':
      return (
        <svg {...common}>
          <path d="M32 6C14 18 12 40 32 58 52 40 50 18 32 6Z" fill="#16a34a" />
          <path d="M32 10v46M32 22l-9-6M32 30l11-7M32 38l-11-6M32 46l10-6" stroke="#bbf7d0" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case 'bell':
      return (
        <svg {...common}>
          <path d="M32 8c-11 0-17 9-17 20v10l-5 8h44l-5-8V28c0-11-6-20-17-20Z" fill="#f59e0b" stroke="#92400e" strokeWidth="2" />
          <circle cx="32" cy="52" r="5" fill="#92400e" />
          <path d="M22 22c2-6 6-8 10-8" stroke="#fde68a" strokeWidth="3" fill="none" strokeLinecap="round" />
        </svg>
      );
    case 'gem':
      return <svg {...common}><Gem color="#2563eb" light="#bfdbfe" /></svg>;
    case 'seven':
      return (
        <svg {...common}>
          <rect x="6" y="6" width="52" height="52" rx="10" fill="#1c1408" stroke="#d8a84e" strokeWidth="2.5" />
          <path d="M18 16h28l-14 34" stroke="#ef4444" strokeWidth="8" fill="none" strokeLinejoin="round" strokeLinecap="round" />
          <path d="M18 16h28l-14 34" stroke="#fca5a5" strokeWidth="2" fill="none" strokeLinejoin="round" opacity=".6" />
        </svg>
      );
    case 'coin':
      return (
        <svg {...common}>
          <circle cx="32" cy="32" r="27" fill="#7a5418" />
          <circle cx="32" cy="32" r="24" fill="#f3c969" />
          <circle cx="32" cy="32" r="19" fill="none" stroke="#a87a2a" strokeWidth="1.5" strokeDasharray="2 3" />
          <text x="32" y="38" textAnchor="middle" fontFamily="Inter, Arial" fontWeight="800" fontSize="15" fill="#2a1c06">SHB</text>
        </svg>
      );
    case 'star':
      return (
        <svg {...common}>
          <path d="M32 6l7.6 16.6L58 24.6 44.4 37l3.6 18L32 46.2 16 55l3.6-18L6 24.6l18.4-2Z" fill="#facc15" stroke="#a16207" strokeWidth="2" />
        </svg>
      );
    case 'lemon':
      return (
        <svg {...common}>
          <ellipse cx="32" cy="34" rx="22" ry="16" fill="#facc15" stroke="#a16207" strokeWidth="2" transform="rotate(-20 32 34)" />
          <path d="M44 18c4-4 9-4 12-2" stroke="#15803d" strokeWidth="3" fill="none" strokeLinecap="round" />
          <ellipse cx="26" cy="30" rx="6" ry="3" fill="#fef9c3" opacity=".7" transform="rotate(-20 26 30)" />
        </svg>
      );
    case 'plum':
      return (
        <svg {...common}>
          <circle cx="32" cy="36" r="20" fill="#7c3aed" />
          <path d="M32 16c0-6 4-9 8-10" stroke="#15803d" strokeWidth="3" fill="none" strokeLinecap="round" />
          <path d="M32 18v36" stroke="#5b21b6" strokeWidth="2" opacity=".6" />
          <circle cx="24" cy="30" r="4" fill="#ddd6fe" opacity=".6" />
        </svg>
      );
    case 'melon':
      return (
        <svg {...common}>
          <path d="M6 24a26 26 0 0 0 52 0Z" fill="#16a34a" />
          <path d="M10 24a22 22 0 0 0 44 0Z" fill="#ef4444" />
          {[18, 26, 32, 38, 46].map((x, i) => <ellipse key={i} cx={x} cy={i % 2 ? 34 : 30} rx="1.6" ry="2.6" fill="#111" />)}
        </svg>
      );
    case 'bar':
      return (
        <svg {...common}>
          <rect x="6" y="18" width="52" height="28" rx="6" fill="#111827" stroke="#f3c969" strokeWidth="2.5" />
          <text x="32" y="39" textAnchor="middle" fontFamily="Inter, Arial" fontWeight="900" fontSize="18" fill="#f3c969">BAR</text>
        </svg>
      );
    case 'blank':
      return <svg {...common}><rect x="14" y="30" width="36" height="4" rx="2" fill="#475569" /></svg>;
    case 'n_a':
      return <svg {...common}><NeonLetter ch="A" color="#22d3ee" /></svg>;
    case 'n_k':
      return <svg {...common}><NeonLetter ch="K" color="#a78bfa" /></svg>;
    case 'n_q':
      return <svg {...common}><NeonLetter ch="Q" color="#f472b6" /></svg>;
    case 'n_star':
      return (
        <svg {...common}>
          <rect x="6" y="6" width="52" height="52" rx="12" fill="#0b0b1e" stroke="#facc15" strokeWidth="2.5" />
          <path d="M32 14l5 11 12 1.5-9 8 2.6 12L32 40.5 21.4 46.5 24 34.5l-9-8L27 25Z" fill="none" stroke="#facc15" strokeWidth="3" style={{ filter: 'drop-shadow(0 0 4px #facc15)' }} />
        </svg>
      );
    case 'n_bolt':
      return (
        <svg {...common}>
          <rect x="6" y="6" width="52" height="52" rx="12" fill="#0b0b1e" stroke="#4ade80" strokeWidth="2.5" />
          <path d="M36 10 18 36h12l-4 18 20-28H34Z" fill="#4ade80" style={{ filter: 'drop-shadow(0 0 5px #4ade80)' }} />
        </svg>
      );
    case 'n_crown':
      return (
        <svg {...common}>
          <rect x="6" y="6" width="52" height="52" rx="12" fill="#0b0b1e" stroke="#f3c969" strokeWidth="2.5" />
          <path d="M14 44 12 20l12 10 8-14 8 14 12-10-2 24Z" fill="#f3c969" style={{ filter: 'drop-shadow(0 0 5px #f3c969)' }} />
        </svg>
      );
    case 'n_wild':
      return (
        <svg {...common}>
          <rect x="6" y="6" width="52" height="52" rx="12" fill="url(#wildg)" />
          <defs><linearGradient id="wildg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ec4899" /><stop offset="1" stopColor="#7c3aed" /></linearGradient></defs>
          <text x="32" y="40" textAnchor="middle" fontFamily="Inter, Arial" fontWeight="900" fontSize="15" fill="#fff">WILD</text>
        </svg>
      );
    case 'c_red':
      return <svg {...common}><Gem color="#dc2626" light="#fecaca" /></svg>;
    case 'c_blue':
      return <svg {...common}><Gem color="#2563eb" light="#bfdbfe" /></svg>;
    case 'c_green':
      return <svg {...common}><Gem color="#16a34a" light="#bbf7d0" /></svg>;
    case 'c_purple':
      return <svg {...common}><Gem color="#7c3aed" light="#ddd6fe" /></svg>;
    case 'c_gold':
      return (
        <svg {...common}>
          <path d="M12 40 22 22h20l10 18-20 14Z" fill="#d8a84e" stroke="#7a5418" strokeWidth="2" />
          <path d="M22 22 32 40l10-18M12 40h40" stroke="#fff1c2" strokeWidth="1.5" fill="none" opacity=".7" />
        </svg>
      );
    case 'sd_diamond':
      return (
        <svg {...common}>
          <defs>
            <linearGradient id="sdg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#e0f2fe" /><stop offset=".5" stopColor="#38bdf8" /><stop offset="1" stopColor="#0369a1" /></linearGradient>
          </defs>
          <path d="M10 22 20 8h24l10 14-22 34Z" fill="url(#sdg)" stroke="#e0f2fe" strokeWidth="1.5" />
          <path d="M10 22h44M20 8l12 14 12-14M32 22v34" stroke="#fff" strokeWidth="1.2" fill="none" opacity=".7" />
          {value !== undefined && (
            <text x="32" y="38" textAnchor="middle" fontFamily="JetBrains Mono, monospace" fontWeight="800" fontSize="13" fill="#0c4a6e"
              stroke="#fff" strokeWidth="3" paintOrder="stroke">{value}</text>
          )}
        </svg>
      );
    default:
      return <svg {...common} />;
  }
}
