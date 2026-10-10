import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase, supabaseConfigured } from '../../lib/supabase';
import { api } from '../../lib/api';
import { authErrorMessage } from '../../lib/errors';
import { useAuth } from './AuthProvider';
import { LogoCoin } from '../../components/Logo';
import { Button } from '../../components/Button';
import { PageLoading } from '../../components/ui';
import {
  emailSchema,
  fieldErrors,
  loginLockRemaining,
  loginSchema,
  registerLoginFailure,
  resetLoginFailures,
  setPasswordSchema,
} from './validation';

function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="auth-page">
      <main className="auth-card">
        <div className="auth-logo">
          <LogoCoin size={68} />
          <div>
            <h1>{title}</h1>
            {subtitle && <p className="subtle" style={{ marginTop: 6 }}>{subtitle}</p>}
          </div>
        </div>
        <div className="card stack-lg">{children}</div>
      </main>
    </div>
  );
}

function Field({
  id,
  label,
  error,
  ...input
}: { id: string; label: string; error?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className="input"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : undefined}
        {...input}
      />
      {error && (
        <span id={`${id}-err`} className="field-error">
          {error}
        </span>
      )}
    </div>
  );
}

function ConfigMissing() {
  return (
    <div className="notice notice-warn">
      Supabase ist nicht konfiguriert. Lege <code>VITE_SUPABASE_URL</code> und <code>VITE_SUPABASE_ANON_KEY</code> in{' '}
      <code>.env.local</code> bzw. in Netlify an.
    </div>
  );
}

// ---------------------------------------------------------------------------
export function LoginPage() {
  const { session, profile, signIn, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading) return <PageLoading />;
  if (session && profile?.status === 'active') {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from && from !== '/login' ? from : '/'} replace />;
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setFormError(null);
    const parsed = loginSchema.safeParse({ email, password });
    setErrors(fieldErrors(parsed));
    if (!parsed.success) return;
    const lock = loginLockRemaining();
    if (lock > 0) {
      setFormError(`Zu viele Fehlversuche. Bitte warte ${Math.ceil(lock / 1000)} Sekunden.`);
      return;
    }
    setBusy(true);
    try {
      await signIn(parsed.data.email, parsed.data.password);
      resetLoginFailures();
      navigate('/', { replace: true });
    } catch (err) {
      registerLoginFailure();
      setFormError(err instanceof Error ? err.message : authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Willkommen zurück" subtitle="Melde dich bei Shishabar Online Casino an.">
      {!supabaseConfigured && <ConfigMissing />}
      <form className="stack" onSubmit={submit} noValidate>
        <Field
          id="email"
          label="E-Mail"
          type="email"
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
        />
        <Field
          id="password"
          label="Passwort"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
        />
        {formError && (
          <div className="notice notice-danger" role="alert">
            {formError}
          </div>
        )}
        <Button type="submit" variant="primary" size="lg" block loading={busy}>
          Anmelden
        </Button>
      </form>
      <div className="row-between small">
        <Link to="/passwort-vergessen">Passwort vergessen?</Link>
        <span className="muted">Zugang nur per Einladung</span>
      </div>
    </AuthShell>
  );
}

// ---------------------------------------------------------------------------
function parseHashError(): string | null {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const query = new URLSearchParams(window.location.search);
  const code = hash.get('error_code') || query.get('error_code');
  const desc = hash.get('error_description') || query.get('error_description');
  if (!code && !desc) return null;
  if (code === 'otp_expired' || /expired/i.test(desc ?? '')) {
    return 'Dieser Link ist abgelaufen. Bitte den Admin, dir eine neue Einladung bzw. einen neuen Link zu senden.';
  }
  return 'Dieser Link ist ungültig oder wurde bereits verwendet.';
}

function SetPasswordForm({ submitLabel, onDone }: { submitLabel: string; onDone: () => Promise<void> | void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setFormError(null);
    const parsed = setPasswordSchema.safeParse({ password, confirm });
    setErrors(fieldErrors(parsed));
    if (!parsed.success) return;
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
      if (error) throw error;
      await onDone();
    } catch (err) {
      setFormError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="stack" onSubmit={submit} noValidate>
      <Field
        id="new-password"
        label="Neues Passwort"
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        error={errors.password}
      />
      <Field
        id="confirm-password"
        label="Passwort wiederholen"
        type="password"
        autoComplete="new-password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        error={errors.confirm}
      />
      <p className="field-hint">Mindestens 8 Zeichen, mit mindestens einem Buchstaben und einer Ziffer.</p>
      {formError && (
        <div className="notice notice-danger" role="alert">
          {formError}
        </div>
      )}
      <Button type="submit" variant="primary" size="lg" block loading={busy}>
        {submitLabel}
      </Button>
    </form>
  );
}

/** Einladungsannahme + Passwort setzen. */
export function InvitePage() {
  const { session, profile, loading, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [linkError] = useState(parseHashError);
  const [waited, setWaited] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setWaited(true), 2500);
    return () => window.clearTimeout(t);
  }, []);

  if (loading || (!session && !waited && !linkError)) return <PageLoading />;

  if (linkError || !session) {
    return (
      <AuthShell title="Einladung" subtitle="Einladungslink konnte nicht verwendet werden.">
        <div className="notice notice-danger" role="alert">
          {linkError ?? 'Kein gültiger Einladungslink gefunden. Öffne den Link direkt aus deiner Einladungs-E-Mail.'}
        </div>
        <Link to="/login" className="btn btn-block">
          Zur Anmeldung
        </Link>
      </AuthShell>
    );
  }

  if (profile?.status === 'active') return <Navigate to="/" replace />;

  return (
    <AuthShell
      title={`Willkommen${profile ? `, ${profile.display_name}` : ''}!`}
      subtitle="Du wurdest zu Shishabar Online Casino eingeladen. Lege jetzt dein Passwort fest."
    >
      <SetPasswordForm
        submitLabel="Passwort festlegen"
        onDone={async () => {
          await api.activateAccount();
          await refreshProfile();
          navigate('/profil?setup=1', { replace: true });
        }}
      />
    </AuthShell>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { error: err } = await supabase.auth.resetPasswordForEmail(parsed.data, {
        redirectTo: `${window.location.origin}/passwort-zuruecksetzen`,
      });
      if (err && /rate|too many/i.test(err.message)) throw err;
      // Aus Datenschutzgründen immer dieselbe Meldung – unabhängig davon, ob die Adresse existiert.
      setSent(true);
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Passwort vergessen" subtitle="Wir senden dir einen Link zum Zurücksetzen.">
      {sent ? (
        <div className="notice notice-gold" role="status">
          Falls ein Konto mit dieser Adresse existiert, wurde eine E-Mail mit einem Reset-Link versendet. Bitte prüfe auch
          deinen Spam-Ordner.
        </div>
      ) : (
        <form className="stack" onSubmit={submit} noValidate>
          <Field
            id="reset-email"
            label="E-Mail"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={error ?? undefined}
          />
          <Button type="submit" variant="primary" size="lg" block loading={busy}>
            Reset-Link senden
          </Button>
        </form>
      )}
      <Link to="/login" className="small">
        ← Zurück zur Anmeldung
      </Link>
    </AuthShell>
  );
}

