import { forwardRef, useEffect, useRef, useState, type ButtonHTMLAttributes } from 'react';

type Variant = 'default' | 'primary' | 'gold' | 'danger' | 'success' | 'ghost';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg';
  block?: boolean;
  loading?: boolean;
  /** Kurzzeitiges visuelles Feedback nach einer Serverantwort */
  feedback?: 'success' | 'error' | null;
}

/**
 * Button mit allen Zuständen: normal, hover, gedrückt, Fokus, deaktiviert,
 * wird verarbeitet (loading), erfolgreich, fehlgeschlagen.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'default', size = 'md', block, loading, feedback, className = '', disabled, children, type = 'button', ...rest },
  ref,
) {
  const cls = [
    'btn',
    variant !== 'default' && `btn-${variant}`,
    size !== 'md' && `btn-${size}`,
    block && 'btn-block',
    loading && 'is-loading',
    feedback === 'success' && 'is-success',
    feedback === 'error' && 'is-error',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button
      ref={ref}
      type={type}
      className={cls}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {children}
    </button>
  );
});

/**
 * Hook für Aktionen mit Doppelklick-Schutz: solange eine Anfrage läuft, wird jeder
 * weitere Aufruf ignoriert (synchron per Ref, nicht erst nach dem nächsten Render).
 */
export function useAction<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<'success' | 'error' | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      window.clearTimeout(timer.current);
    };
  }, []);

  const run = async (...args: A): Promise<R | undefined> => {
    if (busyRef.current) return undefined;
    busyRef.current = true;
    setBusy(true);
    setFeedback(null);
    try {
      const r = await fn(...args);
      if (mounted.current) setFeedback('success');
      return r;
    } catch (e) {
      if (mounted.current) setFeedback('error');
      throw e;
    } finally {
      busyRef.current = false;
      if (mounted.current) {
        setBusy(false);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => mounted.current && setFeedback(null), 1200);
      }
    }
  };

  return { run, busy, feedback };
}
