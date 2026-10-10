import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';
import { api } from '../../lib/api';
import { AppError, authErrorMessage } from '../../lib/errors';
import type { Profile } from '../../types';

interface AuthState {
  session: Session | null;
  profile: Profile | null;
  /** Serverseitig bestätigte Admin-Rolle (nie nur aus dem Frontend-State abgeleitet) */
  isAdmin: boolean;
  loading: boolean;
  /** true, wenn der Benutzer über einen Passwort-Reset-Link kam */
  recovery: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<Profile | null>;
  clearRecovery: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export const SIGN_OUT_EVENT = 'shb:before-signout';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [recovery, setRecovery] = useState(false);
  const currentUser = useRef<string | null>(null);

  const loadProfile = useCallback(async (userId: string) => {
    try {
      const p = await api.getMyProfile(userId);
      setProfile(p);
      if (p && p.role === 'admin' && p.status === 'active') {
        setIsAdmin(await api.isAdmin().catch(() => false));
      } else {
        setIsAdmin(false);
      }
      return p;
    } catch {
      setProfile(null);
      setIsAdmin(false);
      return null;
    }
  }, []);

  useEffect(() => {
    let active = true;
    if (/type=recovery/.test(window.location.hash)) setRecovery(true);

    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      setSession(data.session);
      currentUser.current = data.session?.user.id ?? null;
      if (data.session) await loadProfile(data.session.user.id);
      if (active) setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      setSession(next);
      const uid = next?.user.id ?? null;
      if (uid !== currentUser.current) {
        currentUser.current = uid;
        if (uid) {
          // Nicht im Callback awaiten (Supabase-Empfehlung), sondern entkoppeln
          window.setTimeout(() => void loadProfile(uid), 0);
        } else {
          setProfile(null);
          setIsAdmin(false);
        }
      }
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error || !data.user) throw new AppError('AUTH', authErrorMessage(error));
      currentUser.current = data.user.id;
      let p = await loadProfile(data.user.id);
      if (!p) {
        await supabase.auth.signOut();
        throw new AppError('PROFILE_MISSING');
      }
      if (p.status === 'suspended') {
        await supabase.auth.signOut();
        throw new AppError('ACCOUNT_SUSPENDED');
      }
      if (p.status === 'invited') {
        // Wer sich mit Passwort anmelden kann, hat bereits ein Passwort gesetzt.
        await api.activateAccount();
        p = await loadProfile(data.user.id);
      } else {
        void api.activateAccount().catch(() => undefined);
      }
    },
    [loadProfile],
  );

  const signOut = useCallback(async () => {
    window.dispatchEvent(new Event(SIGN_OUT_EVENT));
    await new Promise((r) => setTimeout(r, 50));
    await supabase.auth.signOut();
    setProfile(null);
    setIsAdmin(false);
    setRecovery(false);
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!session) return null;
    return loadProfile(session.user.id);
  }, [session, loadProfile]);

  const value = useMemo<AuthState>(
    () => ({
      session,
      profile,
      isAdmin,
      loading,
      recovery,
      signIn,
      signOut,
      refreshProfile,
      clearRecovery: () => setRecovery(false),
    }),
    [session, profile, isAdmin, loading, recovery, signIn, signOut, refreshProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth außerhalb von AuthProvider');
  return ctx;
}
