import { useEffect, useRef } from 'react';

/** Tastaturkürzel für wesentliche Spielaktionen (ignoriert Eingaben in Formularfeldern). */
export function useHotkey(keys: string[], handler: () => void, enabled = true) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (target?.closest('[role="dialog"]')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (keys.includes(e.key)) {
        e.preventDefault();
        ref.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, keys.join('|')]);
}
