import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';

/**
 * Phase: Officer Login Page
 * DEMO AUTH / TEMPORARY AUTH for jury, hackathon evaluation, and officer access.
 * Fixed demo credentials:
 *   Officer ID: AEO001
 *   Password:   123456
 */
export const DEMO_CREDENTIALS = {
  officerId: 'AEO001',
  password: '123456',
};

export default function OfficerLoginPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();

  const [officerId, setOfficerId] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    setErrorMessage('');
    setIsSubmitting(true);

    const cleanId = officerId.trim();
    const cleanPass = password.trim();

    // DEMO AUTH CHECK
    if (cleanId === DEMO_CREDENTIALS.officerId && cleanPass === DEMO_CREDENTIALS.password) {
      const sessionData = {
        officer_id: cleanId,
        name: 'Officer AEO-001',
        designation: 'Agricultural Extension Officer',
        authenticated_at: new Date().toISOString(),
        is_demo: true,
      };
      localStorage.setItem('aeo_officer_session', JSON.stringify(sessionData));
      setIsSubmitting(false);
      navigate('/aeo');
    } else {
      setIsSubmitting(false);
      setErrorMessage('Invalid Officer ID or password.');
    }
  };

  return (
    <div className="officer-page" data-testid="officer-login-page">
      <div className="card officer-card" style={{ maxWidth: '440px', margin: '40px auto' }}>
        <div className="card-header" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '8px' }}>🏛️</div>
          <h1 className="card-title">AEO Officer Portal Login</h1>
          <p className="card-subtitle">Agricultural Extension Officer Verification &amp; Incident Triage</p>
        </div>

        <div className="card-body">
          {/* Demo Credentials Notice */}
          <div
            style={{
              backgroundColor: '#eff6ff',
              border: '1px solid #bfdbfe',
              borderRadius: '8px',
              padding: '10px 14px',
              marginBottom: '20px',
              fontSize: '0.8125rem',
              color: '#1e40af',
            }}
          >
            <strong>Demo Evaluation Access:</strong>
            <div style={{ marginTop: '4px' }}>
              Officer ID: <code>AEO001</code> &bull; Password: <code>123456</code>
            </div>
          </div>

          {errorMessage && (
            <div
              className="error-banner"
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
            <div className="form-group" style={{ marginBottom: '16px' }}>
              <label htmlFor="officerId" style={{ display: 'block', fontWeight: '600', marginBottom: '6px', fontSize: '0.875rem' }}>
                Officer ID
              </label>
              <input
                id="officerId"
                type="text"
                className="form-control"
                placeholder="Enter Officer ID (e.g. AEO001)"
                value={officerId}
                onChange={(e) => setOfficerId(e.target.value)}
                required
                data-testid="officer-id-input"
                style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #cbd5e1' }}
              />
            </div>

            <div className="form-group" style={{ marginBottom: '24px' }}>
              <label htmlFor="password" style={{ display: 'block', fontWeight: '600', marginBottom: '6px', fontSize: '0.875rem' }}>
                Password
              </label>
              <input
                id="password"
                type="password"
                className="form-control"
                placeholder="Enter Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                data-testid="officer-password-input"
                style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #cbd5e1' }}
              />
            </div>

            <button
              type="submit"
              className="btn btn-primary btn-submit-incident"
              disabled={isSubmitting}
              data-testid="officer-login-submit-btn"
              style={{ width: '100%', backgroundColor: '#2563eb', border: 'none', padding: '12px', fontWeight: '700' }}
            >
              {isSubmitting ? 'Verifying...' : 'Sign In to Officer Portal'}
            </button>
          </form>

          <div style={{ marginTop: '20px', textAlign: 'center' }}>
            <Link to="/report" style={{ fontSize: '0.8125rem', color: '#64748b', textDecoration: 'none' }}>
              &larr; Return to Farmer Reporting Page
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
