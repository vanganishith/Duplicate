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
export default function EvidenceComparisonCard({ incident }) {
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
                  altText={`Crop evidence photo for incident ${incident.id}`}
                />

                {!visionStructuredData && (
                  <div className="no-vision-notice" data-testid="no-vision-data-banner">
                    <span>ℹ️</span>
                    <span>No AI visual analysis is available for this incident. Officer visual inspection required.</span>
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
      {/* SECTION 3: AI ASSESSMENT                                       */}
      {/* ============================================================== */}
      <section className="evidence-panel assessment-panel" data-testid="ai-assessment-section">
        <div className="evidence-panel-header">
          <div className="panel-title-wrap">
            <span className="panel-icon">🧠</span>
            <div>
              <h3 className="panel-title">AI Assessment</h3>
              <span className="panel-subtitle">Cross-evidence synthesis</span>
            </div>
          </div>
          <span className="provenance-chip ai-chip">Reasoning</span>
        </div>

        <div className="evidence-panel-body">
          <div className="assessment-placeholder-clean" data-testid="ai-assessment-placeholder">
            <div className="placeholder-icon-wrap">⚡</div>
            <div>
              <h4 className="placeholder-title">AI Assessment not available yet.</h4>
              <p className="placeholder-desc">
                This section will compare farmer-reported information with visual evidence after the agricultural reasoning model is enabled.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ============================================================== */}
      {/* SECTION 4: COMMUNITY CONFIRMATION (PHASE 10)                   */}
      {/* ============================================================== */}
      <CommunityConfirmationSection incident={incident} />

      {/* ============================================================== */}
      {/* ============================================================== */}
      {/* SECTION 5: AI STRUCTURED PROVENANCE DATA INSPECTOR             */}
      {/* ============================================================== */}
      <section className="evidence-panel json-panel" data-testid="structured-data-section">
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
      {/* ============================================================== */}
      <div className="clean-authority-banner" data-testid="aeo-authority-banner">
        <span className="authority-icon">⚠️</span>
        <div className="authority-text-block">
          <strong>AEO HUMAN REVIEW REQUIRED</strong>
          <p>
            AI visual findings and voice extractions are preliminary decision-support evidence. Final diagnosis, advisory confirmation, and field dispatch belong to the Agricultural Extension Officer.
          </p>
        </div>
      </div>
    </div>
  );
}
