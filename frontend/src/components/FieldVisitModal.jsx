import React, { useState } from 'react';
import { scheduleFieldVisit, completeFieldVisit } from '../services/api';

/**
 * Field Visit Scheduling & Completion Modal
 */
export default function FieldVisitModal({
  isOpen,
  onClose,
  incident,
  officerSession,
  onVisitUpdated,
}) {
  if (!isOpen || !incident) return null;

  const farmer = incident.farmer || {};
  const visits = incident.field_visits || [];

  const [tab, setTab] = useState('SCHEDULE'); // 'SCHEDULE' | 'LIST'
  const [scheduledDate, setScheduledDate] = useState(
    new Date(Date.now() + 86400000).toISOString().split('T')[0] // default tomorrow
  );
  const [scheduledTime, setScheduledTime] = useState('10:00 AM');
  const [purpose, setPurpose] = useState('Severity Verification & On-site Guidance');
  const [farmerNotes, setFarmerNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Complete visit modal state
  const [selectedVisitToComplete, setSelectedVisitToComplete] = useState(null);
  const [findings, setFindings] = useState('Confirmed heavy foliar lesion spread. 1.2 acres affected.');
  const [actionTaken, setActionTaken] = useState('Demonstrated correct sprayer nozzle calibration and safe handling.');
  const [officerNotes, setOfficerNotes] = useState('Farmer receptive to IPM recommendations.');

  const handleScheduleSubmit = async (e) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      setErrorMsg('');
      setSuccessMsg('');

      const res = await scheduleFieldVisit({
        incidentId: incident.id,
        officerId: officerSession?.officer_id || 'AEO001',
        officerName: officerSession?.name || 'Srinivas Rao (AEO)',
        scheduledDate,
        scheduledTime,
        purpose,
        farmerNotes,
      });

      if (res.success) {
        setSuccessMsg(`Field visit scheduled for ${scheduledDate} at ${scheduledTime}. Notice sent to farmer.`);
        if (onVisitUpdated) onVisitUpdated();
        setTimeout(() => setTab('LIST'), 1200);
      }
    } catch (err) {
      setErrorMsg(err.message || 'Failed to schedule field visit.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCompleteSubmit = async (e) => {
    e.preventDefault();
    if (!selectedVisitToComplete) return;

    try {
      setSubmitting(true);
      setErrorMsg('');

      const res = await completeFieldVisit({
        incidentId: incident.id,
        visitId: selectedVisitToComplete.id,
        officerNotes,
        findings,
        actionTaken,
      });

      if (res.success) {
        setSelectedVisitToComplete(null);
        if (onVisitUpdated) onVisitUpdated();
      }
    } catch (err) {
      setErrorMsg(err.message || 'Failed to complete visit.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        backdropFilter: 'blur(3px)',
      }}
    >
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '16px',
          width: '90%',
          maxWidth: '560px',
          maxHeight: '90vh',
          overflowY: 'auto',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)',
          padding: '24px',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: '700', color: '#1e293b' }}>
              🚗 In-Person Field Inspection
            </h3>
            <p style={{ margin: '4px 0 0', fontSize: '0.8125rem', color: '#64748b' }}>
              Farmer: <strong>{farmer.name || 'Farmer'}</strong> ({incident.area || 'Mandal Zone'}) &bull; Case ID:{' '}
              <code>{incident.case_id || incident.id?.substring(0, 8)}</code>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '1.25rem',
              cursor: 'pointer',
              color: '#64748b',
            }}
          >
            ✕
          </button>
        </div>

        {/* Tab switch */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', borderBottom: '1px solid #e2e8f0', paddingBottom: '8px' }}>
          <button
            type="button"
            onClick={() => setTab('SCHEDULE')}
            style={{
              padding: '6px 14px',
              borderRadius: '6px',
              border: 'none',
              backgroundColor: tab === 'SCHEDULE' ? '#0284c7' : '#f1f5f9',
              color: tab === 'SCHEDULE' ? '#ffffff' : '#475569',
              fontWeight: '600',
              fontSize: '0.875rem',
              cursor: 'pointer',
            }}
          >
            Schedule New Visit
          </button>
          <button
            type="button"
            onClick={() => setTab('LIST')}
            style={{
              padding: '6px 14px',
              borderRadius: '6px',
              border: 'none',
              backgroundColor: tab === 'LIST' ? '#0284c7' : '#f1f5f9',
              color: tab === 'LIST' ? '#ffffff' : '#475569',
              fontWeight: '600',
              fontSize: '0.875rem',
              cursor: 'pointer',
            }}
          >
            Visits for this Case ({visits.length})
          </button>
        </div>

        {errorMsg && (
          <div style={{ backgroundColor: '#fef2f2', color: '#dc2626', padding: '10px 14px', borderRadius: '8px', fontSize: '0.875rem', marginBottom: '16px' }}>
            ⚠️ {errorMsg}
          </div>
        )}
        {successMsg && (
          <div style={{ backgroundColor: '#ecfdf5', color: '#065f46', padding: '10px 14px', borderRadius: '8px', fontSize: '0.875rem', marginBottom: '16px' }}>
            ✓ {successMsg}
          </div>
        )}

        {tab === 'SCHEDULE' ? (
          <form onSubmit={handleScheduleSubmit}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: '600', color: '#334155', marginBottom: '4px' }}>
                  Inspection Date *
                </label>
                <input
                  type="date"
                  value={scheduledDate}
                  onChange={(e) => setScheduledDate(e.target.value)}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.875rem', boxSizing: 'border-box' }}
                  required
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: '600', color: '#334155', marginBottom: '4px' }}>
                  Estimated Time *
                </label>
                <select
                  value={scheduledTime}
                  onChange={(e) => setScheduledTime(e.target.value)}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.875rem', boxSizing: 'border-box' }}
                >
                  <option value="09:00 AM">09:00 AM (Morning Field Shift)</option>
                  <option value="10:30 AM">10:30 AM</option>
                  <option value="12:00 PM">12:00 PM (Mid-day Inspection)</option>
                  <option value="03:00 PM">03:00 PM (Afternoon Shift)</option>
                  <option value="04:30 PM">04:30 PM</option>
                </select>
              </div>
            </div>

            <div style={{ marginBottom: '14px' }}>
              <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: '600', color: '#334155', marginBottom: '4px' }}>
                Visit Purpose *
              </label>
              <select
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.875rem', boxSizing: 'border-box' }}
              >
                <option value="Severity Verification & On-site Guidance">Severity Verification &amp; On-site Guidance</option>
                <option value="Cluster Outbreak Assessment">Cluster Outbreak Assessment</option>
                <option value="Soil & Leaf Sample Collection">Soil &amp; Leaf Sample Collection</option>
                <option value="Damage Enumeration for PMFBY / Disaster Relief">Damage Enumeration for PMFBY / Disaster Relief</option>
                <option value="Sprayer Nozzle & Chemical Calibration Demonstration">Sprayer Calibration Demonstration</option>
              </select>
            </div>

            <div style={{ marginBottom: '18px' }}>
              <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: '600', color: '#334155', marginBottom: '4px' }}>
                Instructions / Landmark for Farmer (Sent via SMS / Direct Message)
              </label>
              <textarea
                rows={2}
                value={farmerNotes}
                onChange={(e) => setFarmerNotes(e.target.value)}
                placeholder="e.g. Please meet at the borewell near the north canal. Keep purchase bills of previously sprayed inputs ready."
                style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.875rem', boxSizing: 'border-box' }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                onClick={onClose}
                style={{ padding: '10px 16px', borderRadius: '8px', border: '1px solid #cbd5e1', background: '#ffffff', cursor: 'pointer', fontSize: '0.875rem' }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                style={{
                  padding: '10px 20px',
                  borderRadius: '8px',
                  border: 'none',
                  backgroundColor: '#0284c7',
                  color: '#ffffff',
                  fontWeight: '700',
                  fontSize: '0.875rem',
                  cursor: submitting ? 'not-allowed' : 'pointer',
                }}
              >
                {submitting ? 'Scheduling...' : '✓ Confirm & Notify Farmer'}
              </button>
            </div>
          </form>
        ) : (
          <div>
            {visits.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px', color: '#94a3b8' }}>
                No field visits scheduled yet for this case.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {visits.map((v, i) => (
                  <div
                    key={v.id || i}
                    style={{
                      border: '1px solid #e2e8f0',
                      borderRadius: '8px',
                      padding: '12px',
                      backgroundColor: '#f8fafc',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                      <span style={{ fontWeight: '700', fontSize: '0.875rem', color: '#1e293b' }}>
                        📅 {v.scheduled_date} at {v.scheduled_time}
                      </span>
                      <span
                        style={{
                          fontSize: '0.75rem',
                          fontWeight: '700',
                          padding: '2px 8px',
                          borderRadius: '10px',
                          backgroundColor: v.status === 'COMPLETED' ? '#d1fae5' : '#e0f2fe',
                          color: v.status === 'COMPLETED' ? '#065f46' : '#0369a1',
                        }}
                      >
                        {v.status}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.8125rem', color: '#475569', marginBottom: '4px' }}>
                      <strong>Purpose:</strong> {v.purpose}
                    </div>
                    {v.status === 'COMPLETED' && (
                      <div style={{ fontSize: '0.8125rem', color: '#16a34a', backgroundColor: '#ffffff', padding: '6px 8px', borderRadius: '4px', marginTop: '6px' }}>
                        <strong>Findings:</strong> {v.findings} &bull; <strong>Action:</strong> {v.action_taken}
                      </div>
                    )}
                    {v.status !== 'COMPLETED' && (
                      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px' }}>
                        <button
                          type="button"
                          onClick={() => setSelectedVisitToComplete(v)}
                          style={{
                            fontSize: '0.75rem',
                            padding: '4px 10px',
                            backgroundColor: '#16a34a',
                            color: '#ffffff',
                            border: 'none',
                            borderRadius: '4px',
                            fontWeight: '600',
                            cursor: 'pointer',
                          }}
                        >
                          Mark Completed
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Complete Visit Mini Form */}
        {selectedVisitToComplete && (
          <div style={{ marginTop: '16px', padding: '14px', backgroundColor: '#ecfdf5', borderRadius: '8px', border: '1px solid #a7f3d0' }}>
            <h5 style={{ margin: '0 0 10px', fontSize: '0.9375rem', fontWeight: '700', color: '#065f46' }}>
              ✓ Complete Field Visit Inspection Report
            </h5>
            <form onSubmit={handleCompleteSubmit}>
              <div style={{ marginBottom: '8px' }}>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: '600', color: '#065f46' }}>Findings *</label>
                <input
                  type="text"
                  value={findings}
                  onChange={(e) => setFindings(e.target.value)}
                  style={{ width: '100%', padding: '6px 8px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '0.8125rem', boxSizing: 'border-box' }}
                  required
                />
              </div>
              <div style={{ marginBottom: '8px' }}>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: '600', color: '#065f46' }}>Action Taken *</label>
                <input
                  type="text"
                  value={actionTaken}
                  onChange={(e) => setActionTaken(e.target.value)}
                  style={{ width: '100%', padding: '6px 8px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '0.8125rem', boxSizing: 'border-box' }}
                  required
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '10px' }}>
                <button
                  type="button"
                  onClick={() => setSelectedVisitToComplete(null)}
                  style={{ fontSize: '0.75rem', padding: '4px 10px', borderRadius: '4px', border: '1px solid #cbd5e1', background: '#ffffff', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  style={{ fontSize: '0.75rem', padding: '4px 12px', borderRadius: '4px', border: 'none', backgroundColor: '#16a34a', color: '#ffffff', fontWeight: '700', cursor: 'pointer' }}
                >
                  Submit Inspection Report
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
