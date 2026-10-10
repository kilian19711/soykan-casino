// Admin: Fehler-Sammlung (Debug) und Aufräumen von Logs/Altdaten.
import { useCallback, useEffect, useState } from 'react';
import { api, type ClientErrorRow } from '../../lib/api';
import { toAppError } from '../../lib/errors';
import { formatCredits, formatDateTime, relativeTime } from '../../lib/format';
import { Button } from '../../components/Button';
import { useToast } from '../../components/Toast';
import { EmptyState, PageLoading } from '../../components/ui';
import { ReasonDialog } from './adminShared';

const KIND_LABEL: Record<string, string> = { crash: 'Absturz', error: 'Fehler', rejection: 'Unbehandelt', server: 'Server' };

export function AdminErrors() {
  const toast = useToast();
  const [rows, setRows] = useState<ClientErrorRow[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setRows(await api.admin.listErrors());
    } catch (e) {
      toast.error('Fehler nicht geladen', toAppError(e).message);
      setRows([]);
    }
  }, [toast]);
  useEffect(() => {
    void load();
  }, [load]);

  const remove = async (ids: string[] | null) => {
    if (ids === null && !window.confirm('Wirklich alle gesammelten Fehler löschen?')) return;
    setBusy(ids?.[0] ?? 'all');
    try {
      const n = await api.admin.deleteErrors(ids);
      toast.success(n === 1 ? 'Fehler gelöscht' : `${n} Fehler gelöscht`);
      await load();
    } catch (e) {
      toast.error('Nicht gelöscht', toAppError(e).message);
    } finally {
      setBusy(null);
    }
  };

  if (!rows) return <PageLoading />;
  return (
    <div className="stack-lg">
      <div className="row-between wrap">
        <div>
          <h1>Fehler (Debug)</h1>
          <p className="subtle small">
            Abstürze und unerwartete Fehler aus der App. Gleiche Fehler werden zusammengefasst. Nach dem Beheben hier löschen.
          </p>
        </div>
        <div className="row">
          <Button size="sm" onClick={() => void load()}>
            Aktualisieren
          </Button>
          {rows.length > 0 && (
            <Button size="sm" variant="danger" loading={busy === 'all'} onClick={() => void remove(null)}>
              Alle löschen
            </Button>
          )}
        </div>
      </div>
      {!rows.length ? (
        <EmptyState title="Keine Fehler gesammelt" text="Alles läuft sauber." />
      ) : (
        <ul className="list">
          {rows.map((r) => (
            <li key={r.id} className="card stack" style={{ gap: 8 }}>
              <div className="row-between wrap" style={{ gap: 8 }}>
                <div className="row wrap" style={{ gap: 6 }}>
                  <span className={`badge ${r.kind === 'crash' || r.kind === 'server' ? 'badge-danger' : 'badge-gold'}`}>{KIND_LABEL[r.kind] ?? r.kind}</span>
                  <span className="badge">{formatCredits(r.count)}×</span>
                  {r.context?.game ? <span className="badge">{String(r.context.game)}</span> : null}
                </div>
                <span className="small muted">zuletzt {relativeTime(r.last_seen_at)}</span>
              </div>
              <strong style={{ overflowWrap: 'anywhere' }}>{r.message}</strong>
              <div className="small subtle">
                Betroffen: {r.users.length ? r.users.join(', ') : '–'} · zuerst {formatDateTime(r.first_seen_at)}
                {r.context?.url ? <> · Seite <span className="mono">{String(r.context.url)}</span></> : null}
                {r.context?.code ? <> · Code <span className="mono">{String(r.context.code)}</span></> : null}
              </div>
              <div className="row wrap" style={{ gap: 8 }}>
                <Button size="sm" variant="ghost" onClick={() => setOpen(open === r.id ? null : r.id)}>
                  {open === r.id ? 'Details ausblenden' : 'Details'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void navigator.clipboard?.writeText(JSON.stringify(r, null, 2)).then(() => toast.info('In die Zwischenablage kopiert'))}>
                  Kopieren
                </Button>
                <Button size="sm" loading={busy === r.id} onClick={() => void remove([r.id])}>
                  Behoben – löschen
                </Button>
              </div>
              {open === r.id && (
                <pre className="mono small" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 320, overflow: 'auto', background: 'var(--card-2)', padding: 10, borderRadius: 10, margin: 0 }}>
                  {r.stack ?? '(kein Stack)'}
                  {'\n\nKontext: '}
                  {JSON.stringify(r.context, null, 2)}
                </pre>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const TARGETS: [string, string, string][] = [
  ['notifications_read', 'Gelesene Benachrichtigungen', 'Benachrichtigungen, die schon gelesen wurden.'],
  ['notifications_all', 'Alle Benachrichtigungen', 'Auch ungelesene – die Spieler sehen sie dann nicht mehr.'],
  ['client_errors', 'Gesammelte Fehler', 'Einträge aus „Fehler (Debug)“.'],
  ['cron_log', 'Cron-Protokoll', 'Laufprotokoll der automatischen Jobs (wächst jede Minute).'],
  ['net_log', 'HTTP-Protokoll (Push)', 'Antworten der Push-Aufrufe (wächst jede Minute).'],
  ['rate_limits', 'Rate-Limit-Einträge', 'Werden ohnehin nach 2 h automatisch gelöscht.'],
  ['announcements', 'Ankündigungs-Log', 'Merker, welche Tagesankündigung schon verschickt wurde (heute bleibt immer).'],
  ['audit_logs', 'Audit-Log', 'Protokoll der Admin-Aktionen. Der Aufräum-Eintrag selbst bleibt immer erhalten.'],
];

const PRESETS: [string, number][] = [
  ['älter als 7 Tage', 7],
  ['älter als 30 Tage', 30],
  ['älter als 90 Tage', 90],
];

function toInputDate(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function AdminCleanup() {
  const toast = useToast();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState(() => toInputDate(new Date(Date.now() - 30 * 86400_000)));
  const [selected, setSelected] = useState<string[]>(['notifications_read', 'cron_log', 'net_log']);
  const [preview, setPreview] = useState<Record<string, number> | null>(null);
  const [dialog, setDialog] = useState(false);

  // Bis-Datum ist inklusive (bis Tagesende)
  const range = useCallback(() => {
    const f = from ? new Date(`${from}T00:00:00`).toISOString() : null;
    const t = to ? new Date(new Date(`${to}T00:00:00`).getTime() + 86400_000).toISOString() : null;
    return { f, t };
  }, [from, to]);

  useEffect(() => {
    const { f, t } = range();
    setPreview(null);
    api.admin
      .cleanupPreview(f, t)
      .then(setPreview)
      .catch((e) => toast.error('Vorschau nicht geladen', toAppError(e).message));
  }, [range, toast]);

  const total = selected.reduce((s, k) => s + Number(preview?.[k] ?? 0), 0);

  return (
    <div className="stack-lg" style={{ maxWidth: 820 }}>
      <div>
        <h1>Aufräumen</h1>
        <p className="subtle small">
          Löscht Logs und Altdaten im gewählten Zeitraum. Kontostände, Buchungen, Spielrunden, Spielzeit und Erfolge werden nie gelöscht.
        </p>
      </div>

      <section className="card stack">
        <h2>Zeitraum</h2>
        <div className="row wrap" style={{ gap: 6 }}>
          {PRESETS.map(([label, days]) => (
            <button
              key={days}
              type="button"
              className="chip"
              onClick={() => {
                setFrom('');
                setTo(toInputDate(new Date(Date.now() - days * 86400_000)));
              }}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            className="chip"
            onClick={() => {
              setFrom('');
              setTo(toInputDate(new Date()));
            }}
          >
            alles bis heute
          </button>
        </div>
        <div className="grid-2">
          <div className="field">
            <label htmlFor="cl-from">Von (leer = Anfang)</label>
            <input id="cl-from" type="date" className="input" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="cl-to">Bis einschließlich</label>
            <input id="cl-to" type="date" className="input" value={to} min={from || undefined} max={toInputDate(new Date())} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
      </section>

      <section className="card stack">
        <h2>Was soll gelöscht werden?</h2>
        {TARGETS.map(([key, label, hint]) => (
          <label key={key} className="checkbox">
            <input
              type="checkbox"
              checked={selected.includes(key)}
              onChange={(e) => setSelected((s) => (e.target.checked ? [...s, key] : s.filter((x) => x !== key)))}
            />
            <span className="grow">
              {label} <span className="mono gold">{preview ? formatCredits(Number(preview[key] ?? 0)) : '…'}</span>
              <br />
              <span className="small muted">{hint}</span>
            </span>
          </label>
        ))}
        <Button variant="danger" disabled={!selected.length || !preview || total === 0} onClick={() => setDialog(true)}>
          {total ? `${formatCredits(total)} Einträge löschen` : 'Nichts zu löschen'}
        </Button>
      </section>

      <section className="card stack">
        <h2>App-Cache auf diesem Gerät</h2>
        <p className="small subtle">
          Leert den Offline-Cache der App (Service Worker) auf diesem Gerät und lädt neu – hilfreich, wenn eine alte Version hängen bleibt. Anmeldung und
          Kontostand bleiben erhalten.
        </p>
        <Button
          onClick={async () => {
            try {
              if ('caches' in window) await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
              const regs = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
              await Promise.all(regs.map((r) => r.update().catch(() => undefined)));
              window.location.reload();
            } catch (e) {
              toast.error('Cache nicht geleert', toAppError(e).message);
            }
          }}
        >
          Cache leeren und neu laden
        </Button>
      </section>

      <ReasonDialog
        open={dialog}
        title="Endgültig löschen?"
        variant="danger"
        confirmLabel="Löschen"
        description={`${formatCredits(total)} Einträge in ${selected.length} Bereich(en) werden endgültig gelöscht.`}
        onClose={() => setDialog(false)}
        onConfirm={async (reason) => {
          const { f, t } = range();
          const res = await api.admin.cleanup(selected, f, t, reason);
          const n = Object.values(res).reduce((s, v) => s + Number(v), 0);
          toast.success('Aufgeräumt', `${formatCredits(n)} Einträge gelöscht`);
          setPreview(await api.admin.cleanupPreview(f, t));
        }}
      />
    </div>
  );
}
