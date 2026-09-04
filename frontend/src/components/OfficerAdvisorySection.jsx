import React, { useState } from 'react';
import { submitOfficerAdvisory } from '../services/api';

/**
 * Phase 12: AEO -> Farmer Advisory + Local-Language TTS Section (Clean White UI)
 * 
 * Features:
 * - AEO writes action advisory for farmer.
 * - Language selection defaults to farmer's preferred language.
 * - AI translates faithfully (NO AI-invented treatments).
 * - gTTS generates local-language audio for the farmer.
 * - Audio playback and dual-text (localized + original preserved) display.
 */
export default function OfficerAdvisorySection({
  incident,
  onAdvisorySaved = () => {},
}) {
  if (!incident) return null;

  const farmerLang = incident.language || incident.farmers?.preferred_language || 'Telugu';

  const [advisoryText, setAdvisoryText] = useState('');
  const [selectedLanguage, setSelectedLanguage] = useState(farmerLang);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [submitSuccess, setSubmitSuccess] = useState('');
  const [showEditForm, setShowEditForm] = useState(false);

  // Existing advisory from incident or local state
  const existingAdvisory = incident.advisory;
  const [currentAdvisory, setCurrentAdvisory] = useState(existingAdvisory);

  const LANGUAGES = [
    { code: 'Telugu', label: 'తెలుగు (Telugu)' },
    { code: 'Hindi', label: 'हिन्दी (Hindi)' },
    { code: 'Tamil', label: 'தமிழ் (Tamil)' },
    { code: 'English', label: 'English' },
    { code: 'Kannada', label: 'ಕನ್ನಡ (Kannada)' },
    { code: 'Marathi', label: 'मరాఠీ (Marathi)' },
  ];

  const handleSendAdvisory = async (e) => {
    e.preventDefault();
    if (!advisoryText.trim()) {
      setSubmitError('Please enter an advisory message for the farmer.');
      return;
    }

    setSubmitting(true);
    setSubmitError('');
    setSubmitSuccess('');

    try {
      const res = await submitOfficerAdvisory({
        incidentId: incident.id,
        advisoryText: advisoryText.trim(),
        targetLanguage: selectedLanguage,
        officerId: 'AEO001',
      });

      if (res && res.success) {
        setCurrentAdvisory(res.advisory);
        setSubmitSuccess(`Advisory localized to ${res.advisory.target_language} and audio generated!`);
        setShowEditForm(false);
        setAdvisoryText('');
        onAdvisorySaved(res.advisory);
      }
    } catch (err) {
      setSubmitError(err.message || 'Failed to send officer advisory.');
    } finally {
      setSubmitting(false);
    }
  };

  const API_HOST = import.meta.env.VITE_API_URL || import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
  const getFullAudioUrl = (url) => {
    if (!url) return null;
    if (url.startsWith('http')) return url;
    return `${API_HOST}${url}`;
  };

  return (
    <section className="evidence-panel advisory-panel" data-testid="aeo-advisory-section">
      <div className="evidence-panel-header">
        <div className="panel-title-wrap">
          <span className="panel-icon">📢</span>
          <div>
            <h3 className="panel-title">AEO Official Advisory &amp; Audio</h3>
            <span className="panel-subtitle">Localized field instructions sent to farmer</span>
          </div>
        </div>
        <span className="provenance-chip aeo-chip">Official Officer Advisory</span>
      </div>

      <div className="evidence-panel-body">
        {/* Existing Advisory Display */}
        {currentAdvisory && !showEditForm ? (
          <div className="advisory-display-card" data-testid="advisory-display-card">
            <div className="advisory-header-row">
              <div className="advisory-meta-badges">
                <span className="badge-lang-tag" data-testid="advisory-lang-badge">
                  🌐 {currentAdvisory.target_language}
                </span>
                <span className="badge-officer-tag">
                  👤 Officer: {currentAdvisory.officer_id || 'AEO001'}
                </span>
              </div>
              <button
                type="button"
                className="btn btn-sm btn-outline btn-edit-advisory"
                onClick={() => {
                  setAdvisoryText(currentAdvisory.original_advisory || '');
                  setSelectedLanguage(currentAdvisory.target_language || farmerLang);
                  setShowEditForm(true);
                }}
                data-testid="edit-advisory-btn"
              >
                ✏️ Update Advisory
              </button>
            </div>

            {/* Localized Message Text */}
            <div className="advisory-message-box">
              <span className="message-label">
                Localized Advisory for Farmer ({currentAdvisory.target_language}):
              </span>
              <p className="localized-text" data-testid="advisory-localized-text">
                {currentAdvisory.localized_advisory}
              </p>
            </div>

            {/* Audio Speech Player */}
            {currentAdvisory.audio_url ? (
              <div className="advisory-audio-row" data-testid="advisory-audio-row">
                <div className="audio-lbl-wrap">
                  <span className="audio-icon">🔊</span>
                  <span className="audio-lbl">Farmer Voice Advisory ({currentAdvisory.target_language} TTS):</span>
                </div>
                <audio
                  controls
                  className="advisory-audio-player"
                  src={getFullAudioUrl(currentAdvisory.audio_url)}
                  data-testid="advisory-audio-player"
                >
                  Your browser does not support audio playback.
                </audio>
              </div>
            ) : (
              <div className="audio-fallback-pill" data-testid="audio-fallback-pill">
                ℹ️ Audio speech generation not available &bull; Text advisory saved and delivered.
              </div>
            )}

            {/* Original Preserved AEO Text */}
            <div className="advisory-original-box" data-testid="advisory-original-box">
              <span className="original-label">Original Officer Text (Preserved):</span>
              <p className="original-text">&ldquo;{currentAdvisory.original_advisory}&rdquo;</p>
              {currentAdvisory.created_at && (
                <span className="advisory-timestamp">
                  Recorded: {new Date(currentAdvisory.created_at).toLocaleString()}
                </span>
              )}
            </div>
          </div>
        ) : (
          /* Advisory Form */
          <div className="advisory-form-card" data-testid="advisory-form-card">
            <h4 className="advisory-form-title">
              {currentAdvisory ? 'Update Advisory for Farmer' : 'Send Official Advisory & Voice Note to Farmer'}
            </h4>
            <p className="advisory-form-desc">
              Write your field instructions or treatment advice. It will be automatically translated into the farmer&apos;s preferred local language and synthesized into voice audio.
            </p>

            {submitError && (
              <div className="form-error-banner" data-testid="advisory-error-msg">
                ⚠️ {submitError}
              </div>
            )}

            {submitSuccess && (
              <div className="form-success-banner" data-testid="advisory-success-msg">
                ✅ {submitSuccess}
              </div>
            )}

            <form onSubmit={handleSendAdvisory} className="advisory-form">
              <div className="advisory-form-controls">
                {/* Language Selector */}
                <div className="input-wrap lang-select-wrap">
                  <label className="input-lbl">Target Farmer Language:</label>
                  <select
                    className="clean-input select-lang"
                    value={selectedLanguage}
                    onChange={(e) => setSelectedLanguage(e.target.value)}
                    data-testid="advisory-lang-select"
                  >
                    {LANGUAGES.map((l) => (
                      <option key={l.code} value={l.code}>
                        {l.label} {l.code.toLowerCase() === farmerLang.toLowerCase() ? '(Farmer Preferred)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Advisory Text Area */}
              <div className="input-wrap">
                <label className="input-lbl">
                  Officer Advisory / Treatment Instructions *:
                </label>
                <textarea
                  className="clean-textarea advisory-textarea"
                  rows={3}
                  placeholder="e.g. Spray 5ml neem oil per liter of water in early morning. Ensure proper drainage to prevent root rot..."
                  value={advisoryText}
                  onChange={(e) => setAdvisoryText(e.target.value)}
                  required
                  data-testid="advisory-text-input"
                />
              </div>

              <div className="form-actions-line">
                {currentAdvisory && (
                  <button
                    type="button"
                    className="btn btn-sm btn-outline"
                    onClick={() => setShowEditForm(false)}
                    disabled={submitting}
                  >
                    Cancel
                  </button>
                )}
                <button
                  type="submit"
                  className="btn btn-sm btn-primary btn-send-advisory"
                  disabled={submitting}
                  data-testid="send-advisory-btn"
                >
                  {submitting ? 'Localizing & Synthesizing Audio...' : '📢 Send Localized Advisory + Audio'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Safety Note */}
        <div className="advisory-safety-note" data-testid="advisory-safety-note">
          <span className="safety-icon">🛡️</span>
          <span className="safety-text">
            <strong>Authoritative Advice:</strong> The AEO is the official agricultural authority. AI is used strictly for linguistic translation into the farmer&apos;s dialect and does not invent or alter treatments.
          </span>
        </div>
      </div>
    </section>
  );
}
