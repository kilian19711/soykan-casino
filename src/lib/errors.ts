// Übersetzt Server-Fehlercodes in verständliche deutsche Meldungen (ohne private Daten).
const MESSAGES: Record<string, string> = {
  NOT_AUTHENTICATED: 'Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.',
  ACCOUNT_SUSPENDED: 'Dein Konto ist gesperrt. Bitte wende dich an den Admin.',
  ACCOUNT_NOT_ACTIVE: 'Dein Konto ist noch nicht aktiviert. Bitte lege zuerst ein Passwort fest.',
  PROFILE_MISSING: 'Zu deinem Login existiert kein Profil. Bitte wende dich an den Admin.',
  FORBIDDEN: 'Dafür fehlen dir die Berechtigungen.',
  RATE_LIMITED: 'Zu viele Anfragen in kurzer Zeit. Bitte warte einen Moment.',
  INSUFFICIENT_BALANCE: 'Dein Kontostand reicht dafür nicht aus.',
  BET_TOO_LOW: 'Der Einsatz liegt unter dem Mindesteinsatz.',
  BET_TOO_HIGH: 'Der Einsatz liegt über dem Höchsteinsatz.',
  INVALID_PARAMS: 'Ungültige Spieleingaben. Bitte prüfe deine Auswahl.',
  INVALID_IDEMPOTENCY_KEY: 'Technischer Fehler bei der Anfrage. Bitte versuche es erneut.',
  GAME_DISABLED: 'Dieses Spiel ist derzeit deaktiviert.',
  GAME_NOT_FOUND: 'Dieses Spiel existiert nicht.',
  GAME_NOT_IMPLEMENTED: 'Dieses Spiel ist noch in Entwicklung und kann nicht aktiviert werden.',
  ACTIVE_ROUND_EXISTS: 'Du hast in diesem Spiel noch eine offene Runde.',
  ROUND_NOT_FOUND: 'Diese Runde wurde nicht gefunden.',
  ROUND_NOT_ACTIVE: 'Diese Runde ist bereits abgeschlossen.',
  ROUND_NOT_STARTED: 'Die Runde hat noch nicht begonnen.',
  CELL_ALREADY_REVEALED: 'Dieses Feld ist bereits aufgedeckt.',
  NOTHING_REVEALED: 'Decke zuerst mindestens ein Feld auf.',
  ACTION_NOT_ALLOWED: 'Diese Aktion ist gerade nicht erlaubt.',
  INVALID_ACTION: 'Unbekannte Aktion.',
  BONUS_ALREADY_CLAIMED: 'Du hast deinen Tagesbonus heute schon abgeholt.',
  BONUS_DISABLED: 'Der Tagesbonus ist derzeit deaktiviert.',
  INVALID_AMOUNT: 'Bitte gib einen gültigen Betrag ein.',
  INVALID_MESSAGE: 'Bitte gib eine Begründung mit 3 bis 500 Zeichen an.',
  TOO_MANY_PENDING_REQUESTS: 'Du hast bereits 3 offene Anfragen. Warte auf eine Entscheidung.',
  REQUEST_NOT_CANCELLABLE: 'Diese Anfrage kann nicht mehr storniert werden.',
  REQUEST_NOT_FOUND: 'Anfrage nicht gefunden.',
  REQUEST_ALREADY_REVIEWED: 'Diese Anfrage wurde bereits bearbeitet.',
  REASON_REQUIRED: 'Bitte gib einen Grund an (mind. 3 Zeichen).',
  USER_NOT_FOUND: 'Benutzer nicht gefunden.',
  INVALID_STATUS: 'Ungültiger Status.',
  CANNOT_CHANGE_SELF: 'Du kannst deinen eigenen Status nicht ändern.',
  USER_NOT_YET_REGISTERED: 'Der Benutzer hat die Einladung noch nicht angenommen.',
  INVALID_USERNAME: 'Benutzername: 2–24 Zeichen, nur Buchstaben, Zahlen, Punkt, Unterstrich, Bindestrich.',
  INVALID_DISPLAY_NAME: 'Anzeigename: 1–40 Zeichen.',
  USERNAME_TAKEN: 'Dieser Benutzername ist bereits vergeben.',
  INVALID_LIMITS: 'Ungültige Einsatzlimits.',
  SETTING_NOT_EDITABLE: 'Diese Einstellung kann nicht bearbeitet werden.',
  INVALID_VALUE: 'Ungültiger Wert.',
  INVALID_EMAIL: 'Bitte gib eine gültige E-Mail-Adresse ein.',
  USER_ALREADY_REGISTERED: 'Dieser Benutzer ist bereits registriert. Nutze stattdessen einen Passwort-Reset.',
  EMAIL_RATE_LIMITED: 'Der E-Mail-Versand ist kurzzeitig limitiert. Bitte später erneut versuchen.',
  INVITE_FAILED: 'Die Einladung konnte nicht versendet werden.',
  RESET_FAILED: 'Der Reset-Link konnte nicht versendet werden.',
  QUEST_NOT_FOUND: 'Quest nicht gefunden.',
  QUEST_ALREADY_CLAIMED: 'Diese Belohnung hast du schon abgeholt.',
  QUEST_NOT_COMPLETED: 'Diese Quest ist noch nicht geschafft.',
  QUEST_EXPIRED: 'Diese Quest ist abgelaufen.',
  NOTHING_TO_FINALIZE: 'Die laufende Runde ist noch nicht vorbei.',
  INVALID_RECIPIENT: 'Dieser Spieler kann nicht ausgewählt werden.',
  GIFT_LIMIT_REACHED: 'Tageslimit für Geschenke erreicht.',
  TOO_MANY_DUELS: 'Du hast schon 3 offene Herausforderungen.',
  DUEL_NOT_FOUND: 'Duell nicht gefunden.',
  DUEL_NOT_OPEN: 'Dieses Duell ist nicht mehr offen.',
  DUPLICATE_REQUEST: 'Diese Aktion wurde bereits ausgeführt.',
  PREDICTION_LOCKED: 'Tipps sind 24 Stunden vor der Abrechnung geschlossen.',
  INTERNAL_ERROR: 'Ein Serverfehler ist aufgetreten. Bitte versuche es erneut.',
  NETWORK: 'Keine Verbindung zum Server. Prüfe deine Internetverbindung.',
};

