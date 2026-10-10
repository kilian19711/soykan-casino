import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { api } from '../../lib/api';
import { useAuth } from '../auth/AuthProvider';
import { useAppData } from '../../app/AppData';
import { authErrorMessage, toAppError } from '../../lib/errors';
import { formatDateTime, formatPlaytime } from '../../lib/format';
import { loadPreferences, savePreferences, type Preferences } from '../../lib/preferences';
import { playTone } from '../../lib/misc';
import { Button } from '../../components/Button';
import { useToast } from '../../components/Toast';
import { Avatar, Credits } from '../../components/ui';
import { IconLogout } from '../../components/Icons';
import { displayNameSchema, fieldErrors, setPasswordSchema } from '../auth/validation';
import { NotificationList, useNotifications } from '../notifications/NotificationDrawer';
import { removeAvatar, uploadAvatar } from '../../lib/avatar';
import { currentSubscription, disablePush, enablePush, needsInstallForPush, pushSupported } from '../../lib/push';

const SEEDS = ['nebula', 'ember', 'mint', 'royal', 'ocean', 'sunset', 'aurora', 'onyx'];

export function ProfilePage() {
  const { profile, session, refreshProfile } = useAuth();
  const { dashboard } = useAppData();
  const toast = useToast();
  const [params] = useSearchParams();
  const setup = params.get('setup') === '1';
  const [name, setName] = useState(profile?.display_name ?? '');
  const [seed, setSeed] = useState(profile?.avatar_seed ?? '');
  const [nameError, setNameError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);

  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [pwErrors, setPwErrors] = useState<Record<string, string>>({});
  const [pwBusy, setPwBusy] = useState(false);

  useEffect(() => {
    setName(profile?.display_name ?? '');
    setSeed(profile?.avatar_seed ?? '');
  }, [profile?.display_name, profile?.avatar_seed]);

  if (!profile) return null;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = displayNameSchema.safeParse(name);
    if (!parsed.success) {
      setNameError(parsed.error.issues[0].message);
      return;
    }
    setNameError(null);
    setSaving(true);
    try {
      await api.updateMyProfile(parsed.data, seed && !seed.startsWith('img:') ? seed : null);
      await refreshProfile();
      toast.success('Profil gespeichert');
    } catch (err) {
      toast.error('Speichern fehlgeschlagen', toAppError(err).message);
    } finally {
      setSaving(false);
    }
  };

  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = setPasswordSchema.safeParse({ password: pw, confirm: pw2 });
    setPwErrors(fieldErrors(parsed));
    if (!parsed.success) return;
    setPwBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
      if (error) throw error;
      setPw('');
      setPw2('');
      toast.success('Passwort geändert');
    } catch (err) {
      toast.error('Passwort nicht geändert', authErrorMessage(err));
    } finally {
      setPwBusy(false);
    }
  };

  return (
    <div className="stack-lg" style={{ maxWidth: 760 }}>
      {setup && (
        <div className="notice notice-gold">
          <span>
            <strong>Willkommen bei Shishabar Online Casino!</strong> Dein Konto ist aktiv. Wähle einen Anzeigenamen und einen
            Avatar – danach kannst du deinen Tagesbonus abholen.
          </span>
        </div>
      )}
      <div className="page-head">
        <div>
          <h1>Profil</h1>
          <p>
            @{profile.username} · {profile.role === 'admin' ? 'Administrator' : 'Spieler'} · Mitglied seit {formatDateTime(profile.created_at)}
          </p>
        </div>
      </div>

      <div className="grid-3">
        <div className="card">
          <div className="label">Kontostand</div>
          <div className="stat-value gold">
            <Credits value={dashboard?.balance} />
          </div>
        </div>
        <div className="card">
          <div className="label">Spielzeit gesamt</div>
          <div className="stat-value">{formatPlaytime(dashboard?.playtime_total)}</div>
        </div>
        <div className="card">
          <div className="label">Platzierung</div>
          <div className="stat-value">{dashboard?.rank ? `#${dashboard.rank}` : '–'}</div>
        </div>
      </div>

      <form className="card stack" onSubmit={save} noValidate>
        <h2>Profil bearbeiten</h2>
        <div className="row" style={{ gap: 16 }}>
          <div className="stack center" style={{ gap: 4, flex: 'none' }}>
            <button
              type="button"
              className="avatar-upload"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              aria-label="Profilbild hochladen"
              title="Profilbild hochladen"
            >
              <Avatar name={name || profile.display_name} seed={seed || profile.username} size={72} />
              <span className="avatar-upload-badge" aria-hidden="true">
                {uploading ? '…' : '📷'}
              </span>
            </button>
            {seed?.startsWith('img:') && (
              <button
                type="button"
                className="link-btn small muted"
                disabled={uploading}
                onClick={async () => {
                  setUploading(true);
                  try {
                    const def = profile.username;
                    await removeAvatar(profile.id);
                    setSeed(def);
                    await refreshProfile();
                    toast.success('Profilbild entfernt');
                  } catch (err) {
                    toast.error('Nicht entfernt', err instanceof Error ? err.message : '');
                  } finally {
                    setUploading(false);
                  }
                }}
              >
                Bild entfernen
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                setUploading(true);
                try {
                  const newSeed = await uploadAvatar(profile.id, file);
                  setSeed(newSeed);
                  await refreshProfile();
                  toast.success('Profilbild gespeichert', 'Alle sehen jetzt dein neues Bild.');
                } catch (err) {
                  toast.error('Profilbild nicht gespeichert', err instanceof Error ? err.message : '');
                } finally {
                  setUploading(false);
                }
              }}
            />
          </div>
          <div className="field grow">
            <label htmlFor="display-name">Anzeigename</label>
            <input id="display-name" className="input" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} aria-invalid={nameError ? true : undefined} />
            {nameError && <span className="field-error">{nameError}</span>}
          </div>
        </div>
        <div className="field">
          <span className="field-label">Avatar-Farbe <span className="muted" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>(oder oben aufs Bild tippen für ein eigenes Foto)</span></span>
          <div className="chip-group" role="group" aria-label="Avatar wählen">
            {SEEDS.map((s) => (
              <button key={s} type="button" className="chip" aria-pressed={seed === s} onClick={() => setSeed(s)} style={{ padding: 4 }} aria-label={`Avatar ${s}`}>
                <Avatar name={name || profile.display_name} seed={s} size={30} />
              </button>
            ))}
          </div>
        </div>
        <p className="small muted">Deine E-Mail-Adresse ist privat und erscheint nie im Leaderboard.</p>
        <Button type="submit" variant="primary" loading={saving}>
          Speichern
        </Button>
        {setup && (
          <Button variant="gold" onClick={() => (window.location.href = '/')}>
            Weiter zum Dashboard
          </Button>
        )}
      </form>

      <section className="card stack">
        <h2>Erfolge &amp; Daily Quests</h2>
        <p className="small subtle">Deine Erfolge mit Fortschritt und die 3 Daily Quests des Tages.</p>
        <div className="row wrap">
          <Link to="/quests" className="btn btn-sm btn-primary">
            Daily Quests
          </Link>
          <Link to="/quests?tab=erfolge" className="btn btn-sm">
            Erfolge
          </Link>
        </div>
      </section>

      <form className="card stack" onSubmit={changePassword} noValidate>
        <h2>Passwort ändern</h2>
        <div className="grid-2">
          <div className="field">
            <label htmlFor="pw1">Neues Passwort</label>
            <input id="pw1" type="password" className="input" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} aria-invalid={pwErrors.password ? true : undefined} />
            {pwErrors.password && <span className="field-error">{pwErrors.password}</span>}
          </div>
          <div className="field">
            <label htmlFor="pw2">Wiederholen</label>
            <input id="pw2" type="password" className="input" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} aria-invalid={pwErrors.confirm ? true : undefined} />
            {pwErrors.confirm && <span className="field-error">{pwErrors.confirm}</span>}
          </div>
        </div>
        <Button type="submit" loading={pwBusy}>
          Passwort ändern
        </Button>
      </form>
      <p className="small muted">Angemeldet als {session?.user.email ?? '–'} (nur für dich sichtbar)</p>
    </div>
  );
}

