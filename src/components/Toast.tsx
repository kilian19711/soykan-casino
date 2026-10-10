import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { IconAlert, IconCheck, IconInfo, IconSpark, IconX } from './Icons';

export type ToastKind = 'success' | 'error' | 'info' | 'win' | 'warn';

interface ToastItem {
  id: number;
  kind: ToastKind;
  title: string;
  message?: string;
}

interface ToastApi {
  show: (kind: ToastKind, title: string, message?: string, durationMs?: number) => void;
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
  win: (title: string, message?: string) => void;
  warn: (title: string, message?: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setItems((list) => list.filter((t) => t.id !== id)), []);

  const show = useCallback(
    (kind: ToastKind, title: string, message?: string, durationMs = kind === 'error' ? 6000 : 3800) => {
      const id = nextId.current++;
      setItems((list) => [...list.slice(-3), { id, kind, title, message }]);
      window.setTimeout(() => dismiss(id), durationMs);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (t, m) => show('success', t, m),
      error: (t, m) => show('error', t, m),
      info: (t, m) => show('info', t, m),
      win: (t, m) => show('win', t, m),
      warn: (t, m) => show('warn', t, m),
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastStack items={items} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function ToastStack({ items, onDismiss }: { items: ToastItem[]; onDismiss: (id: number) => void }) {
  return (
    <div className="toast-stack" aria-live="polite" aria-atomic="false">
      {items.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
          <span
            className={t.kind === 'error' ? 'danger' : t.kind === 'win' ? 'gold' : t.kind === 'success' ? 'success' : t.kind === 'warn' ? 'warn' : 'subtle'}
            style={{ marginTop: 1 }}
          >
            {t.kind === 'error' || t.kind === 'warn' ? (
              <IconAlert size={18} />
            ) : t.kind === 'win' ? (
              <IconSpark size={18} />
            ) : t.kind === 'success' ? (
              <IconCheck size={18} />
            ) : (
              <IconInfo size={18} />
            )}
          </span>
          <div className="grow">
            <strong>{t.title}</strong>
            {t.message && <span className="subtle small">{t.message}</span>}
          </div>
          <button type="button" className="toast-close" onClick={() => onDismiss(t.id)} aria-label="Meldung schließen">
            <IconX size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast außerhalb von ToastProvider');
  return ctx;
}
