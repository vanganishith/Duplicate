import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  listIncidents,
  getIncident,
  analyzeIncidentMultimodal,
  startWorkOnIncident,
  rejectIncident,
  getMapOverview,
  getScheduledFieldVisits,
  getAeoAnalytics,
  getAeoNotifications,
  getFarmerHistory,
} from '../services/api';
import EvidenceComparisonCard from '../components/EvidenceComparisonCard';
import FarmerLocationMap from '../components/FarmerLocationMap';
import IncidentClusterMap from '../components/IncidentClusterMap';
import PriorityClustersPanel from '../components/PriorityClustersPanel';
import ClusterDetailModal from '../components/ClusterDetailModal';
import CaseWorkflowSection from '../components/CaseWorkflowSection';
import OfficerAdvisorySection from '../components/OfficerAdvisorySection';
import AeoVerificationSection from '../components/AeoVerificationSection';
import CaseCommunicationSection from '../components/CaseCommunicationSection';
import CaseFollowupSection from '../components/CaseFollowupSection';
import FieldVisitModal from '../components/FieldVisitModal';
import GovernmentSupportCard from '../components/GovernmentSupportCard';
import SimilarPreviousCasesSection from '../components/SimilarPreviousCasesSection';

export default function AeoDashboard() {
  const navigate = useNavigate();
  const [officerSession, setOfficerSession] = useState(null);

  // Active top tab: 'CASES' | 'MAP' | 'VISITS' | 'ANALYTICS' | 'NOTIFICATIONS'
  const [activeTab, setActiveTab] = useState('CASES');

  // Core incident data
  const [incidents, setIncidents] = useState([]);
  const [mapIncidents, setMapIncidents] = useState([]);
  const [clusters, setClusters] = useState([]);
  const [selectedIncident, setSelectedIncident] = useState(null);
  const [activeCluster, setActiveCluster] = useState(null);

  // Scheduled field visits across cases
  const [allVisits, setAllVisits] = useState([]);

  // Operational analytics
  const [analyticsData, setAnalyticsData] = useState(null);

  // Real action notifications
  const [notifications, setNotifications] = useState([]);

  // Farmer history modal
  const [farmerHistoryData, setFarmerHistoryData] = useState(null);

  // Loading & error states
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'new' | 'in_progress' | 'high_priority' | 'resolved' | 'rejected'
  const [timeFilter, setTimeFilter] = useState('all'); // 'all' | 'today' | '7d' | '30d'

  // Modal states
  const [showVisitModal, setShowVisitModal] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const [rejectionPreset, setRejectionPreset] = useState('');
  const [rejectError, setRejectError] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionSuccessMessage, setActionSuccessMessage] = useState(null);
  const [analyzingMultimodal, setAnalyzingMultimodal] = useState(false);
  const [actionToolsOpen, setActionToolsOpen] = useState(false);

  // Check Officer Authentication Session
  useEffect(() => {
    let sessionStr = null;
    try {
      sessionStr = typeof window !== 'undefined' && window.localStorage ? window.localStorage.getItem('aeo_officer_session') : null;
    } catch {}

    if (sessionStr) {
      try {
        const parsed = JSON.parse(sessionStr);
        if (parsed?.assigned_area === 'Warangal Rural Mandal') {
          parsed.assigned_area = 'Medchal–Malkajgiri & Warangal Division';
          try {
            window.localStorage.setItem('aeo_officer_session', JSON.stringify(parsed));
          } catch {}
        }
        setOfficerSession(parsed);
      } catch {
        setOfficerSession(null);
      }
    } else {
      const defaultOfficer = {
        officer_id: 'AEO001',
        name: 'Srinivas Rao',
        role: 'AEO',
        designation: 'Agriculture Extension Officer',
        assigned_area: 'Medchal–Malkajgiri & Warangal Division',
        phone: '9876543210',
      };
      setOfficerSession(defaultOfficer);
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem('aeo_officer_session', JSON.stringify(defaultOfficer));
        }
      } catch {}
    }
  }, []);

  const handleLogout = () => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem('aeo_officer_session');
      }
    } catch {}
    setOfficerSession(null);
    navigate('/officer-login');
  };

  // Fetch full incident list & overview
  const loadDashboardData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const listRes = await listIncidents(100);
      if (listRes && listRes.incidents) {
        setIncidents(listRes.incidents);
      }

      const mapRes = await getMapOverview({
        status: statusFilter,
        time_filter: timeFilter,
      });
      if (mapRes) {
        setMapIncidents(mapRes.incidents || []);
        setClusters(mapRes.clusters || []);
      }

      try {
        const aP = getAeoAnalytics();
        if (aP && typeof aP.then === 'function') {
          aP.then((res) => {
            if (res?.success) setAnalyticsData(res);
          }).catch(() => {});
        }
      } catch {}

      try {
        const nP = getAeoNotifications();
        if (nP && typeof nP.then === 'function') {
          nP.then((res) => {
            if (res?.notifications) setNotifications(res.notifications);
          }).catch(() => {});
        }
      } catch {}

      try {
        const vP = getScheduledFieldVisits();
        if (vP && typeof vP.then === 'function') {
          vP.then((res) => {
            if (res?.visits) setAllVisits(res.visits);
          }).catch(() => {});
        }
      } catch {}
    } catch (err) {
      setError('Failed to load incident dashboard data from backend.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, timeFilter]);

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  // Select incident and fetch full details
  const handleSelectIncident = async (inc) => {
    try {
      setActionSuccessMessage(null);
      setSelectedIncident(inc);

      const fullData = await getIncident(inc.id);
      if (fullData && fullData.incident) {
        setSelectedIncident(fullData.incident);
      }
    } catch (err) {
      console.error('Failed to fetch full incident details:', err);
    }
  };

  // View farmer past complaints
  const handleViewFarmerHistory = async (farmerId) => {
    if (!farmerId) return;
    try {
      const res = await getFarmerHistory(farmerId);
      if (res.success) {
        setFarmerHistoryData(res);
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Start work action
  const handleStartInvestigation = async () => {
    if (!selectedIncident) return;
    try {
      setActionLoading(true);
      const res = await startWorkOnIncident(selectedIncident.id, officerSession?.officer_id || 'AEO001');
      if (res && res.success) {
        const updated = { ...selectedIncident, status: 'INVESTIGATING' };
        setSelectedIncident(updated);
        setIncidents((prev) =>
          prev.map((i) => (i.id === updated.id ? { ...i, status: 'INVESTIGATING' } : i))
        );
        setActionSuccessMessage('Work started successfully. Complaint moved to IN PROGRESS.');
      }
    } catch (err) {
      setError(err.message || 'Failed to start investigation');
    } finally {
      setActionLoading(false);
    }
  };

  // Re-run Featherless Qwen3-VL Multimodal Evidence Analysis on active incident
  const handleReanalyzeMultimodal = async (incidentId) => {
    if (!incidentId) return;
    try {
      setAnalyzingMultimodal(true);
      setActionSuccessMessage(null);
      const res = await analyzeIncidentMultimodal(incidentId);
      if (res && res.success) {
        setActionSuccessMessage('Multimodal spatial analysis completed via Featherless Qwen3-VL.');
        await handleSelectIncident({ id: incidentId });
      }
    } catch (err) {
      console.error('Failed to analyze multimodal evidence:', err);
      setError(err.message || 'Failed to analyze multimodal evidence with Qwen3-VL.');
    } finally {
      setAnalyzingMultimodal(false);
    }
  };

  // Reject complaint
  const handleConfirmReject = async () => {
    if (!selectedIncident) return;
    const finalReason = rejectionReason.trim() || rejectionPreset.trim();
    if (!finalReason) {
      setRejectError('Please select or enter a rejection reason.');
      return;
    }

    try {
      setActionLoading(true);
      setRejectError('');
      const res = await rejectIncident(selectedIncident.id, finalReason, officerSession?.officer_id || 'AEO001');
      if (res && res.success) {
        const updated = {
          ...selectedIncident,
          status: 'REJECTED',
          rejection_reason: finalReason,
        };
        setSelectedIncident(updated);
        setIncidents((prev) =>
          prev.map((i) => (i.id === updated.id ? { ...i, status: 'REJECTED', rejection_reason: finalReason } : i))
        );
        setShowRejectModal(false);
        setRejectionReason('');
        setRejectionPreset('');
        setActionSuccessMessage('Complaint marked as REJECTED.');
      }
    } catch (err) {
      setRejectError(err.message || 'Failed to reject incident');
    } finally {
      setActionLoading(false);
    }
  };

  // Counts
  const totalCount = incidents.length;
  const newCount = incidents.filter((i) => i.status === 'NEW' || i.status === 'AI_ANALYZED').length;
  const inProgressCount = incidents.filter(
    (i) => i.status === 'ACKNOWLEDGED' || i.status === 'INVESTIGATING' || i.status === 'IN_PROGRESS' || i.status === 'ACTION_TAKEN'
  ).length;
  const resolvedCount = incidents.filter((i) => i.status === 'RESOLVED').length;
  const highPriorityCount = incidents.filter((i) => i.priority === 'HIGH' || i.priority === 'CRITICAL').length;

  // Filtered List
  const filteredIncidents = incidents.filter((inc) => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchName = inc.farmers?.name?.toLowerCase().includes(q) || inc.farmer_name?.toLowerCase().includes(q);
      const matchCrop = inc.crop?.toLowerCase().includes(q) || inc.crop_type?.toLowerCase().includes(q);
      const matchDesc = inc.description?.toLowerCase().includes(q);
      const matchId = inc.id?.toLowerCase().includes(q) || inc.case_id?.toLowerCase().includes(q);
      if (!matchName && !matchCrop && !matchDesc && !matchId) return false;
    }

    if (statusFilter === 'new') {
      if (inc.status !== 'NEW' && inc.status !== 'AI_ANALYZED') return false;
    } else if (statusFilter === 'in_progress') {
      if (inc.status !== 'ACKNOWLEDGED' && inc.status !== 'INVESTIGATING' && inc.status !== 'IN_PROGRESS') return false;
    } else if (statusFilter === 'high_priority') {
      if (inc.priority !== 'HIGH' && inc.priority !== 'CRITICAL') return false;
    } else if (statusFilter === 'resolved') {
      if (inc.status !== 'RESOLVED' && inc.status !== 'ACTION_TAKEN') return false;
    } else if (statusFilter === 'rejected') {
      if (inc.status !== 'REJECTED') return false;
    }

    return true;
  });

  const formatLocation = (inc) => {
    if (!inc) return 'Not specified';
    // 1. Direct resolved area name from real coordinates
    if (inc.area && !inc.area.toLowerCase().includes('rural agricultural zone')) {
      return inc.area;
    }
    if (inc.location_name && !inc.location_name.toLowerCase().includes('rural agricultural zone')) {
      return inc.location_name;
    }

    // 2. Specific village, mandal, district
    const parts = [];
    const vil = inc.village || inc.farmers?.village;
    const mnd = inc.mandal;
    const dist = inc.district || inc.farmers?.district;

    if (vil) parts.push(vil);
    if (mnd && mnd !== vil) parts.push(mnd);
    if (dist && !parts.includes(dist)) parts.push(dist);

    if (parts.length > 0) return parts.join(', ');

    // 3. Coordinate fallback
    if (inc.latitude && inc.longitude) {
      return `${Number(inc.latitude).toFixed(4)}°N, ${Number(inc.longitude).toFixed(4)}°E (Field GPS)`;
    }
    return 'Telangana Field Sector';
  };

  // Derive real operational jurisdiction dynamically from the live complaints
  const activeJurisdiction = useMemo(() => {
    const districts = new Set();
    const mandals = new Set();
    incidents.forEach((inc) => {
      const dist = inc.district || inc.farmers?.district;
      const mnd = inc.mandal || inc.village || inc.farmers?.village;
      if (dist && !dist.toLowerCase().includes('rural agricultural')) districts.add(dist);
      if (mnd && !mnd.toLowerCase().includes('rural agricultural')) {
        mandals.add(mnd.replace(/ mandal/i, ''));
      }
    });

    const distList = Array.from(districts);
    const mndList = Array.from(mandals);

    if (mndList.length > 0 && distList.length > 0) {
      return `${mndList.slice(0, 2).join(' / ')} • ${distList.join(', ')}`;
    }
    if (distList.length > 0) {
      return `${distList.join(' & ')} Division`;
    }

    if (officerSession?.assigned_area && !officerSession.assigned_area.includes('Warangal Rural Mandal')) {
      return officerSession.assigned_area;
    }
    return 'Medchal–Malkajgiri & Warangal Division';
  }, [incidents, officerSession]);

  const areaHealth = analyticsData?.kpis?.area_health_score || 88;

  return (
    <div className="aeo-portal-root" style={{ backgroundColor: '#ffffff', minHeight: '100vh', width: '100%' }}>
      <main className="aeo-portal-main" style={{ maxWidth: '1360px', margin: '0 auto', padding: '24px 20px', width: '100%' }}>
        {/* 1. CLEAN WHITE PAGE HEADER (Matches Home Theme) */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '16px',
            paddingBottom: '16px',
            borderBottom: '1px solid #e2e8f0',
            marginBottom: '20px',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '1.6rem' }}>🏛️</span>
              <h1 style={{ fontSize: '1.5rem', fontWeight: '800', color: '#0f172a', margin: 0, letterSpacing: '-0.02em' }}>
                AEO Field Response Workspace
              </h1>
              <span
                style={{
                  backgroundColor: '#f0fdf4',
                  color: '#166534',
                  border: '1px solid #bbf7d0',
                  fontSize: '0.75rem',
                  fontWeight: '700',
                  padding: '3px 10px',
                  borderRadius: '12px',
                }}
              >
                📍 {activeJurisdiction}
              </span>
            </div>
            <p style={{ margin: '4px 0 0', fontSize: '0.875rem', color: '#64748b' }}>
              Officer: <strong>{officerSession?.name || 'Srinivas Rao (AEO)'}</strong> &bull; Area Health:{' '}
              <strong style={{ color: '#15803d' }}>{areaHealth}/100 Normal</strong>
            </p>
          </div>

          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <button
              type="button"
              onClick={loadDashboardData}
              className="filter-btn"
              style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 14px' }}
            >
              <span>↻</span> Refresh
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="filter-btn"
              style={{ color: '#dc2626', borderColor: '#fecaca', padding: '7px 14px' }}
            >
              Sign Out
            </button>
          </div>
        </div>

        {/* 2. STATS SUMMARY STRIP (Horizontal Grid across width) */}
        <div className="aeo-summary-strip" style={{ marginBottom: '24px' }}>
          {[
            { label: 'Total Complaints', value: totalCount, color: '#0f172a' },
            { label: 'New / Unreviewed', value: newCount, color: '#2563eb' },
            { label: 'High Priority', value: highPriorityCount, color: '#dc2626' },
            { label: 'In Progress', value: inProgressCount, color: '#d97706' },
            { label: 'Active Clusters', value: clusters.length, color: '#7e22ce' },
            { label: 'Resolved Cases', value: resolvedCount, color: '#15803d' },
          ].map((stat, i) => (
            <div key={i} className="summary-stat-card">
              <span className="stat-label">{stat.label}</span>
              <span className="stat-value" style={{ color: stat.color }}>
                {stat.value}
              </span>
            </div>
          ))}
        </div>

        {/* 3. WORKSPACE TABS */}
        <div
          style={{
            display: 'flex',
            gap: '8px',
            borderBottom: '1px solid #e2e8f0',
            marginBottom: '20px',
            flexWrap: 'wrap',
          }}
        >
          {[
            { id: 'CASES', label: '📋 Complaints Queue', count: filteredIncidents.length },
            { id: 'MAP', label: '🗺️ Outbreak Clusters', count: clusters.length },
            { id: 'VISITS', label: '🚗 Scheduled Visits', count: allVisits.length },
            { id: 'ANALYTICS', label: '📈 Area Analytics' },
            { id: 'NOTIFICATIONS', label: '🔔 Alerts', count: notifications.length, alert: notifications.length > 0 },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setActiveTab(t.id);
                if (t.id !== 'CASES') setSelectedIncident(null);
              }}
              style={{
                padding: '10px 18px',
                border: 'none',
                background: 'none',
                borderBottom: activeTab === t.id ? '3px solid #15803d' : '3px solid transparent',
                color: activeTab === t.id ? '#15803d' : '#475569',
                fontWeight: activeTab === t.id ? '700' : '600',
                fontSize: '0.9375rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              {t.label}
              {t.count !== undefined && (
                <span
                  style={{
                    backgroundColor: t.alert ? '#fee2e2' : activeTab === t.id ? '#dcfce7' : '#f1f5f9',
                    color: t.alert ? '#dc2626' : activeTab === t.id ? '#15803d' : '#64748b',
                    fontSize: '0.6875rem',
                    fontWeight: '800',
                    padding: '2px 7px',
                    borderRadius: '10px',
                  }}
                >
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {actionSuccessMessage && (
          <div className="clean-action-banner" data-testid="action-success-banner" style={{ marginBottom: '20px' }}>
            <span>✓</span> {actionSuccessMessage}
          </div>
        )}

        {/* ============================================================== */}
        {/* TAB 1: COMPLAINTS QUEUE & INVESTIGATION                        */}
        {/* ============================================================== */}
        {activeTab === 'CASES' && (
          <div>
            {!selectedIncident ? (
              /* LIST VIEW */
              <div className="aeo-triage-view">
                {/* Search & Filter Bar */}
                <div className="triage-controls-card">
                  <div className="search-input-wrap">
                    <span className="search-icon">🔍</span>
                    <input
                      type="text"
                      className="search-input"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search by farmer name, crop, village, symptom, or Case ID..."
                    />
                    {searchQuery && (
                      <button type="button" className="clear-search-btn" onClick={() => setSearchQuery('')}>
                        ✕
                      </button>
                    )}
                  </div>

                  <div className="filter-button-group">
                    <div className="status-filters">
                      {[
                        { id: 'all', label: 'All Complaints' },
                        { id: 'new', label: 'New / Unreviewed' },
                        { id: 'high_priority', label: '⚡ High Priority' },
                        { id: 'in_progress', label: 'In Progress' },
                        { id: 'resolved', label: 'Resolved' },
                        { id: 'rejected', label: 'Rejected' },
                      ].map((f) => (
                        <button
                          key={f.id}
                          type="button"
                          className={`filter-btn ${statusFilter === f.id ? 'active' : ''}`}
                          onClick={() => setStatusFilter(f.id)}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Complaints List */}
                <div className="complaint-cards-list">
                  {filteredIncidents.length === 0 ? (
                    <div
                      style={{
                        padding: '48px',
                        textAlign: 'center',
                        backgroundColor: '#ffffff',
                        border: '1px solid #e2e8f0',
                        borderRadius: '8px',
                        color: '#64748b',
                      }}
                    >
                      <div style={{ fontSize: '2rem', marginBottom: '8px' }}>🌾</div>
                      <div style={{ fontWeight: '700', fontSize: '1rem', color: '#0f172a' }}>No Complaints Found</div>
                      <p style={{ margin: '4px 0 0', fontSize: '0.875rem' }}>
                        No agricultural complaints match your search query and filters.
                      </p>
                    </div>
                  ) : (
                    filteredIncidents.map((inc) => {
                      const prio = (inc.priority || 'MEDIUM').toUpperCase();
                      const isHigh = prio === 'HIGH' || prio === 'CRITICAL';
                      const st = inc.status || 'NEW';

                      return (
                        <div key={inc.id} className="clean-complaint-row" data-testid={`incident-item-${inc.id}`}>
                          <div className="complaint-row-left">
                            <div className="complaint-header-line">
                              <h3 className="farmer-title">
                                {inc.farmers?.name || inc.farmer_name || 'Farmer'}
                              </h3>
                              <span className="crop-pill">{inc.crop || inc.crop_type || 'Cotton'}</span>
                              <span
                                className={`status-pill ${
                                  st === 'NEW'
                                    ? 'status-pill-new'
                                    : st === 'RESOLVED'
                                    ? 'status-pill-progress'
                                    : st === 'REJECTED'
                                    ? 'status-pill-rejected'
                                    : 'status-pill-progress'
                                }`}
                              >
                                {st}
                              </span>
                              <span
                                data-testid={`incident-priority-badge-${inc.id}`}
                                style={{
                                  fontSize: '0.6875rem',
                                  fontWeight: '800',
                                  padding: '2px 8px',
                                  borderRadius: '4px',
                                  backgroundColor: isHigh ? '#fef2f2' : '#fefce8',
                                  color: isHigh ? '#dc2626' : '#a16207',
                                  border: isHigh ? '1px solid #fecaca' : '1px solid #fef08a',
                                }}
                              >
                                {prio === 'CRITICAL' ? '🔥 CRITICAL' : prio === 'HIGH' ? '⚡ HIGH' : prio}
                              </span>
                            </div>

                            <p className="complaint-snippet-text">{inc.description || 'No description provided.'}</p>

                            <div className="complaint-meta-line">
                              <span className="id-meta">{inc.case_id || `KS-2026-${inc.id?.substring(0, 5).toUpperCase()}`}</span>
                              <span>📍 {formatLocation(inc)}</span>
                              <span>🕒 {inc.created_at ? new Date(inc.created_at).toLocaleDateString() : 'Recently'}</span>
                            </div>
                          </div>

                          <div className="complaint-row-right">
                            <button
                              type="button"
                              className="btn btn-primary view-details-btn"
                              data-testid={`view-details-btn-${inc.id}`}
                              onClick={() => handleSelectIncident(inc)}
                            >
                              Inspect Case →
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            ) : (
              /* DETAIL CASE INVESTIGATION VIEW */
              <div className="aeo-investigation-view">
                {/* Back Button */}
                <div className="detail-navigation-bar">
                  <button
                    type="button"
                    className="btn btn-outline back-to-list-btn"
                    onClick={() => setSelectedIncident(null)}
                  >
                    ← Back to All Complaints
                  </button>
                  <span className="breadcrumb-meta">
                    Case: <strong>{selectedIncident.case_id || selectedIncident.id?.substring(0, 8)}</strong> &bull; Reported by{' '}
                    {selectedIncident.farmers?.name || selectedIncident.farmer_name}
                  </span>
                </div>

                {/* Case Top Card: Farmer Name, Number, Problem, Location, Actions */}
                <div className="detail-top-card">
                  <div className="detail-header-main">
                    <div>
                      <div className="detail-tag-row">
                        <span className="incident-id-tag">
                          {selectedIncident.case_id || `KS-2026-${selectedIncident.id?.substring(0, 5).toUpperCase()}`}
                        </span>
                        <span className="crop-pill">{selectedIncident.crop || selectedIncident.crop_type || 'Cotton'}</span>
                        <span className="status-pill status-pill-progress">{selectedIncident.status || 'NEW'}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginTop: '4px' }}>
                        <h2 className="detail-farmer-heading">
                          {selectedIncident.farmers?.name || selectedIncident.farmer_name || 'Farmer'}
                        </h2>
                        {(selectedIncident.farmers?.phone || selectedIncident.farmer_phone) && (
                          <a
                            href={`tel:${selectedIncident.farmers?.phone || selectedIncident.farmer_phone}`}
                            className="farmer-phone-badge"
                            title="Call Farmer"
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '6px',
                              padding: '4px 10px',
                              background: '#eff6ff',
                              color: '#1d4ed8',
                              borderRadius: '20px',
                              fontSize: '0.875rem',
                              fontWeight: 700,
                              textDecoration: 'none',
                              border: '1px solid #bfdbfe',
                            }}
                          >
                            <span>📞</span>
                            <span>{selectedIncident.farmers?.phone || selectedIncident.farmer_phone}</span>
                          </a>
                        )}
                      </div>
                    </div>

                    <div className="officer-actions-row">
                      {selectedIncident.status !== 'INVESTIGATING' &&
                        selectedIncident.status !== 'ACTION_TAKEN' &&
                        selectedIncident.status !== 'RESOLVED' &&
                        selectedIncident.status !== 'REJECTED' && (
                          <button
                            data-testid="start-work-btn"
                            type="button"
                            className="btn btn-primary btn-start-work"
                            onClick={handleStartInvestigation}
                            disabled={actionLoading}
                          >
                            Start Investigation
                          </button>
                        )}
                      {selectedIncident.status === 'RESOLVED' && (
                        <span data-testid="resolved-status-indicator" style={{ color: '#15803d', fontWeight: '700', fontSize: '0.875rem' }}>
                          ✓ Resolved Case
                        </span>
                      )}
                      <button
                        type="button"
                        className="btn btn-outline"
                        onClick={() => setShowVisitModal(true)}
                        style={{ fontWeight: '700', fontSize: '0.8125rem' }}
                      >
                        🚗 Schedule Field Visit
                      </button>
                      {selectedIncident.status !== 'RESOLVED' && selectedIncident.status !== 'REJECTED' && (
                        <button
                          data-testid="reject-incident-btn"
                          type="button"
                          className="btn btn-outline btn-reject"
                          onClick={() => setShowRejectModal(true)}
                          disabled={actionLoading}
                        >
                          Reject Complaint
                        </button>
                      )}
                    </div>
                  </div>

                  {/* PROMINENT FARMER PROBLEM HEADLINE */}
                  <div
                    className="farmer-problem-callout"
                    data-testid="farmer-problem-callout"
                    style={{
                      background: '#f8fafc',
                      borderLeft: '4px solid #3b82f6',
                      borderRadius: '6px',
                      padding: '12px 16px',
                    }}
                  >
                    <span style={{ display: 'block', fontSize: '0.75rem', fontWeight: 800, color: '#1e40af', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '4px' }}>
                      🌾 Farmer's Reported Problem:
                    </span>
                    <p style={{ margin: 0, fontSize: '0.9375rem', lineHeight: 1.5, color: '#0f172a', fontWeight: 600 }}>
                      &ldquo;{selectedIncident.description || selectedIncident.ai_analysis?.[0]?.transcript || 'No verbal description provided.'}&rdquo;
                    </p>
                  </div>

                  {/* Compact Farmer Info Grid */}
                  <div className="farmer-info-compact-grid">
                    <div className="info-cell">
                      <span className="cell-lbl">Farmer Phone</span>
                      <span className="cell-val">{selectedIncident.farmers?.phone || selectedIncident.farmer_phone || 'N/A'}</span>
                    </div>
                    <div className="info-cell">
                      <span className="cell-lbl">Village &amp; Location</span>
                      <span className="cell-val">{formatLocation(selectedIncident)}</span>
                    </div>
                    <div className="info-cell">
                      <span className="cell-lbl">Reported Date &amp; Time</span>
                      <span className="cell-val">
                        {selectedIncident.created_at ? new Date(selectedIncident.created_at).toLocaleString() : 'N/A'}
                      </span>
                    </div>
                    <div className="info-cell">
                      <span className="cell-lbl">Farmer History</span>
                      <button
                        type="button"
                        onClick={() => handleViewFarmerHistory(selectedIncident.farmers?.id || selectedIncident.farmer_id)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#2563eb',
                          fontWeight: '700',
                          fontSize: '0.8125rem',
                          cursor: 'pointer',
                          textAlign: 'left',
                          padding: 0,
                        }}
                      >
                        View Past Reports →
                      </button>
                    </div>
                  </div>

                  {/* Explainable Priority Breakdown */}
                  <div
                    data-testid="detail-priority-card"
                    style={{
                      backgroundColor: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      borderRadius: '8px',
                      padding: '12px 16px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: '10px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '0.8125rem', fontWeight: '700', color: '#1e293b' }}>
                        Deterministic Priority:
                      </span>
                      <span
                        data-testid="detail-priority-value"
                        style={{
                          fontSize: '0.75rem',
                          fontWeight: '800',
                          padding: '3px 8px',
                          borderRadius: '6px',
                          backgroundColor:
                            selectedIncident.priority === 'HIGH' || selectedIncident.priority === 'CRITICAL'
                              ? '#fee2e2'
                              : '#fef3c7',
                          color:
                            selectedIncident.priority === 'HIGH' || selectedIncident.priority === 'CRITICAL'
                              ? '#dc2626'
                              : '#b45309',
                        }}
                      >
                        {selectedIncident.priority || 'MEDIUM'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '0.8125rem', fontWeight: '700', color: '#475569' }}>Why this priority?</span>
                      {(selectedIncident.priority_reasons || (selectedIncident.priority_detail?.reasons) || [
                        'Multiple nearby complaints',
                        'Recent report',
                      ]).map((reason, rI) => (
                        <span
                          key={rI}
                          style={{
                            fontSize: '0.6875rem',
                            fontWeight: '600',
                            padding: '2px 8px',
                            borderRadius: '4px',
                            backgroundColor: '#ffffff',
                            border: '1px solid #cbd5e1',
                            color: '#475569',
                          }}
                        >
                          • {reason}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                {/* 4-Quadrant Evidence Comparison Card (Voice, YOLO11, Featherless Qwen3-VL) */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: '10px',
                    padding: '8px 12px',
                    background: '#f8fafc',
                    borderRadius: '8px',
                    border: '1px solid #e2e8f0',
                    marginBottom: '8px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '1rem' }}>🧠</span>
                    <span style={{ fontSize: '0.875rem', fontWeight: 700, color: '#1e293b' }}>
                      Multimodal Evidence Synthesis (Voice + YOLO11 + Qwen3-VL)
                    </span>
                  </div>

                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => handleReanalyzeMultimodal(selectedIncident.id)}
                    disabled={analyzingMultimodal}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      fontSize: '0.8125rem',
                      padding: '5px 14px',
                      borderRadius: '6px',
                      border: '1px solid #8b5cf6',
                      color: '#6d28d9',
                      backgroundColor: analyzingMultimodal ? '#f5f3ff' : '#ffffff',
                      cursor: analyzingMultimodal ? 'not-allowed' : 'pointer',
                      fontWeight: 700,
                      boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                    }}
                    data-testid="reanalyze-multimodal-btn"
                  >
                    <span>{analyzingMultimodal ? '⏳ Analyzing with Qwen3-VL...' : '⚡ Re-run Multimodal AI Analysis'}</span>
                  </button>
                </div>

                {/* 1. Evidence Comparison Card: Voice (Listen + Transcript) + Photo & YOLO + Meaningful AI Summary */}
                <EvidenceComparisonCard incident={selectedIncident} simplifiedView={true} />

                {/* 2. Farmer Location Map: Coordinates & Field Boundary */}
                <FarmerLocationMap incident={selectedIncident} />

                {/* 3. Case Workflow Section: Lifecycle Stepper, Next Actions & Journey Timeline */}
                <CaseWorkflowSection
                  incident={selectedIncident}
                  onStatusUpdated={(updatedInc) => {
                    setSelectedIncident((prev) => ({ ...prev, ...updatedInc }));
                    loadDashboardData();
                  }}
                  onOpenRejectModal={() => setShowRejectModal(true)}
                />

                {/* 4. Officer Action Tools (Secondary Auxiliary Desk) */}
                <div className="officer-action-tools-container" style={{ marginTop: '20px' }}>
                  <div
                    style={{
                      padding: '14px 18px',
                      background: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      borderRadius: '8px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      cursor: 'pointer',
                      userSelect: 'none',
                    }}
                    onClick={() => setActionToolsOpen(!actionToolsOpen)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{ fontSize: '1.25rem' }}>🛠️</span>
                      <div>
                        <strong style={{ fontSize: '0.9375rem', color: '#0f172a' }}>Officer Field Actions &amp; Auxiliary Tools</strong>
                        <span style={{ display: 'block', fontSize: '0.75rem', color: '#64748b' }}>
                          Official Advisory, Farmer Chat, Similar Issues Check, Government Support &amp; Recovery Monitoring
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-sm btn-outline"
                      style={{ fontSize: '0.8125rem', fontWeight: 700 }}
                    >
                      {actionToolsOpen ? '▲ Hide Tools' : '▼ Open Officer Tools'}
                    </button>
                  </div>

                  {actionToolsOpen && (
                    <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                      {/* AEO Official Human Authority Decision */}
                      <AeoVerificationSection
                        incident={selectedIncident}
                        officerSession={officerSession}
                        onVerificationSuccess={(ver) => {
                          setSelectedIncident((prev) => ({
                            ...prev,
                            aeo_verification: ver,
                            status: ver.status === 'REJECTED' ? 'REJECTED' : 'ACTION_TAKEN',
                          }));
                          loadDashboardData();
                        }}
                      />

                      {/* Direct Farmer Messaging Thread */}
                      <CaseCommunicationSection incident={selectedIncident} officerSession={officerSession} />

                      {/* Farmer-Confirmed Similar Historical Cases */}
                      <SimilarPreviousCasesSection incident={selectedIncident} />

                      {/* Longitudinal Recovery Monitoring */}
                      <CaseFollowupSection
                        incident={selectedIncident}
                        officerSession={officerSession}
                        onUpdate={() => handleSelectIncident(selectedIncident)}
                      />

                      {/* Grounded Government Support Schemes */}
                      <GovernmentSupportCard incident={selectedIncident} />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ============================================================== */}
        {/* TAB 2: OUTBREAK CLUSTERS MAP                                   */}
        {/* ============================================================== */}
        {activeTab === 'MAP' && (
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '20px' }}>
            <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '16px' }}>
              <h3 style={{ margin: '0 0 12px', fontSize: '1.1rem', fontWeight: '700', color: '#0f172a' }}>
                📍 Outbreak Clusters (7.5km Zone Detection)
              </h3>
              <IncidentClusterMap
                incidents={mapIncidents}
                clusters={clusters}
                onSelectIncident={(inc) => {
                  handleSelectIncident(inc);
                  setActiveTab('CASES');
                }}
                onSelectCluster={(cl) => setActiveCluster(cl)}
              />
            </div>
            <div>
              <PriorityClustersPanel clusters={clusters} onSelectCluster={(cl) => setActiveCluster(cl)} />
            </div>
          </div>
        )}

        {/* ============================================================== */}
        {/* TAB 3: SCHEDULED FIELD VISITS                                  */}
        {/* ============================================================== */}
        {activeTab === 'VISITS' && (
          <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: '800', color: '#0f172a' }}>
                  🚗 Scheduled Field Visits &amp; Inspections ({allVisits.length})
                </h3>
                <p style={{ margin: '4px 0 0', fontSize: '0.8125rem', color: '#64748b' }}>
                  Visits scheduled across {officerSession?.assigned_area || 'assigned zone'}.
                </p>
              </div>
            </div>

            {allVisits.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '48px', color: '#94a3b8' }}>
                <div style={{ fontSize: '2rem', marginBottom: '8px' }}>📅</div>
                <div style={{ fontWeight: '700', fontSize: '1rem', color: '#0f172a' }}>No Field Visits Scheduled</div>
                <p style={{ margin: '4px 0 0', fontSize: '0.875rem' }}>
                  Open any complaint in the Complaints Queue to schedule an on-site field inspection.
                </p>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px' }}>
                {allVisits.map((v, i) => (
                  <div
                    key={v.id || i}
                    style={{
                      border: '1px solid #e2e8f0',
                      borderRadius: '8px',
                      padding: '16px',
                      backgroundColor: '#f8fafc',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <span style={{ fontWeight: '800', fontSize: '0.9375rem', color: '#15803d' }}>
                        📅 {v.scheduled_date} at {v.scheduled_time}
                      </span>
                      <span
                        style={{
                          fontSize: '0.6875rem',
                          fontWeight: '800',
                          padding: '2px 8px',
                          borderRadius: '6px',
                          backgroundColor: v.status === 'COMPLETED' ? '#dcfce7' : '#e0f2fe',
                          color: v.status === 'COMPLETED' ? '#15803d' : '#0369a1',
                        }}
                      >
                        {v.status}
                      </span>
                    </div>

                    <div style={{ fontSize: '0.9375rem', color: '#0f172a', fontWeight: '700', marginBottom: '4px' }}>
                      🌾 {v.farmer_name} ({v.farmer_village})
                    </div>
                    <div style={{ fontSize: '0.8125rem', color: '#475569', marginBottom: '8px' }}>
                      Phone: <strong>{v.farmer_phone}</strong> &bull; Crop: <strong>{v.crop}</strong>
                    </div>

                    <div style={{ fontSize: '0.8125rem', color: '#334155', backgroundColor: '#ffffff', padding: '8px 12px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                      <strong>Purpose:</strong> {v.purpose}
                      {v.farmer_notes && (
                        <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '4px' }}>
                          Note: {v.farmer_notes}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ============================================================== */}
        {/* TAB 4: OPERATIONAL ANALYTICS                                   */}
        {/* ============================================================== */}
        {activeTab === 'ANALYTICS' && (
          <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '24px' }}>
            <h3 style={{ margin: '0 0 16px', fontSize: '1.25rem', fontWeight: '800', color: '#0f172a' }}>
              📈 Operational Analytics &amp; Area Health
            </h3>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px', marginBottom: '24px' }}>
              <div style={{ padding: '16px', backgroundColor: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <span className="stat-label">Resolution Efficiency Rate</span>
                <div style={{ fontSize: '2rem', fontWeight: '800', color: '#15803d', marginTop: '4px' }}>
                  {analyticsData?.kpis?.resolution_rate_percent || 78.4}%
                </div>
                <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: '#64748b' }}>
                  Cases closed or officially verified within 72 hours.
                </p>
              </div>

              <div style={{ padding: '16px', backgroundColor: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <span className="stat-label">Area Health Index</span>
                <div style={{ fontSize: '2rem', fontWeight: '800', color: '#0284c7', marginTop: '4px' }}>
                  {areaHealth} / 100
                </div>
                <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: '#64748b' }}>
                  Index factoring out pest cluster densities and unresolved severe attacks.
                </p>
              </div>

              <div style={{ padding: '16px', backgroundColor: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <span className="stat-label">Active Outbreak Clusters</span>
                <div style={{ fontSize: '2rem', fontWeight: '800', color: '#7e22ce', marginTop: '4px' }}>
                  {clusters.length}
                </div>
                <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: '#64748b' }}>
                  Pest &amp; disease clusters detected in 7.5km zones.
                </p>
              </div>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <h4 style={{ margin: '0 0 12px', fontSize: '1rem', fontWeight: '700', color: '#0f172a' }}>
                Crop Distribution in Area
              </h4>
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                {Object.entries(analyticsData?.crops_distribution || { Cotton: 18, Paddy: 12, Chilli: 6, Maize: 4 }).map(
                  ([crop, count]) => (
                    <div
                      key={crop}
                      style={{
                        padding: '8px 14px',
                        borderRadius: '6px',
                        backgroundColor: '#f8fafc',
                        border: '1px solid #cbd5e1',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                      }}
                    >
                      <span style={{ fontWeight: '700', color: '#0f172a', fontSize: '0.875rem' }}>{crop}</span>
                      <span
                        style={{
                          backgroundColor: '#15803d',
                          color: '#ffffff',
                          fontSize: '0.6875rem',
                          fontWeight: '800',
                          padding: '1px 6px',
                          borderRadius: '8px',
                        }}
                      >
                        {count}
                      </span>
                    </div>
                  )
                )}
              </div>
            </div>
          </div>
        )}

        {/* ============================================================== */}
        {/* TAB 5: ACTION ALERTS                                           */}
        {/* ============================================================== */}
        {activeTab === 'NOTIFICATIONS' && (
          <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '24px' }}>
            <h3 style={{ margin: '0 0 16px', fontSize: '1.25rem', fontWeight: '800', color: '#0f172a' }}>
              🔔 Action-Oriented Field Alerts
            </h3>

            {notifications.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '32px', color: '#94a3b8' }}>
                ✓ No active urgent alerts in your area.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {notifications.map((n) => {
                  const isUrgent = n.severity === 'CRITICAL' || n.severity === 'URGENT';
                  return (
                    <div
                      key={n.id}
                      style={{
                        borderLeft: isUrgent ? '4px solid #dc2626' : '4px solid #15803d',
                        border: '1px solid #e2e8f0',
                        borderRadius: '6px',
                        padding: '14px 16px',
                        backgroundColor: isUrgent ? '#fef2f2' : '#f8fafc',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: '16px',
                      }}
                    >
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                          <span style={{ fontWeight: '700', fontSize: '0.9375rem', color: '#0f172a' }}>{n.title}</span>
                          <span
                            style={{
                              fontSize: '0.6875rem',
                              fontWeight: '800',
                              padding: '1px 6px',
                              borderRadius: '4px',
                              backgroundColor: isUrgent ? '#fee2e2' : '#dcfce7',
                              color: isUrgent ? '#dc2626' : '#15803d',
                            }}
                          >
                            {n.severity}
                          </span>
                        </div>
                        <p style={{ margin: 0, fontSize: '0.8125rem', color: '#475569' }}>{n.message}</p>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          setActiveTab('CASES');
                          const target = incidents.find((i) => i.id === n.link_id);
                          if (target) handleSelectIncident(target);
                        }}
                        className="btn btn-outline"
                        style={{ fontSize: '0.75rem', fontWeight: '700', padding: '6px 12px' }}
                      >
                        Inspect Case →
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </main>

      {/* FIELD VISIT MODAL */}
      <FieldVisitModal
        isOpen={showVisitModal}
        onClose={() => setShowVisitModal(false)}
        incident={selectedIncident}
        officerSession={officerSession}
        onVisitUpdated={() => {
          if (selectedIncident) handleSelectIncident(selectedIncident);
          getScheduledFieldVisits().then((r) => r.visits && setAllVisits(r.visits));
        }}
      />

      {/* CLUSTER DETAIL MODAL */}
      {activeCluster && (
        <ClusterDetailModal
          cluster={activeCluster}
          allIncidents={incidents}
          onClose={() => setActiveCluster(null)}
          onSelectIncident={(inc) => {
            handleSelectIncident(inc);
            setActiveTab('CASES');
          }}
        />
      )}

      {/* FARMER HISTORY MODAL */}
      {farmerHistoryData && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '12px',
              padding: '24px',
              maxWidth: '520px',
              width: '90%',
              maxHeight: '80vh',
              overflowY: 'auto',
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <h4 style={{ margin: 0, fontSize: '1.15rem', fontWeight: '800', color: '#0f172a' }}>
                📜 Complaint History: {farmerHistoryData.farmer?.name || 'Farmer'}
              </h4>
              <button
                type="button"
                onClick={() => setFarmerHistoryData(null)}
                style={{ background: 'none', border: 'none', fontSize: '1.2rem', cursor: 'pointer', color: '#64748b' }}
              >
                ✕
              </button>
            </div>
            <p style={{ fontSize: '0.8125rem', color: '#64748b', margin: '0 0 16px' }}>
              Village: {farmerHistoryData.farmer?.village || 'N/A'} &bull; Total Reports: {farmerHistoryData.total_complaints}
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {farmerHistoryData.history?.map((h) => (
                <div
                  key={h.id}
                  style={{
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    padding: '12px',
                    backgroundColor: '#f8fafc',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ fontWeight: '700', fontSize: '0.875rem', color: '#0f172a' }}>
                      {h.case_id} &bull; {h.crop}
                    </span>
                    <span style={{ fontSize: '0.75rem', color: '#15803d', fontWeight: '700' }}>{h.status}</span>
                  </div>
                  <div style={{ fontSize: '0.8125rem', color: '#334155', marginBottom: '4px' }}>
                    <strong>Diagnosis:</strong> {h.diagnosis}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                    {h.created_at ? new Date(h.created_at).toLocaleDateString() : ''} &bull; {h.description}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* REJECTION CONFIRMATION MODAL */}
      {showRejectModal && (
        <div className="modal-backdrop-clean" data-testid="rejection-modal">
          <div className="modal-dialog-card">
            <div className="modal-dialog-header">
              <span className="modal-warn-icon">⚠️</span>
              <h3 className="modal-title">Reject Complaint</h3>
            </div>

            <p className="modal-desc">
              Please provide a clear reason for rejecting this complaint. This reason will be recorded in the audit trail.
            </p>

            {rejectError && (
              <div className="modal-error-banner" data-testid="rejection-error-msg">
                ⚠️ {rejectError}
              </div>
            )}

            <div className="modal-form-group">
              <label className="modal-field-lbl">Predefined Reason:</label>
              <select
                className="clean-select"
                value={rejectionPreset}
                onChange={(e) => {
                  setRejectionPreset(e.target.value);
                  if (e.target.value && e.target.value !== 'Other') {
                    setRejectionReason(e.target.value);
                  }
                }}
              >
                <option value="">-- Select reason (optional) --</option>
                <option value="Image appears unrelated">Image appears unrelated</option>
                <option value="Voice appears invalid">Voice appears invalid</option>
                <option value="Duplicate complaint">Duplicate complaint</option>
                <option value="Insufficient evidence">Insufficient evidence</option>
                <option value="Photo does not appear to show a crop">Photo does not appear to show a crop</option>
                <option value="Other">Other (custom text below)</option>
              </select>
            </div>

            <div className="modal-form-group">
              <label className="modal-field-lbl">Reason for Rejection *:</label>
              <textarea
                data-testid="rejection-reason-input"
                className="clean-textarea"
                rows={3}
                placeholder="Enter detailed reason for rejection..."
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                required
              />
            </div>

            <div className="modal-actions-row">
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => {
                  setShowRejectModal(false);
                  setRejectError('');
                }}
                disabled={actionLoading}
              >
                Cancel
              </button>
              <button
                data-testid="confirm-rejection-btn"
                type="button"
                className="btn btn-primary btn-confirm-reject"
                onClick={handleConfirmReject}
                disabled={actionLoading}
              >
                {actionLoading ? 'Recording...' : 'Confirm Rejection'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
