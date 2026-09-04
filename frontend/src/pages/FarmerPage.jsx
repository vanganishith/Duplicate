import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { lookupFarmerByPhone } from '../services/api';
import { useLanguage } from '../context/LanguageContext';
import FarmerAiAssistant from '../components/FarmerAiAssistant';

export default function FarmerPage() {
  const { t, currentLanguageName } = useLanguage();

  const getInitialProfile = () => {
    try {
      const saved = localStorage.getItem('kisaansathi_farmer_profile');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  };

  const initialProfile = getInitialProfile();

  // Identification State
  const [isIdentified, setIsIdentified] = useState(Boolean(initialProfile?.phone && initialProfile?.name));
  const [authStep, setAuthStep] = useState('PHONE'); // 'PHONE' | 'NAME'
  const [authPhone, setAuthPhone] = useState('');
  const [authName, setAuthName] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');

  // Farmer Details
  const [farmerName, setFarmerName] = useState(initialProfile?.name || '');
  const [farmerPhone, setFarmerPhone] = useState(initialProfile?.phone || '');
  const [crop, setCrop] = useState(initialProfile?.crop || 'Paddy');
  const [latitude, setLatitude] = useState(initialProfile?.latitude || null);
  const [longitude, setLongitude] = useState(initialProfile?.longitude || null);

  // Sync with global auth state (e.g. navbar login or logout)
  useEffect(() => {
    const handleAuthEvent = () => {
      const p = getInitialProfile();
      if (p?.name && p?.phone) {
        setIsIdentified(true);
        setFarmerName(p.name);
        setFarmerPhone(p.phone);
        if (p.crop) setCrop(p.crop);
        if (p.latitude) setLatitude(p.latitude);
        if (p.longitude) setLongitude(p.longitude);
      } else {
        setIsIdentified(false);
        setFarmerName('');
        setFarmerPhone('');
        setAuthStep('PHONE');
        setAuthPhone('');
        setAuthName('');
      }
    };

    window.addEventListener('kisaansathi_auth_changed', handleAuthEvent);
    window.addEventListener('storage', handleAuthEvent);
    return () => {
      window.removeEventListener('kisaansathi_auth_changed', handleAuthEvent);
      window.removeEventListener('storage', handleAuthEvent);
    };
  }, []);

  // Phone submission handler to check against database
  const handlePhoneSubmit = async (e) => {
    e.preventDefault();
    setAuthError('');
    const rawDigits = authPhone.replace(/\D/g, '');
    const cleanDigits = rawDigits.length === 12 && rawDigits.startsWith('91') ? rawDigits.slice(2) : rawDigits;

    if (cleanDigits.length !== 10 || !['6', '7', '8', '9'].includes(cleanDigits.charAt(0))) {
      setAuthError('Please enter a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9.');
      return;
    }

    setAuthLoading(true);
    try {
      const res = await lookupFarmerByPhone(cleanDigits);
      if (res.exists && res.farmer) {
        const found = res.farmer;
        setFarmerName(found.name);
        setFarmerPhone(found.phone);
        setIsIdentified(true);
        localStorage.setItem(
          'kisaansathi_farmer_profile',
          JSON.stringify({
            farmer_id: found.id,
            name: found.name,
            phone: found.phone,
            preferred_language: found.preferred_language || currentLanguageName,
            crop: crop || 'Paddy',
          })
        );
        window.dispatchEvent(new Event('kisaansathi_auth_changed'));
      } else {
        setAuthStep('NAME');
      }
    } catch (err) {
      setAuthError(err.message || 'Failed to check mobile number. Please try again.');
    } finally {
      setAuthLoading(false);
    }
  };

  // Name submission handler when phone number is not found in database
  const handleNameSubmit = (e) => {
    e.preventDefault();
    setAuthError('');
    if (!authName.trim()) {
      setAuthError('Please enter your full name.');
      return;
    }

    const rawDigits = authPhone.replace(/\D/g, '');
    const formattedPhone = rawDigits.length === 12 && rawDigits.startsWith('91') ? rawDigits.slice(2) : rawDigits;

    setFarmerName(authName.trim());
    setFarmerPhone(formattedPhone);
    setIsIdentified(true);

    localStorage.setItem(
      'kisaansathi_farmer_profile',
      JSON.stringify({
        name: authName.trim(),
        phone: formattedPhone,
        crop: crop || 'Paddy',
      })
    );
    window.dispatchEvent(new Event('kisaansathi_auth_changed'));
  };

  // Switch account or change phone number
  const handleSwitchAccount = () => {
    localStorage.removeItem('kisaansathi_farmer_profile');
    window.dispatchEvent(new Event('kisaansathi_auth_changed'));
    setIsIdentified(false);
    setAuthStep('PHONE');
    setAuthPhone('');
    setAuthName('');
    setFarmerName('');
    setFarmerPhone('');
    setAuthError('');
  };

  return (
    <div className="farmer-page-container">
      <div className="farmer-report-shell">
        <div className="farmer-community-link-row">
          <Link to="/community" className="btn btn-secondary">
            👥 Farmer Community
          </Link>
          <span>Discuss farmer experiences and verified AEO guidance</span>
        </div>

        {!isIdentified ? (
          <div className="farmer-auth-step-container" data-testid="farmer-auth-step">
            <div className="card farmer-auth-step-card">
              <div className="farmer-auth-header">
                <div className="farmer-auth-icon-badge">🌾</div>
                <h2 className="farmer-auth-title">
                  {authStep === 'PHONE' ? 'Report a Crop Problem' : 'Farmer Registration'}
                </h2>
                <p className="farmer-auth-subtitle">
                  {authStep === 'PHONE'
                    ? 'Enter your mobile number to get started. No password or OTP required.'
                    : 'We could not find an existing account for this number in our database. Enter your full name to continue:'}
                </p>
              </div>

              {authError && (
                <div className="alert alert-error" role="alert" style={{ marginBottom: '16px' }}>
                  <span className="alert-icon">!</span>
                  <div>
                    <p>{authError}</p>
                  </div>
                </div>
              )}

              {authStep === 'PHONE' ? (
                <form onSubmit={handlePhoneSubmit} className="farmer-auth-form">
                  <div className="form-group">
                    <label className="form-label" htmlFor="auth-phone">
                      Mobile Number *
                    </label>
                    <div className="phone-input-group">
                      <span className="phone-prefix-tag">+91</span>
                      <input
                        id="auth-phone"
                        type="tel"
                        inputMode="numeric"
                        className="form-input font-mono phone-input-field"
                        placeholder="10-digit mobile number (e.g. 9876543210)"
                        value={authPhone}
                        onChange={(e) => {
                          setAuthPhone(e.target.value);
                          if (authError) setAuthError('');
                        }}
                        maxLength={14}
                        autoFocus
                        required
                        data-testid="farmer-phone-input"
                      />
                    </div>
                    <small className="form-hint">
                      🔒 No login or password required. Your mobile number connects your report with your local Agricultural Extension Officer (AEO).
                    </small>
                  </div>

                  <button
                    type="submit"
                    className="btn btn-primary btn-block btn-auth-submit"
                    disabled={authLoading}
                    data-testid="farmer-phone-submit-btn"
                  >
                    {authLoading ? '⏳ Checking database...' : 'Continue to Assistant →'}
                  </button>
                </form>
              ) : (
                <form onSubmit={handleNameSubmit} className="farmer-auth-form">
                  <div className="farmer-auth-phone-pill">
                    <span>Mobile Number:</span>
                    <strong>+91 {authPhone.replace(/\D/g, '').slice(-10)}</strong>
                    <button
                      type="button"
                      className="btn-change-phone-link"
                      onClick={() => {
                        setAuthStep('PHONE');
                        setAuthError('');
                      }}
                    >
                      ✏️ Change Number
                    </button>
                  </div>

                  <div className="form-group">
                    <label className="form-label" htmlFor="auth-name">
                      Farmer Full Name *
                    </label>
                    <input
                      id="auth-name"
                      type="text"
                      className="form-input"
                      placeholder="e.g. Ramesh Reddy"
                      value={authName}
                      onChange={(e) => {
                        setAuthName(e.target.value);
                        if (authError) setAuthError('');
                      }}
                      autoFocus
                      required
                      data-testid="farmer-name-input"
                    />
                    <small className="form-hint">
                      🌾 Your name helps the Agricultural Extension Officer identify and address you in their advisory.
                    </small>
                  </div>

                  <button
                    type="submit"
                    className="btn btn-primary btn-block btn-auth-submit"
                    data-testid="farmer-name-submit-btn"
                  >
                    Open AI Assistant →
                  </button>
                </form>
              )}
            </div>
          </div>
        ) : (
          <FarmerAiAssistant
            farmer={{
              id: initialProfile?.farmer_id,
              name: farmerName,
              phone: farmerPhone,
              crop: crop,
              latitude: latitude,
              longitude: longitude,
            }}
            onSwitchFarmer={handleSwitchAccount}
          />
        )}
      </div>
    </div>
  );
}
