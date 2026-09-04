import React from 'react';

/**
 * Priority / Emerging Clusters Panel for AEO Dashboard.
 * Displays high-density concentrations of farmer complaints to help the officer prioritize field action.
 */
export default function PriorityClustersPanel({
  clusters = [],
  onSelectCluster = () => {},
  loading = false,
}) {
  return (
    <div className="priority-clusters-card" data-testid="priority-clusters-panel">
      <div className="clusters-header">
        <div className="clusters-title-wrap">
          <span className="clusters-hdr-icon">⚡</span>
          <div>
            <h3 className="clusters-title">Priority &amp; Emerging Areas</h3>
            <span className="clusters-subtitle">
              Geographic concentrations of similar complaints
            </span>
          </div>
        </div>
        <span className="clusters-count-badge" data-testid="cluster-total-badge">
          {clusters.length} {clusters.length === 1 ? 'Cluster' : 'Clusters'}
        </span>
      </div>

      <div className="clusters-body">
        {loading ? (
          <div className="clusters-loading-state">
            <div className="spinner-ring-small" />
            <p>Analyzing complaint concentrations...</p>
          </div>
        ) : clusters.length === 0 ? (
          <div className="clusters-empty-state" data-testid="clusters-empty-state">
            <span className="empty-icon">🌱</span>
            <h4>No Emerging Clusters</h4>
            <p>Complaints are currently distributed without dense localized clusters.</p>
          </div>
        ) : (
          <div className="cluster-cards-list">
            {clusters.map((cluster) => {
              const count = cluster.incident_count || 0;
              const isHigh = cluster.priority === 'HIGH' || count >= 5;

              return (
                <div
                  key={cluster.cluster_id}
                  className={`cluster-item-card ${isHigh ? 'cluster-high-priority' : ''}`}
                  data-testid={`cluster-card-${cluster.cluster_id}`}
                >
                  <div className="cluster-card-top">
                    <div className="cluster-badge-row">
                      <span className="cluster-reports-pill" data-testid="cluster-reports-pill">
                        📊 <strong>{count}</strong> {count === 1 ? 'report' : 'reports'}
                      </span>
                      {cluster.crop && (
                        <span className="cluster-crop-pill">
                          🌾 {cluster.crop}
                        </span>
                      )}
                      <span
                        className={`priority-badge priority-badge-${(cluster.priority || 'MEDIUM').toLowerCase()}`}
                        data-testid={`cluster-priority-tag-${cluster.cluster_id}`}
                      >
                        {cluster.priority === 'HIGH' ? '⚡ HIGH' : (cluster.priority || 'MEDIUM')}
                      </span>
                    </div>
                  </div>

                  <div className="cluster-card-content">
                    <h4 className="cluster-area-title">
                      📍 {cluster.area || 'Telangana Agricultural Zone'}
                    </h4>
                    <p className="cluster-issue-text">
                      {cluster.common_issue || 'Concentration of agricultural complaints'}
                    </p>
                    <div className="cluster-reason-box" data-testid={`cluster-reason-${cluster.cluster_id}`}>
                      <strong>Why:</strong> {cluster.priority_reason || `${count} nearby complaints in area`}
                    </div>
                  </div>

                  <div className="cluster-card-actions">
                    <button
                      type="button"
                      className="btn btn-sm btn-outline cluster-view-btn"
                      onClick={() => onSelectCluster(cluster)}
                      data-testid={`view-cluster-btn-${cluster.cluster_id}`}
                    >
                      View Cluster &rarr;
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="clusters-footer">
        <span className="cluster-safety-notice">
          ℹ️ <em>Clusters represent complaint concentrations to guide officer inspection, not verified disease diagnoses.</em>
        </span>
      </div>
    </div>
  );
}