export class AppError extends Error {
  constructor(
    public code: string,
    message?: string,
  ) {
    super(message ?? MESSAGES[code] ?? 'Unbekannter Fehler. Bitte versuche es erneut.');
  }
}

function rawMessage(err: unknown): string {
  if (typeof err === 'object' && err && 'message' in err) return String((err as { message: unknown }).message);
  return String(err);
}

/** Extrahiert einen bekannten Fehlercode aus Supabase-/Netzwerkfehlern. */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  const raw = rawMessage(err);
  const code = Object.keys(MESSAGES)
    .sort((a, b) => b.length - a.length)
    .find((k) => raw.includes(k));
  if (code) return new AppError(code);
  if (/fetch|network|NetworkError|Load failed/i.test(raw)) return new AppError('NETWORK');
  if (/JWT|jwt expired|invalid claim/i.test(raw)) return new AppError('NOT_AUTHENTICATED');
  return new AppError('UNKNOWN', 'Unbekannter Fehler. Bitte versuche es erneut.');
}

export function errorMessage(err: unknown): string {
  return toAppError(err).message;
}

/** Deutsche Meldungen für Supabase-Auth-Fehler */
export function authErrorMessage(err: unknown): string {
  const raw = rawMessage(err);
  if (/invalid login credentials/i.test(raw)) return 'E-Mail oder Passwort ist falsch.';
  if (/email not confirmed/i.test(raw)) return 'Deine E-Mail-Adresse ist noch nicht bestätigt. Nutze den Einladungslink.';
  if (/rate limit|too many/i.test(raw)) return 'Zu viele Versuche. Bitte warte kurz und versuche es erneut.';
  if (/password should be|weak password/i.test(raw)) return 'Das Passwort ist zu schwach. Mindestens 8 Zeichen.';
  if (/same password|different from the old/i.test(raw)) return 'Das neue Passwort muss sich vom alten unterscheiden.';
  if (/expired|invalid.*(token|link)|otp/i.test(raw))
    return 'Der Link ist abgelaufen oder ungültig. Bitte fordere einen neuen an.';
  if (/fetch|network/i.test(raw)) return MESSAGES.NETWORK;
  return 'Anmeldung fehlgeschlagen. Bitte versuche es erneut.';
}
