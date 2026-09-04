import React, { useState, useEffect } from 'react';
import { getGovernmentSupport } from '../services/api';

/**
 * Grounded Government Support Programs Component
 */
export default function GovernmentSupportCard({ incident }) {
  const [schemes, setSchemes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expandedScheme, setExpandedScheme] = useState(null);

  useEffect(() => {
    if (incident?.government_support && Array.isArray(incident.government_support)) {
      setSchemes(incident.government_support);
    } else if (incident?.id && typeof getGovernmentSupport === 'function') {
      try {
        setLoading(true);
        const p = getGovernmentSupport(incident.id);
        if (p && typeof p.then === 'function') {
          p.then((res) => {
            if (res?.schemes) setSchemes(res.schemes);
          })
            .catch(() => {})
            .finally(() => setLoading(false));
        } else {
          setLoading(false);
        }
      } catch {
        setLoading(false);
      }
    }
  }, [incident]);

  return (
    <div
      className="government-support-card"
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
            🏛️ Government Support &amp; Insurance Eligibility
          </h4>
          <p style={{ margin: '2px 0 0', fontSize: '0.8125rem', color: '#64748b' }}>
            Grounded evaluation of Indian and Telangana programs based on reported damage and crop: <strong>{incident?.crop_type || 'Cotton'}</strong>.
          </p>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '16px', color: '#64748b', fontSize: '0.875rem' }}>
          Evaluating grounded program criteria...
        </div>
      ) : schemes.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '16px', color: '#94a3b8', fontSize: '0.875rem' }}>
          No specific schemes available for this crop profile.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '14px' }}>
          {schemes.map((s) => {
            const isEligible = s.eligible;
            const isExpanded = expandedScheme === s.id;

            return (
              <div
                key={s.id}
                style={{
                  border: isEligible ? '1px solid #86efac' : '1px solid #e2e8f0',
                  borderRadius: '10px',
                  padding: '14px',
                  backgroundColor: isEligible ? '#f0fdf4' : '#f8fafc',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                }}
              >
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', marginBottom: '6px' }}>
                    <span style={{ fontWeight: '700', fontSize: '0.875rem', color: '#1e293b' }}>
                      {s.name}
                    </span>
                    <span
                      style={{
                        fontSize: '0.6875rem',
                        fontWeight: '700',
                        padding: '2px 6px',
                        borderRadius: '6px',
                        backgroundColor: isEligible ? '#dcfce7' : '#e2e8f0',
                        color: isEligible ? '#15803d' : '#64748b',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {isEligible ? 'ELIGIBLE' : 'AVAILABLE'}
                    </span>
                  </div>

                  <span style={{ fontSize: '0.75rem', color: '#64748b', display: 'block', marginBottom: '8px' }}>
                    {s.category}
                  </span>

                  <p style={{ margin: '0 0 8px', fontSize: '0.8125rem', color: '#334155' }}>
                    {s.match_reason}
                  </p>

                  <div style={{ fontSize: '0.75rem', color: '#047857', fontWeight: '600', marginBottom: '8px' }}>
                    Benefits: {s.benefits}
                  </div>

                  {s.claim_window && (
                    <div style={{ fontSize: '0.75rem', color: '#b45309', marginBottom: '8px', backgroundColor: '#fef3c7', padding: '4px 6px', borderRadius: '4px' }}>
                      ⏳ <strong>Claim Window:</strong> {s.claim_window}
                    </div>
                  )}

                  {isExpanded && (
                    <div style={{ marginTop: '10px', borderTop: '1px solid #cbd5e1', paddingTop: '10px' }}>
                      <div style={{ fontSize: '0.75rem', fontWeight: '600', color: '#1e293b', marginBottom: '4px' }}>
                        Required Documents:
                      </div>
                      <ul style={{ margin: '0 0 8px', paddingLeft: '16px', fontSize: '0.75rem', color: '#475569' }}>
                        {s.required_documents?.map((doc, dIdx) => (
                          <li key={dIdx}>{doc}</li>
                        ))}
                      </ul>

                      <div style={{ fontSize: '0.75rem', fontWeight: '600', color: '#1e293b', marginBottom: '2px' }}>
                        AEO Action Required:
                      </div>
                      <p style={{ margin: 0, fontSize: '0.75rem', color: '#0369a1' }}>
                        {s.aeo_action_required}
                      </p>
                    </div>
                  )}
                </div>

                <div style={{ marginTop: '10px', display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    onClick={() => setExpandedScheme(isExpanded ? null : s.id)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#0284c7',
                      fontSize: '0.75rem',
                      fontWeight: '600',
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  >
                    {isExpanded ? 'Show Less ▲' : 'View Checklist & Instructions ▼'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
