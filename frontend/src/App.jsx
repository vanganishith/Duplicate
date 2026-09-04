import React, { useState, useEffect } from 'react';
import { Routes, Route, NavLink, Link } from 'react-router-dom';
import LandingPage from './pages/LandingPage';
import FarmerPage from './pages/FarmerPage';
import OfficerLoginPage from './pages/OfficerLoginPage';
import AeoDashboard from './pages/AeoDashboard';
import CommunityPage from './pages/CommunityPage';
import MyIssuesPage from './pages/MyIssuesPage';
import LanguageSelector from './components/LanguageSelector';
import AuthModal from './components/AuthModal';
import { LanguageProvider, useLanguage } from './context/LanguageContext';

function MainLayout() {
  const { t } = useLanguage();

  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authSession, setAuthSession] = useState(() => {
    try {
      const farmer = JSON.parse(localStorage.getItem('kisaansathi_farmer_profile') || 'null');
      const officer = JSON.parse(localStorage.getItem('aeo_officer_session') || 'null');
      return { farmer, officer };
    } catch {
      return { farmer: null, officer: null };
    }
  });

  const syncAuth = () => {
    try {
      const farmer = JSON.parse(localStorage.getItem('kisaansathi_farmer_profile') || 'null');
      const officer = JSON.parse(localStorage.getItem('aeo_officer_session') || 'null');
      setAuthSession({ farmer, officer });
    } catch {
      setAuthSession({ farmer: null, officer: null });
    }
  };

  useEffect(() => {
    window.addEventListener('storage', syncAuth);
    window.addEventListener('kisaansathi_auth_changed', syncAuth);
    return () => {
      window.removeEventListener('storage', syncAuth);
      window.removeEventListener('kisaansathi_auth_changed', syncAuth);
    };
  }, []);

  const handleFarmerLogout = () => {
    localStorage.removeItem('kisaansathi_farmer_profile');
    window.dispatchEvent(new Event('kisaansathi_auth_changed'));
    syncAuth();
  };

  const handleOfficerLogout = () => {
    localStorage.removeItem('aeo_officer_session');
    window.dispatchEvent(new Event('kisaansathi_auth_changed'));
    syncAuth();
  };

  return (
    <div className="app-container">
      {/* Universal Login Modal */}
      <AuthModal isOpen={isAuthModalOpen} onClose={() => setIsAuthModalOpen(false)} />

      {/* Navigation Bar */}
      <header className="navbar">
        <div className="navbar-left">
          <Link to="/" className="navbar-brand">
            <span className="brand-logo">🌱</span>
            <span className="brand-name">{t.appName || 'KisaanSathi'}</span>
          </Link>

          <nav className="nav-links">
            <NavLink
              to="/my-issues"
              className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
            >
              📋 My Issues
            </NavLink>
            <NavLink
              to="/community"
              className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
            >
              👥 Community
            </NavLink>
            <Link
              to="/report"
              className="nav-link nav-link-highlight"
            >
              Report a Problem
            </Link>
          </nav>
        </div>

        <div className="navbar-right">
          {/* Multi-language Selector */}
          <LanguageSelector />

          {authSession.farmer?.name ? (
            <div className="navbar-user-group" data-testid="navbar-farmer-group">
              <Link to="/my-issues" className="navbar-user-chip" title="View my issues">
                <span className="navbar-user-avatar">
                  {(authSession.farmer.name || 'F').charAt(0).toUpperCase()}
                </span>
                <span className="navbar-user-name">{authSession.farmer.name}</span>
              </Link>
              <button
                type="button"
                className="btn btn-sm btn-navbar-logout"
                onClick={handleFarmerLogout}
                title="Logout from farmer account"
                data-testid="navbar-logout-btn"
              >
                Logout
              </button>
            </div>
          ) : authSession.officer?.officer_id ? (
            <div className="navbar-user-group" data-testid="navbar-officer-group">
              <Link to="/aeo" className="navbar-user-chip navbar-officer-chip" title="Officer dashboard">
                <span className="navbar-user-avatar">🏛️</span>
                <span className="navbar-user-name">{authSession.officer.officer_id}</span>
              </Link>
              <button
                type="button"
                className="btn btn-sm btn-navbar-logout"
                onClick={handleOfficerLogout}
                title="Logout from officer session"
                data-testid="navbar-logout-btn"
              >
                Logout
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-navbar-login"
              onClick={() => setIsAuthModalOpen(true)}
              data-testid="navbar-login-btn"
            >
              Login
            </button>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="main-content">
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/report" element={<FarmerPage />} />
          <Route path="/farmer" element={<FarmerPage />} />
          <Route path="/community" element={<CommunityPage />} />
          <Route path="/my-issues" element={<MyIssuesPage />} />
          <Route path="/community/problems/:problemId" element={<CommunityPage />} />
          <Route path="/officer-login" element={<OfficerLoginPage />} />
          <Route path="/aeo" element={<AeoDashboard />} />
          <Route path="/dashboard" element={<AeoDashboard />} />
        </Routes>
      </main>

      {/* Footer */}
      <footer className="footer">
        <div className="footer-content">
          <div className="footer-brand">
            <span className="brand-logo">🌱</span>
            <strong>{t.appName || 'KisaanSathi'}</strong>
            <span className="footer-tagline">&mdash; {t.footerTitle}</span>
          </div>
          <p className="footer-subtext">
            {t.footerSubtext}
          </p>
          <div className="footer-links">
            <Link to="/">{t.navHome}</Link>
            <Link to="/report">{t.navReport}</Link>
            <Link to="/officer-login">{t.navOfficerLogin}</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <LanguageProvider>
      <MainLayout />
    </LanguageProvider>
  );
}
