import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { loginSchema, setPasswordSchema, usernameSchema } from './validation';

const authState = vi.hoisted(() => ({
  value: {
    session: null as unknown,
    profile: null as unknown,
    isAdmin: false,
    loading: false,
    recovery: false,
    signIn: async () => undefined,
    signOut: async () => undefined,
    refreshProfile: async () => null,
    clearRecovery: () => undefined,
  },
}));

vi.mock('./AuthProvider', () => ({
  useAuth: () => authState.value,
  SIGN_OUT_EVENT: 'shb:before-signout',
}));

import { RequireAdmin, RequireAuth } from './guards';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<div>LOGIN-SEITE</div>} />
        <Route path="/einladung" element={<div>EINLADUNG</div>} />
        <Route path="/fehler" element={<div>KEIN-ZUGRIFF</div>} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <div>DASHBOARD</div>
            </RequireAuth>
          }
        />
        <Route
          path="/admin"
          element={
            <RequireAuth>
              <RequireAdmin>
                <div>ADMIN-BEREICH</div>
              </RequireAdmin>
            </RequireAuth>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

const activeUser = { id: 'u1', username: 'max', display_name: 'Max', role: 'user', status: 'active', avatar_seed: null, created_at: '', last_seen_at: null };

describe('Routenschutz', () => {
  beforeEach(() => {
    authState.value = { ...authState.value, session: null, profile: null, isAdmin: false, loading: false };
  });

  it('leitet nicht angemeldete Benutzer zum Login', () => {
    renderAt('/');
    expect(screen.getByText('LOGIN-SEITE')).toBeInTheDocument();
  });

  it('leitet eingeladene Benutzer zur Passwortfestlegung', () => {
    authState.value = { ...authState.value, session: { user: { id: 'u1' } }, profile: { ...activeUser, status: 'invited' } };
    renderAt('/');
    expect(screen.getByText('EINLADUNG')).toBeInTheDocument();
  });

  it('zeigt gesperrten Benutzern einen Sperrhinweis', () => {
    authState.value = { ...authState.value, session: { user: { id: 'u1' } }, profile: { ...activeUser, status: 'suspended' } };
    renderAt('/');
    expect(screen.getByText('Konto gesperrt')).toBeInTheDocument();
  });

  it('blockiert die Adminroute für normale Benutzer auch bei direkter URL-Eingabe', () => {
    authState.value = { ...authState.value, session: { user: { id: 'u1' } }, profile: activeUser, isAdmin: false };
    renderAt('/admin');
    expect(screen.getByText('KEIN-ZUGRIFF')).toBeInTheDocument();
    expect(screen.queryByText('ADMIN-BEREICH')).not.toBeInTheDocument();
  });

  it('blockiert die Adminroute, wenn nur das Profil "admin" behauptet, der Server es aber nicht bestätigt', () => {
    authState.value = { ...authState.value, session: { user: { id: 'u1' } }, profile: { ...activeUser, role: 'admin' }, isAdmin: false };
    renderAt('/admin');
    expect(screen.getByText('KEIN-ZUGRIFF')).toBeInTheDocument();
  });

  it('erlaubt dem serverseitig bestätigten Admin den Zugriff', () => {
    authState.value = { ...authState.value, session: { user: { id: 'k' } }, profile: { ...activeUser, role: 'admin' }, isAdmin: true };
    renderAt('/admin');
    expect(screen.getByText('ADMIN-BEREICH')).toBeInTheDocument();
  });
});

describe('Formularvalidierung', () => {
  it('Login verlangt E-Mail und Passwort', () => {
    expect(loginSchema.safeParse({ email: 'x', password: '' }).success).toBe(false);
    expect(loginSchema.safeParse({ email: 'max@example.com', password: 'abc' }).success).toBe(true);
  });
  it('Passwortfestlegung verlangt Stärke und Übereinstimmung', () => {
    expect(setPasswordSchema.safeParse({ password: 'kurz1', confirm: 'kurz1' }).success).toBe(false);
    expect(setPasswordSchema.safeParse({ password: 'nurbuchstaben', confirm: 'nurbuchstaben' }).success).toBe(false);
    expect(setPasswordSchema.safeParse({ password: 'Sicher123', confirm: 'Sicher124' }).success).toBe(false);
    expect(setPasswordSchema.safeParse({ password: 'Sicher123', confirm: 'Sicher123' }).success).toBe(true);
  });
  it('Benutzernamen entsprechen der Server-Regel', () => {
    expect(usernameSchema.safeParse('Lukas').success).toBe(true);
    expect(usernameSchema.safeParse('a').success).toBe(false);
    expect(usernameSchema.safeParse('<script>').success).toBe(false);
  });
});
