import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { toAppError } from '../../lib/errors';
import { formatCredits, formatDateTime, formatPlaytime, formatSigned, formatWeekKey, relativeTime, shortId } from '../../lib/format';
import { useAppData } from '../../app/AppData';
import { useAuth } from '../auth/AuthProvider';
import { Button } from '../../components/Button';
import { useToast } from '../../components/Toast';
import { Avatar, BackLink, Countdown, EmptyState, ErrorState, PageLoading, StatusBadge } from '../../components/ui';
import { IconAlert, IconUsers } from '../../components/Icons';
import { AdjustCreditsForm, ReasonDialog, useAdminUsers } from './adminShared';
import { LedgerTable } from '../wallet/WalletPage';
import { displayNameSchema, emailSchema, usernameSchema } from '../auth/validation';
import type { AdminOverview, AuditLog, GameRoundRow, LedgerEntry } from '../../types';

export function AdminDashboard() {
  const { requestsVersion } = useAppData();
  const [o, setO] = useState<AdminOverview | null>(null);
  const [audit, setAudit] = useState<AuditLog[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { nameOf } = useAdminUsers();

  const load = useCallback(async () => {
    try {
      const [ov, logs] = await Promise.all([api.admin.overview(), api.admin.audit(8)]);
      setO(ov);
      setAudit(logs);
      setError(null);
    } catch (e) {
      setError(toAppError(e).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load, requestsVersion]);

  if (error) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!o) return <PageLoading />;

  const warnings: string[] = [];
  if (!o.cron_enabled) warnings.push('pg_cron ist nicht aktiv – Abrechnung bitte manuell auslösen.');
  if (!o.previous_week_finalized) warnings.push('Die vorherige Runde ist noch nicht abgerechnet (passiert automatisch, sobald Aktivität vorlag).');
  if (o.stale_active_rounds > 0) warnings.push(`${o.stale_active_rounds} Spielrunde(n) sind seit über 24 h offen.`);
  if (o.open_requests > 0) warnings.push(`${o.open_requests} offene Credit-Anfrage(n).`);

  return (
    <div className="stack-lg">
      <h1>Admin-Dashboard</h1>
      <div className="grid-4">
        <div className="card">
          <div className="label">Aktive Benutzer</div>
          <div className="stat-value">{o.active_users}</div>
          <div className="small muted">
            {o.invited_users} eingeladen · {o.suspended_users} gesperrt
          </div>
        </div>
        <div className="card card-gold">
          <div className="label">Credits im System</div>
          <div className="stat-value gold">{formatCredits(o.total_credits)}</div>
        </div>
        <Link to="/admin/anfragen" className="card" style={{ color: 'inherit', textDecoration: 'none' }}>
          <div className="label">Offene Anfragen</div>
          <div className={`stat-value ${o.open_requests ? 'warn' : ''}`}>{o.open_requests}</div>
        </Link>
        <div className="card">
          <div className="label">Laufende Sessions</div>
          <div className="stat-value row" style={{ gap: 8 }}>
            {o.live_sessions > 0 && <span className="live-dot" />} {o.live_sessions}
          </div>
          <div className="small muted">{o.rounds_today} Runden in 24 h</div>
        </div>
      </div>
      <div className="grid-2">
        <div className="card stack">
          <div className="label">Abrechnung ({formatWeekKey(o.week_key)})</div>
          <Countdown target={o.week_end} className="stat-value gold" />
          <div className="label" style={{ marginTop: 8 }}>
            Letzter Rundenverlierer
          </div>
          {o.last_weekly_result ? (
            <p>
              <strong>{o.last_weekly_result.loser_display_name ?? '–'}</strong> · {formatWeekKey(o.last_weekly_result.week_key)} ·{' '}
              <span className="mono">{formatCredits(o.last_weekly_result.loser_balance)} Credits</span>
              <br />
              <span className="small muted">Aufgabe: {o.last_weekly_result.task_label}</span>
            </p>
          ) : (
            <p className="subtle small">Noch keine Abrechnung.</p>
          )}
          <Link to="/admin/woche" className="btn btn-sm">
            Zur Abrechnung
          </Link>
        </div>
        <div className="card stack">
          <div className="label">Hinweise & Warnungen</div>
          {warnings.length ? (
            <ul className="list">
              {warnings.map((w) => (
                <li key={w} className="list-item small" style={{ alignItems: 'flex-start' }}>
                  <span className="warn">
                    <IconAlert size={16} />
                  </span>
                  {w}
                </li>
              ))}
            </ul>
          ) : (
            <p className="small success">Keine offenen Warnungen.</p>
          )}
        </div>
      </div>
      <div className="card">
        <div className="card-head">
          <h2>Letzte Admin-Aktionen</h2>
          <Link to="/admin/audit" className="small">
            Audit-Log
          </Link>
        </div>
        {audit?.length ? (
          <ul className="list">
            {audit.map((a) => (
              <li key={a.id} className="list-item small">
                <span className="badge">{a.action}</span>
                <span className="grow truncate">{a.target_user_id ? nameOf(a.target_user_id) : ''}</span>
                <span className="muted">{relativeTime(a.created_at)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="Noch keine Admin-Aktionen" />
        )}
      </div>
    </div>
  );
}

export function AdminUsers() {
  const { users, error, reload } = useAdminUsers();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const filtered = useMemo(
    () =>
      (users ?? []).filter((u) => {
        const s = q.trim().toLowerCase();
        const matches = !s || u.display_name.toLowerCase().includes(s) || u.username.toLowerCase().includes(s) || (u.email ?? '').toLowerCase().includes(s);
        return matches && (!status || u.status === status);
      }),
    [users, q, status],
  );
  if (error) return <ErrorState message={error} onRetry={() => void reload()} />;
  if (!users) return <PageLoading />;
  return (
    <div className="stack-lg">
      <div className="page-head">
        <h1>Benutzerverwaltung</h1>
        <Link to="/admin/einladungen" className="btn btn-primary">
          Benutzer einladen
        </Link>
      </div>
      <div className="row wrap">
        <input className="input grow" style={{ minWidth: 200 }} placeholder="Suche nach Name oder E-Mail" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Suche" />
        <select className="select" style={{ width: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status filtern">
          <option value="">Alle Status</option>
          <option value="active">Aktiv</option>
          <option value="invited">Eingeladen</option>
          <option value="suspended">Gesperrt</option>
        </select>
      </div>
      {filtered.length ? (
        <div className="table-wrap">
          <table className="table responsive">
            <thead>
              <tr>
                <th>Benutzer</th>
                <th>E-Mail</th>
                <th>Status</th>
                <th className="num">Kontostand</th>
                <th className="num">Spielzeit</th>
                <th>Zuletzt aktiv</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.id}>
                  <td data-label="Benutzer">
                    <Link to={`/admin/benutzer/${u.id}`} className="row" style={{ gap: 8, color: 'inherit' }}>
                      <Avatar name={u.display_name} size={28} />
                      <span>
                        <strong>{u.display_name}</strong> <span className="small muted">@{u.username}</span>
                        {u.role === 'admin' && <span className="badge badge-gold" style={{ marginLeft: 6 }}>Admin</span>}
                      </span>
                    </Link>
                  </td>
                  <td data-label="E-Mail" className="small subtle">
                    {u.email}
                  </td>
                  <td data-label="Status">
                    <StatusBadge status={u.status} />
                  </td>
                  <td data-label="Kontostand" className="num">
                    {formatCredits(u.balance)}
                  </td>
                  <td data-label="Spielzeit" className="num">
                    {formatPlaytime(u.playtime_seconds)}
                  </td>
                  <td data-label="Zuletzt aktiv" className="small">
                    {relativeTime(u.last_seen_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card">
          <EmptyState icon={<IconUsers size={28} />} title="Keine Benutzer gefunden" />
        </div>
      )}
    </div>
  );
}

export function AdminUserDetail() {
  const { id = '' } = useParams();
  const { session } = useAuth();
  const toast = useToast();
  const { users, error, reload } = useAdminUsers();
  const [ledger, setLedger] = useState<LedgerEntry[] | null>(null);
  const [rounds, setRounds] = useState<GameRoundRow[] | null>(null);
  const [dialog, setDialog] = useState<null | 'suspend' | 'unsuspend' | 'profile'>(null);
  const [editName, setEditName] = useState('');
  const [editUsername, setEditUsername] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const user = users?.find((u) => u.id === id);

  const loadDetails = useCallback(() => {
    api.admin.ledger(id, undefined, 50).then(setLedger).catch(() => setLedger([]));
    api.admin.rounds({ userId: id, limit: 30 }).then(setRounds).catch(() => setRounds([]));
  }, [id]);
  useEffect(() => loadDetails(), [loadDetails]);
  useEffect(() => {
    if (user) {
      setEditName(user.display_name);
      setEditUsername(user.username);
    }
  }, [user]);

  if (error) return <ErrorState message={error} onRetry={() => void reload()} />;
  if (!users) return <PageLoading />;
  if (!user) return <EmptyState title="Benutzer nicht gefunden" action={<Link to="/admin/benutzer">Zur Liste</Link>} />;

  const self = user.id === session?.user.id;

  const resendInvite = async () => {
    if (!user.email) return;
    setBusy('invite');
    try {
      await api.admin.invite({ email: user.email, resend: true });
      toast.success('Einladung erneut gesendet');
    } catch (e) {
      toast.error('Einladung fehlgeschlagen', toAppError(e).message);
    } finally {
      setBusy(null);
    }
  };
  const sendReset = async () => {
    setBusy('reset');
    try {
      await api.admin.sendPasswordReset(user.id);
      toast.success('Passwort-Reset-Link gesendet');
    } catch (e) {
      toast.error('Reset fehlgeschlagen', toAppError(e).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="stack-lg">
      <BackLink to="/admin/benutzer">Benutzerverwaltung</BackLink>
      <div className="row-between wrap">
        <div className="row" style={{ gap: 14 }}>
          <Avatar name={user.display_name} seed={user.username} size={56} />
          <div>
            <h1>{user.display_name}</h1>
            <p className="subtle small">
              @{user.username} · {user.email} · <StatusBadge status={user.status} />
            </p>
          </div>
        </div>
        <div className="row wrap">
          {user.status === 'invited' && (
            <Button size="sm" loading={busy === 'invite'} onClick={() => void resendInvite()}>
              Einladung erneut senden
            </Button>
          )}
          <Button size="sm" loading={busy === 'reset'} onClick={() => void sendReset()}>
            Passwort-Reset auslösen
          </Button>
          <Button size="sm" onClick={() => setDialog('profile')}>
            Profil bearbeiten
          </Button>
          {!self && user.status === 'active' && (
            <Button size="sm" variant="danger" onClick={() => setDialog('suspend')}>
              Sperren
            </Button>
          )}
          {!self && user.status === 'suspended' && (
            <Button size="sm" variant="success" onClick={() => setDialog('unsuspend')}>
              Entsperren
            </Button>
          )}
        </div>
      </div>
      <div className="grid-4">
        <div className="card card-gold">
          <div className="label">Kontostand</div>
          <div className="stat-value gold">{formatCredits(user.balance)}</div>
        </div>
        <div className="card">
          <div className="label">Spielzeit</div>
          <div className="stat-value">{formatPlaytime(user.playtime_seconds)}</div>
        </div>
        <div className="card">
          <div className="label">Runden</div>
          <div className="stat-value">{user.rounds_count}</div>
        </div>
        <div className="card">
          <div className="label">Zuletzt aktiv</div>
          <div className="small">{formatDateTime(user.last_seen_at)}</div>
          <div className="small muted">Eingeladen: {formatDateTime(user.invited_at)}</div>
        </div>
      </div>
      <div className="grid-2">
        <section className="card stack">
          <h2>Credits anpassen</h2>
          <AdjustCreditsForm
            users={users}
            presetUserId={user.id}
            onDone={() => {
              void reload();
              loadDetails();
            }}
          />
        </section>
        <section className="card stack">
          <h2>Letzte Spielrunden</h2>
          {rounds?.length ? (
            <ul className="list">
              {rounds.slice(0, 10).map((r) => (
                <li key={r.id} className="list-item small">
                  <span className="grow">
                    {r.game_key} · <span className="mono muted">{shortId(r.id)}</span>
                  </span>
                  <span className="mono">{formatCredits(r.bet_amount)}</span>
                  <span className={`mono ${r.profit_amount > 0 ? 'success' : 'subtle'}`} style={{ minWidth: 70, textAlign: 'right' }}>
                    {r.status === 'active' ? 'offen' : formatSigned(r.profit_amount)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="Keine Runden" />
          )}
        </section>
      </div>
      <section className="stack">
        <h2>Transaktionsverlauf</h2>
        {ledger?.length ? <LedgerTable entries={ledger} /> : <div className="card"><EmptyState title="Keine Buchungen" /></div>}
      </section>

      <ReasonDialog
        open={dialog === 'suspend' || dialog === 'unsuspend'}
        title={dialog === 'suspend' ? `${user.display_name} sperren` : `${user.display_name} entsperren`}
        description={dialog === 'suspend' ? 'Gesperrte Benutzer können sich nicht mehr anmelden oder spielen.' : 'Der Benutzer kann sich wieder anmelden.'}
        variant={dialog === 'suspend' ? 'danger' : 'primary'}
        confirmLabel={dialog === 'suspend' ? 'Sperren' : 'Entsperren'}
        onClose={() => setDialog(null)}
        onConfirm={async (reason) => {
          await api.admin.setStatus(user.id, dialog === 'suspend' ? 'suspended' : 'active', reason);
          toast.success(dialog === 'suspend' ? 'Benutzer gesperrt' : 'Benutzer entsperrt');
          await reload();
        }}
      />
      <ReasonDialog
        open={dialog === 'profile'}
        title="Profil bearbeiten"
        description={
          <div className="stack">
            <div className="field">
              <label htmlFor="ed-name">Anzeigename</label>
              <input id="ed-name" className="input" value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="ed-user">Benutzername</label>
              <input id="ed-user" className="input" value={editUsername} onChange={(e) => setEditUsername(e.target.value)} />
            </div>
          </div>
        }
        confirmLabel="Speichern"
        onClose={() => setDialog(null)}
        onConfirm={async (reason) => {
          const n = displayNameSchema.safeParse(editName);
          const u = usernameSchema.safeParse(editUsername);
          if (!n.success) throw new Error(n.error.issues[0].message);
          if (!u.success) throw new Error(u.error.issues[0].message);
          await api.admin.updateProfile(user.id, n.data, u.data, reason);
          toast.success('Profil aktualisiert');
          await reload();
        }}
      />
    </div>
  );
}

export function AdminInvites() {
  const { users, reload } = useAdminUsers();
  const toast = useToast();
  const [expected, setExpected] = useState<{ username: string; display_name: string; is_admin: boolean }[]>([]);
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState<string | null>(null);

  useEffect(() => {
    api.admin.expectedMembers().then(setExpected).catch(() => undefined);
  }, []);

  const registered = new Set((users ?? []).map((u) => u.username.toLowerCase()));
  const invited = (users ?? []).filter((u) => u.status === 'invited');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    const em = emailSchema.safeParse(email);
    const un = usernameSchema.safeParse(username);
    const dn = displayNameSchema.safeParse(displayName);
    if (!em.success) errs.email = em.error.issues[0].message;
    if (!un.success) errs.username = un.error.issues[0].message;
    if (!dn.success) errs.display_name = dn.error.issues[0].message;
    setErrors(errs);
    if (Object.keys(errs).length || !em.success || !un.success || !dn.success) return;
    setBusy(true);
    try {
      await api.admin.invite({ email: em.data, username: un.data, display_name: dn.data });
      toast.success('Einladung gesendet', `${dn.data} erhält einen Einladungslink per E-Mail.`);
      setEmail('');
      setUsername('');
      setDisplayName('');
      await reload();
    } catch (err) {
      toast.error('Einladung fehlgeschlagen', toAppError(err).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack-lg">
      <h1>Einladungen</h1>
      <div className="grid-2">
        <form className="card stack" onSubmit={submit} noValidate>
          <h2>Benutzer einladen</h2>
          <div className="field">
            <label htmlFor="inv-name">Anzeigename</label>
            <input id="inv-name" className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            {errors.display_name && <span className="field-error">{errors.display_name}</span>}
          </div>
          <div className="field">
            <label htmlFor="inv-user">Benutzername</label>
            <input id="inv-user" className="input" value={username} onChange={(e) => setUsername(e.target.value)} />
            {errors.username && <span className="field-error">{errors.username}</span>}
          </div>
          <div className="field">
            <label htmlFor="inv-email">E-Mail-Adresse</label>
            <input id="inv-email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
            {errors.email && <span className="field-error">{errors.email}</span>}
          </div>
          <p className="small muted">Die E-Mail-Adresse wird nur für Login und Einladung genutzt und ist für andere Spieler nicht sichtbar.</p>
          <Button type="submit" variant="primary" loading={busy}>
            Einladung senden
          </Button>
        </form>
        <div className="card stack">
          <h2>Erwartete Mitglieder</h2>
          <p className="small subtle">Klicke auf einen Namen, um das Formular vorzubefüllen.</p>
          <ul className="list">
            {expected.map((m) => {
              const done = registered.has(m.username.toLowerCase());
              return (
                <li key={m.username} className="list-item">
                  <Avatar name={m.display_name} size={30} />
                  <span className="grow">
                    {m.display_name} {m.is_admin && <span className="badge badge-gold">Admin</span>}
                  </span>
                  {done ? (
                    <span className="badge badge-success">angelegt</span>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => {
                        setDisplayName(m.display_name);
                        setUsername(m.username);
                      }}
                    >
                      Übernehmen
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
      <section className="card stack">
        <h2>Offene Einladungen</h2>
        {invited.length ? (
          <ul className="list">
            {invited.map((u) => (
              <li key={u.id} className="list-item">
                <span className="grow">
                  <strong>{u.display_name}</strong> <span className="small muted">{u.email}</span>
                  <br />
                  <span className="small muted">Eingeladen {relativeTime(u.invited_at)}</span>
                </span>
                <Button
                  size="sm"
                  loading={resending === u.id}
                  onClick={async () => {
                    setResending(u.id);
                    try {
                      await api.admin.invite({ email: u.email ?? '', resend: true });
                      toast.success('Einladung erneut gesendet');
                    } catch (e) {
                      toast.error('Fehlgeschlagen', toAppError(e).message);
                    } finally {
                      setResending(null);
                    }
                  }}
                >
                  Erneut senden
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="Keine offenen Einladungen" />
        )}
      </section>
    </div>
  );
}
