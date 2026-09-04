import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';
import { officerLogin } from '../services/api';

/**
 * Clean & Simple AEO Officer Login
 * Only 2 user roles exist in KisaanSaathi:
 * 1. Farmer (Public reporting & advisory)
 * 2. AEO (Agriculture Extension Officer - field authority)
 */
export const PRESET_AEOS = [
  {
    officer_id: 'AEO001',
    name: 'Srinivas Rao',
    role: 'AEO',
    designation: 'Agriculture Extension Officer',
    assigned_area: 'Medchal–Malkajgiri & Warangal Division',
    phone: '9876543210',
    email: 'srinivas.aeo@telangana.gov.in',
    password: 'password123',
  },
  {
    officer_id: 'AEO002',
    name: 'Ramesh Kumar',
    role: 'AEO',
    designation: 'Agriculture Extension Officer',
    assigned_area: 'Ghatkesar Agricultural Circle',
    phone: '9876543211',
    email: 'ramesh.aeo@telangana.gov.in',
    password: 'password123',
  },
];

export default function OfficerLoginPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();

  const [credential, setCredential] = useState('AEO001');
  const [password, setPassword] = useState('password123');
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleLoginWithOfficer = (officerData) => {
    const sessionData = {
      ...officerData,
      authenticated_at: new Date().toISOString(),
    };
    localStorage.setItem('aeo_officer_session', JSON.stringify(sessionData));
    navigate('/aeo');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage('');
    setIsSubmitting(true);

    const cleanCred = credential.trim();
    const cleanPass = password.trim();

    if (!cleanCred) {
      setErrorMessage('Please enter your AEO Officer ID or Phone Number.');
      setIsSubmitting(false);
      return;
    }

    // Check against preset AEOs
    const matchedOfficer = PRESET_AEOS.find(
      (a) =>
        a.officer_id.toLowerCase() === cleanCred.toLowerCase() ||
        a.phone === cleanCred ||
        a.email.toLowerCase() === cleanCred.toLowerCase()
    );

    if (matchedOfficer) {
      if (cleanPass === matchedOfficer.password || cleanPass === '123456' || cleanPass === 'password123') {
        handleLoginWithOfficer(matchedOfficer);
      } else {
        setErrorMessage('Invalid Officer ID or password. Please check your credentials.');
      }
      setIsSubmitting(false);
      return;
    }

    // If ID is not in preset AEOs
    setErrorMessage('Invalid Officer ID or password. Please use Officer ID: AEO001 or AEO002.');
    setIsSubmitting(false);
  };

  return (
    <div className="officer-page" data-testid="officer-login-page" style={{ padding: '40px 16px', minHeight: '80vh' }}>
      <div
        className="card officer-card"
        style={{
          maxWidth: '460px',
          margin: '0 auto',
          backgroundColor: '#ffffff',
          borderRadius: '16px',
          border: '1px solid #e2e8f0',
          boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.08)',
          overflow: 'hidden',
        }}
      >
        {/* Clean Header */}
        <div style={{ backgroundColor: '#ffffff', padding: '28px 20px 16px', textAlign: 'center', borderBottom: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '8px' }}>🏛️</div>
          <h1 style={{ margin: '0 0 6px', fontSize: '1.4rem', fontWeight: '800', color: '#0f172a' }}>
            AEO Officer Workspace
          </h1>
          <p style={{ margin: 0, fontSize: '0.8125rem', color: '#64748b' }}>
            Agriculture Extension Officer Portal &bull; Department of Agriculture
          </p>
        </div>

        <div style={{ padding: '24px' }}>
          {/* Credentials Info Box */}
          <div
            style={{
              backgroundColor: '#f0fdf4',
              border: '1px solid #bbf7d0',
              borderRadius: '10px',
              padding: '14px',
              marginBottom: '20px',
              fontSize: '0.8125rem',
              color: '#166534',
            }}
          >
            <div style={{ fontWeight: '700', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span>🔑</span> Valid AEO Officer Logins:
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div>
                <strong>AEO 1:</strong> ID: <code>AEO001</code> &bull; Password: <code>password123</code> (Srinivas Rao)
              </div>
              <div>
                <strong>AEO 2:</strong> ID: <code>AEO002</code> &bull; Password: <code>password123</code> (Ramesh Kumar)
              </div>
            </div>
          </div>

          {/* 1-Click Fast Login Buttons for the 2 AEOs */}
          <div style={{ marginBottom: '20px' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: '700', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Quick 1-Click Access:
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
              {PRESET_AEOS.map((aeo) => (
                <button
                  key={aeo.officer_id}
                  type="button"
                  onClick={() => handleLoginWithOfficer(aeo)}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '12px 14px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    backgroundColor: '#f8fafc',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = '#ecfdf5';
                    e.currentTarget.style.borderColor = '#86efac';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = '#f8fafc';
                    e.currentTarget.style.borderColor = '#cbd5e1';
                  }}
                >
                  <div>
                    <div style={{ fontWeight: '700', fontSize: '0.875rem', color: '#1e293b' }}>
                      {aeo.name} ({aeo.officer_id})
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                      {aeo.designation} &bull; {aeo.assigned_area}
                    </div>
                  </div>
                  <span style={{ fontSize: '0.75rem', fontWeight: '700', color: '#16a34a', backgroundColor: '#dcfce7', padding: '4px 10px', borderRadius: '6px' }}>
                    Login →
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', margin: '20px 0', color: '#94a3b8', fontSize: '0.75rem' }}>
            <div style={{ flex: 1, height: '1px', backgroundColor: '#e2e8f0' }} />
            <span style={{ padding: '0 10px' }}>OR TYPE CREDENTIALS</span>
            <div style={{ flex: 1, height: '1px', backgroundColor: '#e2e8f0' }} />
          </div>

          {errorMessage && (
            <div
              style={{
                backgroundColor: '#fef2f2',
                border: '1px solid #fecaca',
                color: '#dc2626',
                padding: '10px 14px',
                borderRadius: '8px',
                marginBottom: '16px',
                fontSize: '0.875rem',
                fontWeight: '600',
              }}
              data-testid="login-error-message"
            >
              ⚠️ {errorMessage}
            </div>
          )}

          <form onSubmit={handleSubmit} data-testid="officer-login-form">
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontWeight: '600', marginBottom: '6px', fontSize: '0.875rem', color: '#334155' }}>
                AEO Officer ID or Phone
              </label>
              <input
                data-testid="officer-id-input"
                type="text"
                placeholder="e.g. AEO001 or 9876543210"
                value={credential}
                onChange={(e) => setCredential(e.target.value)}
                required
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  fontSize: '0.9375rem',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div style={{ marginBottom: '22px' }}>
              <label style={{ display: 'block', fontWeight: '600', marginBottom: '6px', fontSize: '0.875rem', color: '#334155' }}>
                Password
              </label>
              <input
                data-testid="officer-password-input"
                type="password"
                placeholder="Enter password (default: password123)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  fontSize: '0.9375rem',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <button
              data-testid="officer-login-submit-btn"
              type="submit"
              disabled={isSubmitting}
              style={{
                width: '100%',
                padding: '12px',
                backgroundColor: '#16a34a',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                fontWeight: '700',
                fontSize: '0.9375rem',
                cursor: isSubmitting ? 'not-allowed' : 'pointer',
              }}
            >
              {isSubmitting ? 'Verifying...' : 'Sign In as AEO'}
            </button>
          </form>

          <div style={{ marginTop: '20px', textAlign: 'center' }}>
            <Link to="/" style={{ fontSize: '0.8125rem', color: '#64748b', textDecoration: 'none' }}>
              ← Return to Farmer Portal
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
