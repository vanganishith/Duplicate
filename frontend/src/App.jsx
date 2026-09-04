import React, { useEffect, useState } from 'react';
import { Routes, Route, NavLink, Link } from 'react-router-dom';
import LandingPage from './pages/LandingPage';
import FarmerPage from './pages/FarmerPage';
import OfficerLoginPage from './pages/OfficerLoginPage';
import AeoDashboard from './pages/AeoDashboard';
import LanguageSelector from './components/LanguageSelector';
import { LanguageProvider, useLanguage } from './context/LanguageContext';
import { checkHealth } from './services/api';

function MainLayout() {
  const [backendStatus, setBackendStatus] = useState('checking');
  const { t } = useLanguage();

  useEffect(() => {
    checkHealth()
      .then((data) => {
        if (data && data.status === 'ok') {
          setBackendStatus('connected');
        } else {
          setBackendStatus('disconnected');
        }
      })
      .catch(() => {
        setBackendStatus('disconnected');
      });
  }, []);

  return (
    <div className="app-container">
      {/* Navigation Bar */}
      <header className="navbar">
        <div className="navbar-left">
          <Link to="/" className="navbar-brand">
            <span className="brand-logo">🌱</span>
            <span className="brand-name">{t.appName || 'KisaanSathi'}</span>
          </Link>

          <nav className="nav-links">
            <NavLink
              to="/"
              className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
              end
            >
              {t.navHome}
            </NavLink>
            <a href="#how-it-works" className="nav-link" onClick={(e) => {
              const el = document.querySelector('.workflow-section');
              if (el) { e.preventDefault(); el.scrollIntoView({ behavior: 'smooth' }); }
            }}>
              {t.navServices}
            </a>
            <a href="#about" className="nav-link" onClick={(e) => {
              const el = document.querySelector('.ai-feature-showcase-section');
              if (el) { e.preventDefault(); el.scrollIntoView({ behavior: 'smooth' }); }
            }}>
              {t.navAbout}
            </a>
            <Link
              to="/report"
              className="nav-link nav-link-highlight"
            >
              {t.navReport}
            </Link>
          </nav>
        </div>

        <div className="navbar-right">
          {/* Multi-language Selector */}
          <LanguageSelector />

          {/* Backend Status Indicator */}
          <div className="backend-indicator">
            {backendStatus === 'connected' ? (
              <span className="status-badge online" title={t.apiConnected}>
                <span className="status-dot"></span>
                <span className="status-text">{t.apiConnected}</span>
              </span>
            ) : (
              <span className="status-badge" title={backendStatus === 'checking' ? t.apiConnecting : t.apiOffline}>
                <span className="status-dot"></span>
                <span className="status-text">{backendStatus === 'checking' ? t.apiConnecting : t.apiOffline}</span>
              </span>
            )}
          </div>

          <Link to="/officer-login" className="btn btn-officer-nav">
            {t.navOfficerLogin}
          </Link>
        </div>
      </header>

      {/* Main Content */}
      <main className="main-content">
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/report" element={<FarmerPage />} />
          <Route path="/farmer" element={<FarmerPage />} />
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
