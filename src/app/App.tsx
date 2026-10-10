import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '../features/auth/AuthProvider';
import { RequireAdmin, RequireAuth } from '../features/auth/guards';
import { ToastProvider } from '../components/Toast';
import { PageLoading } from '../components/ui';
import { AppDataProvider } from './AppData';
import { Layout } from './Layout';
import { PresenceProvider } from './Presence';
import { ErrorPage, ForgotPasswordPage, InvitePage, LoginPage, ResetPasswordPage } from '../features/auth/AuthPages';
import { DashboardPage } from '../features/dashboard/DashboardPage';
import { GamePage, LobbyPage } from '../features/games/LobbyPage';

// Seltener genutzte Bereiche werden nachgeladen
const WalletPage = lazy(() => import('../features/wallet/WalletPage').then((m) => ({ default: m.WalletPage })));
const CreditRequestsPage = lazy(() => import('../features/requests/CreditRequestsPage').then((m) => ({ default: m.CreditRequestsPage })));
const LeaderboardPage = lazy(() => import('../features/leaderboard/LeaderboardPage').then((m) => ({ default: m.LeaderboardPage })));
const HistoryPage = lazy(() => import('../features/history/HistoryPage').then((m) => ({ default: m.HistoryPage })));
const DuelsPage = lazy(() => import('../features/social/SocialPage').then((m) => ({ default: m.DuelsPage })));
const LiveDuelRoom = lazy(() => import('../features/social/LiveDuel').then((m) => ({ default: m.LiveDuelRoom })));
const TippPage = lazy(() => import('../features/social/SocialPage').then((m) => ({ default: m.TippPage })));
const QuestsPage = lazy(() => import('../features/quests/QuestsPage').then((m) => ({ default: m.QuestsPage })));
const ProfilePage = lazy(() => import('../features/profile/ProfilePages').then((m) => ({ default: m.ProfilePage })));
const SettingsPage = lazy(() => import('../features/profile/ProfilePages').then((m) => ({ default: m.SettingsPage })));
const NotificationsPage = lazy(() => import('../features/profile/ProfilePages').then((m) => ({ default: m.NotificationsPage })));

const admin = () => import('../features/admin/AdminRoutes');
const AdminRoutes = lazy(admin);

export function AppRoutes() {
  return (
    <Suspense fallback={<PageLoading />}>
      <Routes>
        {/* Öffentlich */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/einladung" element={<InvitePage />} />
        <Route path="/passwort-setzen" element={<InvitePage />} />
        <Route path="/passwort-vergessen" element={<ForgotPasswordPage />} />
        <Route path="/passwort-zuruecksetzen" element={<ResetPasswordPage />} />
        <Route path="/fehler" element={<ErrorPage />} />
        <Route path="/rechtliches" element={<Navigate to="/" replace />} />

        {/* Benutzerbereich */}
        <Route
          element={
            <RequireAuth>
              <AppDataProvider>
                <PresenceProvider>
                  <Layout />
                </PresenceProvider>
              </AppDataProvider>
            </RequireAuth>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="casino" element={<LobbyPage />} />
          <Route path="casino/:gameKey" element={<GamePage />} />
          <Route path="wallet" element={<WalletPage />} />
          <Route path="anfragen" element={<CreditRequestsPage />} />
          <Route path="leaderboard" element={<LeaderboardPage />} />
          <Route path="historie" element={<HistoryPage />} />
          <Route path="profil" element={<ProfilePage />} />
          <Route path="quests" element={<QuestsPage />} />
          <Route path="casino/duelle" element={<DuelsPage />} />
          <Route path="casino/duelle/:id" element={<LiveDuelRoom />} />
          <Route path="tipp" element={<TippPage />} />
          <Route path="social" element={<Navigate to="/casino/duelle" replace />} />
          <Route path="benachrichtigungen" element={<NotificationsPage />} />
          <Route path="einstellungen" element={<SettingsPage />} />
          <Route
            path="admin/*"
            element={
              <RequireAdmin>
                <AdminRoutes />
              </RequireAdmin>
            }
          />
        </Route>

        <Route path="*" element={<Navigate to="/fehler" replace />} />
      </Routes>
    </Suspense>
  );
}

export function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ToastProvider>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
