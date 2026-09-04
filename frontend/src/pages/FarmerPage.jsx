import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { submitIncident, lookupFarmerByPhone } from '../services/api';
import { useLanguage } from '../context/LanguageContext';
import AudioRecorder from '../components/AudioRecorder';
import LocationPickerMap from '../components/LocationPickerMap';
import PhotoEvidenceCapture from '../components/PhotoEvidenceCapture';
import NearbyCommunityIssues from '../components/NearbyCommunityIssues';

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

  // Basic Farmer & Crop Info
  const [farmerName, setFarmerName] = useState(initialProfile?.name || '');
  const [farmerPhone, setFarmerPhone] = useState(initialProfile?.phone || '');
  const [crop, setCrop] = useState(initialProfile?.crop || '');
  const [customCrop, setCustomCrop] = useState('');
  const [description, setDescription] = useState('');
  const [isManualTextVisible, setIsManualTextVisible] = useState(false);

  // Section 1: Photo Evidence State (Up to 4 photos)
  const [photos, setPhotos] = useState([]); // [{ file: File, preview: string }]

  // Section 2: Voice AI State
  const [audioFile, setAudioFile] = useState(null);
  const [liveTranscript, setLiveTranscript] = useState('');

  // Section 3: Interactive Location & Map State
  const [latitude, setLatitude] = useState(null);
  const [longitude, setLongitude] = useState(null);
  const [area, setArea] = useState('');
  const [landmark, setLandmark] = useState('');

  // Submission State
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState('');
  const [submissionSuccess, setSubmissionSuccess] = useState(null);

  // Stage 1 & 2 Workflow State
  const [agriculturalIntentValidated, setAgriculturalIntentValidated] = useState(false);
  const [nonAgriculturalNotice, setNonAgriculturalNotice] = useState('');
  const [complaintUnderstanding, setComplaintUnderstanding] = useState(null);
  const [photoGuidance, setPhotoGuidance] = useState([]);
  const [photoRetryNotice, setPhotoRetryNotice] = useState('');

  // Sync with global auth state (e.g. navbar login or logout)
  useEffect(() => {
    const handleAuthEvent = () => {
      const p = getInitialProfile();
      if (p?.name && p?.phone) {
        setIsIdentified(true);
        setFarmerName(p.name);
        setFarmerPhone(p.phone);
        if (p.crop) setCrop(p.crop);
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
        localStorage.setItem('kisaansathi_farmer_profile', JSON.stringify({
          farmer_id: found.id,
          name: found.name,
          phone: found.phone,
          preferred_language: found.preferred_language || currentLanguageName,
          crop: crop || (t.crops?.[0]?.value || 'Paddy'),
        }));
        window.dispatchEvent(new Event('kisaansathi_auth_changed'));
      } else {
        // Phone number not found in database - prompt for full name
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
    const cleanDigits = rawDigits.length === 12 && rawDigits.startsWith('91') ? rawDigits.slice(2) : rawDigits;
    const formattedPhone = cleanDigits.length === 10 ? `+91${cleanDigits}` : authPhone.trim();

    setFarmerName(authName.trim());
    setFarmerPhone(formattedPhone);
    setIsIdentified(true);

    localStorage.setItem('kisaansathi_farmer_profile', JSON.stringify({
      name: authName.trim(),
      phone: formattedPhone,
      crop: crop || (t.crops?.[0]?.value || 'Paddy'),
    }));
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

  // Set default crop choice
  useEffect(() => {
    if (t.crops && t.crops.length > 0 && !crop) {
      setCrop(t.crops[0].value);
    }
  }, [t.crops]);

  // Handle Location changes from interactive map
  const handleLocationChange = (loc) => {
    setLatitude(loc.latitude);
    setLongitude(loc.longitude);
    if (loc.area) setArea(loc.area);
    if (loc.landmark) setLandmark(loc.landmark);
  };

  // Form Submit Handler
  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmissionError('');
    setPhotoRetryNotice('');

    if (!farmerName.trim()) {
      setSubmissionError(t.valNameRequired || 'Farmer name is required.');
      return;
    }

    if (!farmerPhone.trim() || farmerPhone.trim().length < 10) {
      setSubmissionError(t.valPhoneRequired || 'Valid 10-digit mobile number is required.');
      return;
    }

    // Voice is mandatory first step
    const effectiveDesc = description.trim() || liveTranscript.trim();
    if (!effectiveDesc && !audioFile) {
      setSubmissionError('Voice complaint is mandatory. Please record and confirm your voice complaint first.');
      return;
    }

    // Must be confirmed as agriculture-related
    if (!agriculturalIntentValidated) {
      setSubmissionError('Please confirm your voice recording to validate its agricultural intent before uploading photos.');
      return;
    }

    // Require 1 to 4 photos
    if (!photos || photos.length === 0) {
      setSubmissionError('Please upload at least 1 photo following the photo guidance above (1 to 4 photos allowed).');
      return;
    }

    const isOtherCrop = crop === 'Other' || crop === 'ఇతర పంట' || crop === 'மற்ற பயிர்' || crop === 'अन्य फसल';
    const effectiveCrop = isOtherCrop && customCrop.trim() ? customCrop.trim() : crop;

    setIsSubmitting(true);

    try {
      const photoFiles = photos.map((p) => p.file).filter(Boolean);
      const response = await submitIncident({
        farmer_name: farmerName,
        farmer_phone: farmerPhone,
        description: effectiveDesc || 'Voice Agricultural Incident Report',
        crop: effectiveCrop,
        language: currentLanguageName,
        latitude: latitude,
        longitude: longitude,
        photo_file: photoFiles[0] || null,
        photo_files: photoFiles,
        audio_file: audioFile,
      });

      localStorage.setItem('kisaansathi_farmer_profile', JSON.stringify({
        farmer_id: response.farmer_id,
        name: farmerName.trim(),
        phone: farmerPhone.trim(),
        crop: effectiveCrop,
        latitude,
        longitude,
      }));

      setSubmissionSuccess(response);
    } catch (err) {
      if (err.photo_retry_required) {
        setPhotoRetryNotice(err.message || 'The uploaded photos did not show clear crop or plant evidence. Your voice complaint is preserved. Please upload clearer photos.');
        setSubmissionError('');
      } else {
        setSubmissionError(err.message || 'Failed to submit the problem. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReset = () => {
    setCrop(t.crops?.[0]?.value || 'Paddy');
    setCustomCrop('');
    setDescription('');
    setPhotos([]);
    setAudioFile(null);
    setLiveTranscript('');
    setAgriculturalIntentValidated(false);
    setNonAgriculturalNotice('');
    setComplaintUnderstanding(null);
    setPhotoGuidance([]);
    setPhotoRetryNotice('');
    setSubmissionError('');
    setSubmissionSuccess(null);
  };

  // ==========================================
  // CONFIRMATION / SUCCESS VIEW
  // ==========================================
  if (submissionSuccess) {
    const referenceId = submissionSuccess.reference_id || `RB-${(submissionSuccess.incident_id || '').substring(0, 8).toUpperCase()}`;
    const voiceAi = submissionSuccess.voice_ai;

    return (
      <div className="farmer-page-container">
        <div className="card confirmation-card">
          <div className="confirmation-header">
            <div className="success-check-badge">✓</div>
            <h1 className="confirmation-title">{t.successTitle || 'Incident Reported Successfully!'}</h1>
            <p className="confirmation-subtitle">{t.successSubtitle || 'Your local Agricultural Extension Officer (AEO) has been notified.'}</p>
          </div>

          {/* Non-blocking Agricultural Photo Guidance Notice */}
          {submissionSuccess.farmer_notice && (
            <div
              className="alert alert-warning"
              style={{
                margin: '16px 0',
                padding: '12px 16px',
                backgroundColor: '#fffbeb',
                border: '1px solid #fde68a',
                borderRadius: '8px',
                color: '#92400e',
                fontSize: '0.875rem',
                lineHeight: 1.5,
                textAlign: 'left'
              }}
              data-testid="farmer-relevance-warning"
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                <span style={{ fontSize: '1.25rem' }}>🌾</span>
                <div>
                  <strong>Photo Notice:</strong> {submissionSuccess.farmer_notice}
                </div>
              </div>
            </div>
          )}

          <div className="reference-box">
            <span className="reference-label">{t.refIdLabel || 'INCIDENT TRACKING REFERENCE ID'}</span>
            <span className="reference-code">{referenceId}</span>
          </div>

          {/* Incident Summary */}
          <div className="submission-summary">
            <h3 className="summary-title">{t.summaryTitle || 'Submitted Details'}</h3>
            <div className="summary-row">
              <span className="summary-key">{t.summaryFarmerName || 'Farmer'}:</span>
              <span className="summary-val"><strong>{farmerName}</strong> ({farmerPhone})</span>
            </div>
            <div className="summary-row">
              <span className="summary-key">{t.summaryCrop || 'Crop'}:</span>
              <span className="summary-val">{customCrop ? customCrop : crop}</span>
            </div>
            {area && (
              <div className="summary-row">
                <span className="summary-key">Confirmed Location:</span>
                <span className="summary-val">{area} {landmark ? `(${landmark})` : ''}</span>
              </div>
            )}
            {latitude && longitude && (
              <div className="summary-row">
                <span className="summary-key">GPS Coordinates:</span>
                <span className="summary-val font-mono">{latitude.toFixed(6)}, {longitude.toFixed(6)}</span>
              </div>
            )}
            <div className="summary-row">
              <span className="summary-key">Photo Evidence:</span>
              <span className="summary-val">{photos.length > 0 ? `${photos.length} Attached ✓` : 'None (Optional)'}</span>
            </div>
            <div className="summary-row">
              <span className="summary-key">Voice Note:</span>
              <span className="summary-val">{audioFile ? 'Attached & Processed ✓' : 'None'}</span>
            </div>
          </div>

          {/* AI Voice Insights */}
          {voiceAi && (
            <div className="ai-insights-card">
              <div className="ai-insights-header">
                <span className="ai-spark-icon">✨</span>
                <h3 className="ai-insights-title">AI Voice & Agricultural Meaning Insights</h3>
              </div>

              {voiceAi.transcript && (
                <div className="ai-insight-block">
                  <span className="ai-insight-label">Spoken Transcript:</span>
                  <p className="ai-transcript-text">"{voiceAi.transcript}"</p>
                </div>
              )}

              {voiceAi.summary && (
                <div className="ai-insight-block">
                  <span className="ai-insight-label">AI Summary:</span>
                  <p className="ai-summary-text">{voiceAi.summary}</p>
                </div>
              )}

              {voiceAi.symptoms && voiceAi.symptoms.length > 0 && (
                <div className="ai-insight-block">
                  <span className="ai-insight-label">Extracted Symptoms:</span>
                  <div className="symptoms-pills">
                    {voiceAi.symptoms.map((symptom, idx) => (
                      <span key={idx} className="symptom-pill">{symptom}</span>
                    ))}
                  </div>
                </div>
              )}

              {voiceAi.possible_conditions && voiceAi.possible_conditions.length > 0 && (
                <div className="ai-insight-block">
                  <span className="ai-insight-label">Preliminary Possibilities:</span>
                  <div className="conditions-pills">
                    {voiceAi.possible_conditions.map((cond, idx) => (
                      <span key={idx} className="condition-pill">{cond}</span>
                    ))}
                  </div>
                </div>
              )}

              <div className="ai-review-banner">
                <span className="review-badge">🛡 Human AEO Review Mandatory</span>
                <small>The Agricultural Extension Officer is the final authority to inspect and prescribe remedies.</small>
              </div>
            </div>
          )}

          <div className="confirmation-actions">
            <button type="button" onClick={handleReset} className="btn btn-primary">
              {t.btnReportAnother || 'Report Another Incident'}
            </button>
            <Link to="/my-issues" className="btn btn-secondary">
              📋 My Issues
            </Link>
            <Link to="/community" className="btn btn-secondary">
              👥 Farmer Community
            </Link>
            <Link to="/" className="btn btn-secondary" style={{ marginLeft: '12px' }}>
              {t.btnBackHome || 'Return to Home'}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ==========================================
  // MAIN REPORTING VIEW
  // ==========================================
  const isOtherCrop = crop === 'Other' || crop === 'ఇతర పంట' || crop === 'மற்ற பயிர்' || crop === 'अन्य फसल';

  return (
    <div className="farmer-page-container">
      <div className="farmer-report-shell">
        <div className="farmer-community-link-row">
          <Link to="/community" className="btn btn-secondary">👥 Farmer Community</Link>
          <span>Discuss farmer experiences and verified AEO guidance</span>
        </div>
        {/* Page Header */}
        <div className="report-main-header">
          <h1 className="report-page-title">Capture Agricultural Issue</h1>
          <p className="report-page-subtitle">
            Upload photos or speak to describe the crop problem. Our AI extracts symptoms and alerts your local AEO.
          </p>
        </div>

        {submissionError && (
          <div className="alert alert-error" role="alert" style={{ marginBottom: '16px' }}>
            <span className="alert-icon">!</span>
            <div>
              <strong>Error Submitting Report</strong>
              <p>{submissionError}</p>
            </div>
          </div>
        )}

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
                    {authLoading ? '⏳ Checking database...' : 'Continue to Complaint Form →'}
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
                    Open Complaint Form →
                  </button>
                </form>
              )}
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="incident-form-layout">
            {/* Farmer Identification Banner */}
            <div className="form-card-section">
              <div className="farmer-session-banner" data-testid="farmer-session-banner">
                <div className="farmer-session-main">
                  <div className="farmer-avatar-circle">
                    {(farmerName || 'F').charAt(0).toUpperCase()}
                  </div>
                  <div className="farmer-session-details">
                    <span className="farmer-session-kicker">Verified Farmer Profile</span>
                    <h3 className="farmer-session-name">{farmerName}</h3>
                    <span className="farmer-session-phone">📱 {farmerPhone}</span>
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-sm btn-outline btn-switch-farmer"
                  onClick={handleSwitchAccount}
                  title="Change mobile number or log in as a different farmer"
                  data-testid="switch-farmer-btn"
                >
                  🔄 Change number / Not you?
                </button>
              </div>

              <div className="farmer-crop-selector-grid">
                <div className="form-group">
                  <label className="form-label" htmlFor="farmer-crop">Primary Crop *</label>
                  <select
                    id="farmer-crop"
                    className="form-select"
                    value={crop}
                    onChange={(e) => setCrop(e.target.value)}
                  >
                    {(t.crops || [
                      { value: 'Paddy', label: 'Paddy / వరి' },
                      { value: 'Cotton', label: 'Cotton / పత్తి' },
                      { value: 'Chilli', label: 'Chilli / మిరప' },
                      { value: 'Maize', label: 'Maize / మొక్కజొన్న' },
                      { value: 'Other', label: 'Other / ఇతర పంట' },
                    ]).map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>

                {isOtherCrop && (
                  <div className="form-group">
                    <label className="form-label" htmlFor="custom-crop">Specify Crop Name *</label>
                    <input
                      id="custom-crop"
                      type="text"
                      className="form-input"
                      value={customCrop}
                      onChange={(e) => setCustomCrop(e.target.value)}
                      placeholder="Enter crop name"
                      required
                    />
                  </div>
                )}
              </div>
            </div>

          {/* Step 1: Voice Note & Authoritative ASR / Qwen3-VL Validation (MANDATORY FIRST STEP) */}
          <div className="voice-evidence-section" data-testid="voice-step-section">
            <div className="section-label-header">
              <span>1. VOICE COMPLAINT (MANDATORY FIRST STEP)</span>
            </div>

            <AudioRecorder
              onAudioRecorded={(file) => setAudioFile(file)}
              onAudioCleared={() => {
                setAudioFile(null);
                setLiveTranscript('');
                setAgriculturalIntentValidated(false);
                setNonAgriculturalNotice('');
                setComplaintUnderstanding(null);
                setPhotoGuidance([]);
                setPhotoRetryNotice('');
              }}
              onFinalTranscriptConfirmed={(confirmedText) => {
                setLiveTranscript(confirmedText);
                setDescription(confirmedText);
              }}
              onExtractedInsights={(insights) => {
                if (insights.agriculture_related === false) {
                  setAgriculturalIntentValidated(false);
                  setNonAgriculturalNotice(insights.reason || 'The recorded voice does not appear to describe a crop disease, pest, plant damage, or farming issue.');
                  setComplaintUnderstanding(null);
                  setPhotoGuidance([]);
                } else {
                  setAgriculturalIntentValidated(true);
                  setNonAgriculturalNotice('');
                  setComplaintUnderstanding(insights.complaint || {});
                  setPhotoGuidance(insights.photo_guidance || []);
                  if (insights.crop_detected && !customCrop) {
                    const matched = (t.crops || []).find((c) => c.value.toLowerCase() === insights.crop_detected.toLowerCase());
                    if (matched) {
                      setCrop(matched.value);
                    }
                  }
                  if (insights.summary && !description) {
                    setDescription(insights.summary);
                  }
                }
              }}
              disabled={isSubmitting}
              showManualToggle={false}
            />

            {/* Non-Agricultural Voice Alert */}
            {nonAgriculturalNotice && (
              <div className="alert alert-warning" style={{ marginTop: '14px', padding: '14px 16px', borderRadius: '8px', border: '1px solid #fde68a', backgroundColor: '#fffbeb' }} data-testid="non-agri-warning">
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                  <span style={{ fontSize: '1.3rem' }}>🌾</span>
                  <div>
                    <strong style={{ color: '#78350f', display: 'block', marginBottom: '4px' }}>Please describe a farming problem:</strong>
                    <p style={{ margin: 0, fontSize: '0.875rem', color: '#92400e', lineHeight: 1.5 }}>
                      {nonAgriculturalNotice} Please tap Re-record above and describe your crop, leaves, wilting, insect damage, or farming issue.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* AI Complaint Understanding & Tailored Photo Guidance (Revealed ONLY after Agricultural Intent is Validated) */}
          {agriculturalIntentValidated && (
            <div className="complaint-insights-wrapper" style={{ marginTop: '16px' }} data-testid="complaint-insights-wrapper">
              {/* Complaint Understanding Card */}
              {complaintUnderstanding && (
                <div className="card" style={{ padding: '16px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', marginBottom: '14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                    <h4 style={{ margin: 0, fontSize: '0.95rem', color: '#0f172a', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span>🌾</span> AI Complaint Understanding
                    </h4>
                    <span style={{ fontSize: '0.75rem', padding: '3px 8px', borderRadius: '12px', background: '#fef3c7', color: '#92400e', fontWeight: 600 }}>
                      Preliminary / Unconfirmed
                    </span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px', fontSize: '0.875rem', color: '#334155' }}>
                    {complaintUnderstanding.crop && <div><span style={{ color: '#64748b' }}>Crop:</span> <strong>{complaintUnderstanding.crop}</strong></div>}
                    {complaintUnderstanding.plant_part && <div><span style={{ color: '#64748b' }}>Plant Part:</span> <strong>{complaintUnderstanding.plant_part}</strong></div>}
                    {complaintUnderstanding.duration && <div><span style={{ color: '#64748b' }}>Duration:</span> <strong>{complaintUnderstanding.duration}</strong></div>}
                    {complaintUnderstanding.severity && <div><span style={{ color: '#64748b' }}>Severity:</span> <strong>{complaintUnderstanding.severity}</strong></div>}
                    {complaintUnderstanding.progression && <div><span style={{ color: '#64748b' }}>Progression:</span> <strong>{complaintUnderstanding.progression}</strong></div>}
                    {complaintUnderstanding.farmer_concern && (
                      <div style={{ gridColumn: '1 / -1' }}><span style={{ color: '#64748b' }}>Farmer Concern:</span> <em>{complaintUnderstanding.farmer_concern}</em></div>
                    )}
                  </div>
                </div>
              )}

              {/* Dynamic Photo Guidance Card */}
              {photoGuidance && photoGuidance.length > 0 && (
                <div className="card" style={{ padding: '16px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '10px', marginBottom: '14px' }} data-testid="photo-guidance-card">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <span style={{ fontSize: '1.2rem' }}>📸</span>
                    <h4 style={{ margin: 0, fontSize: '0.95rem', color: '#166534' }}>
                      Recommended Photos for your Agricultural Officer
                    </h4>
                  </div>
                  <p style={{ margin: '0 0 8px 0', fontSize: '0.8125rem', color: '#15803d' }}>
                    To help the AEO accurately inspect your reported issue, please attach 1 to 4 photos:
                  </p>
                  <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '0.875rem', color: '#166534', lineHeight: 1.6 }}>
                    {photoGuidance.map((guide, idx) => (
                      <li key={idx}><strong>{idx + 1}.</strong> {guide}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Photo Retry Notice Banner (if photos failed multimodal relevance check) */}
              {photoRetryNotice && (
                <div className="alert alert-warning" style={{ marginBottom: '14px', padding: '14px', borderRadius: '8px', border: '1px solid #fde68a', backgroundColor: '#fffbeb' }} data-testid="photo-retry-alert">
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                    <span style={{ fontSize: '1.25rem' }}>📷</span>
                    <div>
                      <strong style={{ color: '#78350f', display: 'block', marginBottom: '4px' }}>Better Photo Required:</strong>
                      <p style={{ margin: 0, fontSize: '0.875rem', color: '#92400e', lineHeight: 1.5 }}>
                        {photoRetryNotice}
                      </p>
                      <small style={{ display: 'block', marginTop: '4px', color: '#b45309' }}>
                        ✓ Your voice complaint is safe and does not need to be re-recorded.
                      </small>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 2: Photo Evidence Capture (Appears ONLY after Voice Intent is Validated) */}
              <div className="photo-evidence-section" data-testid="photo-step-section">
                <div className="section-label-header">
                  <span>2. PHOTO EVIDENCE (1 TO 4 PHOTOS REQUIRED)</span>
                </div>
                <PhotoEvidenceCapture
                  photos={photos}
                  onPhotosChange={(newPhotos) => {
                    setPhotos(newPhotos);
                    if (photoRetryNotice) setPhotoRetryNotice('');
                  }}
                  disabled={isSubmitting}
                />
              </div>
            </div>
          )}

          {/* Section 3: Interactive Location Details with Leaflet Map */}
          <div className="map-evidence-section">
            <div className="section-label-header">
              <span>3. FARM LOCATION & MAP CONFIRMATION</span>
            </div>

            <LocationPickerMap
              latitude={latitude}
              longitude={longitude}
              area={area}
              landmark={landmark}
              onLocationChange={handleLocationChange}
              disabled={isSubmitting}
            />

            {/* Section 4: Similar Community Issues within 3 KM */}
            <NearbyCommunityIssues
              latitude={latitude}
              longitude={longitude}
              crop={crop}
              farmerPhone={farmerPhone}
              farmerName={farmerName}
            />
          </div>

          {/* Submit Action Button */}
          <div className="form-submit-row">
            <button
              type="submit"
              disabled={isSubmitting || !agriculturalIntentValidated || photos.length === 0}
              className="btn btn-submit-incident"
              data-testid="submit-incident-btn"
            >
              {isSubmitting ? (
                <span>⏳ Running YOLO11 & Multimodal AI...</span>
              ) : !agriculturalIntentValidated ? (
                <span>🎙️ Record & Confirm Voice Complaint First</span>
              ) : photos.length === 0 ? (
                <span>📸 Upload 1–4 Photos to Submit Incident &rarr;</span>
              ) : (
                <span>🚀 SUBMIT INCIDENT REPORT &rarr;</span>
              )}
            </button>
          </div>
        </form>
      )}
    </div>
  </div>
);
}
