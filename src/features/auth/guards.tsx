import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { PageLoading } from '../../components/ui';
import { LogoCoin } from '../../components/Logo';
import { Button } from '../../components/Button';

/** Geschützter Bereich: nur angemeldete, aktive Benutzer. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, profile, loading, signOut } = useAuth();
  const location = useLocation();

  if (loading || (session && !profile)) return <PageLoading />;
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (!profile) return <Navigate to="/fehler?code=profile" replace />;
  if (profile.status === 'invited') return <Navigate to="/einladung" replace />;
  if (profile.status === 'suspended' || profile.status === 'deleted') {
    return (
      <div className="auth-page">
        <div className="auth-card card center stack">
          <div className="auth-logo">
            <LogoCoin size={56} />
            <h1>Konto gesperrt</h1>
          </div>
          <p className="subtle">Dein Konto ist derzeit gesperrt. Bitte wende dich an den Admin.</p>
          <Button onClick={() => void signOut()}>Abmelden</Button>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

/** Adminbereich: zusätzlich serverseitig bestätigte Admin-Rolle. Daten sind zusätzlich per RLS/RPC geschützt. */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { isAdmin, profile, loading } = useAuth();
  if (loading || !profile) return <PageLoading />;
  if (!isAdmin) return <Navigate to="/fehler?code=403" replace />;
  return <>{children}</>;
}
