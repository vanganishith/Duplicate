import React, { useState, useEffect } from 'react';
import { getNearbyCommunityIncidents, submitCommunityConfirmation } from '../services/api';

/**
 * NearbyCommunityIssues Component (Farmer-Facing)
 * 
 * - Strictly searches within a 3 KM radius based on the farmer's selected location.
 * - Displays prioritized similar issues (same crop first, closest distance, recency).
 * - Enforces strict privacy: NO exact GPS coordinates, phone numbers, or farmer names.
 * - Provides an interactive "Me Too" action that records community confirmation without creating a new AEO case.
 */
export default function NearbyCommunityIssues({
  latitude,
  longitude,
  crop = '',
  farmerPhone = '',
  farmerName = '',
  onSelectExistingIssue = () => {},
}) {
  const [nearbyIssues, setNearbyIssues] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [confirmedMap, setConfirmedMap] = useState({}); // { [incidentId]: true }
  const [confirmingId, setConfirmingId] = useState(null);
  const [phonePromptId, setPhonePromptId] = useState(null);
  const [inputPhone, setInputPhone] = useState(farmerPhone || '');

  const hasCoordinates =
    latitude !== null &&
    longitude !== null &&
    latitude !== undefined &&
    longitude !== undefined &&
    Number.isFinite(Number(latitude)) &&
    Number.isFinite(Number(longitude)) &&
    Number(latitude) >= -90 &&
    Number(latitude) <= 90 &&
    Number(longitude) >= -180 &&
    Number(longitude) <= 180;

  // Fetch nearby issues whenever location or crop changes
  useEffect(() => {
    if (!hasCoordinates) {
      setNearbyIssues([]);
      return;
    }

    let isMounted = true;
    setIsLoading(true);
    setError(null);

    getNearbyCommunityIncidents({
      latitude,
      longitude,
      radiusKm: 3.0,
      crop: crop || null,
      limit: 15,
    })
      .then((res) => {
        if (isMounted) {
          if (res && res.success) {
            setNearbyIssues(res.items || []);
          } else {
            setNearbyIssues([]);
          }
        }
      })
      .catch((err) => {
        if (isMounted) {
          setError(err.message || 'Unable to load nearby community issues');
          setNearbyIssues([]);
        }
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [latitude, longitude, crop]);

  // Handle "Me Too" button click
  const handleMeTooClick = async (incident) => {
    const effectivePhone = farmerPhone || inputPhone;
    if (!effectivePhone || effectivePhone.trim().length < 10) {
      setPhonePromptId(incident.id);
      return;
    }

    setConfirmingId(incident.id);
    try {
      await submitCommunityConfirmation({
        incidentId: incident.id,
        farmerPhone: effectivePhone.trim(),
        response: 'YES',
        farmerName: farmerName || 'Nearby Farmer',
        latitude,
        longitude,
      });

      setConfirmedMap((prev) => ({
        ...prev,
        [incident.id]: (prev[incident.id] || incident.community_confirmations_count || 0) + 1,
      }));
      setPhonePromptId(null);
    } catch (err) {
      alert(err.message || 'Could not record confirmation.');
    } finally {
      setConfirmingId(null);
    }
  };

  if (!hasCoordinates) {
    return null;
  }

  return (
    <div className="nearby-community-section" data-testid="nearby-community-section">
      <div className="nearby-community-header">
        <div className="header-title-row">
          <span className="nearby-icon">👥</span>
          <div>
            <h3 className="nearby-title">Similar Community Issues Nearby</h3>
            <span className="nearby-subtitle">Within 3 km of your selected farm location</span>
          </div>
        </div>
        <span className="privacy-badge" title="No exact coordinates or farmer names are exposed">
          🔒 Privacy Protected
        </span>
      </div>

      {isLoading ? (
        <div className="nearby-loading-state" data-testid="nearby-loading">
          <span className="spinner-icon">🔄</span>
          <span>Checking 3 km agricultural radius for similar complaints...</span>
        </div>
      ) : error ? (
        <div className="nearby-error-state">
          <span>⚠️ {error}</span>
        </div>
      ) : nearbyIssues.length === 0 ? (
        <div className="nearby-empty-state" data-testid="nearby-empty-state">
          <span className="empty-icon">📍</span>
          <div className="empty-text-wrap">
            <strong>No similar issues found nearby.</strong>
            <p>No other complaints recorded within 3 km of your farm location.</p>
          </div>
        </div>
      ) : (
        <div className="nearby-issues-list" data-testid="nearby-issues-list">
          <p className="nearby-issues-intro">
            Farmers in your locality have reported the following issues. If your farm is facing the exact same problem, tap <strong>"Me Too"</strong> to increase the local alert density without creating a separate complaint.
          </p>

          <div className="nearby-cards-grid">
            {nearbyIssues.map((issue) => {
              const isConfirmed = Boolean(confirmedMap[issue.id]);
              const confCount =
                confirmedMap[issue.id] !== undefined
                  ? confirmedMap[issue.id]
                  : issue.community_confirmations_count || 0;

              return (
                <div
                  key={issue.id}
                  className={`nearby-issue-card ${issue.has_similar_crop ? 'highlight-same-crop' : ''}`}
                  data-testid={`nearby-issue-card-${issue.id}`}
                  onClick={() => onSelectExistingIssue(issue)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => { if (event.key === 'Enter') onSelectExistingIssue(issue); }}
                >
                  <div className="nearby-card-top">
                    <div className="distance-badge-wrap">
                      <span className="distance-pill" data-testid="distance-badge">
                        📍 {issue.distance_text || `${issue.distance_km} km away`}
                      </span>
                      <span className="locality-pill">{issue.locality || 'Near your locality'}</span>
                    </div>
                    <span className="crop-tag" data-testid="crop-tag">
                      {issue.crop}
                    </span>
                  </div>

                  <div className="nearby-card-body">
                    {issue.photo_url && (
                      <div className="nearby-photo-thumb">
                        <img src={issue.photo_url} alt="Crop issue thumbnail" />
                      </div>
                    )}
                    <div className="nearby-desc-wrap">
                      <p className="nearby-problem-summary" data-testid="problem-summary">
                        {issue.problem_summary}
                      </p>
                      {issue.created_at && (
                        <span className="nearby-timestamp">
                          Reported {new Date(issue.created_at).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="nearby-card-footer">
                    <div className="confirmation-count-stat" data-testid="confirmation-count">
                      <span className="thumb-icon">👍</span>
                      <span>
                        {confCount > 0
                          ? `${confCount} nearby farmer${confCount > 1 ? 's' : ''} confirmed`
                          : 'Be the first to confirm'}
                      </span>
                    </div>

                    {isConfirmed ? (
                      <div className="me-too-confirmed-badge" data-testid="me-too-confirmed">
                        ✓ Confirmed (Me Too recorded)
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-sm btn-me-too"
                        disabled={confirmingId === issue.id}
                        data-testid={`me-too-btn-${issue.id}`}
                        onClick={(event) => { event.stopPropagation(); handleMeTooClick(issue); }}
                      >
                        {confirmingId === issue.id ? 'Recording...' : '✋ Me Too'}
                      </button>
                    )}
                  </div>

                  {phonePromptId === issue.id && !isConfirmed && (
                    <div className="phone-prompt-row" data-testid="phone-prompt-row">
                      <input
                        type="tel"
                        className="form-input form-input-sm"
                        placeholder="Enter 10-digit mobile number"
                        value={inputPhone}
                        onChange={(e) => setInputPhone(e.target.value)}
                        maxLength={10}
                      />
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        onClick={(event) => { event.stopPropagation(); handleMeTooClick(issue); }}
                      >
                        Confirm
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
