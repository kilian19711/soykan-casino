import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Brand } from '../components/Logo';
import { IconBell, IconDice, IconHome, IconShield, IconTrophy, IconUser, IconWallet } from '../components/Icons';
import { useAppData } from './AppData';
import { useAuth } from '../features/auth/AuthProvider';
import { formatCredits } from '../lib/format';
import { NotificationDrawer } from '../features/notifications/NotificationDrawer';
import { usePlaytimeTracker } from '../features/session/usePlaytimeTracker';
import { OfflineBanner } from './OfflineBanner';
import { QuestButton, QuestPopup } from '../features/quests/Quests';

export function Layout() {
  const { isAdmin } = useAuth();
  const { balance, balanceFlash, unread } = useAppData();
  const [drawer, setDrawer] = useState(false);
  const location = useLocation();
  usePlaytimeTracker(true);

  useEffect(() => {
    setDrawer(false);
    window.scrollTo({ top: 0 });
  }, [location.pathname]);

  return (
    <div className="app-shell">
      <OfflineBanner />
      <a href="#main" className="sr-only">
        Zum Inhalt springen
      </a>
      <header className="app-header">
        <div className="app-header-inner">
          <Link to="/" className="brand" aria-label="Shishabar Online Casino – Dashboard">
            <Brand />
          </Link>
          <nav className="desktop-nav" aria-label="Hauptnavigation">
            <NavLink to="/" end>
              Dashboard
            </NavLink>
            <NavLink to="/casino">Casino</NavLink>
            <NavLink to="/leaderboard">Leaderboard</NavLink>
            <NavLink to="/wallet">Wallet</NavLink>
            <NavLink to="/anfragen">Anfragen</NavLink>
            <NavLink to="/historie">Historie</NavLink>
            {isAdmin && <NavLink to="/admin">Admin</NavLink>}
          </nav>
          <div className="header-right">
            <Link
              to="/wallet"
              className={`balance-pill ${balanceFlash === 'up' ? 'flash-up' : balanceFlash === 'down' ? 'flash-down' : ''}`}
              aria-label={`Kontostand ${formatCredits(balance)} Credits`}
              style={{ textDecoration: 'none' }}
            >
              <span aria-hidden="true" style={{ display: 'inline-flex' }}>
                <CoinDot />
              </span>
              <span aria-live="polite">{formatCredits(balance)}</span>
              <span className="unit">CR</span>
            </Link>
            <QuestButton />
            <button
              type="button"
              className="icon-btn"
              onClick={() => setDrawer(true)}
              aria-label={`Benachrichtigungen${unread ? `, ${unread} ungelesen` : ''}`}
            >
              <IconBell />
              {unread > 0 && <span className="dot">{unread > 9 ? '9+' : unread}</span>}
            </button>
            <Link to="/profil" className="icon-btn hide-mobile" aria-label="Profil">
              <IconUser />
            </Link>
          </div>
        </div>
      </header>

      <main id="main" className="app-main" key={location.pathname}>
        <Outlet />
      </main>

      <footer className="legal-footer">
        <Link to="/einstellungen">Einstellungen</Link> · <Link to="/benachrichtigungen">Benachrichtigungen</Link>
      </footer>

      <nav className="bottom-nav" aria-label="Navigation">
        <ul>
          <li>
            <NavLink to="/" end>
              <IconHome size={22} />
              Start
            </NavLink>
          </li>
          <li>
            <NavLink to="/casino">
              <IconDice size={22} />
              Casino
            </NavLink>
          </li>
          <li>
            <NavLink to="/leaderboard">
              <IconTrophy size={22} />
              Ranking
            </NavLink>
          </li>
          <li>
            <NavLink to="/wallet">
              <IconWallet size={22} />
              Wallet
            </NavLink>
          </li>
          <li>
            {isAdmin ? (
              <NavLink to="/admin">
                <IconShield size={22} />
                Admin
              </NavLink>
            ) : (
              <NavLink to="/profil">
                <IconUser size={22} />
                Profil
              </NavLink>
            )}
          </li>
        </ul>
      </nav>

      <NotificationDrawer open={drawer} onClose={() => setDrawer(false)} />
      <QuestPopup />
    </div>
  );
}

function CoinDot() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
      <circle cx="11" cy="11" r="10" fill="#7a5418" />
      <circle cx="11" cy="11" r="8.5" fill="#f3c969" />
      <circle cx="11" cy="11" r="6" fill="none" stroke="#a87a2a" strokeWidth="1.2" />
      <path d="M7 8a5 5 0 0 1 5-2.5" stroke="#fff6d8" strokeWidth="1.3" strokeLinecap="round" fill="none" opacity=".7" />
    </svg>
  );
}
