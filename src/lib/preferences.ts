// Lokale Komfort-Einstellungen pro Gerät (keine sicherheitsrelevanten Daten).
export interface Preferences {
  sound: boolean;
  haptics: boolean;
  confetti: boolean;
}

const KEY = 'shb.preferences.v1';
const DEFAULTS: Preferences = { sound: false, haptics: true, confetti: true };

export function loadPreferences(): Preferences {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Preferences>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePreferences(p: Preferences) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* Speicher nicht verfügbar – Einstellungen gelten nur für diese Sitzung */
  }
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}