export function ResetPasswordPage() {
  const { session, loading, refreshProfile, clearRecovery } = useAuth();
  const navigate = useNavigate();
  const [linkError] = useState(parseHashError);
  const [waited, setWaited] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setWaited(true), 2500);
    return () => window.clearTimeout(t);
  }, []);

  if (loading || (!session && !waited && !linkError)) return <PageLoading />;

  if (done) {
    return (
      <AuthShell title="Passwort geändert" subtitle="Dein neues Passwort ist aktiv.">
        <Button variant="primary" block onClick={() => navigate('/', { replace: true })}>
          Weiter zum Dashboard
        </Button>
      </AuthShell>
    );
  }

  if (linkError || !session) {
    return (
      <AuthShell title="Passwort zurücksetzen">
        <div className="notice notice-danger" role="alert">
          {linkError ?? 'Kein gültiger Reset-Link gefunden. Bitte fordere einen neuen Link an.'}
        </div>
        <Link to="/passwort-vergessen" className="btn btn-primary btn-block">
          Neuen Link anfordern
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Neues Passwort" subtitle="Lege ein neues Passwort für dein Konto fest.">
      <SetPasswordForm
        submitLabel="Passwort speichern"
        onDone={async () => {
          await api.activateAccount().catch(() => undefined);
          await refreshProfile();
          clearRecovery();
          setDone(true);
        }}
      />
    </AuthShell>
  );
}

export function ErrorPage() {
  const [params] = useSearchParams();
  const code = params.get('code');
  const title = code === '403' ? 'Kein Zugriff' : code === 'profile' ? 'Profil fehlt' : 'Seite nicht gefunden';
  const text =
    code === '403'
      ? 'Für diesen Bereich fehlen dir die Berechtigungen.'
      : code === 'profile'
        ? 'Zu deinem Login wurde kein Profil gefunden. Bitte wende dich an den Admin.'
        : 'Die angeforderte Seite existiert nicht oder wurde verschoben.';
  return (
    <AuthShell title={title} subtitle={text}>
      <Link to="/" className="btn btn-primary btn-block">
        Zum Dashboard
      </Link>
    </AuthShell>
  );
}

