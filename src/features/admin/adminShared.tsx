import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { api } from '../../lib/api';
import { toAppError } from '../../lib/errors';
import { formatCredits, formatSigned } from '../../lib/format';
import { newIdempotencyKey } from '../../lib/misc';
import { Button } from '../../components/Button';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import type { AdminUser } from '../../types';

const TABS: [string, string][] = [
  ['/admin', 'Übersicht'],
  ['/admin/benutzer', 'Benutzer'],
  ['/admin/einladungen', 'Einladungen'],
  ['/admin/anfragen', 'Credit-Anfragen'],
  ['/admin/anpassungen', 'Credit-Anpassungen'],
  ['/admin/runden', 'Spielverläufe'],
  ['/admin/spielzeit', 'Spielzeit'],
  ['/admin/woche', 'Abrechnung'],
  ['/admin/leaderboard', 'Leaderboard'],
  ['/admin/audit', 'Audit-Log'],
  ['/admin/spiele', 'Spiele'],
  ['/admin/einstellungen', 'System'],
  ['/admin/fehler', 'Fehler'],
  ['/admin/aufraeumen', 'Aufräumen'],
];

export function AdminLayout() {
  return (
    <div className="stack-lg">
      <div className="row wrap" style={{ gap: 6 }}>
        <span className="badge badge-gold">Admin</span>
        <span className="small muted">Jede Änderung wird mit Grund im Audit-Log gespeichert.</span>
      </div>
      <nav aria-label="Adminbereich" style={{ overflowX: 'auto' }}>
        <div className="segmented" style={{ gridAutoColumns: 'max-content', width: 'max-content' }}>
          {TABS.map(([to, label]) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/admin'}
              className={({ isActive }) => (isActive ? 'chip active-tab' : 'chip')}
              style={({ isActive }) => ({
                border: 0,
                background: isActive ? 'var(--card-2)' : 'transparent',
                color: isActive ? 'var(--text)' : 'var(--subtle)',
                textDecoration: 'none',
                display: 'inline-flex',
                alignItems: 'center',
              })}
            >
              {label}
            </NavLink>
          ))}
        </div>
      </nav>
      <Outlet />
    </div>
  );
}

