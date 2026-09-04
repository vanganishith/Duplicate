import React, { useState, useEffect } from 'react';
import { submitAeoVerification } from '../services/api';

/**
 * AEO Human Authority Verification & Official Decision Component
 * 
 * Implements the core principle:
 * - AI outputs remain preliminary and unconfirmed.
 * - Human Officer has the sole authority to confirm, modify, or reject diagnosis.
 * - Records official advisory, severity, and recommended government schemes.
 */
export default function AeoVerificationSection({
  incident,
  officerSession,
  onVerificationSuccess,
}) {
  const existingVerification = incident?.aeo_verification;
  const aiAnalysis = (incident?.ai_analysis && incident.ai_analysis[0]) || {};
  const preliminaryDisease = aiAnalysis.preliminary_disease || incident?.crop_issue || 'Foliar Infection';

  const [decisionStatus, setDecisionStatus] = useState('CONFIRMED'); // 'CONFIRMED' | 'MODIFIED' | 'REJECTED' | 'ESCALATED'
  const [diagnosis, setDiagnosis] = useState('');
  const [severity, setSeverity] = useState('HIGH');
  const [advisory, setAdvisory] = useState('');
  const [followUpNotes, setFollowUpNotes] = useState('');
  const [officerNotes, setOfficerNotes] = useState('');
  const [selectedSchemes, setSelectedSchemes] = useState(['PMFBY Crop Insurance', 'NFSM Plant Protection Subsidy']);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  useEffect(() => {
    if (existingVerification) {
      setDecisionStatus(existingVerification.status || 'CONFIRMED');
      setDiagnosis(existingVerification.confirmed_diagnosis || '');
      setSeverity(existingVerification.verified_severity || 'HIGH');
      setAdvisory(existingVerification.official_advisory || '');
      setFollowUpNotes(existingVerification.follow_up_instructions || '');
      setOfficerNotes(existingVerification.officer_notes || '');
      if (existingVerification.recommended_schemes) {
        setSelectedSchemes(existingVerification.recommended_schemes);
      }
    } else {
      setDiagnosis(preliminaryDisease);
      setSeverity(incident?.priority || 'HIGH');
      setAdvisory(
        incident?.crop_type === 'Cotton'
          ? 'Apply Neem oil (Azadirachtin 1500 ppm @ 5ml/L) or Profenophos 50 EC @ 2ml/L during early morning. Install pheromone traps (5/acre).'
          : 'Apply recommended bio-fungicide Copper Oxychloride 50 WP @ 3g/L. Maintain field drainage and avoid overhead irrigation.'
      );
      setFollowUpNotes('Submit follow-up photos in 72 hours to verify cessation of leaf spots.');
    }
  }, [incident, existingVerification, preliminaryDisease]);

  const handlePresetAdvisory = (text) => {
    setAdvisory(text);
  };

  const handleSchemeToggle = (schemeName) => {
    setSelectedSchemes((prev) =>
      prev.includes(schemeName) ? prev.filter((s) => s !== schemeName) : [...prev, schemeName]
    );
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!diagnosis.trim()) {
      setErrorMsg('Please specify the confirmed diagnosis.');
      return;
    }
    if (!advisory.trim()) {
      setErrorMsg('Please write the official advisory.');
      return;
    }

    try {
      setSubmitting(true);
      setErrorMsg('');
      setSuccessMsg('');

      const officerId = officerSession?.officer_id || 'AEO001';
      const officerName = officerSession?.name || 'Srinivas Rao (AEO)';

      const res = await submitAeoVerification({
        incidentId: incident.id,
        officerId,
        officerName,
        status: decisionStatus,
        confirmedDiagnosis: diagnosis.trim(),
        verifiedSeverity: severity,
        officialAdvisory: advisory.trim(),
        followUpInstructions: followUpNotes.trim(),
        officerNotes: officerNotes.trim(),
        recommendedSchemes: selectedSchemes,
      });

      if (res.success) {
        setSuccessMsg('Official AEO verification recorded and dispatched to farmer.');
        if (onVerificationSuccess) {
          onVerificationSuccess(res.verification);
        }
      }
    } catch (err) {
      setErrorMsg(err.message || 'Failed to submit verification.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="aeo-verification-section"
      style={{
        backgroundColor: '#ffffff',
        border: existingVerification ? '2px solid #10b981' : '1px solid #e2e8f0',
        borderRadius: '12px',
        padding: '20px',
        marginBottom: '24px',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)',
      }}
    >
      {/* Header Banner */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '1.4rem' }}>🛡️</span>
            <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: '700', color: '#1e293b' }}>
              Official AEO Verification &amp; Authority Decision
            </h3>
            {existingVerification ? (
              <span
                style={{
                  backgroundColor: '#d1fae5',
                  color: '#065f46',
                  fontSize: '0.75rem',
                  fontWeight: '700',
                  padding: '3px 8px',
                  borderRadius: '12px',
                  textTransform: 'uppercase',
                }}
              >
                ✓ VERIFIED BY {existingVerification.officer_name || 'AEO'}
              </span>
            ) : (
              <span
                style={{
                  backgroundColor: '#fef3c7',
                  color: '#92400e',
                  fontSize: '0.75rem',
                  fontWeight: '700',
                  padding: '3px 8px',
                  borderRadius: '12px',
                }}
              >
                ⏳ PENDING OFFICER CONFIRMATION
              </span>
            )}
          </div>
          <p style={{ margin: '4px 0 0', fontSize: '0.8125rem', color: '#64748b' }}>
            Human Officer is the final authority. Preliminary AI analysis is advisory and unconfirmed until verified below.
          </p>
        </div>
      </div>

      {successMsg && (
        <div
          style={{
            backgroundColor: '#ecfdf5',
            border: '1px solid #a7f3d0',
            color: '#065f46',
            padding: '10px 14px',
            borderRadius: '8px',
            marginBottom: '16px',
            fontSize: '0.875rem',
            fontWeight: '600',
          }}
        >
          ✓ {successMsg}
        </div>
      )}

      {errorMsg && (
        <div
          style={{
            backgroundColor: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#dc2626',
            padding: '10px 14px',
            borderRadius: '8px',
            marginBottom: '16px',
            fontSize: '0.875rem',
          }}
        >
          ⚠️ {errorMsg}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        {/* Decision Status Radios */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '600', color: '#334155', marginBottom: '8px' }}>
            Officer Decision Action
          </label>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            {[
              { id: 'CONFIRMED', label: 'Confirm AI Hypothesis', icon: '✓', color: '#10b981' },
              { id: 'MODIFIED', label: 'Modify / Correct Diagnosis', icon: '✏️', color: '#3b82f6' },
              { id: 'REJECTED', label: 'Reject / Inconclusive Evidence', icon: '✕', color: '#ef4444' },
              { id: 'ESCALATED', label: 'Escalate to Specialist / DAO', icon: '⬆️', color: '#8b5cf6' },
            ].map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setDecisionStatus(opt.id)}
                style={{
                  flex: 1,
                  minWidth: '160px',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: decisionStatus === opt.id ? `2px solid ${opt.color}` : '1px solid #cbd5e1',
                  backgroundColor: decisionStatus === opt.id ? `${opt.color}15` : '#f8fafc',
                  color: decisionStatus === opt.id ? opt.color : '#475569',
                  fontWeight: '600',
                  fontSize: '0.875rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  transition: 'all 0.15s ease',
                }}
              >
                <span>{opt.icon}</span>
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Diagnosis & Severity Inputs */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', marginBottom: '16px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '600', color: '#334155', marginBottom: '6px' }}>
              Official Confirmed Diagnosis *
            </label>
            <input
              type="text"
              value={diagnosis}
              onChange={(e) => setDiagnosis(e.target.value)}
              placeholder="e.g. Pink Bollworm Infestation, Late Blight, Bacterial Blight"
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: '0.9375rem',
                backgroundColor: '#ffffff',
                boxSizing: 'border-box',
              }}
              required
            />
            <span style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '4px', display: 'block' }}>
              Preliminary AI Hypothesis: <strong>{preliminaryDisease}</strong>
            </span>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '600', color: '#334155', marginBottom: '6px' }}>
              Verified Severity Level *
            </label>
            <select
              value={severity}
              onChange={(e) => setSeverity(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: '0.9375rem',
                backgroundColor: '#ffffff',
                boxSizing: 'border-box',
              }}
            >
              <option value="CRITICAL">🔴 CRITICAL (Immediate Multi-Acre Intervention Required)</option>
              <option value="HIGH">🟠 HIGH (Urgent Action within 24 Hours)</option>
              <option value="MEDIUM">🟡 MEDIUM (Routine Visit / Advisory within 48 Hours)</option>
              <option value="LOW">🟢 LOW (Standard Monitoring / Minor Symptoms)</option>
            </select>
          </div>
        </div>

        {/* Official Advisory Input */}
        <div style={{ marginBottom: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
            <label style={{ fontSize: '0.875rem', fontWeight: '600', color: '#334155' }}>
              Official Actionable Advisory (Prescription) *
            </label>
            {/* Quick preset pills */}
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() =>
                  handlePresetAdvisory(
                    'Spray Profenophos 50 EC @ 2ml/L water during early morning hours. Repeat after 7 days if larval damage continues.'
                  )
                }
                style={{
                  fontSize: '0.75rem',
                  padding: '3px 8px',
                  borderRadius: '4px',
                  border: '1px solid #cbd5e1',
                  background: '#f1f5f9',
                  cursor: 'pointer',
                  color: '#475569',
                }}
              >
                + Chemical Spray
              </button>
              <button
                type="button"
                onClick={() =>
                  handlePresetAdvisory(
                    'Apply 5% Neem Seed Kernel Extract (NSKE) or Azadirachtin 1500 ppm @ 5ml/L. Install 4-5 pheromone traps per acre for pest monitoring.'
                  )
                }
                style={{
                  fontSize: '0.75rem',
                  padding: '3px 8px',
                  borderRadius: '4px',
                  border: '1px solid #cbd5e1',
                  background: '#f1f5f9',
                  cursor: 'pointer',
                  color: '#475569',
                }}
              >
                + Organic / IPM
              </button>
              <button
                type="button"
                onClick={() =>
                  handlePresetAdvisory(
                    'Ensure proper drainage in root zone. Avoid nitrogenous fertilizer excess. Drench root zone with Trichoderma viride @ 5g/L.'
                  )
                }
                style={{
                  fontSize: '0.75rem',
                  padding: '3px 8px',
                  borderRadius: '4px',
                  border: '1px solid #cbd5e1',
                  background: '#f1f5f9',
                  cursor: 'pointer',
                  color: '#475569',
                }}
              >
                + Root / Soil Care
              </button>
            </div>
          </div>
          <textarea
            rows={4}
            value={advisory}
            onChange={(e) => setAdvisory(e.target.value)}
            placeholder="Specify precise chemical/biological dosage, spraying timing, water ratio, and precautions..."
            style={{
              width: '100%',
              padding: '10px 12px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              fontSize: '0.9375rem',
              fontFamily: 'inherit',
              boxSizing: 'border-box',
            }}
            required
          />
        </div>

        {/* Follow-up check instructions & confidential notes */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', marginBottom: '16px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '600', color: '#334155', marginBottom: '6px' }}>
              Follow-up Verification Instructions for Farmer
            </label>
            <input
              type="text"
              value={followUpNotes}
              onChange={(e) => setFollowUpNotes(e.target.value)}
              placeholder="e.g. Upload photo of new shoots after 5 days"
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: '0.875rem',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '600', color: '#334155', marginBottom: '6px' }}>
              Confidential Officer Field Notes
            </label>
            <input
              type="text"
              value={officerNotes}
              onChange={(e) => setOfficerNotes(e.target.value)}
              placeholder="e.g. Farmer applied unrecommended pesticide cocktail previously"
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: '0.875rem',
                boxSizing: 'border-box',
              }}
            />
          </div>
        </div>

        {/* Grounded Government Support Recommendation */}
        <div style={{ marginBottom: '20px', padding: '14px', backgroundColor: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
          <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '600', color: '#1e293b', marginBottom: '6px' }}>
            🏛️ Endorse Eligible Government Programs
          </label>
          <p style={{ margin: '0 0 10px', fontSize: '0.75rem', color: '#64748b' }}>
            Check schemes to include in the farmer's official advisory note for insurance claims and input assistance.
          </p>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            {[
              { id: 'PMFBY Crop Insurance', label: 'PMFBY Crop Insurance (72h Notice Window)' },
              { id: 'Telangana Disaster Relief', label: 'Telangana Disaster Relief / Input Subsidy (>33% Damage)' },
              { id: 'NFSM Plant Protection Subsidy', label: 'NFSM 50% Bio-Pesticide Subsidy' },
              { id: 'Rythu Bharosa Support', label: 'Rythu Bharosa Input Verification' },
            ].map((sc) => (
              <label
                key={sc.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '0.8125rem',
                  fontWeight: '500',
                  color: '#334155',
                  cursor: 'pointer',
                  backgroundColor: selectedSchemes.includes(sc.id) ? '#e0e7ff' : '#ffffff',
                  padding: '6px 10px',
                  borderRadius: '6px',
                  border: selectedSchemes.includes(sc.id) ? '1px solid #6366f1' : '1px solid #cbd5e1',
                }}
              >
                <input
                  type="checkbox"
                  checked={selectedSchemes.includes(sc.id)}
                  onChange={() => handleSchemeToggle(sc.id)}
                />
                {sc.label}
              </label>
            ))}
          </div>
        </div>

        {/* Submit Button */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
          <button
            type="submit"
            disabled={submitting}
            style={{
              padding: '12px 24px',
              backgroundColor: '#16a34a',
              color: '#ffffff',
              border: 'none',
              borderRadius: '8px',
              fontSize: '0.9375rem',
              fontWeight: '700',
              cursor: submitting ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              boxShadow: '0 2px 4px rgba(22, 163, 74, 0.2)',
            }}
          >
            {submitting ? 'Recording Official Decision...' : '✓ Record Official Verification'}
          </button>
        </div>
      </form>
    </div>
  );
}
