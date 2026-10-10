import { useEffect, useState } from 'react';

/** Klarer Offline-Hinweis statt irreführender Offline-Funktionen. */
export function OfflineBanner() {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  if (online) return null;
  return (
    <div className="offline-banner" role="alert">
      Keine Internetverbindung – Spiele und Kontostände sind offline nicht verfügbar.
    </div>
  );
}
