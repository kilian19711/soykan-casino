import { useId } from 'react';

/** Eigenes SHB-Logo: goldene Münze mit stilisierten Buchstaben, dunkle Kontur, Glanzrand. */
export function LogoCoin({ size = 36, title = 'Shishabar Online Casino' }: { size?: number; title?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={title}>
      <defs>
        <radialGradient id={`f${id}`} cx="36%" cy="30%" r="78%">
          <stop offset="0" stopColor="#fdeab0" />
          <stop offset=".45" stopColor="#f3c969" />
          <stop offset="1" stopColor="#a87a2a" />
        </radialGradient>
        <linearGradient id={`r${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff2c4" />
          <stop offset=".5" stopColor="#d8a84e" />
          <stop offset="1" stopColor="#6e4a12" />
        </linearGradient>
      </defs>
      <circle cx="32" cy="32" r="31" fill="#1a1205" />
      <circle cx="32" cy="32" r="29" fill={`url(#r${id})`} />
      <circle cx="32" cy="32" r="24.5" fill={`url(#f${id})`} stroke="#5c3f10" strokeWidth="1.2" />
      <circle cx="32" cy="32" r="21.5" fill="none" stroke="#7a5418" strokeWidth=".7" strokeDasharray="1.5 2.2" opacity=".75" />
      <text
        x="32"
        y="37.5"
        textAnchor="middle"
        fontFamily="Inter, Arial, sans-serif"
        fontWeight="800"
        fontSize="15.5"
        letterSpacing="-.6"
        fill="#2a1c06"
      >
        SHB
      </text>
      <path d="M17 22a18 18 0 0 1 18-8" fill="none" stroke="#fff6d8" strokeWidth="1.8" strokeLinecap="round" opacity=".6" />
    </svg>
  );
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="row" style={{ gap: 10 }}>
      <LogoCoin size={compact ? 32 : 36} />
      {!compact && (
        <span className="brand-text">
          Shishabar
          <small>Online Casino</small>
        </span>
      )}
    </span>
  );
}
