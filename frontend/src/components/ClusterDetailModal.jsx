import React from 'react';

/**
 * Cluster Detail Modal / Panel for inspecting all related complaints in an agricultural cluster.
 * Every individual farmer complaint remains accessible and actionable.
 */
export default function ClusterDetailModal({
  cluster = null,
  allIncidents = [],
  onClose = () => {},
  onSelectIncident = () => {},
}) {
  if (!cluster) return null;

  // Find all incidents that belong to this cluster
  const relatedIncidents = allIncidents.filter((inc) => {
    if (cluster.incident_ids && cluster.incident_ids.includes(inc.id)) {
      return true;
    }
    if (inc.cluster_id && inc.cluster_id === cluster.cluster_id) {
      return true;
    }
    return false;
  });

  return (
    <div className="modal-backdrop-clean" data-testid="cluster-detail-modal">
      <div className="modal-dialog-card cluster-modal-container">
        {/* Modal Header */}
        <div className="modal-dialog-header cluster-modal-header">
          <div className="cluster-modal-title-row">
            <span className="cluster-modal-icon">🌾</span>
            <div>
              <h3 className="modal-title">
                Agricultural Cluster Overview &bull; {cluster.area || 'Telangana Zone'}
              </h3>
              <span className="cluster-modal-sub">
                {cluster.incident_count || relatedIncidents.length} related farmer reports in this concentration
              </span>
            </div>
          </div>
          <button
            type="button"
            className="modal-close-x-btn"
            onClick={onClose}
            data-testid="close-cluster-modal-btn"
          >
            ✕
          </button>
        </div>

        {/* Cluster Metadata Summary Strip */}
        <div className="cluster-meta-strip">
          <div className="cluster-meta-item">
            <span className="meta-lbl">Area / Village</span>
            <span className="meta-val">📍 {cluster.area || 'Telangana Agricultural Zone'}</span>
          </div>
          <div className="cluster-meta-item">
            <span className="meta-lbl">Reported Crop</span>
            <span className="meta-val">🌾 {cluster.crop || 'Mixed / Unspecified'}</span>
          </div>
          <div className="cluster-meta-item">
            <span className="meta-lbl">Concentration Issue</span>
            <span className="meta-val">{cluster.common_issue || 'Similar agricultural symptoms'}</span>
          </div>
          <div className="cluster-meta-item">
            <span className="meta-lbl">Priority Level</span>
            <span className="meta-val">
              <span
                className={`priority-badge priority-badge-${(cluster.priority || 'MEDIUM').toLowerCase()}`}
                data-testid="cluster-modal-priority-badge"
              >
                {cluster.priority === 'HIGH' ? '⚡ HIGH' : (cluster.priority || 'MEDIUM')}
              </span>
            </span>
          </div>
          {cluster.priority_reason && (
            <div className="cluster-meta-item">
              <span className="meta-lbl">Why this Priority</span>
              <span className="meta-val">ℹ️ {cluster.priority_reason}</span>
            </div>
          )}
        </div>

        {/* Related Complaints List */}
        <div className="cluster-modal-body">
          <h4 className="cluster-list-heading">
            Related Farmer Complaints ({relatedIncidents.length})
          </h4>
          <p className="cluster-list-desc">
            Each farmer complaint is an individual report. Click <strong>View Details</strong> to inspect the farmer&apos;s audio, photo, AI analysis, or start active work.
          </p>

          <div className="cluster-complaints-list">
            {relatedIncidents.length === 0 ? (
              <div className="empty-sub-state">
                <p>No individual incident records linked to this cluster ID.</p>
              </div>
            ) : (
              relatedIncidents.map((inc, index) => {
                const isRej = inc.status === 'REJECTED';
                const isAck = inc.status === 'ACKNOWLEDGED' || inc.status === 'INVESTIGATING';

                return (
                  <div
                    key={inc.id}
                    className="cluster-complaint-item-card"
                    data-testid={`cluster-incident-${inc.id}`}
                  >
                    <div className="complaint-item-num">#{index + 1}</div>
                    <div className="complaint-item-info">
                      <div className="complaint-item-header">
                        <strong className="item-farmer-name">
                          {inc.farmers?.name || inc.farmer_name || 'Farmer'}
                        </strong>
                        {inc.crop && <span className="crop-pill-sm">🌾 {inc.crop}</span>}
                        <span
                          className={`status-pill-sm ${
                            isRej
                              ? 'status-pill-rejected'
                              : isAck
                                ? 'status-pill-progress'
                                : 'status-pill-new'
                          }`}
                        >
                          {inc.status}
                        </span>
                        <span
                          className={`priority-badge priority-badge-${(inc.priority || 'LOW').toLowerCase()}`}
                        >
                          {inc.priority === 'HIGH' ? '⚡ HIGH' : (inc.priority || 'LOW')}
                        </span>
                      </div>
                      <p className="item-description-text">{inc.description}</p>
                      <div className="item-meta-sub">
                        <span>ID: {inc.id.slice(0, 8).toUpperCase()}</span>
                        <span>
                          📅 {new Date(inc.created_at).toLocaleDateString()}
                        </span>
                        {inc.photo_url && <span>📷 Photo Attached</span>}
                        {inc.audio_url && <span>🎙️ Voice Attached</span>}
                      </div>
                    </div>

                    <div className="complaint-item-action">
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        onClick={() => {
                          onClose();
                          onSelectIncident(inc, true);
                        }}
                        data-testid={`cluster-view-detail-btn-${inc.id}`}
                      >
                        View Details &rarr;
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="modal-actions-row cluster-modal-footer">
          <span className="cluster-footer-note">
            🛡️ RythuBandhu geospatial cluster grouping &bull; All farmer complaints remain individual and actionable.
          </span>
          <button
            type="button"
            className="btn btn-outline"
            onClick={onClose}
            data-testid="close-cluster-modal-footer-btn"
          >
            Close Overview
          </button>
        </div>
      </div>
    </div>
  );
}
