import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  listIncidents,
  getIncident,
  startWorkOnIncident,
  rejectIncident,
  getMapOverview,
} from '../services/api';
import EvidenceComparisonCard from '../components/EvidenceComparisonCard';
import FarmerLocationMap from '../components/FarmerLocationMap';
import IncidentClusterMap from '../components/IncidentClusterMap';
import PriorityClustersPanel from '../components/PriorityClustersPanel';
import ClusterDetailModal from '../components/ClusterDetailModal';
import CaseWorkflowSection from '../components/CaseWorkflowSection';
import OfficerAdvisorySection from '../components/OfficerAdvisorySection';

export default function AeoDashboard() {
  const navigate = useNavigate();
  const [officerSession, setOfficerSession] = useState(null);

  // Core incident data
  const [incidents, setIncidents] = useState([]);
  const [mapIncidents, setMapIncidents] = useState([]);
  const [clusters, setClusters] = useState([]);
  const [selectedIncident, setSelectedIncident] = useState(null);
  const [activeCluster, setActiveCluster] = useState(null);

  // Loading & error states
  const [loading, setLoading] = useState(true);
  const [mapLoading, setMapLoading] = useState(false);
  const [error, setError] = useState(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'new' | 'acknowledged' | 'resolved' | 'high_priority' | 'rejected'
  const [timeFilter, setTimeFilter] = useState('all'); // 'all' | 'today' | '7d' | '30d'
  const [modalityFilter, setModalityFilter] = useState('all'); // 'all' | 'photo' | 'voice'

  // View state
  const [isDetailViewOpen, setIsDetailViewOpen] = useState(false);

  // Action states
  const [actionLoading, setActionLoading] = useState(false);
  const [actionSuccessMessage, setActionSuccessMessage] = useState(null);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const [rejectionPreset, setRejectionPreset] = useState('');
  const [rejectError, setRejectError] = useState('');

  // Check Officer Authentication Session
  useEffect(() => {
    const sessionStr = localStorage.getItem('aeo_officer_session');
    if (sessionStr) {
      try {
        setOfficerSession(JSON.parse(sessionStr));
      } catch {
        setOfficerSession(null);
      }
    }
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('aeo_officer_session');
    setOfficerSession(null);
    navigate('/officer-login');
  };

  // Fetch full incident list & map overview
  const loadDashboardData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // 1. Fetch recent incidents list for the triage table
      const listRes = await listIncidents(100);
      if (listRes && listRes.incidents) {
        setIncidents(listRes.incidents);
        if (listRes.incidents.length > 0 && !selectedIncident) {
          setSelectedIncident(listRes.incidents[0]);
        }
      }

      // 2. Fetch real PostGIS map & cluster overview
      await loadMapData();
    } catch (err) {
      setError('Failed to load incident dashboard data from backend.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch map overview specifically based on active filters
  const loadMapData = async () => {
    try {
      setMapLoading(true);
      const mapRes = await getMapOverview({
        status: statusFilter,
        time_filter: timeFilter,
        modality: modalityFilter,
      });

      if (mapRes && mapRes.success) {
        setMapIncidents(mapRes.incidents || []);
        setClusters(mapRes.clusters || []);
      }
    } catch (err) {
      console.error('Failed to load map data:', err);
    } finally {
      setMapLoading(false);
    }
  };

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  // Reload map whenever map filters change
  useEffect(() => {
    loadMapData();
  }, [statusFilter, timeFilter, modalityFilter]);

  const handleSelectIncident = async (inc, openDetail = false) => {
    setActionSuccessMessage(null);
    if (openDetail) {
      setIsDetailViewOpen(true);
    }
    try {
      const res = await getIncident(inc.id);
      if (res && res.incident) {
        const detailed = {
          ...res.incident,
          ai_analysis: res.ai_analysis || inc.ai_analysis || [],
        };
        setSelectedIncident(detailed);
      } else {
        setSelectedIncident(inc);
      }
    } catch {
      setSelectedIncident(inc);
    }
  };

  const handleOpenCluster = (cluster) => {
    setActiveCluster(cluster);
  };

  // Handler: Start Work on Incident
  const handleStartWork = async () => {
    if (!selectedIncident) return;
    try {
      setActionLoading(true);
      setActionSuccessMessage(null);
      const res = await startWorkOnIncident(selectedIncident.id, officerSession?.officer_id || 'AEO001');
      if (res && res.success) {
        const updated = {
          ...selectedIncident,
          status: 'ACKNOWLEDGED',
          acknowledged_at: res.acknowledged_at,
        };
        setSelectedIncident(updated);
        setIncidents((prev) => prev.map((i) => (i.id === updated.id ? { ...i, status: 'ACKNOWLEDGED' } : i)));
        setMapIncidents((prev) => prev.map((i) => (i.id === updated.id ? { ...i, status: 'ACKNOWLEDGED' } : i)));
        setActionSuccessMessage('Work started successfully! Complaint is now in ACKNOWLEDGED status.');
      }
    } catch (err) {
      alert(`Failed to start work: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  // Handler: Confirm Rejection with Reason
  const handleConfirmReject = async () => {
    const finalReason = rejectionReason.trim() || rejectionPreset.trim();
    if (!finalReason) {
      setRejectError('Please enter or select a rejection reason.');
      return;
    }

    if (!selectedIncident) return;

    try {
      setActionLoading(true);
      setRejectError('');
      const res = await rejectIncident(selectedIncident.id, finalReason, officerSession?.officer_id || 'AEO001');
      if (res && res.success) {
        const updatedAi = [...(selectedIncident.ai_analysis || [])];
        const rejectionMeta = {
          status: 'REJECTED',
          reason: finalReason,
          rejected_at: res.rejected_at,
          officer_id: officerSession?.officer_id || 'AEO001',
        };

        if (updatedAi.length > 0) {
          updatedAi[0] = {
            ...updatedAi[0],
            structured_data: {
              ...(updatedAi[0].structured_data || {}),
              rejection: rejectionMeta,
            },
          };
        } else {
          updatedAi.push({ structured_data: { rejection: rejectionMeta } });
        }

        const updated = {
          ...selectedIncident,
          status: 'REJECTED',
          rejection_reason: finalReason,
          ai_analysis: updatedAi,
        };

        setSelectedIncident(updated);
        setIncidents((prev) =>
          prev.map((i) => (i.id === updated.id ? { ...i, status: 'REJECTED', rejection_reason: finalReason } : i))
        );
        setMapIncidents((prev) =>
          prev.map((i) => (i.id === updated.id ? { ...i, status: 'REJECTED' } : i))
        );
        setShowRejectModal(false);
        setRejectionReason('');
        setRejectionPreset('');
        setActionSuccessMessage('Complaint marked as REJECTED with recorded reason.');
      }
    } catch (err) {
      setRejectError(err.message || 'Failed to reject incident');
    } finally {
      setActionLoading(false);
    }
  };

  // Real Count Calculations from all incidents
  const totalCount = incidents.length;
  const newCount = incidents.filter((i) => i.status === 'NEW' || i.status === 'AI_ANALYZED').length;
  const inProgressCount = incidents.filter((i) => i.status === 'ACKNOWLEDGED' || i.status === 'INVESTIGATING').length;
  const resolvedCount = incidents.filter(
    (i) =>
      (i.status === 'RESOLVED' || i.status === 'ACTION_TAKEN') &&
      i.status !== 'REJECTED' &&
      !i.ai_analysis?.[0]?.structured_data?.rejection
  ).length;
  const rejectedCount = incidents.filter(
    (i) => i.status === 'REJECTED' || !!i.ai_analysis?.[0]?.structured_data?.rejection
  ).length;

  // Filtered List for Triage Table
  const filteredIncidents = incidents.filter((inc) => {
    // Search Query (farmer name, crop, description, ID)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchName = inc.farmers?.name?.toLowerCase().includes(q) || inc.farmer_name?.toLowerCase().includes(q);
      const matchCrop = inc.crop?.toLowerCase().includes(q);
      const matchDesc = inc.description?.toLowerCase().includes(q);
      const matchId = inc.id?.toLowerCase().includes(q);
      if (!matchName && !matchCrop && !matchDesc && !matchId) return false;
    }

    // Status Filter
    const isRej = inc.status === 'REJECTED' || !!inc.ai_analysis?.[0]?.structured_data?.rejection;
    if (statusFilter === 'new') {
      if (inc.status !== 'NEW' && inc.status !== 'AI_ANALYZED') return false;
    } else if (statusFilter === 'acknowledged' || statusFilter === 'in_progress') {
      if (inc.status !== 'ACKNOWLEDGED' && inc.status !== 'INVESTIGATING') return false;
    } else if (statusFilter === 'resolved') {
      if (inc.status !== 'RESOLVED' && inc.status !== 'ACTION_TAKEN') return false;
      if (isRej) return false;
    } else if (statusFilter === 'rejected') {
      if (!isRej) return false;
    } else if (statusFilter === 'high_priority') {
      if (inc.priority !== 'HIGH' && inc.priority !== 'CRITICAL') return false;
    }

    // Time Filter
    if (timeFilter !== 'all' && inc.created_at) {
      const createdDate = new Date(inc.created_at);
      const now = new Date();
      const diffHours = (now - createdDate) / (1000 * 60 * 60);
      if (timeFilter === 'today' && diffHours > 24) return false;
      if (timeFilter === '7d' && diffHours > 24 * 7) return false;
      if (timeFilter === '30d' && diffHours > 24 * 30) return false;
    }

    // Modality Filter
    if (modalityFilter === 'photo' && !inc.photo_url) return false;
    if (modalityFilter === 'voice' && !inc.audio_url) return false;

    return true;
  });

  // Location Formatter
  const formatLocation = (inc) => {
    if (!inc) return 'Not specified';
    const parts = [];
    if (inc.farmers?.village) parts.push(inc.farmers.village);
    if (inc.farmers?.district) parts.push(inc.farmers.district);
    if (inc.farmers?.state) parts.push(inc.farmers.state);

    if (parts.length > 0) {
      return parts.join(', ');
    }
    if (inc.location_source) {
      return `Registered Area (${inc.location_source})`;
    }
    return 'Telangana Rural Agricultural Zone';
  };

  return (
    <div className="aeo-portal-root" data-testid="aeo-dashboard">
      {/* ============================================================== */}
      {/* 1. CLEAN TOP NAVIGATION (White UI)                             */}
      {/* ============================================================== */}
      <header className="aeo-top-navbar">
        <div className="navbar-container">
          <div className="navbar-brand">
            <span className="brand-leaf-icon">🌾</span>
            <div>
              <h1 className="brand-title">RythuBandhu</h1>
              <span className="brand-subtitle">Agricultural Extension Officer Portal</span>
            </div>
          </div>

          <div className="navbar-officer-meta">
            <div className="officer-badge" data-testid="officer-session-badge">
              <span className="officer-icon">👤</span>
              <span>
                Officer: <strong>{officerSession?.officer_id || 'AEO001'}</strong>
              </span>
            </div>
            <button
              type="button"
              className="btn btn-sm btn-outline btn-logout"
              onClick={handleLogout}
              data-testid="officer-logout-btn"
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="aeo-portal-main">
        {/* ============================================================== */}
        {/* 2. COMPACT SUMMARY METRICS STRIP                              */}
        {/* ============================================================== */}
        <section className="aeo-summary-strip" aria-label="Complaints summary">
          <div className="summary-stat-card">
            <span className="stat-label">Total Complaints</span>
            <span className="stat-value" data-testid="total-incidents-count">
              {totalCount}
            </span>
          </div>

          <div className="summary-stat-card">
            <span className="stat-label">New / Unassigned</span>
            <span className="stat-value stat-new">{newCount}</span>
          </div>

          <div className="summary-stat-card">
            <span className="stat-label">In Progress</span>
            <span className="stat-value stat-progress">{inProgressCount}</span>
          </div>

          <div className="summary-stat-card">
            <span className="stat-label">Resolved</span>
            <span className="stat-value stat-resolved">{resolvedCount}</span>
          </div>

          <div className="summary-stat-card">
            <span className="stat-label">Rejected</span>
            <span className="stat-value stat-rejected">{rejectedCount}</span>
          </div>
        </section>

        {/* View Switcher / Breadcrumb if in Dedicated Detail Mode */}
        {isDetailViewOpen && selectedIncident ? (
          <div className="detail-navigation-bar">
            <button
              type="button"
              className="btn btn-sm btn-outline back-to-list-btn"
              onClick={() => setIsDetailViewOpen(false)}
            >
              &larr; Back to Dashboard &amp; Complaints
            </button>
            <span className="breadcrumb-meta">
              Viewing Complaint: <code>{selectedIncident.id}</code>
            </span>
          </div>
        ) : null}

        {/* ============================================================== */}
        {/* 3. MAIN DASHBOARD CONTENT AREA                                 */}
        {/* ============================================================== */}
        {!isDetailViewOpen ? (
          <div className="aeo-overview-view">
            {/* Filter & Control Bar */}
            <div className="triage-controls-card">
              <div className="search-input-wrap">
                <span className="search-icon">🔍</span>
                <input
                  type="text"
                  className="search-input"
                  placeholder="Search complaints by farmer name, crop, issue description, or ID..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  data-testid="search-complaints-input"
                />
                {searchQuery && (
                  <button type="button" className="clear-search-btn" onClick={() => setSearchQuery('')}>
                    ✕
                  </button>
                )}
              </div>

              <div className="filter-button-group">
                {/* Status Filters */}
                <div className="status-filters">
                  <button
                    type="button"
                    className={`filter-btn ${statusFilter === 'all' ? 'active' : ''}`}
                    onClick={() => setStatusFilter('all')}
                  >
                    All ({totalCount})
                  </button>
                  <button
                    type="button"
                    className={`filter-btn ${statusFilter === 'new' ? 'active' : ''}`}
                    onClick={() => setStatusFilter('new')}
                  >
                    New ({newCount})
                  </button>
                  <button
                    type="button"
                    className={`filter-btn ${statusFilter === 'acknowledged' ? 'active' : ''}`}
                    onClick={() => setStatusFilter('acknowledged')}
                  >
                    In Progress ({inProgressCount})
                  </button>
                  <button
                    type="button"
                    className={`filter-btn ${statusFilter === 'high_priority' ? 'active' : ''}`}
                    onClick={() => setStatusFilter('high_priority')}
                  >
                    ⚡ High Priority
                  </button>
                  <button
                    type="button"
                    className={`filter-btn ${statusFilter === 'resolved' ? 'active' : ''}`}
                    onClick={() => setStatusFilter('resolved')}
                  >
                    Resolved ({resolvedCount})
                  </button>
                  <button
                    type="button"
                    className={`filter-btn ${statusFilter === 'rejected' ? 'active' : ''}`}
                    onClick={() => setStatusFilter('rejected')}
                  >
                    Rejected ({rejectedCount})
                  </button>
                </div>

                {/* Time Filters */}
                <div className="time-filters-group">
                  <button
                    type="button"
                    className={`time-filter-btn ${timeFilter === 'all' ? 'active' : ''}`}
                    onClick={() => setTimeFilter('all')}
                    data-testid="time-filter-all"
                  >
                    All Time
                  </button>
                  <button
                    type="button"
                    className={`time-filter-btn ${timeFilter === 'today' ? 'active' : ''}`}
                    onClick={() => setTimeFilter('today')}
                    data-testid="time-filter-today"
                  >
                    Today
                  </button>
                  <button
                    type="button"
                    className={`time-filter-btn ${timeFilter === '7d' ? 'active' : ''}`}
                    onClick={() => setTimeFilter('7d')}
                    data-testid="time-filter-7d"
                  >
                    7 Days
                  </button>
                  <button
                    type="button"
                    className={`time-filter-btn ${timeFilter === '30d' ? 'active' : ''}`}
                    onClick={() => setTimeFilter('30d')}
                    data-testid="time-filter-30d"
                  >
                    30 Days
                  </button>
                </div>

                {/* Modality Filters */}
                <div className="modality-filters">
                  <button
                    type="button"
                    className={`modality-btn ${modalityFilter === 'all' ? 'active' : ''}`}
                    onClick={() => setModalityFilter('all')}
                  >
                    All Media
                  </button>
                  <button
                    type="button"
                    className={`modality-btn ${modalityFilter === 'photo' ? 'active' : ''}`}
                    onClick={() => setModalityFilter('photo')}
                  >
                    📷 Photo
                  </button>
                  <button
                    type="button"
                    className={`modality-btn ${modalityFilter === 'voice' ? 'active' : ''}`}
                    onClick={() => setModalityFilter('voice')}
                  >
                    🎙️ Voice
                  </button>
                </div>
              </div>
            </div>

            {/* ============================================================== */}
            {/* 4. GEOGRAPHIC MAP & PRIORITY CLUSTERS SPLIT SECTION            */}
            {/* ============================================================== */}
            <section className="aeo-map-cluster-section">
              <div className="map-column">
                <IncidentClusterMap
                  incidents={mapIncidents}
                  clusters={clusters}
                  selectedIncident={selectedIncident}
                  onSelectIncident={(inc, open) => handleSelectIncident(inc, open)}
                  onSelectCluster={(c) => handleOpenCluster(c)}
                />
              </div>
              <div className="clusters-column">
                <PriorityClustersPanel
                  clusters={clusters}
                  onSelectCluster={(c) => handleOpenCluster(c)}
                  loading={mapLoading}
                />
              </div>
            </section>

            {/* ============================================================== */}
            {/* 5. ALL FARMER COMPLAINTS LIST (NEVER GATEKEPT BY CLUSTERING)   */}
            {/* ============================================================== */}
            <section className="aeo-complaints-list-section">
              <div className="section-header-row">
                <div className="section-title-wrap">
                  <h3 className="section-heading">Farmer Complaints Queue</h3>
                  <span className="section-subheading">
                    Every reported farmer incident &bull; {filteredIncidents.length} matching complaints
                  </span>
                </div>
              </div>

              {loading ? (
                <div className="loading-state-card">
                  <div className="spinner-ring" />
                  <p>Loading farmer complaints from database...</p>
                </div>
              ) : error ? (
                <div className="error-state-card">
                  <p>⚠️ {error}</p>
                  <button type="button" className="btn btn-sm btn-outline" onClick={loadDashboardData}>
                    Retry
                  </button>
                </div>
              ) : filteredIncidents.length === 0 ? (
                <div className="empty-state-card">
                  <span className="empty-state-icon">📋</span>
                  <h3>No complaints matching current filters.</h3>
                  <p>Try changing your search keywords or filter criteria.</p>
                </div>
              ) : (
                <div className="complaint-cards-list">
                  {filteredIncidents.map((inc) => {
                    const isRej = inc.status === 'REJECTED' || !!inc.ai_analysis?.[0]?.structured_data?.rejection;
                    const isAck = inc.status === 'ACKNOWLEDGED' || inc.status === 'INVESTIGATING';

                    return (
                      <article
                        key={inc.id}
                        className="clean-complaint-row"
                        data-testid={`incident-item-${inc.id}`}
                      >
                        <div className="complaint-row-left">
                          <div className="complaint-header-line">
                            <h4 className="farmer-title">
                              {inc.farmers?.name || inc.farmer_name || 'Farmer'}
                            </h4>
                            {inc.crop && <span className="crop-pill">🌾 {inc.crop}</span>}
                            <span
                              className={`status-pill ${
                                isRej
                                  ? 'status-pill-rejected'
                                  : isAck
                                    ? 'status-pill-progress'
                                    : 'status-pill-new'
                              }`}
                            >
                              {isRej ? 'REJECTED' : inc.status}
                            </span>
                            <span
                              className={`priority-badge priority-badge-${(inc.priority || 'LOW').toLowerCase()}`}
                              data-testid={`incident-priority-badge-${inc.id}`}
                            >
                              {inc.priority === 'HIGH' ? '⚡ HIGH' : (inc.priority || 'LOW')}
                            </span>
                          </div>

                          <p className="complaint-snippet-text">{inc.description}</p>

                          <div className="complaint-meta-line">
                            <span className="meta-item id-meta">ID: {inc.id.slice(0, 8).toUpperCase()}</span>
                            <span className="meta-item location-meta-item">📍 {formatLocation(inc)}</span>
                            <span className="meta-item">
                              📅 {new Date(inc.created_at).toLocaleDateString()} at{' '}
                              {new Date(inc.created_at).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                            {inc.farmers?.phone && <span className="meta-item">📞 {inc.farmers.phone}</span>}
                          </div>
                        </div>

                        <div className="complaint-row-right">
                          <div className="evidence-icons-row">
                            {inc.photo_url && (
                              <span className="media-badge" title="Photo evidence attached">
                                📷 Photo
                              </span>
                            )}
                            {inc.audio_url && (
                              <span className="media-badge" title="Voice note attached">
                                🎙️ Voice
                              </span>
                            )}
                            {inc.ai_analysis?.length > 0 && (
                              <span className="ai-ready-badge" title="AI Analysis available">
                                🤖 AI Analyzed
                              </span>
                            )}
                          </div>

                          <button
                            type="button"
                            className="btn btn-sm btn-primary view-details-btn"
                            onClick={() => handleSelectIncident(inc, true)}
                            data-testid={`view-details-btn-${inc.id}`}
                          >
                            View Details &rarr;
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        ) : (
          /* ============================================================== */
          /* INCIDENT DETAIL (INVESTIGATION MODE) — SPACIOUS & COMPLETE     */
          /* ============================================================== */
          <div className="aeo-investigation-view" data-testid="aeo-detail-panel">
            {/* Action Feedback Banner */}
            {actionSuccessMessage && (
              <div className="clean-action-banner" data-testid="action-success-banner">
                <span>✅</span>
                <span>{actionSuccessMessage}</span>
              </div>
            )}

            {/* 1. Incident Detail Header */}
            <div className="detail-top-card">
              <div className="detail-header-main">
                <div>
                  <div className="detail-tag-row">
                    <span className="incident-id-tag">Incident #{selectedIncident.id.slice(0, 8).toUpperCase()}</span>
                    {selectedIncident.crop && <span className="crop-pill">🌾 {selectedIncident.crop}</span>}
                    <span
                      className={`status-pill ${
                        selectedIncident.status === 'REJECTED'
                          ? 'status-pill-rejected'
                          : selectedIncident.status === 'RESOLVED'
                            ? 'status-pill-resolved'
                            : selectedIncident.status === 'ACKNOWLEDGED' || selectedIncident.status === 'INVESTIGATING' || selectedIncident.status === 'ACTION_TAKEN'
                              ? 'status-pill-progress'
                              : 'status-pill-new'
                      }`}
                    >
                      {selectedIncident.status}
                    </span>
                  </div>
                  <h2 className="detail-farmer-heading">
                    {selectedIncident.farmers?.name || selectedIncident.farmer_name || 'Farmer Report'} &bull;{' '}
                    {selectedIncident.crop || 'Crop'} Issue
                  </h2>
                  <p style={{ margin: '4px 0 0 0', fontSize: '0.875rem', color: '#64748b' }}>
                    📍 <strong>Origin:</strong> {formatLocation(selectedIncident)}{' '}
                    {selectedIncident.location_source ? `(Source: ${selectedIncident.location_source})` : ''}
                  </p>
                </div>

                {/* Officer Action Buttons */}
                <div className="officer-actions-row">
                  {/* If terminal RESOLVED */}
                  {selectedIncident.status === 'RESOLVED' && (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '6px 14px',
                        borderRadius: '20px',
                        fontSize: '0.875rem',
                        fontWeight: '600',
                        backgroundColor: '#dcfce7',
                        color: '#15803d',
                        border: '1px solid #bbf7d0',
                      }}
                      data-testid="resolved-status-indicator"
                    >
                      ✅ Case Resolved / Workflow Completed
                    </span>
                  )}

                  {/* If terminal REJECTED */}
                  {selectedIncident.status === 'REJECTED' && (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '6px 14px',
                        borderRadius: '20px',
                        fontSize: '0.875rem',
                        fontWeight: '600',
                        backgroundColor: '#fee2e2',
                        color: '#b91c1c',
                        border: '1px solid #fecaca',
                      }}
                      data-testid="rejected-status-indicator"
                    >
                      🚫 Case Rejected / Workflow Completed
                    </span>
                  )}

                  {/* For Non-Terminal States: Render only valid next actions */}
                  {selectedIncident.status !== 'RESOLVED' && selectedIncident.status !== 'REJECTED' && (
                    <>
                      {/* Show Start Work ONLY if incident is in initial unacknowledged state */}
                      {(selectedIncident.status === 'NEW' ||
                        selectedIncident.status === 'AI_ANALYZED' ||
                        selectedIncident.status === 'AEO_NOTIFIED') && (
                        <button
                          type="button"
                          className="btn btn-primary btn-start-work"
                          onClick={handleStartWork}
                          disabled={actionLoading}
                          data-testid="start-work-btn"
                        >
                          🚀 Start Work
                        </button>
                      )}

                      {/* Show Reject ONLY if allowed by backend next_valid_statuses (or initial/investigating states) */}
                      {(selectedIncident.next_valid_statuses
                        ? selectedIncident.next_valid_statuses.includes('REJECTED')
                        : ['NEW', 'AI_ANALYZED', 'AEO_NOTIFIED', 'ACKNOWLEDGED', 'INVESTIGATING'].includes(selectedIncident.status)
                      ) && (
                        <button
                          type="button"
                          className="btn btn-outline btn-reject"
                          onClick={() => setShowRejectModal(true)}
                          disabled={actionLoading}
                          data-testid="reject-incident-btn"
                        >
                          ❌ Reject
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* 2. Farmer Information Sub-card */}
              <div className="farmer-info-compact-grid">
                <div className="info-cell">
                  <span className="cell-lbl">Farmer Name</span>
                  <span className="cell-val">
                    {selectedIncident.farmers?.name || selectedIncident.farmer_name || 'Anonymous'}
                  </span>
                </div>
                <div className="info-cell">
                  <span className="cell-lbl">Phone Number</span>
                  <span className="cell-val">{selectedIncident.farmers?.phone || 'N/A'}</span>
                </div>
                <div className="info-cell">
                  <span className="cell-lbl">Farmer Location / Village</span>
                  <span className="cell-val" data-testid="farmer-location-val">
                    📍 {formatLocation(selectedIncident)}
                  </span>
                </div>
                <div className="info-cell">
                  <span className="cell-lbl">Reported Date &amp; Time</span>
                  <span className="cell-val">{new Date(selectedIncident.created_at).toLocaleString()}</span>
                </div>
                <div className="info-cell">
                  <span className="cell-lbl">Current Lifecycle</span>
                  <span className="cell-val">{selectedIncident.status}</span>
                </div>
              </div>

              {/* Priority & Explainable Reasons Section */}
              <div className="detail-priority-card" data-testid="detail-priority-card">
                <div className="priority-card-header">
                  <span className="priority-title-label">Priority:</span>
                  <span
                    className={`priority-badge priority-badge-${(selectedIncident.priority || 'LOW').toLowerCase()}`}
                    data-testid="detail-priority-value"
                  >
                    {selectedIncident.priority === 'HIGH' ? '⚡ HIGH' : (selectedIncident.priority || 'LOW')}
                  </span>
                </div>
                <div className="priority-why-box">
                  <div className="why-title">Why this priority?</div>
                  <ul className="why-list" data-testid="priority-reasons-list">
                    {(selectedIncident.priority_reasons && selectedIncident.priority_reasons.length > 0
                      ? selectedIncident.priority_reasons
                      : ['Single isolated complaint', 'Standard reporting timeline', 'Standard severity reported by farmer']
                    ).map((reason, idx) => (
                      <li key={idx} className="why-item">
                        • {reason}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>

            {/* 3. Case Lifecycle Management & Workflow Actions */}
            <CaseWorkflowSection
              incident={selectedIncident}
              onStatusUpdated={(updatedInc, updatedTimeline) => {
                setActionSuccessMessage(null);
                setSelectedIncident({
                  ...selectedIncident,
                  ...updatedInc,
                  timeline: updatedTimeline || selectedIncident.timeline,
                });
                loadData();
              }}
              onOpenRejectModal={() => setShowRejectModal(true)}
            />

            {/* 4. AEO Advisory & Local-Language TTS Section (Phase 12) */}
            <OfficerAdvisorySection
              incident={selectedIncident}
              onAdvisorySaved={(savedAdvisory) => {
                setSelectedIncident({
                  ...selectedIncident,
                  advisory: savedAdvisory,
                });
                loadData();
              }}
            />

            {/* 5. Real Interactive Location Map */}
            <FarmerLocationMap incident={selectedIncident} />

            {/* 6. Evidence Provenance & Comparison */}
            <EvidenceComparisonCard incident={selectedIncident} />
          </div>
        )}
      </main>

      {/* ============================================================== */}
      {/* 6. CLUSTER DETAIL MODAL                                        */}
      {/* ============================================================== */}
      {activeCluster && (
        <ClusterDetailModal
          cluster={activeCluster}
          allIncidents={incidents}
          onClose={() => setActiveCluster(null)}
          onSelectIncident={(inc, open) => handleSelectIncident(inc, open)}
        />
      )}

      {/* ============================================================== */}
      {/* 7. REJECTION CONFIRMATION MODAL                                */}
      {/* ============================================================== */}
      {showRejectModal && (
        <div className="modal-backdrop-clean" data-testid="rejection-modal">
          <div className="modal-dialog-card">
            <div className="modal-dialog-header">
              <span className="modal-warn-icon">⚠️</span>
              <h3 className="modal-title">Reject Complaint</h3>
            </div>

            <p className="modal-desc">
              Please provide a clear reason for rejecting this complaint. This reason will be permanently recorded in the
              incident audit trail.
            </p>

            {rejectError && (
              <div className="modal-error-banner" data-testid="rejection-error-msg">
                ⚠️ {rejectError}
              </div>
            )}

            {/* Predefined Reasons */}
            <div className="modal-form-group">
              <label className="modal-field-lbl">Common Predefined Reason:</label>
              <select
                className="clean-select"
                value={rejectionPreset}
                onChange={(e) => {
                  setRejectionPreset(e.target.value);
                  if (e.target.value && e.target.value !== 'Other') {
                    setRejectionReason(e.target.value);
                  }
                }}
                data-testid="rejection-preset-select"
              >
                <option value="">-- Select a reason (optional) --</option>
                <option value="Image appears unrelated">Image appears unrelated</option>
                <option value="Voice appears invalid">Voice appears invalid</option>
                <option value="Duplicate complaint">Duplicate complaint</option>
                <option value="Insufficient evidence">Insufficient evidence</option>
                <option value="Photo does not appear to show a crop">Photo does not appear to show a crop</option>
                <option value="Other">Other (custom text below)</option>
              </select>
            </div>

            {/* Custom Reason Textarea */}
            <div className="modal-form-group">
              <label className="modal-field-lbl">Reason for Rejection *:</label>
              <textarea
                className="clean-textarea"
                rows={3}
                placeholder="Enter detailed reason for rejection..."
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                required
                data-testid="rejection-reason-input"
              />
            </div>

            {/* Modal Actions */}
            <div className="modal-actions-row">
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => {
                  setShowRejectModal(false);
                  setRejectError('');
                }}
                disabled={actionLoading}
                data-testid="cancel-rejection-btn"
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary btn-confirm-reject"
                onClick={handleConfirmReject}
                disabled={actionLoading}
                data-testid="confirm-rejection-btn"
              >
                {actionLoading ? 'Recording Rejection...' : 'Confirm Rejection'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
