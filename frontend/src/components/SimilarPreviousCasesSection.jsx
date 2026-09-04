import React, { useState, useEffect } from 'react';
import { getIncident } from '../services/api';

/**
 * SimilarPreviousCasesSection
 * Displays confirmed similar previous cases in the AEO Dashboard case detail.
 * Highlights the farmer's confirmation signal along with historical diagnosis,
 * verification status, and resolution outcome.
 */
export default function SimilarPreviousCasesSection({ incident }) {
  const [confirmations, setConfirmations] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!incident) return;

    // 1. Check if confirmations are already present on incident object
    if (Array.isArray(incident.similar_issue_confirmations) && incident.similar_issue_confirmations.length > 0) {
      setConfirmations(incident.similar_issue_confirmations);
      return;
    }

    // 2. Check ai_analysis structured_data
    const aiRecords = Array.isArray(incident.ai_analysis) ? incident.ai_analysis : [];
    for (const r of aiRecords) {
      const sd = r?.structured_data;
      if (sd && Array.isArray(sd.similar_issue_confirmations) && sd.similar_issue_confirmations.length > 0) {
        setConfirmations(sd.similar_issue_confirmations);
        return;
      }
    }

    // 3. Alternatively fetch fresh incident detail
    let isMounted = true;
    if (incident.id) {
      setIsLoading(true);
      getIncident(incident.id)
        .then((data) => {
          if (!isMounted) return;
          const inc = data?.incident || data;
          const confs =
            data?.similar_issue_confirmations ||
            inc?.similar_issue_confirmations ||
            [];
          if (Array.isArray(confs) && confs.length > 0) {
            setConfirmations(confs);
          }
        })
        .catch((err) => {
          console.warn('Could not load similar issue confirmations:', err);
        })
        .finally(() => {
          if (isMounted) setIsLoading(false);
        });
    }

    return () => {
      isMounted = false;
    };
  }, [incident]);

  if (!incident) return null;

  return (
    <div className="card aeo-similar-cases-card" data-testid="aeo-similar-previous-cases">
      <div className="aeo-section-header">
        <div className="header-title-group">
          <span className="section-icon">🔄</span>
          <div>
            <h3 className="section-title">Similar Previous Cases</h3>
            <p className="section-subtitle">
              Farmer-confirmed similar historical cases for cross-field pattern validation
            </p>
          </div>
        </div>
        {confirmations.length > 0 && (
          <span className="farmer-confirmed-badge">
            ✓ {confirmations.length} Confirmed by Farmer
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="loading-state-sm">
          <span>Loading historical pattern matches...</span>
        </div>
      ) : confirmations.length === 0 ? (
        <div className="empty-similar-state">
          <span className="empty-icon">ℹ️</span>
          <p>No similar historical cases were confirmed by the farmer for this complaint.</p>
          <small className="text-muted">
            The Similar Issues Check is optional and does not affect normal AEO investigation.
          </small>
        </div>
      ) : (
        <div className="similar-confirmed-list">
          {confirmations.map((conf, idx) => {
            const shortId = (conf.matched_incident_id || '').substring(0, 8).toUpperCase();
            return (
              <div
                key={conf.id || conf.matched_incident_id || idx}
                className="similar-confirmed-item"
                data-testid={`confirmed-similar-item-${idx}`}
              >
                <div className="confirmed-item-header">
                  <div className="confirmed-case-ref">
                    <strong className="case-ref-code">Case #{shortId}</strong>
                    <span className="crop-tag">🌾 {conf.matched_crop || incident.crop || 'Crop'}</span>
                    <span className={`status-tag status-${(conf.matched_status || 'REPORTED').toLowerCase()}`}>
                      {conf.matched_status || 'RECORDED'}
                    </span>
                  </div>
                  <span className="confirmation-signal-tag">
                    ✓ Farmer Confirmed: "Looks Like My Problem"
                  </span>
                </div>

                <div className="confirmed-item-body">
                  <p className="matched-problem-desc">
                    <strong>Previous Complaint:</strong> {conf.matched_problem || 'No description recorded'}
                  </p>

                  {conf.matched_photo_url && (
                    <div className="matched-photo-thumb">
                      <a href={conf.matched_photo_url} target="_blank" rel="noopener noreferrer">
                        <img src={conf.matched_photo_url} alt="Historical case evidence" loading="lazy" />
                        <span className="thumb-caption">View Historical Photo ↗</span>
                      </a>
                    </div>
                  )}

                  <div className="confirmed-meta-footer">
                    <small className="text-muted">
                      Confirmed at: {conf.created_at ? new Date(conf.created_at).toLocaleString() : 'During intake'}
                    </small>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
