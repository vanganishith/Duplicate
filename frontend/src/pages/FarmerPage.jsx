import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { submitIncident } from '../services/api';
import { useLanguage } from '../context/LanguageContext';
import AudioRecorder from '../components/AudioRecorder';
import LocationPickerMap from '../components/LocationPickerMap';
import PhotoEvidenceCapture from '../components/PhotoEvidenceCapture';
import NearbyCommunityIssues from '../components/NearbyCommunityIssues';

export default function FarmerPage() {
  const { t, currentLanguageName } = useLanguage();

  // Basic Farmer & Crop Info
  const [farmerName, setFarmerName] = useState('');
  const [farmerPhone, setFarmerPhone] = useState('');
  const [crop, setCrop] = useState('');
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

    if (!farmerName.trim()) {
      setSubmissionError(t.valNameRequired || 'Farmer name is required.');
      return;
    }

    if (!farmerPhone.trim() || farmerPhone.trim().length < 10) {
      setSubmissionError(t.valPhoneRequired || 'Valid 10-digit mobile number is required.');
      return;
    }

    // Require at least 1 photo (mandatory, up to 4 allowed)
    if (!photos || photos.length === 0) {
      setSubmissionError('Please upload at least 1 photo of the affected crop (1 to 4 photos allowed).');
      return;
    }

    // Require either typed description, live transcript, or recorded audio
    const effectiveDesc = description.trim() || liveTranscript.trim();
    if (!effectiveDesc && !audioFile) {
      setSubmissionError(t.valDescRequired || 'Please record a voice description or write the problem.');
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

      setSubmissionSuccess(response);
    } catch (err) {
      setSubmissionError(err.message || 'Failed to submit the problem. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReset = () => {
    setFarmerName('');
    setFarmerPhone('');
    setCrop(t.crops?.[0]?.value || 'Paddy');
    setCustomCrop('');
    setDescription('');
    setPhotos([]);
    setAudioFile(null);
    setLiveTranscript('');
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

        <form onSubmit={handleSubmit} className="incident-form-layout">
          {/* Farmer Contact Info Card */}
          <div className="form-card-section">
            <h3 className="section-title">Farmer Identification</h3>
            <div className="farmer-contact-grid">
              <div className="form-group">
                <label className="form-label" htmlFor="farmer-name">Full Name *</label>
                <input
                  id="farmer-name"
                  type="text"
                  className="form-input"
                  value={farmerName}
                  onChange={(e) => setFarmerName(e.target.value)}
                  placeholder="e.g. Ramesh Reddy"
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="farmer-phone">Mobile Number *</label>
                <input
                  id="farmer-phone"
                  type="tel"
                  className="form-input font-mono"
                  value={farmerPhone}
                  onChange={(e) => setFarmerPhone(e.target.value)}
                  placeholder="e.g. 9876543210"
                  required
                />
              </div>

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

          {/* Section 1: Photo Evidence (Optional, Up to 4 Photos) */}
          <PhotoEvidenceCapture
            photos={photos}
            onPhotosChange={(newPhotos) => setPhotos(newPhotos)}
            disabled={isSubmitting}
          />

          {/* Section 2: Voice Note & Live Conversion */}
          <div className="voice-evidence-section">
            <div className="section-label-header">
              <span>2. VOICE DESCRIPTION & LIVE AI CONVERSION</span>
            </div>

            <AudioRecorder
              onAudioRecorded={(file) => setAudioFile(file)}
              onAudioCleared={() => {
                setAudioFile(null);
                setLiveTranscript('');
              }}
              onFinalTranscriptConfirmed={(confirmedText) => {
                setLiveTranscript(confirmedText);
                setDescription(confirmedText);
              }}
              onExtractedInsights={(insights) => {
                if (insights.crop_detected && !customCrop) {
                  const matched = (t.crops || []).find((c) => c.value.toLowerCase() === insights.crop_detected.toLowerCase());
                  if (matched) {
                    setCrop(matched.value);
                  }
                }
                if (insights.summary && !description) {
                  setDescription(insights.summary);
                }
              }}
              disabled={isSubmitting}
              showManualToggle={true}
              isManualTextVisible={isManualTextVisible}
              onToggleManualText={() => setIsManualTextVisible(!isManualTextVisible)}
            />

            {/* Optional Manual Text Area */}
            {isManualTextVisible && (
              <div className="manual-text-group" style={{ marginTop: '14px' }}>
                <label className="form-label" htmlFor="manual-desc">
                  Typed Description (Optional)
                </label>
                <textarea
                  id="manual-desc"
                  className="form-textarea"
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe observed leaf yellowing, insect bites, or symptoms..."
                />
              </div>
            )}
          </div>

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
              disabled={isSubmitting}
              className="btn btn-submit-incident"
            >
              {isSubmitting ? (
                <span>⏳ Transcribing & Submitting Incident...</span>
              ) : (
                <span>🚀 SUBMIT INCIDENT REPORT &rarr;</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
