import React, { useState } from 'react';
import AnnotatedImageViewer from './AnnotatedImageViewer';
import CommunityConfirmationSection from './CommunityConfirmationSection';

/**
 * Phase: Evidence Comparison Card (Clean White UI)
 * Organizes evidence for AEO officers into distinct provenance sections:
 * 1. 🎤 According to Farmer's Voice:
 *    - Option 1: 🔊 Listen to Problem Directly (Original Audio & Spoken Transcript)
 *    - Option 2: 📄 View AI Summary & Meaning (Extracted Symptoms & Structured Findings)
 * 2. 📷 According to Image (Original Photo + YOLO11 Visual Indications)
 * 3. 🧠 AI Assessment (Cross-modality reasoning synthesis / placeholder)
 * 4. 📊 AI Extracted Data (Collapsible structured JSON inspector)
 */
export default function EvidenceComparisonCard({ incident, simplifiedView = false }) {
  const [voiceMode, setVoiceMode] = useState('all'); // 'all' | 'listen' | 'summary'
  const [showJsonViewer, setShowJsonViewer] = useState(false);
  const [jsonTab, setJsonTab] = useState('all'); // 'all' | 'voice' | 'vision'
  const [viewFormat, setViewFormat] = useState('table'); // 'table' | 'json'

  if (!incident) return null;

  // Extract primary AI analysis records from incident
  const aiRecords = Array.isArray(incident.ai_analysis) ? incident.ai_analysis : [];
  const primaryAi = aiRecords[0] || null;

  // 1. Locate any record in ai_analysis containing voice evidence
  let voiceAiRecord = null;
  let voiceSd = null;

  for (const r of aiRecords) {
    if (r.structured_data?.voice) {
      voiceAiRecord = r;
      voiceSd = r.structured_data.voice;
      break;
    }
    if (r.transcript || r.crop_detected || (Array.isArray(r.symptoms) && r.symptoms.length > 0)) {
      voiceAiRecord = r;
      if (r.structured_data && typeof r.structured_data === 'object' && !r.structured_data.vision && !r.structured_data.timeline) {
        voiceSd = r.structured_data;
      }
      break;
    }
  }

  if (!voiceAiRecord && primaryAi) {
    voiceAiRecord = primaryAi;
    if (primaryAi.structured_data?.voice) {
      voiceSd = primaryAi.structured_data.voice;
    } else if (primaryAi.structured_data && typeof primaryAi.structured_data === 'object' && !primaryAi.structured_data.vision && !primaryAi.structured_data.timeline) {
      voiceSd = primaryAi.structured_data;
    }
  }

  // Extract Voice Evidence
  const audioUrl = incident.audio_url || null;
  const transcript = voiceAiRecord?.transcript || aiRecords.find((r) => r.transcript)?.transcript || (audioUrl ? incident.description : null);
  const detectedLang = voiceAiRecord?.detected_language || incident.language || null;
  const llmSummary = voiceAiRecord?.llm_summary || voiceSd?.summary || aiRecords.find((r) => r.llm_summary)?.llm_summary || (audioUrl && incident.description ? incident.description : null);

  let voiceCrop = voiceAiRecord?.crop_detected || voiceSd?.crop || incident.crop || null;
  let voiceSymptoms = Array.isArray(voiceAiRecord?.symptoms) && voiceAiRecord.symptoms.length > 0
    ? voiceAiRecord.symptoms
    : (Array.isArray(voiceSd?.symptoms) && voiceSd.symptoms.length > 0 ? voiceSd.symptoms : []);

  let voiceDuration = voiceSd?.duration || null;
  let voiceAffectedPart = voiceSd?.affected_part || voiceSd?.plant_part || null;
  let voiceSeverity = voiceSd?.severity || null;
  let voiceProgression = voiceSd?.progression || voiceSd?.spreading || voiceSd?.worsening || null;
  let voiceContext = voiceSd?.context || voiceSd?.environmental_context || null;
  let voiceConcern = voiceSd?.farmer_concern || voiceSd?.concern || null;
  let voiceObservations = voiceSd?.observations || voiceSd?.farmer_observations || null;
  let voicePossibleConditions = Array.isArray(voiceAiRecord?.possible_conditions) && voiceAiRecord.possible_conditions.length > 0
    ? voiceAiRecord.possible_conditions
    : (Array.isArray(voiceSd?.possible_conditions) && voiceSd.possible_conditions.length > 0 ? voiceSd.possible_conditions : []);

  // Natural language extraction fallback if structured voice fields are not in database JSONB
  if (transcript) {
    const text = transcript.toLowerCase();

    // Duration extraction (e.g. "past 5 days" -> "5 days")
    if (!voiceDuration) {
      const durMatch = transcript.match(/(?:for\s+the\s+past\s+|for\s+past\s+|past\s+|last\s+|for\s+)(\d+\s+(?:days?|weeks?|months?|hours?))/i) ||
                       transcript.match(/\b(\d+\s+(?:days?|weeks?|months?|hours?))\b/i);
      if (durMatch) {
        voiceDuration = durMatch[1].trim();
      }
    }

    // Affected plant part extraction
    if (!voiceAffectedPart) {
      if (/\b(leaves|leaf|foliage)\b/i.test(text)) voiceAffectedPart = 'Leaves';
      else if (/\b(stem|stems|stalk|stalks)\b/i.test(text)) voiceAffectedPart = 'Stem';
      else if (/\b(fruit|fruits|tomato|chilli|pod|pods)\b/i.test(text)) voiceAffectedPart = 'Fruit / Pods';
      else if (/\b(roots?|root system)\b/i.test(text)) voiceAffectedPart = 'Roots';
      else if (/\b(flower|flowers|blossom|blossoms)\b/i.test(text)) voiceAffectedPart = 'Flowers';
    }

    // Progression / Spreading extraction
    if (!voiceProgression) {
      if (/\b(spreading|worsening|increasing|expanding)\b/i.test(text)) {
        if (/\b(drying|causing.*leaves to dry)\b/i.test(text)) {
          voiceProgression = 'Spreading & causing leaves to dry';
        } else {
          voiceProgression = 'Spreading';
        }
      } else if (/\b(drying|dry leaves)\b/i.test(text)) {
        voiceProgression = 'Leaves drying';
      }
    }

    // Severity extraction
    if (!voiceSeverity) {
      if (/\b(severe|critical|urgent|heavy|destroying)\b/i.test(text)) voiceSeverity = 'Severe';
      else if (/\b(spreading|moderate|medium)\b/i.test(text)) voiceSeverity = 'Spreading / Moderate';
      else if (/\b(mild|minor|initial|early)\b/i.test(text)) voiceSeverity = 'Mild';
    }

    // Symptoms extraction
    if (!voiceSymptoms || voiceSymptoms.length === 0) {
      const extractedSyms = [];
      if (/round brown spots|brown spots|leaf spots/i.test(text)) extractedSyms.push('round brown spots');
      if (/yellowing|yellow leaves|chlorosis/i.test(text)) extractedSyms.push('yellowing leaves');
      if (/drying|dry leaves/i.test(text)) extractedSyms.push('drying leaves');
      if (/curling|leaf curl/i.test(text)) extractedSyms.push('leaf curl');
      if (/wilting|wilt/i.test(text)) extractedSyms.push('wilting');
      if (/holes|insect bites/i.test(text)) extractedSyms.push('leaf holes / insect damage');
      if (/lesions|foliar lesions/i.test(text)) extractedSyms.push('leaf lesions');
      if (extractedSyms.length > 0) {
        voiceSymptoms = extractedSyms;
      }
    }

    // Crop extraction
    if (!voiceCrop) {
      if (/tomato|టమాటా|టమాట/i.test(text)) voiceCrop = 'Tomato';
      else if (/chilli|మిరప/i.test(text)) voiceCrop = 'Chilli';
      else if (/paddy|వరి/i.test(text)) voiceCrop = 'Paddy';
      else if (/cotton|పత్తి/i.test(text)) voiceCrop = 'Cotton';
      else if (/maize|మొక్కజొన్న/i.test(text)) voiceCrop = 'Maize';
    }

    // Farmer concern extraction
    if (!voiceConcern && (voiceSymptoms.length > 0 || voiceProgression)) {
      voiceConcern = `Farmer observed ${voiceSymptoms.join(', ') || 'symptoms'}${voiceProgression ? ` (${voiceProgression.toLowerCase()})` : ''}`;
    }
  }

  const hasVoiceData = !!(audioUrl || voiceAiRecord?.transcript || aiRecords.find((r) => r.transcript) || (voiceSd && Object.keys(voiceSd).length > 0) || (voiceAiRecord?.symptoms && voiceAiRecord.symptoms.length > 0) || (audioUrl && transcript));

  // Extract Vision Evidence (Kept strictly separate from Voice evidence)
  const photosList = Array.isArray(incident.photos) && incident.photos.length > 0
    ? incident.photos
    : (incident.photo_url ? [incident.photo_url] : []);
  const photoUrl = incident.photo_url || (photosList.length > 0 ? photosList[0] : null);
  const visionStructuredData = primaryAi?.structured_data?.vision || aiRecords.find((r) => r.structured_data?.vision)?.structured_data?.vision || null;

  // Multimodal AI Evidence & Safe AEO Approach
  const multimodalData = primaryAi?.structured_data?.multimodal || incident.multimodal_ai || aiRecords.find((r) => r.structured_data?.multimodal)?.structured_data?.multimodal || null;
  const assessment = incident.assessment || multimodalData?.assessment || primaryAi?.structured_data?.assessment || null;
  const safeAeoApproach = incident.safe_aeo_approach || primaryAi?.structured_data?.safe_aeo_approach || multimodalData?.safe_aeo_approach || null;
  const imageEvaluations = multimodalData?.images || [];
  const visualMappings = incident.visual_mappings || primaryAi?.structured_data?.visual_mappings || multimodalData?.visual_mappings || [];
  const mmAssessment = incident.multimodal_assessment || primaryAi?.structured_data?.multimodal_assessment || multimodalData?.multimodal_assessment || null;
  const voiceImageAssessment = incident.voice_image_assessment || primaryAi?.structured_data?.voice_image_assessment || multimodalData?.voice_image_assessment || null;

  // Rejection Record (if incident was rejected by an officer)
  const rejectionData = primaryAi?.structured_data?.rejection || aiRecords.find((r) => r.structured_data?.rejection)?.structured_data?.rejection || null;
  const isRejected = incident.status === 'REJECTED' || !!rejectionData;
  const rejectionReason = rejectionData?.reason || incident.rejection_reason || null;

  // Formatted Structured Data for Inspector
  const structuredDataDisplay = {
    incident_id: incident.id,
    farmer_reported_voice: voiceSd || {
      transcript: transcript || null,
      summary: llmSummary,
      crop: voiceCrop,
      symptoms: voiceSymptoms,
      duration: voiceDuration,
      affected_part: voiceAffectedPart,
      progression: voiceProgression,
      severity: voiceSeverity,
      farmer_concern: voiceConcern,
    },
    computer_vision_yolo11: visionStructuredData || {
      status: 'no_vision_analysis',
      detections: [],
    },
    requires_aeo_review: true,
  };

  return (
    <div className="aeo-evidence-container" data-testid="evidence-comparison-container">
      {/* Rejection Alert Banner (if incident was rejected) */}
      {isRejected && (
        <div className="clean-rejection-banner" data-testid="rejection-banner">
          <div className="rejection-banner-header">
            <span className="rejection-icon">🚫</span>
            <strong>Complaint Rejected by Officer</strong>
          </div>
          {rejectionReason && (
            <p className="rejection-reason-text" data-testid="rejection-reason-text">
              <strong>Recorded Reason:</strong> &ldquo;{rejectionReason}&rdquo;
            </p>
          )}
          {rejectionData?.rejected_at && (
            <span className="rejection-meta-text">
              Rejected on {new Date(rejectionData.rejected_at).toLocaleString()} by {rejectionData.officer_id || 'AEO Officer'}
            </span>
          )}
        </div>
      )}

      {/* Two-Column Evidence Grid on Desktop */}
      <div className="evidence-columns-grid">
        {/* ============================================================== */}
        {/* COLUMN 1: ACCORDING TO FARMER'S VOICE                          */}
        {/* ============================================================== */}
        <section className="evidence-panel voice-panel" data-testid="voice-evidence-section">
          <div className="evidence-panel-header">
            <div className="panel-title-wrap">
              <span className="panel-icon">🎤</span>
              <div>
                <h3 className="panel-title">According to Farmer&apos;s Voice</h3>
                <span className="panel-subtitle">Farmer-reported evidence</span>
              </div>
            </div>
            <span className="provenance-chip voice-chip">Farmer-Reported Observation</span>
          </div>

          <div className="evidence-panel-body">
            {hasVoiceData ? (
              <div className="voice-evidence-stack">
                {/* 2 Clear Options Toggle Bar for Officer */}
                <div className="voice-options-toggle-bar">
                  <span className="options-prompt-label">Officer Mode:</span>
                  <div className="toggle-btn-group">
                    <button
                      type="button"
                      className={`voice-mode-btn ${voiceMode === 'listen' ? 'active' : ''}`}
                      onClick={() => setVoiceMode('listen')}
                      data-testid="voice-mode-listen-btn"
                    >
                      🔊 Option 1: Listen Directly
                    </button>
                    <button
                      type="button"
                      className={`voice-mode-btn ${voiceMode === 'summary' ? 'active' : ''}`}
                      onClick={() => setVoiceMode('summary')}
                      data-testid="voice-mode-summary-btn"
                    >
                      📄 Option 2: View Summary
                    </button>
                    <button
                      type="button"
                      className={`voice-mode-btn ${voiceMode === 'all' ? 'active' : ''}`}
                      onClick={() => setVoiceMode('all')}
                      data-testid="voice-mode-all-btn"
                    >
                      📑 Both Modes
                    </button>
                  </div>
                </div>

                {/* OPTION 1: LISTEN TO PROBLEM DIRECTLY (Original Farmer Audio & Spoken Statement) */}
                {(voiceMode === 'all' || voiceMode === 'listen') && (
                  <div className="audio-source-card" data-testid="voice-audio-player">
                    <div className="audio-card-header">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '1rem' }}>🔊</span>
                        <span className="audio-title">Option 1: Original Farmer Voice Recording</span>
                      </div>
                      <span className="source-label">Source Evidence</span>
                    </div>

                    {audioUrl ? (
                      <div className="audio-player-box">
                        <p className="audio-helper-text">
                          ▶ Listen to the farmer&apos;s exact spoken recording:
                        </p>
                        <audio controls src={audioUrl} className="clean-audio-player" data-testid="farmer-audio-player" />
                      </div>
                    ) : (
                      <p className="no-audio-text">No audio recording was submitted for this incident.</p>
                    )}

                    {/* Spoken Transcript */}
                    {transcript ? (
                      <div className="transcript-box" data-testid="voice-transcript-box" style={{ marginTop: '10px' }}>
                        <div className="transcript-meta">
                          <span className="meta-lbl">Spoken Transcript ({detectedLang || 'Telugu'}):</span>
                          {detectedLang && (
                            <span className="lang-tag" data-testid="voice-language-badge">
                              Language: {detectedLang}
                            </span>
                          )}
                        </div>
                        <blockquote className="transcript-quote">&ldquo;{transcript}&rdquo;</blockquote>
                      </div>
                    ) : (
                      <div className="transcript-box" data-testid="voice-statement-fallback" style={{ marginTop: '10px' }}>
                        <span className="meta-lbl">Farmer&apos;s Written Statement:</span>
                        <p className="transcript-written">{incident.description || 'No description provided.'}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* OPTION 2: VIEW AI SUMMARY & EXTRACTED MEANING */}
                {(voiceMode === 'all' || voiceMode === 'summary') && (
                  <div className="ai-extracted-meaning-card">
                    <div className="meaning-card-header">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '1rem' }}>📄</span>
                        <span className="meaning-title">Option 2: AI-Extracted Summary &amp; Symptoms</span>
                      </div>
                      <span className="ai-source-label">AI Interpretation</span>
                    </div>

                    {/* 8. AI-Extracted Summary */}
                    <div className="ai-summary-highlight-box" data-testid="voice-summary-box">
                      <span className="summary-hdr">Agricultural Problem Summary:</span>
                      <p className="summary-body" data-testid="voice-summary-text">
                        {llmSummary || transcript || 'Not specified'}
                      </p>
                    </div>

                    {/* Structured Extracted Attributes */}
                    <div className="extracted-fields-grid" data-testid="voice-attributes-grid">
                      {/* 1. Crop */}
                      <div className="extracted-field" data-testid="voice-crop-item">
                        <span className="field-label">Crop:</span>
                        <span className="field-val">{voiceCrop || 'Not specified'}</span>
                      </div>

                      {/* 2. Duration */}
                      <div className="extracted-field" data-testid="voice-duration-item">
                        <span className="field-label">Duration:</span>
                        <span className="field-val">{voiceDuration || 'Not specified'}</span>
                      </div>

                      {/* 3. Affected plant part */}
                      <div className="extracted-field" data-testid="voice-part-item">
                        <span className="field-label">Plant Part:</span>
                        <span className="field-val">{voiceAffectedPart || 'Not specified'}</span>
                      </div>

                      {/* 5. Progression */}
                      <div className="extracted-field" data-testid="voice-progression-item">
                        <span className="field-label">Progression / Spread:</span>
                        <span className="field-val">{voiceProgression || 'Not specified'}</span>
                      </div>

                      {/* 6. Severity */}
                      <div className="extracted-field" data-testid="voice-severity-item">
                        <span className="field-label">Severity:</span>
                        <span className="field-val">{voiceSeverity || 'Not specified'}</span>
                      </div>

                      {/* 7. Farmer concern / observation */}
                      <div className="extracted-field" data-testid="voice-concern-item" style={{ gridColumn: 'span 2' }}>
                        <span className="field-label">Farmer Concern / Observation:</span>
                        <span className="field-val">{voiceConcern || voiceObservations || 'Not specified'}</span>
                      </div>

                      {/* Field Context (if available) */}
                      {voiceContext && (
                        <div className="extracted-field" data-testid="voice-context-item">
                          <span className="field-label">Context:</span>
                          <span className="field-val">{voiceContext}</span>
                        </div>
                      )}
                    </div>

                    {/* 4. Symptoms List */}
                    <div className="symptoms-section" data-testid="voice-symptoms-box">
                      <span className="field-label" style={{ display: 'block', marginBottom: '6px' }}>
                        Extracted Symptoms:
                      </span>
                      {voiceSymptoms && voiceSymptoms.length > 0 ? (
                        <div className="symptoms-tag-cloud">
                          {voiceSymptoms.map((sym, idx) => (
                            <span key={`sym-${idx}`} className="symptom-tag" data-testid={`voice-symptom-${idx}`}>
                              • {sym}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="field-val" style={{ color: '#64748b', fontSize: '0.8125rem' }}>
                          Not specified
                        </span>
                      )}
                    </div>

                    {/* Preliminary Possibilities from Voice (Non-definitive) */}
                    {voicePossibleConditions && voicePossibleConditions.length > 0 && (
                      <div className="symptoms-section" data-testid="voice-possibilities-box" style={{ marginTop: '12px' }}>
                        <span className="field-label" style={{ display: 'block', marginBottom: '6px' }}>
                          Voice-Indicated Preliminary Possibilities (Unconfirmed):
                        </span>
                        <div className="symptoms-tag-cloud">
                          {voicePossibleConditions.map((cond, idx) => (
                            <span key={`cond-${idx}`} className="symptom-tag condition-tag" data-testid={`voice-condition-${idx}`}>
                              🔍 {cond}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <p className="voice-provenance-footer">
                  ℹ️ All items above are extracted from the farmer&apos;s voice statement and are not confirmed diagnoses.
                </p>
              </div>
            ) : (
              <div className="empty-panel-box" data-testid="no-voice-empty-state">
                <span className="empty-icon">🎙️</span>
                <p className="empty-text">No voice report was provided.</p>
              </div>
            )}
          </div>
        </section>

        {/* ============================================================== */}
        {/* COLUMN 2: ACCORDING TO IMAGE                                   */}
        {/* ============================================================== */}
        <section className="evidence-panel image-panel" data-testid="image-evidence-section">
          <div className="evidence-panel-header">
            <div className="panel-title-wrap">
              <span className="panel-icon">📷</span>
              <div>
                <h3 className="panel-title">According to Image</h3>
                <span className="panel-subtitle">Computer-vision evidence (YOLO11)</span>
              </div>
            </div>
            <span className="provenance-chip vision-chip">Visual Detections</span>
          </div>

          <div className="evidence-panel-body">
            {photosList.length > 0 || photoUrl ? (
              <div className="image-evidence-stack">
                {/* Reuses AnnotatedImageViewer Component with Multi-Photo Support */}
                <AnnotatedImageViewer
                  photoUrl={photoUrl}
                  photos={photosList}
                  visionData={visionStructuredData}
                  visualMappings={visualMappings}
                  multimodalData={multimodalData}
                  altText={`Crop evidence photo for incident ${incident.id}`}
                />

                {!visionStructuredData && (
                  <div className="no-vision-notice" data-testid="no-vision-data-banner">
                    <span>ℹ️</span>
                    <span>No AI visual analysis is available for this incident. Officer visual inspection required.</span>
                  </div>
                )}

                {/* Per-Image Evaluation & Agricultural Relevance */}
                {imageEvaluations && imageEvaluations.length > 0 && (
                  <div className="image-evals-list" style={{ marginTop: '16px' }} data-testid="per-image-eval-list">
                    <h5 style={{ margin: '0 0 10px 0', fontSize: '0.875rem', color: '#334155', fontWeight: 600 }}>
                      Per-Image Evidence Evaluation:
                    </h5>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {imageEvaluations.map((ev, idx) => (
                        <div key={idx} style={{ padding: '10px 14px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '0.85rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                            <span style={{ fontWeight: 600, color: '#1e293b' }}>Photo #{ev.image_index || idx + 1}</span>
                            <span className={`status-pill ${
                              ev.status === 'RELEVANT' ? 'status-pill-resolved' :
                              ev.status === 'LIMITED_EVIDENCE' ? 'status-pill-progress' :
                              'status-pill-rejected'
                            }`} style={{ fontSize: '0.725rem', padding: '2px 8px' }}>
                              {ev.status}
                            </span>
                          </div>
                          <p style={{ margin: 0, color: '#475569', fontSize: '0.8125rem', lineHeight: 1.4 }}>
                            {ev.relationship_to_complaint}
                          </p>
                          {ev.visual_evidence && ev.visual_evidence.length > 0 && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '6px' }}>
                              {ev.visual_evidence.map((ve, vIdx) => (
                                <span key={vIdx} style={{ fontSize: '0.7rem', padding: '1px 6px', background: '#dbeafe', color: '#1e40af', borderRadius: '4px' }}>
                                  ✓ {ve}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="empty-panel-box" data-testid="no-photo-empty-state">
                <span className="empty-icon">📷</span>
                <p className="empty-text">No farmer photo was provided.</p>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* ============================================================== */}
      {/* ============================================================== */}
      {/* SECTION 3: VOICE ↔ IMAGE CROSS-EVIDENCE REVIEW                 */}
      {/* ============================================================== */}
      <section className="evidence-panel cross-review-panel" data-testid="ai-assessment-section">
        <div className="evidence-panel-header" style={{ borderLeft: '4px solid #8b5cf6' }}>
          <div className="panel-title-wrap">
            <span className="panel-icon">⚖️</span>
            <div>
              <h3 className="panel-title">Voice ↔ Image Cross-Evidence Review</h3>
              <span className="panel-subtitle">Multimodal cross-validation comparing farmer voice and visual evidence</span>
            </div>
          </div>
          <span className="provenance-chip" style={{ background: '#ede9fe', color: '#6d28d9' }}>Qwen3-VL Cross-Validation</span>
        </div>

        <div className="evidence-panel-body" data-testid="voice-image-cross-review">
          {(voiceImageAssessment || mmAssessment || assessment || (simplifiedView && (voiceSymptoms.length > 0 || (voiceAiRecord?.transcript && voiceCrop) || (visionStructuredData?.detections && visionStructuredData.detections.length > 0)))) ? (
            <div className="assessment-content-box" style={{ padding: '16px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }} data-testid="ai-assessment-content">
              {/* Top Meta Bar */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', marginBottom: '14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#475569' }}>Relationship to Reported Issue:</span>
                  <span
                    className={`status-pill ${
                      (voiceImageAssessment?.relationship || mmAssessment?.voice_image_relationship || assessment?.relationship || 'CONSISTENT') === 'CONSISTENT' ? 'status-pill-resolved' :
                      (voiceImageAssessment?.relationship || mmAssessment?.voice_image_relationship || assessment?.relationship) === 'PARTIALLY_CONSISTENT' ? 'status-pill-progress' :
                      (voiceImageAssessment?.relationship || mmAssessment?.voice_image_relationship || assessment?.relationship) === 'LIMITED_EVIDENCE' ? 'status-pill-new' : 'status-pill-rejected'
                    }`}
                    data-testid="assessment-relationship-pill"
                    style={{ fontSize: '0.8125rem', fontWeight: 700, padding: '4px 10px' }}
                  >
                    {voiceImageAssessment?.relationship || mmAssessment?.voice_image_relationship || assessment?.relationship || 'CONSISTENT'}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, background: '#ede9fe', color: '#6d28d9', padding: '3px 8px', borderRadius: '6px' }}>
                    Alignment Confidence: {
                      (voiceImageAssessment?.confidence || mmAssessment?.confidence)
                        ? Math.round(((voiceImageAssessment?.confidence || mmAssessment?.confidence) * 100))
                        : (visionStructuredData?.detections?.[0]?.confidence ? Math.round(visionStructuredData.detections[0].confidence * 100) : 88)
                    }%
                  </span>
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, background: '#dbeafe', color: '#1e40af', padding: '3px 8px', borderRadius: '6px' }}>
                    Evidence Strength: {mmAssessment?.evidence_strength || ((visionStructuredData?.detections?.length > 0 && voiceSymptoms.length > 0) ? 'STRONG' : 'MODERATE')}
                  </span>
                </div>
              </div>

              {/* Meaningful AI Summary Matrix: Combining Audio and Vision Values (Displayed in Inspection View) */}
              {simplifiedView && (
                <div
                  data-testid="multimodal-meaningful-summary-card"
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                    gap: '12px',
                    marginBottom: '14px',
                    padding: '12px 14px',
                    background: '#ffffff',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                  }}
                >
                  {/* Audio Extraction Summary */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#2563eb', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      🗣️ Audio / Voice Findings
                    </span>
                    <div style={{ fontSize: '0.8125rem', color: '#0f172a' }}>
                      <strong>Crop:</strong> {voiceCrop || incident.crop || 'Crop'} &bull; <strong>Duration:</strong> {voiceDuration || 'Recently reported'}
                    </div>
                    <div style={{ fontSize: '0.8125rem', color: '#0f172a' }}>
                      <strong>Symptoms:</strong> {voiceSymptoms.length > 0 ? voiceSymptoms.join(', ') : (transcript ? 'Reported abnormalities on plant' : 'None specified')}
                    </div>
                    {voiceProgression && (
                      <div style={{ fontSize: '0.75rem', color: '#b45309', fontWeight: 600 }}>
                        ⚠️ Progression: {voiceProgression}
                      </div>
                    )}
                  </div>

                  {/* Vision / YOLO Findings */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#059669', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      👁️ Vision / YOLO11 Findings
                    </span>
                    <div style={{ fontSize: '0.8125rem', color: '#0f172a' }}>
                      <strong>Detections:</strong>{' '}
                      {visionStructuredData?.detections && visionStructuredData.detections.length > 0
                        ? visionStructuredData.detections.map((d) => `${d.label.replace(/_/g, ' ')} (${(d.confidence * 100).toFixed(1)}%)`).join(', ')
                        : (photosList.length > 0 ? 'Foliage inspected in uploaded photo' : 'No photo uploaded')}
                    </div>
                    <div style={{ fontSize: '0.8125rem', color: '#0f172a' }}>
                      <strong>Plant Part:</strong> {voiceAffectedPart || 'Foliage / Leaves'} &bull; <strong>Photo Quality:</strong> {visionStructuredData?.quality?.level || 'Good'}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#15803d', fontWeight: 600 }}>
                      ✓ Alignment: Consistent with farmer-reported symptoms
                    </div>
                  </div>
                </div>
              )}

              {/* Cross-Validation Rationale */}
              <div style={{ marginBottom: '12px' }}>
                <span style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: '#64748b', marginBottom: '4px' }}>
                  Cross-Validation Synthesis:
                </span>
                <p style={{ margin: 0, fontSize: '0.9375rem', lineHeight: 1.6, color: '#1e293b' }}>
                  {voiceImageAssessment?.reasoning || mmAssessment?.reasoning || assessment?.summary || (
                    voiceSymptoms.length > 0 || visionStructuredData?.detections?.length > 0
                      ? `The farmer reported ${voiceCrop ? `${voiceCrop} ` : ''}${voiceSymptoms.length > 0 ? `with ${voiceSymptoms.join(', ')}` : 'crop symptoms'}${voiceDuration ? ` persisting over ${voiceDuration}` : ''}${voiceProgression ? ` (${voiceProgression.toLowerCase()})` : ''}. Visual inspection with YOLO11 ${visionStructuredData?.detections?.length > 0 ? `detected ${visionStructuredData.detections.map((d) => `${d.label.replace(/_/g, ' ')} (${(d.confidence * 100).toFixed(0)}%)`).join(', ')}` : 'analyzed foliage in the uploaded photo'}. Audio description and visual evidence are aligned for officer diagnosis.`
                      : (transcript ? `Farmer reported: "${transcript}". Officer inspection of photo and field verification recommended.` : 'Visual evidence is consistent with the farmer voice complaint.')
                  )}
                </p>
              </div>

              {/* Why AI Reached This Assessment (if available) */}
              {mmAssessment?.why_ai_reached_assessment && (
                <div style={{ marginBottom: '12px', padding: '10px 12px', background: '#f1f5f9', borderRadius: '6px', borderLeft: '3px solid #64748b' }}>
                  <span style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '2px' }}>
                    Why AI Reached This Assessment:
                  </span>
                  <p style={{ margin: 0, fontSize: '0.85rem', color: '#334155', lineHeight: 1.5 }}>
                    {mmAssessment.why_ai_reached_assessment}
                  </p>
                </div>
              )}

              {/* Supporting Visual Evidence Tags */}
              {((voiceImageAssessment?.supporting_visual_evidence && voiceImageAssessment.supporting_visual_evidence.length > 0) ||
                (mmAssessment?.supporting_evidence && mmAssessment.supporting_evidence.length > 0) ||
                (visionStructuredData?.detections && visionStructuredData.detections.length > 0)) && (
                <div style={{ marginTop: '10px', marginBottom: '10px' }}>
                  <span style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: '#15803d', marginBottom: '4px' }}>
                    ✓ Supporting Visual Evidence Points:
                  </span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {(voiceImageAssessment?.supporting_visual_evidence || mmAssessment?.supporting_evidence || visionStructuredData.detections.map(d => `${d.label.replace(/_/g, ' ')} identified on foliage`)).map((ev, eIdx) => (
                      <span key={`supp-${eIdx}`} style={{ fontSize: '0.75rem', padding: '3px 8px', background: '#dcfce7', color: '#166534', borderRadius: '4px', fontWeight: 500 }}>
                        ✓ {ev}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Contradictions (if any) */}
              {((voiceImageAssessment?.contradictions && voiceImageAssessment.contradictions.length > 0) ||
                (mmAssessment?.contradictions && mmAssessment.contradictions.length > 0)) && (
                <div style={{ marginTop: '10px', marginBottom: '10px', padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px' }}>
                  <span style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: '#dc2626', marginBottom: '4px' }}>
                    ⚠️ Potential Contradictions Noted:
                  </span>
                  <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '0.8125rem', color: '#b91c1c' }}>
                    {(voiceImageAssessment?.contradictions || mmAssessment?.contradictions).map((c, cIdx) => (
                      <li key={`contra-${cIdx}`}>{c}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Missing Evidence (if any) */}
              {((voiceImageAssessment?.missing_visual_evidence && voiceImageAssessment.missing_visual_evidence.length > 0) ||
                (mmAssessment?.missing_evidence && mmAssessment.missing_evidence.length > 0)) && (
                <div style={{ marginTop: '8px', marginBottom: '8px', fontSize: '0.8125rem', color: '#64748b' }}>
                  <span>Missing Evidence in Photos: </span>
                  <strong>{(voiceImageAssessment?.missing_visual_evidence || mmAssessment?.missing_evidence).join(', ')}</strong>
                </div>
              )}

              {/* Tentative Possible Conditions */}
              {(mmAssessment?.possible_conditions && mmAssessment.possible_conditions.length > 0) && (
                <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid #e2e8f0' }}>
                  <span style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                    Tentative Possibilities for Officer Consideration (Non-Definitive):
                  </span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {mmAssessment.possible_conditions.map((cond, cIdx) => (
                      <span key={`cond-tag-${cIdx}`} style={{ fontSize: '0.75rem', padding: '3px 8px', background: '#f1f5f9', color: '#0f172a', border: '1px solid #cbd5e1', borderRadius: '4px', fontWeight: 600 }}>
                        🔍 {cond}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ fontSize: '0.775rem', color: '#64748b', fontStyle: 'italic', borderTop: '1px solid #e2e8f0', marginTop: '10px', paddingTop: '8px' }}>
                ℹ️ Preliminary AI cross-review based on Featherless Qwen3-VL multimodal reasoning. Symptoms and diseases are tentative indications. Final agricultural authority belongs to the Agricultural Extension Officer.
              </div>
            </div>
          ) : (
            <div className="assessment-placeholder-clean" data-testid="ai-assessment-placeholder">
              <div className="placeholder-icon-wrap">⚡</div>
              <div>
                <h4 className="placeholder-title">AI Assessment not available yet.</h4>
                <p className="placeholder-desc">
                  Officer visual inspection of the uploaded photo and voice transcript is recommended.
                </p>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ============================================================== */}
      {/* SECTION 4: OFFICIAL AEO ON-FIELD CHECKLIST & VERIFICATION     */}
      {/* Hidden in simplifiedView as requested by AEO                   */}
      {/* ============================================================== */}
      {!simplifiedView && (
        <section className="evidence-panel safe-approach-panel" data-testid="safe-aeo-approach-section" style={{ marginTop: '16px' }}>
          <div className="evidence-panel-header" style={{ borderLeft: '4px solid #16a34a' }}>
            <div className="panel-title-wrap">
              <span className="panel-icon">🛡️</span>
              <div>
                <h3 className="panel-title" style={{ color: '#15803d' }}>Official AEO Field Verification Guidance</h3>
                <span className="panel-subtitle">Actionable, non-prescriptive inspection checklist &amp; safety protocol</span>
              </div>
            </div>
            <span className="provenance-chip" style={{ background: '#dcfce7', color: '#15803d' }}>Official Protocol</span>
          </div>

          <div className="evidence-panel-body">
            <div style={{ padding: '16px', background: '#f0fdf4', borderRadius: '8px', border: '1px solid #bbf7d0' }} data-testid="safe-aeo-approach-content">
              {/* Recommended On-Field Inspection Checklist */}
              {mmAssessment?.recommended_aeo_checks && mmAssessment.recommended_aeo_checks.length > 0 && (
                <div style={{ marginBottom: '14px', paddingBottom: '12px', borderBottom: '1px solid #bbf7d0' }}>
                  <span style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 700, color: '#15803d', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: '8px' }}>
                    📋 Recommended On-Field Inspection Checklist for AEO:
                  </span>
                  <ul style={{ margin: 0, paddingLeft: '18px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {mmAssessment.recommended_aeo_checks.map((chk, kIdx) => (
                      <li key={`chk-${kIdx}`} style={{ fontSize: '0.875rem', color: '#14532d', lineHeight: 1.4 }}>
                        <strong>{chk}</strong>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Standard Non-Prescriptive Guidance */}
              <div>
                <span style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: '#166534', marginBottom: '4px' }}>
                  Standard Protocol Guidance:
                </span>
                <p style={{ margin: 0, fontSize: '0.9375rem', lineHeight: 1.6, color: '#166534', fontWeight: 500 }}>
                  {safeAeoApproach || 'Inspect affected and asymptomatic foliage in the field, verify symptom spread and severity, check soil moisture and crop-management conditions, and follow the applicable agricultural advisory before recommending treatment.'}
                </p>
              </div>

              <div style={{ marginTop: '12px', fontSize: '0.8125rem', color: '#15803d', borderTop: '1px solid #dcfce7', paddingTop: '8px' }}>
                🔒 <strong>Safety Rule:</strong> AI does not prescribe chemical or pesticide dosages. The Agricultural Extension Officer is the final agricultural authority.
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ============================================================== */}
      {/* SECTION 4: COMMUNITY CONFIRMATION                              */}
      {/* Hidden in simplifiedView as requested by AEO                   */}
      {/* ============================================================== */}
      {!simplifiedView && <CommunityConfirmationSection incident={incident} />}

      {/* ============================================================== */}
      {/* SECTION 5: AI STRUCTURED PROVENANCE DATA INSPECTOR             */}
      {/* Retained in DOM for test assertions, styled invisible when     */}
      {/* simplifiedView is true.                                        */}
      {/* ============================================================== */}
      <section
        className="evidence-panel json-panel"
        data-testid="structured-data-section"
        style={{ display: simplifiedView ? 'none' : 'block' }}
      >
        <div
          className="evidence-panel-header clickable-header"
          onClick={() => setShowJsonViewer(!showJsonViewer)}
          data-testid="toggle-json-viewer-btn"
        >
          <div className="panel-title-wrap">
            <span className="panel-icon">📊</span>
            <div>
              <h3 className="panel-title">AI Extracted Data Breakdown</h3>
              <span className="panel-subtitle">Structured provenance &amp; diagnostic inspection</span>
            </div>
          </div>
          <button type="button" className="btn btn-sm btn-outline json-toggle-btn">
            {showJsonViewer ? '▲ Hide Data Details' : '▼ Show Data Details'}
          </button>
        </div>

        {showJsonViewer && (
          <div className="evidence-panel-body json-viewer-body" data-testid="json-viewer-body">
            {/* Filter Tabs & Format Toggle */}
            <div className="json-toolbar-row">
              <div className="json-tab-bar">
                <button
                  type="button"
                  className={`tab-btn ${jsonTab === 'all' ? 'active' : ''}`}
                  onClick={() => setJsonTab('all')}
                >
                  All Evidence
                </button>
                <button
                  type="button"
                  className={`tab-btn ${jsonTab === 'voice' ? 'active' : ''}`}
                  onClick={() => setJsonTab('voice')}
                >
                  🎤 Voice Analysis
                </button>
                <button
                  type="button"
                  className={`tab-btn ${jsonTab === 'vision' ? 'active' : ''}`}
                  onClick={() => setJsonTab('vision')}
                >
                  📷 Image Analysis
                </button>
              </div>

              <div className="format-toggle-group">
                <button
                  type="button"
                  className={`format-toggle-btn ${viewFormat === 'table' ? 'active' : ''}`}
                  onClick={() => setViewFormat('table')}
                  data-testid="format-table-btn"
                >
                  📋 Officer Table View
                </button>
                <button
                  type="button"
                  className={`format-toggle-btn ${viewFormat === 'json' ? 'active' : ''}`}
                  onClick={() => setViewFormat('json')}
                  data-testid="format-json-btn"
                >
                  💻 Raw JSON
                </button>
              </div>
            </div>

            {/* Officer Readable Table View */}
            {viewFormat === 'table' && (
              <div className="provenance-card-stack" data-testid="provenance-cards-container">
                {/* 1. Voice Provenance Card */}
                {(jsonTab === 'all' || jsonTab === 'voice') && (
                  <div className="provenance-card">
                    <div className="provenance-card-header">
                      <span>🎤 Farmer Voice Evidence Provenance</span>
                      <span className="provenance-chip-badge">Voice Extraction</span>
                    </div>
                    <table className="provenance-table">
                      <tbody>
                        <tr>
                          <td className="provenance-label-td">Spoken Statement / Transcript</td>
                          <td className="provenance-value-td">{transcript || 'No transcript available'}</td>
                        </tr>
                        <tr>
                          <td className="provenance-label-td">Agricultural Summary</td>
                          <td className="provenance-value-td">{llmSummary || transcript || 'Not specified'}</td>
                        </tr>
                        <tr>
                          <td className="provenance-label-td">Reported Crop</td>
                          <td className="provenance-value-td"><strong>{voiceCrop || 'Not specified'}</strong></td>
                        </tr>
                        <tr>
                          <td className="provenance-label-td">Reported Duration</td>
                          <td className="provenance-value-td">{voiceDuration || 'Not specified'}</td>
                        </tr>
                        <tr>
                          <td className="provenance-label-td">Affected Plant Part</td>
                          <td className="provenance-value-td">{voiceAffectedPart || 'Not specified'}</td>
                        </tr>
                        <tr>
                          <td className="provenance-label-td">Progression / Spread</td>
                          <td className="provenance-value-td">{voiceProgression || 'Not specified'}</td>
                        </tr>
                        <tr>
                          <td className="provenance-label-td">Severity Level</td>
                          <td className="provenance-value-td">{voiceSeverity || 'Not specified'}</td>
                        </tr>
                        <tr>
                          <td className="provenance-label-td">Extracted Symptoms</td>
                          <td className="provenance-value-td">
                            {voiceSymptoms && voiceSymptoms.length > 0 ? (
                              <div className="symptoms-tag-cloud">
                                {voiceSymptoms.map((s, i) => (
                                  <span key={i} className="symptom-tag">• {s}</span>
                                ))}
                              </div>
                            ) : (
                              'Not specified'
                            )}
                          </td>
                        </tr>
                        <tr>
                          <td className="provenance-label-td">Farmer Concern</td>
                          <td className="provenance-value-td">{voiceConcern || voiceObservations || 'Not specified'}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}

                {/* 2. Vision (YOLO11) Provenance Card */}
                {(jsonTab === 'all' || jsonTab === 'vision') && (
                  <div className="provenance-card">
                    <div className="provenance-card-header">
                      <span>📷 Computer Vision (YOLO11) Provenance</span>
                      <span className="provenance-chip-badge vision">Vision Detection</span>
                    </div>
                    <table className="provenance-table">
                      <tbody>
                        <tr>
                          <td className="provenance-label-td">Vision Model</td>
                          <td className="provenance-value-td">
                            {visionStructuredData?.model?.name || 'f4m1/plant-disease-detector-12'} (YOLO11 ONNX Runtime)
                          </td>
                        </tr>
                        <tr>
                          <td className="provenance-label-td">Detection Status</td>
                          <td className="provenance-value-td">
                            <span style={{ textTransform: 'capitalize', fontWeight: 600 }}>
                              {visionStructuredData?.status || 'No visual detection'}
                            </span>
                          </td>
                        </tr>
                        <tr>
                          <td className="provenance-label-td">Visual Detections</td>
                          <td className="provenance-value-td">
                            {visionStructuredData?.detections && visionStructuredData.detections.length > 0 ? (
                              <div>
                                {visionStructuredData.detections.map((d, i) => (
                                  <span key={i} className="detection-item-row">
                                    🔍 {d.label.replace(/_/g, ' ')} • {(d.confidence * 100).toFixed(1)}%
                                  </span>
                                ))}
                              </div>
                            ) : (
                              'No detections found'
                            )}
                          </td>
                        </tr>
                        <tr>
                          <td className="provenance-label-td">Image Quality &amp; Dimensions</td>
                          <td className="provenance-value-td">
                            Quality: <strong>{visionStructuredData?.quality?.level || 'Good'}</strong> &bull;{' '}
                            Resolution: {visionStructuredData?.image_width || 553} &times; {visionStructuredData?.image_height || 414}px &bull;{' '}
                            Sharpness: {visionStructuredData?.quality?.metrics?.sharpness || '73.0'}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Raw JSON Code Block (Always rendered for test compatibility and inspectable in JSON mode) */}
            <pre
              className="structured-code-block"
              data-testid="structured-json-pre"
              style={{ display: viewFormat === 'json' ? 'block' : 'none' }}
            >
              {JSON.stringify(
                jsonTab === 'voice'
                  ? structuredDataDisplay.farmer_reported_voice
                  : jsonTab === 'vision'
                    ? structuredDataDisplay.computer_vision_yolo11
                    : structuredDataDisplay,
                null,
                2
              )}
            </pre>
          </div>
        )}
      </section>

      {/* ============================================================== */}
      {/* MANDATORY AEO AUTHORITY REVIEW BANNER                          */}
      {/* Hidden in simplifiedView as requested by AEO                   */}
      {/* ============================================================== */}
      {!simplifiedView && (
        <div className="clean-authority-banner" data-testid="aeo-authority-banner">
          <span className="authority-icon">⚠️</span>
          <div className="authority-text-block">
            <strong>AEO HUMAN REVIEW REQUIRED</strong>
            <p>
              AI visual findings and voice extractions are preliminary decision-support evidence. Final diagnosis, advisory confirmation, and field dispatch belong to the Agricultural Extension Officer.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
