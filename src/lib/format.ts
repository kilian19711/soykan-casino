const intFmt = new Intl.NumberFormat('de-DE');

/** 12345 -> "12.345" */
export function formatCredits(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '–';
  return intFmt.format(Math.trunc(value));
}

/** Vorzeichenbehaftet: +1.000 / −250 */
export function formatSigned(value: number): string {
  if (value > 0) return `+${formatCredits(value)}`;
  if (value < 0) return `−${formatCredits(Math.abs(value))}`;
  return '0';
}

/** Multiplikator in Hundertsteln (z. B. 250) -> "2,50×" */
export function formatMultiplierH(hundredths: number): string {
  return formatMultiplier(hundredths / 100);
}

export function formatMultiplier(value: number, digits = 2): string {
  return `${value.toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits })}×`;
}

/**
 * Spielzeit gut lesbar:
 *  < 1 h   -> "12 min"
 *  < 1 Tag -> "03:42 h"
 *  sonst   -> "1 Tag 04:10 h"
 */
export function formatPlaytime(totalSeconds: number | null | undefined): string {
  const s = Math.max(0, Math.floor(totalSeconds ?? 0));
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  if (days > 0) return `${days} ${days === 1 ? 'Tag' : 'Tage'} ${pad(hours)}:${pad(minutes)} h`;
  if (hours > 0) return `${pad(hours)}:${pad(minutes)} h`;
  return `${minutes} min`;
}

/** Countdown: "3 Tagen 08:14:22" bzw. "08:14:22" */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  const clock = `${pad(h)}:${pad(m)}:${pad(sec)}`;
  if (days === 0) return clock;
  return `${days} ${days === 1 ? 'Tag' : 'Tagen'} ${clock}`;
}

const dateTimeFmt = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const shortFmt = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '–';
  return dateTimeFmt.format(new Date(iso));
}

export function formatShort(iso: string | null | undefined): string {
  if (!iso) return '–';
  return shortFmt.format(new Date(iso));
}

export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '–';
  const diff = Math.round((now - new Date(iso).getTime()) / 1000);
  if (diff < 45) return 'gerade eben';
  if (diff < 3600) return `vor ${Math.round(diff / 60)} min`;
  if (diff < 86400) return `vor ${Math.round(diff / 3600)} h`;
  const d = Math.round(diff / 86400);
  return `vor ${d} ${d === 1 ? 'Tag' : 'Tagen'}`;
}

/** "2026-W41" -> "KW 41 / 2026" */
export function formatWeekKey(key: string | null | undefined): string {
  if (!key) return '–';
  const p = /^P(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (p) return `Runde bis ${p[3]}.${p[2]}.${p[1]}`;
  const m = /^(\d{4})-W(\d{2})$/.exec(key);
  return m ? `KW ${Number(m[2])} / ${m[1]}` : key;
}

export function shortId(id: string | null | undefined): string {
  return id ? id.slice(0, 8).toUpperCase() : '–';
}
