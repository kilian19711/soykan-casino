import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAppData } from '../../app/AppData';
import { relativeTime } from '../../lib/format';
import { Button } from '../../components/Button';
import { IconBell, IconX } from '../../components/Icons';
import { EmptyState, Spinner } from '../../components/ui';
import type { NotificationItem } from '../../types';

export function useNotifications(limit = 50) {
  const { notificationsVersion, setUnread } = useAppData();
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await api.getNotifications(limit);
      setItems(list);
      setUnread(list.filter((n) => !n.read_at).length);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler');
    }
  }, [limit, setUnread]);

  useEffect(() => {
    void load();
  }, [load, notificationsVersion]);

  const markRead = useCallback(
    async (ids: string[] | null) => {
      await api.markNotificationsRead(ids);
      setItems((list) =>
        list?.map((n) => (ids === null || ids.includes(n.id) ? { ...n, read_at: n.read_at ?? new Date().toISOString() } : n)) ?? null,
      );
      setUnread(0);
      void load();
    },
    [load, setUnread],
  );

  return { items, error, reload: load, markRead };
}

const TYPE_ICON: Record<string, string> = {
  announcement: '🎁',
  quest_completed: '🎯',
  achievement: '🏆',
  admin_credit: '➕',
  admin_debit: '➖',
  credit_request_new: '📨',
  credit_request_approved: '✅',
  credit_request_rejected: '✖',
  week_finalized: '📦',
  duel: '⚔️',
  gift_received: '🎁',
  prediction: '🎯',
  jackpot: '💰',
};

function NotificationRow({ n, onMarkRead }: { n: NotificationItem; onMarkRead?: (id: string) => void }) {
  const unread = !n.read_at;
  const Tag = unread && onMarkRead ? 'button' : 'div';
  return (
    <li>
      <Tag
        type={Tag === 'button' ? 'button' : undefined}
        className={`notif ${unread ? 'unread' : ''}`}
        onClick={unread && onMarkRead ? () => onMarkRead(n.id) : undefined}
        aria-label={unread ? `${n.title} – als gelesen markieren` : undefined}
      >
        <span className="notif-icon" aria-hidden="true">
          {TYPE_ICON[n.type] ?? '🔔'}
        </span>
        <span className="notif-body">
          <span className="notif-head">
            <strong>{n.title}</strong>
            <span className="small muted">{relativeTime(n.created_at)}</span>
          </span>
          <span className="small subtle notif-text">{n.message}</span>
        </span>
        {unread && <span className="notif-dot" aria-hidden="true" />}
      </Tag>
    </li>
  );
}

/** Neue Benachrichtigungen oben, gelesene in einem aufklappbaren Bereich darunter. */
export function NotificationList({ items, onMarkRead }: { items: NotificationItem[]; onMarkRead: (id: string) => void }) {
  const fresh = items.filter((n) => !n.read_at);
  const old = items.filter((n) => n.read_at);
  return (
    <div className="stack">
      {fresh.length ? (
        <>
          <div className="label">Neu · {fresh.length}</div>
          <ul className="notif-list">
            {fresh.map((n) => (
              <NotificationRow key={n.id} n={n} onMarkRead={onMarkRead} />
            ))}
          </ul>
          <p className="small muted" style={{ textAlign: 'center' }}>
            Antippen = gelesen
          </p>
        </>
      ) : (
        <EmptyState icon={<IconBell size={28} />} title="Keine neuen Benachrichtigungen" text="Du bist auf dem neuesten Stand." />
      )}
      {old.length > 0 && (
        <details className="notif-past">
          <summary>
            Vergangene Benachrichtigungen <span className="muted">({old.length})</span>
          </summary>
          <ul className="notif-list">
            {old.map((n) => (
              <NotificationRow key={n.id} n={n} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export function NotificationDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { items, error, markRead } = useNotifications(30);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="Benachrichtigungen">
        <div className="row-between">
          <h2>Benachrichtigungen</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Schließen" autoFocus>
            <IconX />
          </button>
        </div>
        <div className="row">
          <Button size="sm" onClick={() => void markRead(null)} disabled={!items?.some((n) => !n.read_at)}>
            Alle als gelesen markieren
          </Button>
          <Link to="/benachrichtigungen" className="btn btn-ghost btn-sm" onClick={onClose}>
            Alle anzeigen
          </Link>
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {error && <p className="danger small">{error}</p>}
          {!items && !error && <Spinner />}
          {items && <NotificationList items={items} onMarkRead={(id) => void markRead([id])} />}
        </div>
      </aside>
    </>,
    document.body,
  );
}
