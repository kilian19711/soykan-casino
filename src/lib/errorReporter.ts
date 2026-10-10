// Meldet App-Fehler an den Server (Admin → Fehler). Nur für angemeldete Benutzer, gedrosselt, nie rekursiv.
import { supabase } from './supabase';

const CHUNK_ERROR = /Importing a module script failed|is not a valid JavaScript MIME type|Failed to fetch dynamically imported module|error loading dynamically imported module|Loading chunk|ChunkLoadError/i;

/** Alte App-Version nach einem Deploy: fehlende Datei -> einmal neu laden (höchstens alle 30 s). */
export function reloadOnChunkError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  if (!CHUNK_ERROR.test(msg)) return false;
  try {
    const last = Number(sessionStorage.getItem('shb.chunkReload') || 0);
    if (Date.now() - last < 30_000) return false;
    sessionStorage.setItem('shb.chunkReload', String(Date.now()));
  } catch {
    /* ignore */
  }
  window.location.reload();
  return true;
}

export type ErrorKind = 'crash' | 'error' | 'rejection' | 'server';

const sent = new Map<string, number>();
let installed = false;

export function reportError(kind: ErrorKind, err: unknown, extra: Record<string, unknown> = {}) {
  try {
    const e = err instanceof Error ? err : null;
    const message = (e?.message ?? (typeof err === 'string' ? err : JSON.stringify(err) ?? '?')).slice(0, 500);
    // gleiche Meldung höchstens alle 60 s pro Gerät
    const key = kind + message;
    const now = Date.now();
    if ((sent.get(key) ?? 0) > now - 60_000) return;
    sent.set(key, now);
    const path = window.location.pathname;
    const game = /^\/casino\/([^/]+)/.exec(path)?.[1];
    const context = {
      url: path,
      game: game ?? null,
      ua: navigator.userAgent.slice(0, 200),
      standalone: window.matchMedia?.('(display-mode: standalone)').matches ?? false,
      online: navigator.onLine,
      time: new Date().toISOString(),
      ...extra,
    };
    void supabase
      .rpc('log_client_error', { p_kind: kind, p_message: message, p_stack: e?.stack?.slice(0, 4000) ?? null, p_context: context })
      .then(() => undefined, () => undefined);
  } catch {
    // Melden darf selbst nie einen Fehler auslösen
  }
}

/** Globale Handler für unbehandelte Fehler und Promise-Ablehnungen. */
export function installErrorReporter() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('error', (ev) => {
    // Ressourcen-Ladefehler (Bilder etc.) und fremde Skripte ignorieren
    if (!ev.error && !ev.message) return;
    if (ev.message === 'Script error.') return;
    reportError('error', ev.error ?? ev.message, { source: ev.filename ? ev.filename.split('/').pop() : null, line: ev.lineno });
  });
  // Vite meldet fehlgeschlagene Vorab-Ladevorgänge über dieses Ereignis
  window.addEventListener('vite:preloadError', (ev) => {
    if (reloadOnChunkError((ev as Event & { payload?: unknown }).payload ?? 'Failed to fetch dynamically imported module')) ev.preventDefault();
  });
  window.addEventListener('unhandledrejection', (ev) => {
    if (reloadOnChunkError(ev.reason)) return;
    const r = ev.reason as { code?: string; message?: string } | undefined;
    // erwartete Fachfehler (z. B. zu wenig Guthaben) sind keine Bugs
    if (r && typeof r === 'object' && 'code' in r && r.code && r.code !== 'UNKNOWN' && r.code !== 'INTERNAL_ERROR') return;
    if (/fetch|network|Load failed/i.test(String(r?.message ?? r))) return;
    reportError('rejection', ev.reason);
  });
}
