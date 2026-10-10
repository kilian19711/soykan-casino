import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { z } from 'zod';
import { api } from '../../lib/api';
import { useAuth } from '../auth/AuthProvider';
import { useAppData } from '../../app/AppData';
import { formatCredits, formatDateTime } from '../../lib/format';
import { toAppError } from '../../lib/errors';
import { Button } from '../../components/Button';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { ConfirmDialog, EmptyState, ErrorState, PageLoading, StatusBadge } from '../../components/ui';
import { IconSend } from '../../components/Icons';
import { fieldErrors } from '../auth/validation';
import type { CreditRequest } from '../../types';

const requestSchema = z.object({
  amount: z.coerce
    .number({ invalid_type_error: 'Bitte gib einen Betrag ein.' })
    .int('Nur ganze Credits.')
    .min(1, 'Mindestens 1 Credits.')
    .max(1_000_000, 'Höchstens 1.000.000 Credits.'),
  message: z.string().trim().min(3, 'Bitte begründe deine Anfrage (mind. 3 Zeichen).').max(500, 'Maximal 500 Zeichen.'),
});

export function CreditRequestModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [amount, setAmount] = useState('1000');
  const [message, setMessage] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const toast = useToast();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const parsed = requestSchema.safeParse({ amount, message });
    setErrors(fieldErrors(parsed));
    if (!parsed.success) return;
    setBusy(true);
    setFormError(null);
    try {
      await api.requestCredits(parsed.data.amount, parsed.data.message);
      toast.success('Credit-Anfrage gesendet', `${formatCredits(parsed.data.amount)} Credits – der Admin wird benachrichtigt.`);
      setMessage('');
      onCreated();
      onClose();
    } catch (err) {
      setFormError(toAppError(err).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={() => !busy && onClose()} title="Credits anfragen">
      <form className="stack" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="req-amount">Betrag (Credits)</label>
          <input
            id="req-amount"
            className="input mono"
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, '').slice(0, 7))}
            aria-invalid={errors.amount ? true : undefined}
          />
          {errors.amount && <span className="field-error">{errors.amount}</span>}
        </div>
        <div className="field">
          <label htmlFor="req-msg">Begründung</label>
          <textarea
            id="req-msg"
            className="textarea"
            maxLength={500}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Warum brauchst du zusätzliche Credits?"
            aria-invalid={errors.message ? true : undefined}
          />
          <span className={errors.message ? 'field-error' : 'field-hint'}>{errors.message ?? `${message.length}/500`}</span>
        </div>
        <p className="small muted">Credits sind virtuell und können nicht gekauft werden. Max. 3 offene Anfragen.</p>
        {formError && (
          <div className="notice notice-danger" role="alert">
            {formError}
          </div>
        )}
        <div className="modal-actions" style={{ marginTop: 4 }}>
          <Button onClick={onClose} disabled={busy}>
            Abbrechen
          </Button>
          <Button type="submit" variant="primary" loading={busy}>
            Anfrage senden
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function CreditRequestsPage() {
  const { session } = useAuth();
  const { requestsVersion } = useAppData();
  const toast = useToast();
  const [items, setItems] = useState<CreditRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const uid = session?.user.id;

  const load = useCallback(async () => {
    if (!uid) return;
    try {
      setItems(await api.getMyCreditRequests(uid));
      setError(null);
    } catch (e) {
      setError(toAppError(e).message);
    }
  }, [uid]);

  useEffect(() => {
    void load();
  }, [load, requestsVersion]);

  const cancel = async () => {
    if (!cancelId) return;
    setCancelling(true);
    try {
      await api.cancelCreditRequest(cancelId);
      toast.info('Anfrage storniert');
      await load();
    } catch (e) {
      toast.error('Stornieren fehlgeschlagen', toAppError(e).message);
    } finally {
      setCancelling(false);
      setCancelId(null);
    }
  };

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <h1>Credit-Anfragen</h1>
          <p>Frag beim Admin zusätzliche Credits an.</p>
        </div>
        <Button variant="primary" onClick={() => setOpen(true)}>
          <IconSend size={16} /> Neue Anfrage
        </Button>
      </div>
      {error && <ErrorState message={error} onRetry={() => void load()} />}
      {!items && !error && <PageLoading />}
      {items &&
        (items.length ? (
          <div className="stack">
            {items.map((r) => (
              <article key={r.id} className="card">
                <div className="row-between wrap">
                  <div className="row">
                    <span className="stat-value" style={{ fontSize: 22 }}>
                      {formatCredits(r.amount)} Credits
                    </span>
                    <StatusBadge status={r.status} />
                  </div>
                  <span className="small muted">{formatDateTime(r.created_at)}</span>
                </div>
                <p className="subtle" style={{ marginTop: 8, overflowWrap: 'anywhere' }}>
                  {r.message}
                </p>
                {r.review_message && (
                  <p className="small" style={{ marginTop: 6 }}>
                    <span className="muted">Antwort des Admins:</span> {r.review_message}
                  </p>
                )}
                {r.status === 'pending' && (
                  <Button size="sm" variant="ghost" style={{ marginTop: 8, paddingLeft: 0 }} onClick={() => setCancelId(r.id)}>
                    Anfrage stornieren
                  </Button>
                )}
              </article>
            ))}
          </div>
        ) : (
          <div className="card">
            <EmptyState
              icon={<IconSend size={28} />}
              title="Noch keine Anfragen"
              text="Wenn dir die Credits ausgehen, kannst du hier beim Admin nachfragen."
              action={
                <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
                  Erste Anfrage stellen
                </Button>
              }
            />
          </div>
        ))}
      <CreditRequestModal open={open} onClose={() => setOpen(false)} onCreated={() => void load()} />
      <ConfirmDialog
        open={!!cancelId}
        title="Anfrage stornieren?"
        confirmLabel="Stornieren"
        variant="danger"
        loading={cancelling}
        onConfirm={() => void cancel()}
        onCancel={() => setCancelId(null)}
      >
        <p className="subtle">Die Anfrage wird zurückgezogen und kann nicht mehr genehmigt werden.</p>
      </ConfirmDialog>
    </div>
  );
}
