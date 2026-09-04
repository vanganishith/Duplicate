import React, { useState } from 'react';
import { submitCommunityConfirmation } from '../services/api';

/**
 * Phase 10: Community Confirmation Component (Clean White UI)
 * 
 * Displays aggregated field responses from nearby farmers:
 * - X farmers confirmed (YES)
 * - X said No (NO)
 * - X said Not Sure (NOT_SURE)
 * 
 * Includes an interactive confirmation response form for nearby farmers/officers testing field reports.
 * Clearly labeled as supporting evidence, NOT a confirmed outbreak diagnosis.
 */
export default function CommunityConfirmationSection({
  incident,
  onConfirmationSubmitted = () => {},
}) {
  if (!incident) return null;

  // Confirmation state
  const communityStats = incident.community_stats || {
    yes_count: 0,
    no_count: 0,
    not_sure_count: 0,
    total_responses: 0,
  };

  const hasNearby = incident.has_nearby_complaints || incident.nearby_complaints_count > 0;
  const nearbyCount = incident.nearby_complaints_count || 0;

  // Form states
  const [showResponseForm, setShowResponseForm] = useState(false);
  const [selectedResponse, setSelectedResponse] = useState('YES');
  const [farmerPhone, setFarmerPhone] = useState('');
  const [farmerName, setFarmerName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [submitSuccess, setSubmitSuccess] = useState('');

  // Local counts if updated
  const [localStats, setLocalStats] = useState(communityStats);

  const total = localStats.total_responses || 0;
  const yes = localStats.yes_count || 0;
  const no = localStats.no_count || 0;
  const notSure = localStats.not_sure_count || 0;

  const handleSendResponse = async (e) => {
    e.preventDefault();
    setSubmitError('');
    setSubmitSuccess('');

    if (!farmerPhone.trim() || farmerPhone.trim().length < 10) {
      setSubmitError('Please enter a valid 10-digit mobile number.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await submitCommunityConfirmation({
        incidentId: incident.id,
        farmerPhone: farmerPhone.trim(),
        farmerName: farmerName.trim() || 'Nearby Farmer',
        response: selectedResponse,
      });

      if (res && res.success) {
        setLocalStats(res.stats);
        setSubmitSuccess(`Your response (${selectedResponse}) has been recorded.`);
        setFarmerPhone('');
        setFarmerName('');
        setShowResponseForm(false);
        onConfirmationSubmitted(res.stats);
      }
    } catch (err) {
      setSubmitError(err.message || 'Failed to record community confirmation.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="evidence-panel community-panel" data-testid="community-confirmation-section">
      <div className="evidence-panel-header">
        <div className="panel-title-wrap">
          <span className="panel-icon">👥</span>
          <div>
            <h3 className="panel-title">Community Confirmation</h3>
            <span className="panel-subtitle">Nearby farmer feedback &amp; corroboration</span>
          </div>
        </div>
        <span className="provenance-chip community-chip">Supporting Field Evidence</span>
      </div>

      <div className="evidence-panel-body">
        {/* Nearby Status Context */}
        <div className="community-context-row" data-testid="community-context-row">
          {hasNearby ? (
            <div className="nearby-alert-pill">
              📍 <strong>{nearbyCount > 0 ? `${nearbyCount} nearby complaint${nearbyCount > 1 ? 's' : ''}` : 'Nearby complaints'}</strong> reported in this area
            </div>
          ) : (
            <div className="isolated-notice-pill">
              🌱 Single isolated report &bull; No other nearby complaints recorded yet
            </div>
          )}
        </div>

        {/* Aggregated Response Metrics Grid */}
        <div className="community-stats-grid" data-testid="community-stats-grid">
          <div className="comm-stat-cell comm-stat-yes" data-testid="comm-stat-yes">
            <span className="comm-count" data-testid="comm-yes-count">{yes}</span>
            <span className="comm-label">
              <span className="comm-icon">👍</span> Farmers Confirmed (Yes)
            </span>
          </div>

          <div className="comm-stat-cell comm-stat-no" data-testid="comm-stat-no">
            <span className="comm-count" data-testid="comm-no-count">{no}</span>
            <span className="comm-label">
              <span className="comm-icon">👎</span> Said No
            </span>
          </div>

          <div className="comm-stat-cell comm-stat-notsure" data-testid="comm-stat-notsure">
            <span className="comm-count" data-testid="comm-notsure-count">{notSure}</span>
            <span className="comm-label">
              <span className="comm-icon">❓</span> Said Not Sure
            </span>
          </div>

          <div className="comm-stat-cell comm-stat-total" data-testid="comm-stat-total">
            <span className="comm-count" data-testid="comm-total-count">{total}</span>
            <span className="comm-label">
              <span className="comm-icon">📊</span> Total Responses
            </span>
          </div>
        </div>

        {/* Form Toggle & Action */}
        <div className="community-action-row">
          {!showResponseForm ? (
            <button
              type="button"
              className="btn btn-sm btn-outline btn-add-confirmation"
              onClick={() => setShowResponseForm(true)}
              data-testid="toggle-add-confirmation-btn"
            >
              + Record Farmer Response
            </button>
          ) : (
            <div className="community-response-form-card" data-testid="community-response-form">
              <div className="form-header-row">
                <h4 className="form-title">Have you seen this problem on nearby fields?</h4>
                <button
                  type="button"
                  className="btn-close-form"
                  onClick={() => setShowResponseForm(false)}
                >
                  ✕
                </button>
              </div>

              {submitError && (
                <div className="form-error-banner" data-testid="confirmation-error-msg">
                  ⚠️ {submitError}
                </div>
              )}

              {submitSuccess && (
                <div className="form-success-banner" data-testid="confirmation-success-msg">
                  ✅ {submitSuccess}
                </div>
              )}

              <form onSubmit={handleSendResponse} className="confirmation-form">
                {/* 3 Response Choices */}
                <div className="response-choice-group" data-testid="response-choice-group">
                  <label
                    className={`choice-btn ${selectedResponse === 'YES' ? 'selected-yes' : ''}`}
                  >
                    <input
                      type="radio"
                      name="confirmationResponse"
                      value="YES"
                      checked={selectedResponse === 'YES'}
                      onChange={(e) => setSelectedResponse(e.target.value)}
                      data-testid="radio-response-yes"
                    />
                    <span className="choice-title">👍 YES</span>
                    <span className="choice-sub">I&apos;ve seen this</span>
                  </label>

                  <label
                    className={`choice-btn ${selectedResponse === 'NO' ? 'selected-no' : ''}`}
                  >
                    <input
                      type="radio"
                      name="confirmationResponse"
                      value="NO"
                      checked={selectedResponse === 'NO'}
                      onChange={(e) => setSelectedResponse(e.target.value)}
                      data-testid="radio-response-no"
                    />
                    <span className="choice-title">👎 NO</span>
                    <span className="choice-sub">Haven&apos;t seen this</span>
                  </label>

                  <label
                    className={`choice-btn ${selectedResponse === 'NOT_SURE' ? 'selected-notsure' : ''}`}
                  >
                    <input
                      type="radio"
                      name="confirmationResponse"
                      value="NOT_SURE"
                      checked={selectedResponse === 'NOT_SURE'}
                      onChange={(e) => setSelectedResponse(e.target.value)}
                      data-testid="radio-response-notsure"
                    />
                    <span className="choice-title">❓ NOT SURE</span>
                    <span className="choice-sub">Uncertain</span>
                  </label>
                </div>

                {/* Farmer Phone Input */}
                <div className="form-input-grid">
                  <div className="input-wrap">
                    <label className="input-lbl">Farmer Phone (10 digits) *</label>
                    <input
                      type="tel"
                      className="clean-input"
                      placeholder="e.g. 9876543210"
                      value={farmerPhone}
                      onChange={(e) => setFarmerPhone(e.target.value)}
                      required
                      data-testid="farmer-phone-input"
                    />
                  </div>

                  <div className="input-wrap">
                    <label className="input-lbl">Farmer Name (optional)</label>
                    <input
                      type="text"
                      className="clean-input"
                      placeholder="e.g. Ramesh"
                      value={farmerName}
                      onChange={(e) => setFarmerName(e.target.value)}
                      data-testid="farmer-name-input"
                    />
                  </div>
                </div>

                <div className="form-actions-line">
                  <button
                    type="button"
                    className="btn btn-sm btn-outline"
                    onClick={() => setShowResponseForm(false)}
                    disabled={submitting}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn btn-sm btn-primary"
                    disabled={submitting}
                    data-testid="submit-confirmation-btn"
                  >
                    {submitting ? 'Submitting...' : 'Submit Response'}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>

        {submitSuccess && !showResponseForm && (
          <div className="form-success-banner" data-testid="confirmation-success-toast">
            ✅ {submitSuccess}
          </div>
        )}

        {/* Safety Disclaimer Banner */}
        <div className="community-safety-note" data-testid="community-safety-note">
          <span className="safety-icon">ℹ️</span>
          <span className="safety-text">
            <strong>Supporting Field Evidence:</strong> Community confirmations are farmer observations from nearby fields. This is not a confirmed disease or outbreak diagnosis. Official advisory requires AEO verification.
          </span>
        </div>
      </div>
    </section>
  );
}
