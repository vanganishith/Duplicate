import React, { useState, useEffect } from 'react';
import { sendCaseMessage, getCaseMessages } from '../services/api';

/**
 * Two-way Case Communication Component (Officer <-> Farmer)
 */
export default function CaseCommunicationSection({ incident, officerSession }) {
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [msgType, setMsgType] = useState('TEXT'); // 'TEXT' | 'ADVISORY' | 'FOLLOW_UP_REQUEST'
  const [sending, setSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const farmer = incident?.farmer || {};
  const farmerName = farmer.name || 'Farmer';
  const officerName = officerSession?.name || 'Srinivas Rao (AEO)';
  const officerId = officerSession?.officer_id || 'AEO001';

  // Load existing communications
  useEffect(() => {
    if (incident?.communications && Array.isArray(incident.communications)) {
      setMessages(incident.communications);
    } else if (incident?.id && typeof getCaseMessages === 'function') {
      try {
        const resPromise = getCaseMessages(incident.id);
        if (resPromise && typeof resPromise.then === 'function') {
          resPromise
            .then((res) => {
              if (res?.messages) setMessages(res.messages);
            })
            .catch(() => {});
        }
      } catch {}
    }
  }, [incident]);

  const handleSend = async (e) => {
    e.preventDefault();
    if (!newMessage.trim() || sending) return;

    const outgoing = {
      id: `tmp-${Date.now()}`,
      timestamp: new Date().toISOString(),
      sender_type: 'OFFICER',
      sender_id: officerId,
      sender_name: officerName,
      message: newMessage.trim(),
      message_type: msgType,
      read: false,
    };

    // Optimistic UI update
    setMessages((prev) => [...prev, outgoing]);
    const sentText = newMessage.trim();
    setNewMessage('');

    try {
      setSending(true);
      setErrorMsg('');
      const res = await sendCaseMessage({
        incidentId: incident.id,
        senderType: 'OFFICER',
        senderId: officerId,
        senderName: officerName,
        message: sentText,
        messageType: msgType,
      });
      if (res?.communications) {
        setMessages(res.communications);
      }
    } catch (err) {
      setErrorMsg('Failed to deliver message. Please retry.');
      console.error(err);
    } finally {
      setSending(false);
    }
  };

  const insertTemplate = (templateText, type = 'TEXT') => {
    setNewMessage(templateText);
    setMsgType(type);
  };

  return (
    <div
      className="case-communication-section"
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
            💬 Direct Farmer Communication Thread
          </h4>
          <p style={{ margin: '2px 0 0', fontSize: '0.8125rem', color: '#64748b' }}>
            Two-way case messaging with <strong>{farmerName}</strong> ({farmer.phone || 'Phone registered'})
          </p>
        </div>
        <span style={{ fontSize: '0.8125rem', color: '#64748b', backgroundColor: '#f1f5f9', padding: '4px 8px', borderRadius: '6px' }}>
          {messages.length} messages
        </span>
      </div>

      {errorMsg && (
        <div style={{ backgroundColor: '#fef2f2', color: '#dc2626', padding: '8px 12px', borderRadius: '6px', fontSize: '0.8125rem', marginBottom: '12px' }}>
          ⚠️ {errorMsg}
        </div>
      )}

      {/* Messages Scroll Area */}
      <div
        style={{
          maxHeight: '320px',
          overflowY: 'auto',
          backgroundColor: '#f8fafc',
          borderRadius: '8px',
          padding: '14px',
          border: '1px solid #e2e8f0',
          marginBottom: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        {messages.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '24px', color: '#94a3b8', fontSize: '0.875rem' }}>
            No previous messages for this case. Dispatch the first advisory or request a follow-up photo below.
          </div>
        ) : (
          messages.map((m, idx) => {
            const isOfficer = m.sender_type === 'OFFICER';
            return (
              <div
                key={m.id || idx}
                style={{
                  alignSelf: isOfficer ? 'flex-end' : 'flex-start',
                  maxWidth: '82%',
                  backgroundColor: isOfficer ? '#1e293b' : '#ffffff',
                  color: isOfficer ? '#ffffff' : '#1e293b',
                  borderRadius: isOfficer ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                  padding: '10px 14px',
                  boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)',
                  border: isOfficer ? 'none' : '1px solid #e2e8f0',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                  <span
                    style={{
                      fontSize: '0.75rem',
                      fontWeight: '700',
                      color: isOfficer ? '#93c5fd' : '#16a34a',
                    }}
                  >
                    {isOfficer ? `🏛️ ${m.sender_name || 'AEO Officer'}` : `🌾 ${m.sender_name || farmerName}`}
                  </span>
                  {m.message_type && m.message_type !== 'TEXT' && (
                    <span
                      style={{
                        fontSize: '0.6875rem',
                        padding: '1px 5px',
                        borderRadius: '4px',
                        backgroundColor: isOfficer ? '#334155' : '#f1f5f9',
                        color: isOfficer ? '#cbd5e1' : '#475569',
                      }}
                    >
                      {m.message_type}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: '0.875rem', lineHeight: '1.45', whiteSpace: 'pre-wrap' }}>
                  {m.message}
                </div>
                <div
                  style={{
                    fontSize: '0.6875rem',
                    color: isOfficer ? '#94a3b8' : '#94a3b8',
                    textAlign: 'right',
                    marginTop: '4px',
                  }}
                >
                  {m.timestamp ? new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Quick response templates */}
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '10px' }}>
        <button
          type="button"
          onClick={() =>
            insertTemplate(
              'Please apply the prescribed bio-fungicide within 24 hours. Ensure leaves are dry before spraying.',
              'ADVISORY'
            )
          }
          style={{
            fontSize: '0.75rem',
            padding: '3px 8px',
            borderRadius: '4px',
            border: '1px solid #cbd5e1',
            background: '#ffffff',
            cursor: 'pointer',
            color: '#475569',
          }}
        >
          + Spray Reminder
        </button>
        <button
          type="button"
          onClick={() =>
            insertTemplate(
              'Please take and submit a clear photo of the leaf underside in 3 days so we can review recovery.',
              'FOLLOW_UP_REQUEST'
            )
          }
          style={{
            fontSize: '0.75rem',
            padding: '3px 8px',
            borderRadius: '4px',
            border: '1px solid #cbd5e1',
            background: '#ffffff',
            cursor: 'pointer',
            color: '#475569',
          }}
        >
          + Request Follow-up Photo
        </button>
        <button
          type="button"
          onClick={() =>
            insertTemplate(
              'I will be visiting your village tomorrow for an on-site field inspection. Please be available near your field.',
              'VISIT_NOTIFICATION'
            )
          }
          style={{
            fontSize: '0.75rem',
            padding: '3px 8px',
            borderRadius: '4px',
            border: '1px solid #cbd5e1',
            background: '#ffffff',
            cursor: 'pointer',
            color: '#475569',
          }}
        >
          + Field Visit Notice
        </button>
      </div>

      {/* Message Input Form */}
      <form onSubmit={handleSend} style={{ display: 'flex', gap: '8px' }}>
        <input
          type="text"
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          placeholder={`Type message to ${farmerName}...`}
          style={{
            flex: 1,
            padding: '10px 14px',
            borderRadius: '8px',
            border: '1px solid #cbd5e1',
            fontSize: '0.875rem',
            boxSizing: 'border-box',
          }}
        />
        <button
          type="submit"
          disabled={sending || !newMessage.trim()}
          style={{
            padding: '10px 18px',
            backgroundColor: '#0284c7',
            color: '#ffffff',
            border: 'none',
            borderRadius: '8px',
            fontSize: '0.875rem',
            fontWeight: '600',
            cursor: sending || !newMessage.trim() ? 'not-allowed' : 'pointer',
          }}
        >
          {sending ? 'Sending...' : 'Send Message'}
        </button>
      </form>
    </div>
  );
}
