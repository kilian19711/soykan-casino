import { Navigate, Route, Routes } from 'react-router-dom';
import { AdminLayout } from './adminShared';
import { AdminDashboard, AdminInvites, AdminUserDetail, AdminUsers } from './AdminUsersPages';
import {
  AdminAdjustments,
  AdminAudit,
  AdminGames,
  AdminLeaderboard,
  AdminPlaytime,
  AdminRequests,
  AdminRounds,
  AdminSettings,
  AdminWeek,
} from './AdminOpsPages';
import { AdminCleanup, AdminErrors } from './AdminTools';

export default function AdminRoutes() {
  return (
    <Routes>
      <Route element={<AdminLayout />}>
        <Route index element={<AdminDashboard />} />
        <Route path="benutzer" element={<AdminUsers />} />
        <Route path="benutzer/:id" element={<AdminUserDetail />} />
        <Route path="einladungen" element={<AdminInvites />} />
        <Route path="anfragen" element={<AdminRequests />} />
        <Route path="anpassungen" element={<AdminAdjustments />} />
        <Route path="runden" element={<AdminRounds />} />
        <Route path="spielzeit" element={<AdminPlaytime />} />
        <Route path="woche" element={<AdminWeek />} />
        <Route path="leaderboard" element={<AdminLeaderboard />} />
        <Route path="audit" element={<AdminAudit />} />
        <Route path="spiele" element={<AdminGames />} />
        <Route path="einstellungen" element={<AdminSettings />} />
        <Route path="fehler" element={<AdminErrors />} />
        <Route path="aufraeumen" element={<AdminCleanup />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Route>
    </Routes>
  );
}
