import React, { useState } from 'react';
import { reviewCaseFollowup, submitCaseFollowup } from '../services/api';

/**
 * Longitudinal Progress & Treatment Follow-up Component
 * 
 * Shows chronological evidence: Baseline vs Follow-up 1, 2...
 * Allows AEO to evaluate recovery ('IMPROVING', 'UNCHANGED', 'WORSENING').
 */
export default function CaseFollowupSection({ incident, officerSession, onUpdate }) {
  const followups = incident?.followups || [];
  const baselinePhoto = (incident?.photos && incident.photos[0]) || incident?.photo_url || null;
  const initialDiagnosis = incident?.aeo_verification?.confirmed_diagnosis || incident?.crop_issue || 'Initial Complaint';

  const [selectedFollowup, setSelectedFollowup] = useState(null);
  const [assessment, setAssessment] = useState('');
  const [comparisonStatus, setComparisonStatus] = useState('IMPROVING'); // 'IMPROVING' | 'UNCHANGED' | 'WORSENING'
  const [newAdvisory, setNewAdvisory] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [reviewSuccess, setReviewSuccess] = useState('');
  const [reviewError, setReviewError] = useState('');

  // Farmer demo simulate submission state
  const [showSimulateModal, setShowSimulateModal] = useState(false);
  const [simNotes, setSimNotes] = useState('Observed new green leaves after spraying Copper Oxychloride. Yellow spots reduced.');
  const [simulating, setSimulating] = useState(false);

  const handleOpenReview = (flw) => {
    setSelectedFollowup(flw);
    setAssessment(flw.officer_review?.assessment || 'Symptoms substantially reduced. Crop foliage shows clear regeneration.');
    setComparisonStatus(flw.officer_review?.comparison_status || 'IMPROVING');
    setNewAdvisory(flw.officer_review?.new_advisory || 'Continue monitoring for 1 more week. No further chemical application needed.');
    setReviewSuccess('');
    setReviewError('');
  };

  const handleReviewSubmit = async (e) => {
    e.preventDefault();
    if (!selectedFollowup) return;

    try {
      setReviewing(true);
      setReviewError('');
      setReviewSuccess('');

      const res = await reviewCaseFollowup({
        incidentId: incident.id,
        followupId: selectedFollowup.id,
        officerId: officerSession?.officer_id || 'AEO001',
        officerName: officerSession?.name || 'Srinivas Rao (AEO)',
        officerAssessment: assessment.trim(),
        comparisonStatus,
        newAdvisory: newAdvisory.trim(),
        baselineImage: baselinePhoto,
        followupImage: selectedFollowup.image_url,
        crop: incident.crop_type || 'Cotton',
        initialDiagnosis,
        farmerNotes: selectedFollowup.notes,
      });

      if (res.success) {
        setReviewSuccess('Follow-up review recorded and progression status updated.');
        if (onUpdate) onUpdate();
      }
    } catch (err) {
      setReviewError(err.message || 'Failed to submit review.');
    } finally {
      setReviewing(false);
    }
  };

  const handleSimulateFarmerFollowup = async () => {
    try {
      setSimulating(true);
      const res = await submitCaseFollowup({
        incidentId: incident.id,
        farmerId: incident?.farmer?.id || 'FARMER01',
        farmerName: incident?.farmer?.name || 'Farmer',
        notes: simNotes,
        imageUrl: baselinePhoto, // reuse photo as simulated check
        voiceText: 'రెండు రోజుల క్రితం మందు పిచికారీ చేశాను, ఇప్పుడు కొంచెం మెరుగుపడింది (Sprayed medicine 2 days ago, recovering now)',
      });
      if (res.success) {
        setShowSimulateModal(false);
        if (onUpdate) onUpdate();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSimulating(false);
    }
  };

  return (
    <div
      className="case-followup-section"
      style={{
        backgroundColor: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: '12px',
        padding: '20px',
        marginBottom: '24px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div>
          <h4 style={{ margin: 0, fontSize: '1.1rem', fontWeight: '700', color: '#1e293b' }}>
            📈 Longitudinal Follow-up &amp; Recovery Monitoring
          </h4>
          <p style={{ margin: '2px 0 0', fontSize: '0.8125rem', color: '#64748b' }}>
            Track plant recovery chronologically after treatment application.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowSimulateModal(true)}
          style={{
            fontSize: '0.8125rem',
            padding: '6px 12px',
            backgroundColor: '#f1f5f9',
            border: '1px solid #cbd5e1',
            borderRadius: '6px',
            cursor: 'pointer',
            color: '#334155',
            fontWeight: '600',
          }}
        >
          + Record Follow-up Check
        </button>
      </div>

      {/* Follow-up Timeline Cards */}
      {followups.length === 0 ? (
        <div
          style={{
            padding: '24px',
            textAlign: 'center',
            backgroundColor: '#f8fafc',
            borderRadius: '8px',
            border: '1px dashed #cbd5e1',
            color: '#64748b',
          }}
        >
          <div style={{ fontSize: '1.8rem', marginBottom: '6px' }}>🌱</div>
          <div style={{ fontWeight: '600', marginBottom: '4px' }}>No Follow-up Evidence Submitted Yet</div>
          <p style={{ margin: 0, fontSize: '0.8125rem' }}>
            When the farmer submits progress photos or voice updates after spraying, they appear here for chronological review.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px' }}>
          {followups.map((flw, idx) => {
            const isReviewed = flw.status === 'REVIEWED';
            const compStatus = flw.officer_review?.comparison_status || 'PENDING';
            const statusColor =
              compStatus === 'IMPROVING' ? '#10b981' : compStatus === 'WORSENING' ? '#ef4444' : '#f59e0b';

            return (
              <div
                key={flw.id || idx}
                style={{
                  border: selectedFollowup?.id === flw.id ? '2px solid #0284c7' : '1px solid #e2e8f0',
                  borderRadius: '10px',
                  padding: '14px',
                  backgroundColor: '#f8fafc',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontWeight: '700', fontSize: '0.875rem', color: '#1e293b' }}>
                      Follow-up #{idx + 1}
                    </span>
                    <span
                      style={{
                        fontSize: '0.75rem',
                        fontWeight: '700',
                        padding: '2px 8px',
                        borderRadius: '10px',
                        backgroundColor: isReviewed ? `${statusColor}20` : '#fef3c7',
                        color: isReviewed ? statusColor : '#92400e',
                      }}
                    >
                      {isReviewed ? `✓ ${compStatus}` : 'PENDING OFFICER REVIEW'}
                    </span>
                  </div>
                  <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                    {flw.created_at ? new Date(flw.created_at).toLocaleDateString() : 'Recently'}
                  </span>
                </div>

                <p style={{ margin: '0 0 8px', fontSize: '0.875rem', color: '#334155' }}>
                  <strong>Farmer Observation:</strong> {flw.notes || 'No written notes.'}
                </p>

                {flw.voice_text && (
                  <p style={{ margin: '0 0 8px', fontSize: '0.8125rem', color: '#475569', fontStyle: 'italic', backgroundColor: '#ffffff', padding: '6px 10px', borderRadius: '6px' }}>
                    🎙️ Voice note: "{flw.voice_text}"
                  </p>
                )}

                {isReviewed && flw.officer_review && (
                  <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '10px', marginBottom: '8px', fontSize: '0.8125rem' }}>
                    <div style={{ fontWeight: '600', color: '#1e293b', marginBottom: '2px' }}>
                      Officer Assessment by {flw.officer_review.officer_name}:
                    </div>
                    <div style={{ color: '#475569' }}>{flw.officer_review.assessment}</div>
                    {flw.officer_review.new_advisory && (
                      <div style={{ color: '#16a34a', fontWeight: '500', marginTop: '4px' }}>
                        Next Action: {flw.officer_review.new_advisory}
                      </div>
                    )}
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    onClick={() => handleOpenReview(flw)}
                    style={{
                      fontSize: '0.8125rem',
                      padding: '6px 12px',
                      backgroundColor: '#0284c7',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontWeight: '600',
                    }}
                  >
                    {isReviewed ? 'Update Review' : 'Evaluate Recovery'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Review Modal / Drawer */}
      {selectedFollowup && (
        <div
          style={{
            backgroundColor: '#f1f5f9',
            border: '2px solid #0284c7',
            borderRadius: '10px',
            padding: '16px',
            marginTop: '16px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <h5 style={{ margin: 0, fontSize: '1rem', fontWeight: '700', color: '#0f172a' }}>
              🔬 Evaluate Treatment Progression (Follow-up #{followups.indexOf(selectedFollowup) + 1})
            </h5>
            <button
              type="button"
              onClick={() => setSelectedFollowup(null)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem' }}
            >
              ✕
            </button>
          </div>

          {reviewSuccess && (
            <div style={{ backgroundColor: '#ecfdf5', color: '#065f46', padding: '8px 12px', borderRadius: '6px', fontSize: '0.8125rem', marginBottom: '12px' }}>
              ✓ {reviewSuccess}
            </div>
          )}
          {reviewError && (
            <div style={{ backgroundColor: '#fef2f2', color: '#dc2626', padding: '8px 12px', borderRadius: '6px', fontSize: '0.8125rem', marginBottom: '12px' }}>
              ⚠️ {reviewError}
            </div>
          )}

          <form onSubmit={handleReviewSubmit}>
            {/* Progression Selector */}
            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: '600', color: '#334155', marginBottom: '6px' }}>
                Progression Assessment *
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                {[
                  { id: 'IMPROVING', label: '🟢 Improving / Symptoms Receding' },
                  { id: 'UNCHANGED', label: '🟡 Unchanged / Static' },
                  { id: 'WORSENING', label: '🔴 Worsening / Spreading' },
                ].map((st) => (
                  <button
                    key={st.id}
                    type="button"
                    onClick={() => setComparisonStatus(st.id)}
                    style={{
                      flex: 1,
                      padding: '8px 10px',
                      fontSize: '0.8125rem',
                      fontWeight: '600',
                      borderRadius: '6px',
                      border: comparisonStatus === st.id ? '2px solid #0284c7' : '1px solid #cbd5e1',
                      backgroundColor: comparisonStatus === st.id ? '#e0f2fe' : '#ffffff',
                      color: comparisonStatus === st.id ? '#0369a1' : '#475569',
                      cursor: 'pointer',
                    }}
                  >
                    {st.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: '600', color: '#334155', marginBottom: '4px' }}>
                Officer Clinical Assessment *
              </label>
              <textarea
                rows={2}
                value={assessment}
                onChange={(e) => setAssessment(e.target.value)}
                placeholder="Describe changes in foliar color, lesion spread, or pest reduction..."
                style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.875rem', boxSizing: 'border-box' }}
                required
              />
            </div>

            <div style={{ marginBottom: '14px' }}>
              <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: '600', color: '#334155', marginBottom: '4px' }}>
                Updated Next-Step Advisory for Farmer
              </label>
              <input
                type="text"
                value={newAdvisory}
                onChange={(e) => setNewAdvisory(e.target.value)}
                placeholder="e.g. Discontinue fungicide; apply micronutrient spray for leaf recovery"
                style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.875rem', boxSizing: 'border-box' }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                type="button"
                onClick={() => setSelectedFollowup(null)}
                style={{ padding: '8px 14px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#ffffff', cursor: 'pointer', fontSize: '0.8125rem' }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={reviewing}
                style={{ padding: '8px 16px', borderRadius: '6px', border: 'none', backgroundColor: '#16a34a', color: '#ffffff', fontWeight: '700', cursor: reviewing ? 'not-allowed' : 'pointer', fontSize: '0.8125rem' }}
              >
                {reviewing ? 'Saving Review...' : '✓ Submit Progression Review'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Simulate Modal */}
      {showSimulateModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div style={{ backgroundColor: '#ffffff', borderRadius: '12px', padding: '24px', maxWidth: '440px', width: '90%' }}>
            <h4 style={{ margin: '0 0 12px', fontSize: '1.1rem', fontWeight: '700' }}>
              Simulate Farmer Follow-up Submission
            </h4>
            <p style={{ fontSize: '0.8125rem', color: '#64748b', margin: '0 0 14px' }}>
              Simulates farmer submitting 3-day post-treatment photo check for testing the longitudinal workflow.
            </p>
            <div style={{ marginBottom: '14px' }}>
              <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: '600', marginBottom: '4px' }}>
                Farmer Notes
              </label>
              <textarea
                rows={3}
                value={simNotes}
                onChange={(e) => setSimNotes(e.target.value)}
                style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.875rem', boxSizing: 'border-box' }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                type="button"
                onClick={() => setShowSimulateModal(false)}
                style={{ padding: '8px 14px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#ffffff', cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSimulateFarmerFollowup}
                disabled={simulating}
                style={{ padding: '8px 16px', borderRadius: '6px', border: 'none', backgroundColor: '#0284c7', color: '#ffffff', fontWeight: '600', cursor: 'pointer' }}
              >
                {simulating ? 'Submitting...' : 'Submit Follow-up'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
