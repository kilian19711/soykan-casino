// Kleine wiederverwendbare UI-Bausteine.
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { formatCountdown, formatCredits } from '../lib/format';
import { serverNow } from '../lib/misc';
import { avatarImageUrl } from '../lib/avatar';
import { Button } from './Button';
import { Modal } from './Modal';

const AVATAR_COLORS = [
  ['#4f8ef7', '#7c5df9'],
  ['#d8a84e', '#a0702a'],
  ['#22c55e', '#0f766e'],
  ['#ef4444', '#9d174d'],
  ['#f59e0b', '#b45309'],
  ['#06b6d4', '#2563eb'],
  ['#a855f7', '#6d28d9'],
  ['#ec4899', '#be185d'],
];

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function Avatar({ name, seed, size = 36 }: { name: string; seed?: string | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  const img = failed ? null : avatarImageUrl(seed);
  const [a, b] = AVATAR_COLORS[hash(seed || name) % AVATAR_COLORS.length];
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2);
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize: size * 0.4, background: `linear-gradient(135deg, ${a}, ${b})` }}
      aria-hidden="true"
    >
      {img ? (
        <img src={img} alt="" width={size} height={size} loading="lazy" decoding="async" onError={() => setFailed(true)} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      ) : (
        initials
      )}
    </span>
  );
}

export function Credits({ value, className = '', unit = true }: { value: number | null | undefined; className?: string; unit?: boolean }) {
  return (
    <span className={`mono ${className}`}>
      {formatCredits(value)}
      {unit && <span style={{ fontSize: '0.6em', marginLeft: 4, letterSpacing: '0.06em', fontFamily: 'var(--font)' }}>CR</span>}
    </span>
  );
}

export function Spinner({ label = 'Wird geladen …' }: { label?: string }) {
  return (
    <span role="status" aria-live="polite" className="row">
      <span className="spinner" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function PageLoading() {
  return (
    <div className="page-loading">
      <Spinner />
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  text,
  action,
}: {
  icon?: ReactNode;
  title: string;
  text?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      {icon}
      <strong>{title}</strong>
      {text && <p className="small">{text}</p>}
      {action && <div style={{ marginTop: 6 }}>{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="notice notice-danger" role="alert">
      <div className="grow">
        <strong>Fehler beim Laden.</strong> {message}
      </div>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          Erneut versuchen
        </Button>
      )}
    </div>
  );
}

/** Countdown auf Basis der Serverzeit. */
export function Countdown({ target, onDone, className = '' }: { target: string | number; onDone?: () => void; className?: string }) {
  const targetMs = typeof target === 'number' ? target : new Date(target).getTime();
  const [now, setNow] = useState(serverNow());
  useEffect(() => {
    const id = window.setInterval(() => setNow(serverNow()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const remaining = targetMs - now;
  useEffect(() => {
    if (remaining <= 0) onDone?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining <= 0]);
  return (
    <span className={`mono ${className}`} aria-label={`Verbleibend: ${formatCountdown(remaining)}`}>
      {formatCountdown(remaining)}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    pending: ['badge-warn', 'Offen'],
    approved: ['badge-success', 'Genehmigt'],
    rejected: ['badge-danger', 'Abgelehnt'],
    cancelled: ['', 'Storniert'],
    active: ['badge-success', 'Aktiv'],
    invited: ['badge-accent', 'Eingeladen'],
    suspended: ['badge-danger', 'Gesperrt'],
    deleted: ['', 'Gelöscht'],
    settled: ['', 'Abgerechnet'],
  };
  const [cls, label] = map[status] ?? ['', status];
  return <span className={`badge ${cls}`}>{label}</span>;
}

export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel = 'Bestätigen',
  variant = 'primary',
  loading,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel?: string;
  variant?: 'primary' | 'danger' | 'gold';
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={() => !loading && onCancel()}
      title={title}
      footer={
        <>
          <Button onClick={onCancel} disabled={loading}>
            Abbrechen
          </Button>
          <Button variant={variant} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Modal>
  );
}

export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="small subtle" style={{ display: 'inline-flex', gap: 6, alignItems: 'center', marginBottom: 10 }}>
      ← {children}
    </Link>
  );
}
