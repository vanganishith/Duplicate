import React, { useState } from 'react';
import { updateCaseStatus } from '../services/api';

/**
 * Phase 11: Complete AEO Case Workflow Section (Clean White UI)
 * 
 * Manages the linear real-world incident lifecycle:
 * NEW -> ACKNOWLEDGED -> INVESTIGATING -> ACTION_TAKEN -> RESOLVED
 * 
 * Features:
 * - Current Status Badge & Lifecycle Progression Stepper
 * - Only next valid actions displayed
 * - Investigation / Action note modal/input
 * - Case Timeline / Status History audit trail
 * - Case completed badge when RESOLVED
 */
export default function CaseWorkflowSection({
  incident,
  onStatusUpdated = () => {},
  onOpenRejectModal = () => {},
}) {
  if (!incident) return null;

  const currentStatus = (incident.status || 'NEW').toUpperCase();

  const [activeAction, setActiveAction] = useState(null); // 'ACKNOWLEDGED' | 'INVESTIGATING' | 'ACTION_TAKEN' | 'RESOLVED' | 'ESCALATED'
  const [officerNote, setOfficerNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Lifecycle steps
  const STEPS = [
    { key: 'NEW', label: 'New', icon: '🆕' },
    { key: 'ACKNOWLEDGED', label: 'Acknowledged', icon: '📋' },
    { key: 'INVESTIGATING', label: 'Investigating', icon: '🔍' },
    { key: 'ACTION_TAKEN', label: 'Action Taken', icon: '🛠️' },
    { key: 'RESOLVED', label: 'Resolved', icon: '✅' },
  ];

  const getStepIndex = (status) => {
    if (status === 'AI_ANALYZED' || status === 'AEO_NOTIFIED') return 0;
    const idx = STEPS.findIndex((s) => s.key === status);
    return idx >= 0 ? idx : 0;
  };

  const currentStepIdx = getStepIndex(currentStatus);
  const isTerminal = currentStatus === 'RESOLVED' || currentStatus === 'REJECTED';

  const handleOpenAction = (nextStatus) => {
    setActiveAction(nextStatus);
    setOfficerNote('');
    setErrorMsg('');
    setSuccessMsg('');
  };

  const handleConfirmTransition = async (e) => {
    e.preventDefault();
    if (!activeAction) return;

    setSubmitting(true);
    setErrorMsg('');
    try {
      const res = await updateCaseStatus({
        incidentId: incident.id,
        status: activeAction,
        note: officerNote.trim() || undefined,
        officerId: 'AEO001',
      });

      if (res && res.success) {
        setSuccessMsg(`Case transitioned to ${activeAction.replace('_', ' ')} successfully.`);
        setActiveAction(null);
        setOfficerNote('');
        onStatusUpdated(res.incident || { ...incident, status: activeAction }, res.timeline);
      }
    } catch (err) {
      setErrorMsg(err.message || 'Failed to update case status.');
    } finally {
      setSubmitting(false);
    }
  };

  // Timeline list
  const timeline = incident.timeline || [];

  return (
    <section className="evidence-panel workflow-panel" data-testid="case-workflow-section">
      <div className="evidence-panel-header">
        <div className="panel-title-wrap">
          <span className="panel-icon">🔄</span>
          <div>
            <h3 className="panel-title">Case Management Workflow</h3>
            <span className="panel-subtitle">Lifecycle state &amp; field action tracking</span>
          </div>
        </div>
        <span
          className={`status-pill status-${currentStatus.toLowerCase()}`}
          data-testid="current-workflow-status-badge"
        >
          {currentStatus === 'RESOLVED' ? '✅ RESOLVED (Completed)' : currentStatus.replace('_', ' ')}
        </span>
      </div>

      <div className="evidence-panel-body">
        {/* Progress Stepper (Hidden on rejected) */}
        {currentStatus !== 'REJECTED' && (
          <div className="workflow-stepper" data-testid="workflow-stepper">
            {STEPS.map((step, idx) => {
              const isPassed = idx < currentStepIdx || (currentStatus === 'RESOLVED' && idx <= currentStepIdx);
              const isCurrent = idx === currentStepIdx && currentStatus !== 'RESOLVED';
              return (
                <div
                  key={step.key}
                  className={`step-item ${isCurrent ? 'step-current' : ''} ${isPassed ? 'step-passed' : ''}`}
                  data-testid={`step-${step.key.toLowerCase()}`}
                >
                  <div className="step-circle">
                    {isPassed ? '✓' : step.icon}
                  </div>
                  <span className="step-label">{step.label}</span>
                  {idx < STEPS.length - 1 && <div className="step-connector" />}
                </div>
              );
            })}
          </div>
        )}

        {/* Status Highlights & Action Banners */}
        {currentStatus === 'RESOLVED' && (
          <div className="case-completed-banner" data-testid="case-completed-banner">
            <span className="completed-icon">🎉</span>
            <div>
              <strong>Case Completed:</strong> This agricultural incident has been fully investigated, action has been taken, and the case is closed.
              {incident.resolved_at && (
                <div className="resolved-date">
                  Closed on: {new Date(incident.resolved_at).toLocaleString()}
                </div>
              )}
            </div>
          </div>
        )}

        {currentStatus === 'REJECTED' && (
          <div className="case-rejected-banner" data-testid="case-rejected-banner">
            <span className="rejected-icon">🚫</span>
            <div>
              <strong>Case Rejected:</strong> This complaint was reviewed and dismissed by the AEO.
            </div>
          </div>
        )}

        {/* Next Valid Actions Toolbar */}
        {!isTerminal && (
          <div className="workflow-actions-bar" data-testid="workflow-actions-bar">
            <span className="actions-bar-label">Next Available Actions:</span>
            <div className="actions-button-group">
              {/* Transitions from NEW */}
              {(currentStatus === 'NEW' || currentStatus === 'AI_ANALYZED' || currentStatus === 'AEO_NOTIFIED') && (
                <>
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    onClick={() => handleOpenAction('ACKNOWLEDGED')}
                    data-testid="btn-action-acknowledge"
                  >
                    📋 Acknowledge Complaint
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-outline btn-danger-outline"
                    onClick={onOpenRejectModal}
                    data-testid="btn-action-reject-initial"
                  >
                    ❌ Reject Complaint
                  </button>
                </>
              )}

              {/* Transitions from ACKNOWLEDGED */}
              {currentStatus === 'ACKNOWLEDGED' && (
                <>
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    onClick={() => handleOpenAction('INVESTIGATING')}
                    data-testid="btn-action-investigate"
                  >
                    🔍 Start Field Investigation
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-outline btn-danger-outline"
                    onClick={onOpenRejectModal}
                    data-testid="btn-action-reject-ack"
                  >
                    ❌ Reject Complaint
                  </button>
                </>
              )}

              {/* Transitions from INVESTIGATING */}
              {currentStatus === 'INVESTIGATING' && (
                <>
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    onClick={() => handleOpenAction('ACTION_TAKEN')}
                    data-testid="btn-action-action-taken"
                  >
                    🛠️ Mark Action Taken
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-outline"
                    onClick={() => handleOpenAction('ESCALATED')}
                    data-testid="btn-action-escalate"
                  >
                    ⚠️ Escalate to AO
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-outline btn-danger-outline"
                    onClick={onOpenRejectModal}
                    data-testid="btn-action-reject-inv"
                  >
                    ❌ Reject
                  </button>
                </>
              )}

              {/* Transitions from ACTION_TAKEN */}
              {currentStatus === 'ACTION_TAKEN' && (
                <>
                  <button
                    type="button"
                    className="btn btn-sm btn-success"
                    onClick={() => handleOpenAction('RESOLVED')}
                    data-testid="btn-action-resolve"
                  >
                    ✅ Mark Case Resolved
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-outline"
                    onClick={() => handleOpenAction('ESCALATED')}
                    data-testid="btn-action-escalate-act"
                  >
                    ⚠️ Escalate
                  </button>
                </>
              )}

              {/* Transitions from ESCALATED */}
              {currentStatus === 'ESCALATED' && (
                <>
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    onClick={() => handleOpenAction('ACTION_TAKEN')}
                    data-testid="btn-action-action-taken-esc"
                  >
                    🛠️ Record Field Action
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-success"
                    onClick={() => handleOpenAction('RESOLVED')}
                    data-testid="btn-action-resolve-esc"
                  >
                    ✅ Mark Case Resolved
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Action Input Card (Shown when an action is selected) */}
        {activeAction && (
          <div className="action-note-card" data-testid="action-note-card">
            <div className="action-note-header">
              <h4 className="action-note-title">
                Confirm Transition to: <strong>{activeAction.replace('_', ' ')}</strong>
              </h4>
              <button
                type="button"
                className="btn-close-form"
                onClick={() => setActiveAction(null)}
              >
                ✕
              </button>
            </div>

            {errorMsg && (
              <div className="form-error-banner" data-testid="workflow-error-msg">
                ⚠️ {errorMsg}
              </div>
            )}

            <form onSubmit={handleConfirmTransition}>
              <div className="input-wrap">
                <label className="input-lbl">
                  AEO Officer Note / Field Advisory (optional):
                </label>
                <textarea
                  className="clean-textarea"
                  rows={2}
                  placeholder={`Add details about ${activeAction.toLowerCase().replace('_', ' ')} (e.g. visited farm, advised bio-pesticide, confirmed resolution)...`}
                  value={officerNote}
                  onChange={(e) => setOfficerNote(e.target.value)}
                  data-testid="officer-note-input"
                />
              </div>

              <div className="form-actions-line">
                <button
                  type="button"
                  className="btn btn-sm btn-outline"
                  onClick={() => setActiveAction(null)}
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-sm btn-primary"
                  disabled={submitting}
                  data-testid="confirm-transition-btn"
                >
                  {submitting ? 'Updating...' : `Confirm ${activeAction.replace('_', ' ')}`}
                </button>
              </div>
            </form>
          </div>
        )}

        {successMsg && !activeAction && (
          <div className="form-success-banner" data-testid="workflow-success-toast">
            ✅ {successMsg}
          </div>
        )}

        {/* Case Timeline / Status History */}
        <div className="timeline-section" data-testid="case-timeline-section">
          <h4 className="timeline-title">Case Timeline &amp; History</h4>
          {timeline && timeline.length > 0 ? (
            <div className="timeline-list" data-testid="timeline-list">
              {timeline.map((item, idx) => (
                <div key={idx} className="timeline-item" data-testid={`timeline-item-${idx}`}>
                  <div className="timeline-dot" />
                  <div className="timeline-content">
                    <div className="timeline-meta">
                      <span className="timeline-status-tag">
                        {item.label || (item.status || item.to_status || 'Update').replace('_', ' ')}
                      </span>
                      {item.timestamp && (
                        <span className="timeline-time">
                          {new Date(item.timestamp).toLocaleString()}
                        </span>
                      )}
                    </div>
                    {item.officer_id && (
                      <span className="timeline-officer">Officer: {item.officer_id}</span>
                    )}
                    {item.note && (
                      <p className="timeline-note">&ldquo;{item.note}&rdquo;</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="timeline-empty">
              No previous status updates recorded yet.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