/** Lädt die Benutzerliste (inkl. privater E-Mail – nur für Admins per RPC). */
export function useAdminUsers() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setUsers(await api.admin.listUsers());
      setError(null);
    } catch (e) {
      setError(toAppError(e).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const nameOf = useCallback((id: string | null | undefined) => users?.find((u) => u.id === id)?.display_name ?? '–', [users]);
  return { users, error, reload: load, nameOf };
}

/** Dialog, der vor einer Admin-Aktion einen Grund verlangt. */
export function ReasonDialog({
  open,
  title,
  description,
  confirmLabel = 'Bestätigen',
  variant = 'primary',
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  variant?: 'primary' | 'danger' | 'gold';
  onConfirm: (reason: string) => Promise<void>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setReason('');
      setError(null);
    }
  }, [open]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (reason.trim().length < 3) {
      setError('Bitte gib einen Grund an (mind. 3 Zeichen).');
      return;
    }
    setBusy(true);
    try {
      await onConfirm(reason.trim());
      onClose();
    } catch (err) {
      const appErr = toAppError(err);
      setError(appErr.code === 'UNKNOWN' && err instanceof Error ? err.message : appErr.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={() => !busy && onClose()} title={title}>
      <form className="stack" onSubmit={submit} noValidate>
        {description && <div className="subtle">{description}</div>}
        <div className="field">
          <label htmlFor="reason">Grund (Pflicht)</label>
          <textarea id="reason" className="textarea" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        {error && (
          <div className="notice notice-danger" role="alert">
            {error}
          </div>
        )}
        <div className="modal-actions">
          <Button onClick={onClose} disabled={busy}>
            Abbrechen
          </Button>
          <Button type="submit" variant={variant} loading={busy}>
            {confirmLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Credit-Gutschrift/-Abzug mit Bestätigung (Zielbenutzer, Betrag, Richtung, neuer Kontostand, Begründung). */
export function AdjustCreditsForm({ users, presetUserId, onDone }: { users: AdminUser[]; presetUserId?: string; onDone?: () => void }) {
  const toast = useToast();
  const [userId, setUserId] = useState(presetUserId ?? '');
  const [direction, setDirection] = useState<'credit' | 'debit'>('credit');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [idemKey, setIdemKey] = useState(() => newIdempotencyKey('adj'));

  useEffect(() => {
    if (presetUserId) setUserId(presetUserId);
  }, [presetUserId]);

  const target = users.find((u) => u.id === userId);
  const value = Number(amount);
  const signed = direction === 'credit' ? value : -value;
  const newBalance = target ? target.balance + signed : null;

  const validate = () => {
    if (!target) return 'Bitte wähle einen Benutzer.';
    if (!Number.isInteger(value) || value <= 0) return 'Bitte gib einen positiven ganzzahligen Betrag ein.';
    if (value > 100_000_000) return 'Betrag zu groß.';
    if (reason.trim().length < 3) return 'Bitte gib einen Grund an (mind. 3 Zeichen).';
    if (newBalance !== null && newBalance < 0) return 'Der Kontostand darf nicht unter 0 fallen.';
    return null;
  };

  const submit = async () => {
    setBusy(true);
    try {
      const res = await api.admin.adjustCredits(userId, signed, reason.trim(), idemKey);
      toast.success(direction === 'credit' ? 'Gutschrift gebucht' : 'Abzug gebucht', `Neuer Kontostand: ${formatCredits(res.balance)} Credits`);
      setAmount('');
      setReason('');
      setConfirm(false);
      setIdemKey(newIdempotencyKey('adj'));
      onDone?.();
    } catch (e) {
      setError(toAppError(e).message);
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="stack"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const v = validate();
        setError(v);
        if (!v) setConfirm(true);
      }}
    >
      {!presetUserId && (
        <div className="field">
          <label htmlFor="adj-user">Benutzer</label>
          <select id="adj-user" className="select" value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">Bitte wählen …</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.display_name} (@{u.username}) – {formatCredits(u.balance)} Credits
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="segmented" role="group" aria-label="Richtung">
        <button type="button" aria-pressed={direction === 'credit'} onClick={() => setDirection('credit')}>
          Gutschrift (+)
        </button>
        <button type="button" aria-pressed={direction === 'debit'} onClick={() => setDirection('debit')}>
          Abzug (−)
        </button>
      </div>
      <div className="field">
        <label htmlFor="adj-amount">Betrag (Credits)</label>
        <input id="adj-amount" className="input mono" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, '').slice(0, 9))} />
      </div>
      <div className="field">
        <label htmlFor="adj-reason">Begründung (Pflicht)</label>
        <input id="adj-reason" className="input" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="z. B. Startguthaben, Korrektur …" />
      </div>
      {error && (
        <div className="notice notice-danger" role="alert">
          {error}
        </div>
      )}
      <Button type="submit" variant={direction === 'credit' ? 'primary' : 'danger'}>
        Weiter zur Bestätigung
      </Button>
      <Modal
        open={confirm}
        onClose={() => !busy && setConfirm(false)}
        title="Buchung bestätigen"
        footer={
          <>
            <Button onClick={() => setConfirm(false)} disabled={busy}>
              Abbrechen
            </Button>
            <Button variant={direction === 'credit' ? 'primary' : 'danger'} loading={busy} onClick={() => void submit()}>
              Jetzt buchen
            </Button>
          </>
        }
      >
        <dl className="kv">
          <dt>Zielbenutzer</dt>
          <dd>{target?.display_name}</dd>
          <dt>Richtung</dt>
          <dd>{direction === 'credit' ? 'Gutschrift' : 'Abzug'}</dd>
          <dt>Betrag</dt>
          <dd className={direction === 'credit' ? 'success' : 'danger'}>{formatSigned(signed)} Credits</dd>
          <dt>Aktueller Kontostand</dt>
          <dd>{formatCredits(target?.balance)} Credits</dd>
          <dt>Neuer Kontostand</dt>
          <dd className="gold">{formatCredits(newBalance)} Credits</dd>
          <dt>Begründung</dt>
          <dd style={{ fontFamily: 'var(--font)' }}>{reason}</dd>
        </dl>
      </Modal>
    </form>
  );
}
