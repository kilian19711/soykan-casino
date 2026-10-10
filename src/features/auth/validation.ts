import { z } from 'zod';

export const emailSchema = z.string().trim().min(1, 'Bitte gib deine E-Mail-Adresse ein.').email('Ungültige E-Mail-Adresse.');

export const passwordSchema = z
  .string()
  .min(8, 'Mindestens 8 Zeichen.')
  .max(72, 'Maximal 72 Zeichen.')
  .regex(/[A-Za-zÄÖÜäöüß]/, 'Mindestens ein Buchstabe.')
  .regex(/\d/, 'Mindestens eine Ziffer.');

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Bitte gib dein Passwort ein.'),
});

export const setPasswordSchema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { message: 'Die Passwörter stimmen nicht überein.', path: ['confirm'] });

export const usernameSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_.-]{2,24}$/, '2–24 Zeichen: Buchstaben, Zahlen, Punkt, Unterstrich, Bindestrich.');

export const displayNameSchema = z.string().trim().min(1, 'Bitte gib einen Namen ein.').max(40, 'Maximal 40 Zeichen.');

export function fieldErrors(result: z.SafeParseReturnType<unknown, unknown>): Record<string, string> {
  if (result.success) return {};
  const out: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = String(issue.path[0] ?? '_');
    out[key] ??= issue.message;
  }
  return out;
}

/** Einfacher clientseitiger Schutz gegen Brute-Force (zusätzlich zu Supabase-Rate-Limits). */
const LOCK_KEY = 'shb.login.fails';
export function loginLockRemaining(): number {
  try {
    const raw = sessionStorage.getItem(LOCK_KEY);
    if (!raw) return 0;
    const { count, until } = JSON.parse(raw) as { count: number; until: number };
    return count >= 5 ? Math.max(0, until - Date.now()) : 0;
  } catch {
    return 0;
  }
}
export function registerLoginFailure() {
  try {
    const raw = sessionStorage.getItem(LOCK_KEY);
    const prev = raw ? (JSON.parse(raw) as { count: number; until: number }) : { count: 0, until: 0 };
    const count = prev.until && prev.until < Date.now() && prev.count >= 5 ? 1 : prev.count + 1;
    sessionStorage.setItem(LOCK_KEY, JSON.stringify({ count, until: Date.now() + 30_000 }));
  } catch {
    /* ignore */
  }
}
export function resetLoginFailures() {
  try {
    sessionStorage.removeItem(LOCK_KEY);
  } catch {
    /* ignore */
  }
}
