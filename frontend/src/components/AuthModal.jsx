import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { lookupFarmerByPhone } from '../services/api';

export default function AuthModal({ isOpen, onClose }) {
  const navigate = useNavigate();

  const [step, setStep] = useState('PHONE'); // 'PHONE' | 'NAME'
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handlePhoneSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const rawDigits = phone.replace(/\D/g, '');
    const cleanDigits = rawDigits.length === 12 && rawDigits.startsWith('91') ? rawDigits.slice(2) : rawDigits;

    if (cleanDigits.length !== 10 || !['6', '7', '8', '9'].includes(cleanDigits.charAt(0))) {
      setError('Please enter a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9.');
      return;
    }

    setIsLoading(true);
    try {
      const res = await lookupFarmerByPhone(cleanDigits);
      if (res.exists && res.farmer) {
        const found = res.farmer;
        localStorage.setItem('kisaansathi_farmer_profile', JSON.stringify({
          farmer_id: found.id,
          name: found.name,
          phone: found.phone,
          preferred_language: found.preferred_language || 'Telugu',
        }));
        window.dispatchEvent(new Event('kisaansathi_auth_changed'));
        handleClose();
      } else {
        // Number not in database - ask for name
        setStep('NAME');
      }
    } catch (err) {
      setError(err.message || 'Unable to verify mobile number. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleNameSubmit = (e) => {
    e.preventDefault();
    setError('');

    if (!name.trim()) {
      setError('Please enter your full name.');
      return;
    }

    const rawDigits = phone.replace(/\D/g, '');
    const cleanDigits = rawDigits.length === 12 && rawDigits.startsWith('91') ? rawDigits.slice(2) : rawDigits;
    const formattedPhone = cleanDigits.length === 10 ? `+91${cleanDigits}` : phone.trim();

    localStorage.setItem('kisaansathi_farmer_profile', JSON.stringify({
      name: name.trim(),
      phone: formattedPhone,
    }));
    window.dispatchEvent(new Event('kisaansathi_auth_changed'));
    handleClose();
  };

  const handleClose = () => {
    setStep('PHONE');
    setPhone('');
    setName('');
    setError('');
    setIsLoading(false);
    onClose();
  };

  const handleOfficerLoginClick = () => {
    handleClose();
    navigate('/officer-login');
  };

  return (
    <div className="auth-modal-overlay" onClick={handleClose} data-testid="auth-modal-overlay">
      <div
        className="auth-modal-card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-modal-title"
      >
        <button
          type="button"
          className="auth-modal-close-btn"
          onClick={handleClose}
          aria-label="Close dialog"
        >
          ✕
        </button>

        <div className="auth-modal-header">
          <div className="auth-modal-icon">🌾</div>
          <h2 id="auth-modal-title" className="auth-modal-title">
            {step === 'PHONE' ? 'Farmer Login' : 'First-Time Registration'}
          </h2>
          <p className="auth-modal-subtitle">
            {step === 'PHONE'
              ? 'Enter your mobile number to access your reported complaints and community.'
              : 'Your mobile number is not yet registered. Enter your name to complete your profile:'}
          </p>
        </div>

        {error && (
          <div className="alert alert-error" role="alert" style={{ marginBottom: '16px' }}>
            <span className="alert-icon">!</span>
            <span>{error}</span>
          </div>
        )}

        {step === 'PHONE' ? (
          <form onSubmit={handlePhoneSubmit} className="auth-modal-form">
            <div className="form-group">
              <label className="form-label" htmlFor="modal-farmer-phone">
                Mobile Number *
              </label>
              <div className="phone-input-group">
                <span className="phone-prefix-tag">+91</span>
                <input
                  id="modal-farmer-phone"
                  type="tel"
                  inputMode="numeric"
                  className="form-input font-mono phone-input-field"
                  placeholder="10-digit mobile number"
                  value={phone}
                  onChange={(e) => {
                    setPhone(e.target.value);
                    if (error) setError('');
                  }}
                  maxLength={14}
                  autoFocus
                  required
                  data-testid="modal-phone-input"
                />
              </div>
              <small className="form-hint">
                🔒 No passwords or OTP required. New numbers will be asked for a name.
              </small>
            </div>

            <button
              type="submit"
              className="btn btn-primary btn-block btn-auth-submit"
              disabled={isLoading}
              data-testid="modal-phone-submit-btn"
            >
              {isLoading ? '⏳ Checking database...' : 'Continue →'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleNameSubmit} className="auth-modal-form">
            <div className="farmer-auth-phone-pill">
              <span>Mobile Number:</span>
              <strong>+91 {phone.replace(/\D/g, '').slice(-10)}</strong>
              <button
                type="button"
                className="btn-change-phone-link"
                onClick={() => {
                  setStep('PHONE');
                  setError('');
                }}
              >
                ✏️ Change
              </button>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="modal-farmer-name">
                Full Name *
              </label>
              <input
                id="modal-farmer-name"
                type="text"
                className="form-input"
                placeholder="e.g. Ramesh Reddy"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (error) setError('');
                }}
                autoFocus
                required
                data-testid="modal-name-input"
              />
              <small className="form-hint">
                🌾 Used to link your agricultural reports with your local officer.
              </small>
            </div>

            <button
              type="submit"
              className="btn btn-primary btn-block btn-auth-submit"
              data-testid="modal-name-submit-btn"
            >
              Complete Registration &amp; Login →
            </button>
          </form>
        )}

        {/* Divider & Officer Login Section */}
        <div className="auth-modal-officer-section">
          <div className="auth-modal-divider">
            <span>OR</span>
          </div>
          <div className="officer-redirect-box">
            <div className="officer-redirect-info">
              <span className="officer-redirect-icon">🏛️</span>
              <div>
                <strong>Government Agricultural Officer?</strong>
                <p>Access official incident triage and verified advice portal</p>
              </div>
            </div>
            <button
              type="button"
              className="btn btn-sm btn-outline btn-officer-redirect"
              onClick={handleOfficerLoginClick}
              data-testid="officer-login-redirect-btn"
            >
              Officer Login →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