function NotificationSettings() {
  const { profile, refreshProfile } = useAuth();
  const toast = useToast();
  const [pushOn, setPushOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const prefs = profile?.preferences ?? {};
  useEffect(() => {
    currentSubscription().then((s) => setPushOn(!!s)).catch(() => setPushOn(false));
  }, []);
  const setPref = async (key: 'announcements' | 'show_feed', value: boolean) => {
    setBusy(key);
    try {
      await api.updatePreferences({ [key]: value });
      await refreshProfile();
    } catch (e) {
      toast.error('Nicht gespeichert', toAppError(e).message);
    } finally {
      setBusy(null);
    }
  };
  const togglePush = async () => {
    setBusy('push');
    try {
      if (pushOn) {
        await disablePush();
        setPushOn(false);
        toast.info('Push-Benachrichtigungen aus');
      } else {
        const r = await enablePush();
        if (r === 'enabled') {
          setPushOn(true);
          toast.success('Push-Benachrichtigungen aktiv', 'Du wirst über Bonus, Erinnerungen und Ereignisse informiert.');
        } else if (r === 'denied') toast.error('Nicht erlaubt', 'Bitte erlaube Mitteilungen in den Geräte-Einstellungen.');
        else if (r === 'unconfigured') toast.error('Noch nicht verfügbar', 'Push-Nachrichten sind gerade noch nicht verfügbar.');
        else toast.error('Nicht unterstützt', 'Dieser Browser unterstützt keine Push-Benachrichtigungen.');
      }
    } catch (e) {
      toast.error('Fehler', toAppError(e).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="card stack">
      <h2>Benachrichtigungen</h2>
      <label className="checkbox">
        <input type="checkbox" checked={prefs.announcements !== false} disabled={busy === 'announcements'}
          onChange={(e) => void setPref('announcements', e.target.checked)} />
        <span>
          Ankündigungen <span className="small muted">(Tagesbonus um 0 Uhr, Erinnerungen um 10 und 18 Uhr)</span>
        </span>
      </label>
      <label className="checkbox">
        <input type="checkbox" checked={prefs.show_feed === true} disabled={busy === 'show_feed'}
          onChange={(e) => void setPref('show_feed', e.target.checked)} />
        <span>
          Live-Feed großer Gewinne im Dashboard anzeigen <span className="small muted">(standardmäßig aus)</span>
        </span>
      </label>
      <div className="row-between wrap">
        <span>
          Push-Benachrichtigungen auf diesem Gerät{' '}
          <span className="small muted">{pushOn === null ? '' : pushOn ? '(aktiv)' : '(aus)'}</span>
        </span>
        <Button size="sm" variant={pushOn ? 'default' : 'primary'} loading={busy === 'push'} disabled={!pushSupported() && !pushOn} onClick={() => void togglePush()}>
          {pushOn ? 'Deaktivieren' : 'Aktivieren'}
        </Button>
      </div>
      {needsInstallForPush() && (
        <p className="small muted">Auf dem iPhone funktionieren Push-Benachrichtigungen nur, wenn die App zum Home-Bildschirm hinzugefügt wurde (ab iOS 16.4).</p>
      )}
    </section>
  );
}

export function SettingsPage() {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [prefs, setPrefs] = useState<Preferences>(loadPreferences);
  const [signingOut, setSigningOut] = useState(false);
  const isStandalone =
    typeof window !== 'undefined' &&
    (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true);

  const update = (patch: Partial<Preferences>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    savePreferences(next);
    if (patch.sound) playTone('click');
  };

  return (
    <div className="stack-lg" style={{ maxWidth: 760 }}>
      <div className="page-head">
        <div>
          <h1>Einstellungen</h1>
          <p>Diese Einstellungen gelten nur für dieses Gerät.</p>
        </div>
      </div>
      <section className="card stack">
        <h2>Feedback & Animationen</h2>
        <label className="checkbox">
          <input type="checkbox" checked={prefs.sound} onChange={(e) => update({ sound: e.target.checked })} />
          <span>
            Soundeffekte <span className="small muted">(standardmäßig aus, startet nie automatisch)</span>
          </span>
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={prefs.haptics} onChange={(e) => update({ haptics: e.target.checked })} />
          <span>
            Haptisches Feedback <span className="small muted">(auf unterstützten Geräten)</span>
          </span>
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={prefs.confetti} onChange={(e) => update({ confetti: e.target.checked })} />
          <span>Münzregen bei großen Gewinnen</span>
        </label>
        <p className="small muted">
          Bei aktivierter Systemeinstellung „Bewegung reduzieren" werden Animationen automatisch stark reduziert.
        </p>
      </section>

      <NotificationSettings />

      <section className="card stack">
        <h2>App auf dem iPhone installieren</h2>
        {isStandalone ? (
          <p className="subtle">Die App läuft bereits als installierte Web-App.</p>
        ) : (
          <ol className="subtle" style={{ margin: 0, paddingLeft: 20, lineHeight: 1.9 }}>
            <li>Safari öffnen und diese Seite aufrufen.</li>
            <li>
              Auf <strong>Teilen</strong> tippen (Quadrat mit Pfeil nach oben).
            </li>
            <li>
              <strong>„Zum Home-Bildschirm"</strong> auswählen.
            </li>
            <li>
              Mit <strong>Hinzufügen</strong> bestätigen.
            </li>
          </ol>
        )}
        <p className="small muted">Die App funktioniert auch ganz normal im mobilen Browser.</p>
      </section>

      <section className="card stack">
        <h2>Konto</h2>
        <Button
          variant="danger"
          loading={signingOut}
          onClick={async () => {
            setSigningOut(true);
            await signOut();
            navigate('/login', { replace: true });
          }}
        >
          <IconLogout size={18} /> Abmelden
        </Button>
      </section>
    </div>
  );
}

export function NotificationsPage() {
  const { items, error, markRead, reload } = useNotifications(100);
  return (
    <div className="stack-lg" style={{ maxWidth: 760 }}>
      <div className="page-head">
        <div>
          <h1>Benachrichtigungen</h1>
          <p>Bonus, Quests, Duelle, Geschenke und Abrechnungen.</p>
        </div>
        <Button size="sm" onClick={() => void markRead(null)} disabled={!items?.some((n) => !n.read_at)}>
          Alle als gelesen markieren
        </Button>
      </div>
      {error && (
        <div className="notice notice-danger">
          {error}{' '}
          <Button size="sm" onClick={() => void reload()}>
            Erneut versuchen
          </Button>
        </div>
      )}
      <div className="card">{items ? <NotificationList items={items} onMarkRead={(id) => void markRead([id])} /> : <div className="skeleton" style={{ height: 200 }} />}</div>
    </div>
  );
}
