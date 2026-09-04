import React, { useState, useRef, useMemo } from 'react';

/**
 * Formats internal model snake_case labels into human-readable Title Case.
 * Example: 'powdery_mildew' -> 'Powdery Mildew'
 */
function formatDiseaseLabel(label) {
  if (!label) return 'Visual Finding';
  return label
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Returns user-friendly quality badge text and styling class.
 */
function getQualityDisplay(quality) {
  if (!quality || !quality.level) return null;
  const level = String(quality.level).toLowerCase();
  switch (level) {
    case 'good':
      return { text: 'Photo quality: Good', className: 'quality-badge-good' };
    case 'medium':
      return { text: 'Photo quality: Moderate', className: 'quality-badge-medium' };
    case 'poor':
      return { text: 'Photo quality: Poor', className: 'quality-badge-poor' };
    default:
      return { text: `Photo quality: ${quality.level}`, className: 'quality-badge-neutral' };
  }
}

/**
 * Dual-Layer AEO Annotated Image Viewer
 * Renders the original farmer photo untouched, with a responsive transparent SVG overlay
 * visualizing BOTH:
 *  1. Local YOLO11 computer vision detections (Red #ef4444)
 *  2. Featherless Qwen3-VL multimodal visual mappings (Purple #8b5cf6)
 * Supports independent toggling of both layers, interactive legend, and detailed symptom cards.
 */
export default function AnnotatedImageViewer({
  photoUrl,
  photos = [],
  visionData = null,
  visualMappings = [],
  multimodalData = null,
  altText = 'Farmer crop evidence',
}) {
  const [viewMode, setViewMode] = useState('ai'); // 'ai' | 'original'
  const [showYolo, setShowYolo] = useState(true);
  const [showQwen, setShowQwen] = useState(true);
  const [activePhotoIdx, setActivePhotoIdx] = useState(0);
  const [naturalDimensions, setNaturalDimensions] = useState(null);
  const imgRef = useRef(null);

  // Normalize photo list from either visionData.images, photos array, or photoUrl
  const photoList = useMemo(() => {
    if (Array.isArray(visionData?.images) && visionData.images.length > 0) {
      return visionData.images.map((img, i) => ({
        index: i,
        url: img.photo_url || (Array.isArray(photos) ? photos[i] : null) || photoUrl,
        detections: Array.isArray(img.detections) ? img.detections : [],
        quality: img.quality,
        agriculture_relevance: img.agriculture_relevance,
        status: img.status || (img.detections?.length > 0 ? 'detected' : 'no_reliable_detection'),
        image_width: img.image_width,
        image_height: img.image_height,
        error: img.error,
      }));
    }
    if (Array.isArray(photos) && photos.length > 0) {
      return photos.map((u, i) => ({
        index: i,
        url: u,
        detections: i === 0 && Array.isArray(visionData?.detections) ? visionData.detections : [],
        quality: i === 0 ? visionData?.quality : null,
        agriculture_relevance: i === 0 ? visionData?.agriculture_relevance : null,
        status: i === 0 ? (visionData?.status || 'no_reliable_detection') : 'no_reliable_detection',
        image_width: i === 0 ? visionData?.image_width : null,
        image_height: i === 0 ? visionData?.image_height : null,
      }));
    }
    if (photoUrl) {
      return [{
        index: 0,
        url: photoUrl,
        detections: Array.isArray(visionData?.detections) ? visionData.detections : [],
        quality: visionData?.quality,
        agriculture_relevance: visionData?.agriculture_relevance,
        status: visionData?.status || (visionData?.detections?.length > 0 ? 'detected' : 'no_reliable_detection'),
        image_width: visionData?.image_width,
        image_height: visionData?.image_height,
      }];
    }
    return [];
  }, [photoUrl, photos, visionData]);

  // Extract Qwen visual mappings for active photo
  const activeVisualMappings = useMemo(() => {
    const list = Array.isArray(visualMappings) && visualMappings.length > 0
      ? visualMappings
      : (Array.isArray(multimodalData?.visual_mappings) ? multimodalData.visual_mappings : []);

    return list.filter((m) => {
      if (m.image_index === undefined || m.image_index === null) return activePhotoIdx === 0;
      return m.image_index === activePhotoIdx || m.image_index === (activePhotoIdx + 1);
    });
  }, [visualMappings, multimodalData, activePhotoIdx]);

  // If no photos exist for this incident
  if (photoList.length === 0) {
    return (
      <div className="aeo-image-empty-state" data-testid="missing-photo-placeholder">
        <span className="empty-state-icon">📷</span>
        <p className="empty-state-text">No photo evidence uploaded for this incident.</p>
      </div>
    );
  }

  const currentPhoto = photoList[activePhotoIdx] || photoList[0];
  const currentPhotoUrl = currentPhoto.url || photoUrl;

  // Extract structured vision properties strictly for the active photo
  const visionStatus = currentPhoto.status || 'no_reliable_detection';
  const detections = Array.isArray(currentPhoto.detections) ? currentPhoto.detections : [];
  const qualityInfo = getQualityDisplay(currentPhoto.quality);

  // Image coordinate base
  const imageWidth = currentPhoto.image_width || naturalDimensions?.width || 800;
  const imageHeight = currentPhoto.image_height || naturalDimensions?.height || 600;

  const handleImageLoad = (e) => {
    const { naturalWidth, naturalHeight } = e.target;
    if (naturalWidth && naturalHeight) {
      setNaturalDimensions({ width: naturalWidth, height: naturalHeight });
    }
  };

  const isAnalysisFailed = visionStatus === 'analysis_failed';
  const isNonAgricultural = visionStatus === 'non_agricultural';
  const isLowQuality = visionStatus === 'low_quality';
  const hasNoDetections = !isAnalysisFailed && !isNonAgricultural && !isLowQuality && detections.length === 0 && activeVisualMappings.length === 0;

  const totalFindings = (detections.length || 0) + (activeVisualMappings.length || 0);

  return (
    <div className="aeo-annotated-viewer" data-testid="aeo-annotated-viewer">
      {/* Multi-Photo Switcher Bar (when more than 1 photo submitted) */}
      {photoList.length > 1 && (
        <div className="multi-photo-selector-bar" data-testid="multi-photo-selector-bar">
          <span className="photo-selector-label">Photos submitted: {photoList.length}</span>
          <div className="photo-tabs-group" role="tablist">
            {photoList.map((p, idx) => {
              let badgeLabel = '✓ Agri-Relevant';
              let badgeClass = 'status-badge-analyzed';
              const statusNormalized = (p.status || '').toLowerCase();
              const categoryNormalized = (p.relevance_category || '').toUpperCase();

              if (categoryNormalized === 'NON_AGRICULTURAL' || statusNormalized === 'non_agricultural') {
                badgeLabel = '⚠ Non-Agricultural';
                badgeClass = 'status-badge-nonagri';
              } else if (categoryNormalized === 'LIMITED_EVIDENCE' || statusNormalized === 'limited_evidence' || statusNormalized === 'low_quality' || statusNormalized === 'no_reliable_detection') {
                badgeLabel = '⚠ Limited Evidence';
                badgeClass = 'status-badge-lowquality';
              } else if (categoryNormalized === 'ANALYSIS_FAILED' || statusNormalized === 'analysis_failed') {
                badgeLabel = '⚠ Analysis Failed';
                badgeClass = 'status-badge-failed';
              } else if (categoryNormalized === 'AGRICULTURE_RELEVANT' || statusNormalized === 'agriculture_relevant' || statusNormalized === 'detected') {
                badgeLabel = '✓ Agri-Relevant';
                badgeClass = 'status-badge-analyzed';
              }

              return (
                <button
                  key={`photo-tab-${idx}`}
                  type="button"
                  className={`photo-tab-btn ${activePhotoIdx === idx ? 'active' : ''}`}
                  onClick={() => {
                    setActivePhotoIdx(idx);
                    setNaturalDimensions(null);
                  }}
                  data-testid={`photo-tab-${idx}`}
                  role="tab"
                  aria-selected={activePhotoIdx === idx}
                >
                  <span className="photo-tab-name">Photo {idx + 1}</span>
                  <span className={`photo-tab-status-pill ${badgeClass}`}>{badgeLabel}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Header Controls Bar */}
      <div className="viewer-toolbar">
        <div className="viewer-toolbar-left">
          <span className="viewer-section-title">
            <span className="icon">🌿</span> Visual Evidence {photoList.length > 1 ? `(Photo ${activePhotoIdx + 1} of ${photoList.length})` : ''}
          </span>
          {qualityInfo && (
            <span className={`quality-badge ${qualityInfo.className}`} data-testid="photo-quality-badge">
              {qualityInfo.text}
            </span>
          )}
        </div>

        {/* View Mode Toggle: [ Original ] [ AI Findings ] */}
        <div className="view-mode-toggle" role="tablist" aria-label="Image Display Mode">
          <button
            type="button"
            className={`toggle-btn ${viewMode === 'original' ? 'active' : ''}`}
            onClick={() => setViewMode('original')}
            data-testid="toggle-original-btn"
            role="tab"
            aria-selected={viewMode === 'original'}
          >
            Original
          </button>
          <button
            type="button"
            className={`toggle-btn ${viewMode === 'ai' ? 'active' : ''}`}
            onClick={() => setViewMode('ai')}
            data-testid="toggle-ai-btn"
            role="tab"
            aria-selected={viewMode === 'ai'}
          >
            AI Findings {totalFindings > 0 ? `(${totalFindings})` : ''}
          </button>
        </div>
      </div>

      {/* Layer Toggles & Dual-AI Legend (Only in AI Findings mode) */}
      {viewMode === 'ai' && (
        <div
          className="viewer-layers-legend-bar"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '12px',
            padding: '10px 14px',
            background: '#1e293b',
            borderRadius: '8px',
            border: '1px solid #334155',
            fontSize: '0.8125rem',
          }}
          data-testid="viewer-layers-legend-bar"
        >
          {/* Layer Checkbox Toggles */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600, color: '#94a3b8' }}>Visible AI Layers:</span>
            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                cursor: 'pointer',
                color: showYolo ? '#f87171' : '#64748b',
                fontWeight: 600,
              }}
            >
              <input
                type="checkbox"
                checked={showYolo}
                onChange={(e) => setShowYolo(e.target.checked)}
                style={{ accentColor: '#ef4444', cursor: 'pointer' }}
                data-testid="toggle-yolo-layer-checkbox"
              />
              <span>🔴 YOLO11 Findings ({detections.length})</span>
            </label>

            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                cursor: 'pointer',
                color: showQwen ? '#a78bfa' : '#64748b',
                fontWeight: 600,
              }}
            >
              <input
                type="checkbox"
                checked={showQwen}
                onChange={(e) => setShowQwen(e.target.checked)}
                style={{ accentColor: '#8b5cf6', cursor: 'pointer' }}
                data-testid="toggle-qwen-layer-checkbox"
              />
              <span>🟣 Qwen3-VL Spatial Mappings ({activeVisualMappings.length})</span>
            </label>
          </div>

          {/* Legend */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '0.75rem', color: '#cbd5e1' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: '#ef4444', display: 'inline-block' }}></span>
              CV Detection
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: '#8b5cf6', display: 'inline-block' }}></span>
              Multimodal Mapping
            </span>
          </div>
        </div>
      )}

      {/* Main Image + SVG Overlay Container */}
      <div className="viewer-media-viewport">
        <div className="viewer-canvas-wrapper" style={{ position: 'relative', display: 'inline-block', width: '100%' }}>
          {/* 1. Original Untouched Image from Supabase Storage */}
          <img
            ref={imgRef}
            src={currentPhotoUrl}
            alt={`${altText} - Photo ${activePhotoIdx + 1}`}
            className="original-farmer-photo"
            onLoad={handleImageLoad}
            style={{
              display: 'block',
              width: '100%',
              height: 'auto',
              borderRadius: '6px',
              objectFit: 'contain',
              backgroundColor: '#0f172a',
            }}
            data-testid="original-photo-img"
          />

          {/* 2. Transparent Responsive SVG Overlay (Both YOLO and Qwen visual mappings) */}
          {viewMode === 'ai' && !isAnalysisFailed && ((showYolo && detections.length > 0) || (showQwen && activeVisualMappings.length > 0)) && (
            <svg
              className="vision-svg-overlay"
              viewBox={`0 0 ${imageWidth} ${imageHeight}`}
              preserveAspectRatio="none"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                pointerEvents: 'none',
              }}
              data-testid="vision-svg-overlay"
            >
              <defs>
                <filter id="box-glow-yolo" x="-10%" y="-10%" width="120%" height="120%">
                  <feDropShadow dx="0" dy="1" stdDeviation="2" floodColor="#000000" floodOpacity="0.8" />
                </filter>
                <filter id="box-glow-qwen" x="-10%" y="-10%" width="120%" height="120%">
                  <feDropShadow dx="0" dy="1" stdDeviation="2" floodColor="#1e1b4b" floodOpacity="0.8" />
                </filter>
              </defs>

              {/* LAYER 1: YOLO11 Computer Vision Detections (Red) */}
              {showYolo && detections.map((det, index) => {
                const { bbox, label, confidence } = det;
                if (!bbox) return null;

                const x = Math.max(0, bbox.x1);
                const y = Math.max(0, bbox.y1);
                const width = Math.max(1, bbox.x2 - bbox.x1);
                const height = Math.max(1, bbox.y2 - bbox.y1);
                const labelText = `🔴 YOLO: ${formatDiseaseLabel(label)} • ${(Number(confidence) * 100).toFixed(1)}%`;

                const badgeHeight = Math.max(22, Math.round(imageHeight * 0.035));
                const badgeWidth = Math.max(110, Math.round(labelText.length * (imageWidth * 0.011)));
                const fontSize = Math.max(12, Math.round(imageHeight * 0.024));
                const badgeY = y > badgeHeight + 6 ? y - badgeHeight - 4 : y + 4;
                const badgeX = Math.min(x, Math.max(4, imageWidth - badgeWidth - 4));

                return (
                  <g key={`yolo-det-${index}`} className="detection-box-group" data-testid={`detection-box-${index}`}>
                    <rect
                      x={x}
                      y={y}
                      width={width}
                      height={height}
                      fill="rgba(239, 68, 68, 0.16)"
                      stroke="#ef4444"
                      strokeWidth={Math.max(2, Math.round(imageWidth * 0.0035))}
                      rx={Math.max(2, Math.round(imageWidth * 0.004))}
                    />

                    {/* Corner accents */}
                    <rect x={x - 2} y={y - 2} width={8} height={8} fill="#ffffff" stroke="#ef4444" strokeWidth="1.5" />
                    <rect x={x + width - 6} y={y - 2} width={8} height={8} fill="#ffffff" stroke="#ef4444" strokeWidth="1.5" />
                    <rect x={x - 2} y={y + height - 6} width={8} height={8} fill="#ffffff" stroke="#ef4444" strokeWidth="1.5" />
                    <rect x={x + width - 6} y={y + height - 6} width={8} height={8} fill="#ffffff" stroke="#ef4444" strokeWidth="1.5" />

                    {/* Label Badge */}
                    <g filter="url(#box-glow-yolo)">
                      <rect
                        x={badgeX}
                        y={badgeY}
                        width={badgeWidth}
                        height={badgeHeight}
                        fill="#0f172a"
                        stroke="#ef4444"
                        strokeWidth="1.5"
                        rx="4"
                      />
                      <text
                        x={badgeX + 8}
                        y={badgeY + badgeHeight * 0.72}
                        fill="#ffffff"
                        fontSize={fontSize}
                        fontFamily="system-ui, -apple-system, sans-serif"
                        fontWeight="700"
                        letterSpacing="0.02em"
                      >
                        {labelText}
                      </text>
                    </g>
                  </g>
                );
              })}

              {/* LAYER 2: Qwen3-VL Multimodal Visual Mappings (Purple/Indigo) */}
              {showQwen && activeVisualMappings.map((mapping, mIdx) => {
                const nb = mapping.bbox_normalized;
                if (!nb) return null;

                // Convert normalized 0.0-1.0 coords to SVG viewport dimensions
                const x = Math.max(0, Math.round(nb.x1 * imageWidth));
                const y = Math.max(0, Math.round(nb.y1 * imageHeight));
                const width = Math.max(2, Math.round((nb.x2 - nb.x1) * imageWidth));
                const height = Math.max(2, Math.round((nb.y2 - nb.y1) * imageHeight));
                const shortLabel = mapping.label ? mapping.label.replace(/^Brown circular lesion area observed on /i, 'Lesion on ') : 'Symptom Area';
                const labelText = `🟣 Qwen3-VL: ${shortLabel} • ${Math.round((mapping.confidence || 0.85) * 100)}%`;

                const badgeHeight = Math.max(22, Math.round(imageHeight * 0.035));
                const badgeWidth = Math.max(120, Math.round(labelText.length * (imageWidth * 0.0105)));
                const fontSize = Math.max(11, Math.round(imageHeight * 0.023));
                // Position label on bottom inside or top outside
                const badgeY = y + height + badgeHeight + 4 <= imageHeight
                  ? y + height + 2
                  : (y > badgeHeight + 6 ? y - badgeHeight - 4 : y + 4);
                const badgeX = Math.min(x, Math.max(4, imageWidth - badgeWidth - 4));

                return (
                  <g key={`qwen-mapping-${mIdx}`} className="qwen-mapping-box-group" data-testid={`qwen-mapping-box-${mIdx}`}>
                    <rect
                      x={x}
                      y={y}
                      width={width}
                      height={height}
                      fill="rgba(139, 92, 246, 0.16)"
                      stroke="#8b5cf6"
                      strokeWidth={Math.max(2, Math.round(imageWidth * 0.0035))}
                      strokeDasharray="6 3"
                      rx={Math.max(2, Math.round(imageWidth * 0.004))}
                    />

                    {/* Corner accents */}
                    <rect x={x - 2} y={y - 2} width={8} height={8} fill="#ffffff" stroke="#8b5cf6" strokeWidth="1.5" />
                    <rect x={x + width - 6} y={y - 2} width={8} height={8} fill="#ffffff" stroke="#8b5cf6" strokeWidth="1.5" />
                    <rect x={x - 2} y={y + height - 6} width={8} height={8} fill="#ffffff" stroke="#8b5cf6" strokeWidth="1.5" />
                    <rect x={x + width - 6} y={y + height - 6} width={8} height={8} fill="#ffffff" stroke="#8b5cf6" strokeWidth="1.5" />

                    {/* Label Badge */}
                    <g filter="url(#box-glow-qwen)">
                      <rect
                        x={badgeX}
                        y={badgeY}
                        width={badgeWidth}
                        height={badgeHeight}
                        fill="#1e1b4b"
                        stroke="#8b5cf6"
                        strokeWidth="1.5"
                        rx="4"
                      />
                      <text
                        x={badgeX + 8}
                        y={badgeY + badgeHeight * 0.72}
                        fill="#f5f3ff"
                        fontSize={fontSize}
                        fontFamily="system-ui, -apple-system, sans-serif"
                        fontWeight="700"
                        letterSpacing="0.02em"
                      >
                        {labelText}
                      </text>
                    </g>
                  </g>
                );
              })}
            </svg>
          )}
        </div>
      </div>

      {/* Visual Status Banners for the Active Photo */}
      {viewMode === 'ai' && isNonAgricultural && (
        <div className="viewer-status-banner banner-non-agri" data-testid="non-agri-banner">
          <div className="banner-icon">🌾</div>
          <div className="banner-content">
            <h4 className="banner-title">NON_AGRICULTURAL</h4>
            <p className="banner-description">
              No useful agricultural evidence detected. Automated disease inference was safely bypassed.
            </p>
          </div>
        </div>
      )}

      {viewMode === 'ai' && isLowQuality && (
        <div className="viewer-status-banner banner-low-quality" data-testid="low-quality-banner">
          <div className="banner-icon">📷</div>
          <div className="banner-content">
            <h4 className="banner-title">LIMITED_EVIDENCE</h4>
            <p className="banner-description">
              Image is too dark or blurry for automated disease detection. Officer visual inspection required.
            </p>
          </div>
        </div>
      )}

      {viewMode === 'ai' && hasNoDetections && !isLowQuality && (
        <div className="viewer-status-banner banner-no-detection" data-testid="no-detection-banner">
          <div className="banner-icon">ℹ️</div>
          <div className="banner-content">
            <h4 className="banner-title">No reliable visual finding detected (LIMITED_EVIDENCE).</h4>
            <p className="banner-description">
              Plant visible, but visual disease evidence is weak or unconfirmed. AEO review required.
            </p>
          </div>
        </div>
      )}

      {viewMode === 'ai' && isAnalysisFailed && (
        <div className="viewer-status-banner banner-analysis-failed" data-testid="analysis-failed-banner">
          <div className="banner-icon">⚠️</div>
          <div className="banner-content">
            <h4 className="banner-title">AI image analysis unavailable for this photo (ANALYSIS_FAILED).</h4>
            <p className="banner-description">
              {currentPhoto.error || 'Could not process image.'} Original photo is available above for officer inspection.
            </p>
          </div>
        </div>
      )}

      {/* Detections & Spatial Mappings Lists */}
      {viewMode === 'ai' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* 1. YOLO11 Detections List */}
          {detections.length > 0 && (
            <div className="viewer-detections-list" data-testid="detections-list">
              <h5 className="detections-list-title" style={{ color: '#f87171' }}>
                🔴 Computer Vision Detections (YOLO11) &bull; Photo {activePhotoIdx + 1} ({detections.length}):
              </h5>
              <div className="detection-items-grid">
                {detections.map((det, idx) => (
                  <div key={`item-${idx}`} className="detection-item-card" data-testid={`detection-item-${idx}`}>
                    <div className="item-badge-row">
                      <span className="item-label-chip">🔍 {formatDiseaseLabel(det.label)}</span>
                      <span className="item-confidence-tag">
                        AI visual indication: {(Number(det.confidence) * 100).toFixed(1)}%
                      </span>
                    </div>
                    {det.bbox && (
                      <span className="item-bbox-meta" style={{ color: '#94a3b8', fontSize: '0.75rem' }}>
                        Pixel Bounds: [{det.bbox.x1}, {det.bbox.y1}] to [{det.bbox.x2}, {det.bbox.y2}] px
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 2. Qwen3-VL Spatial Mappings List */}
          {activeVisualMappings.length > 0 && (
            <div
              className="viewer-detections-list"
              style={{ background: '#1e1b4b', border: '1px solid #4338ca' }}
              data-testid="qwen-mappings-list"
            >
              <h5 className="detections-list-title" style={{ color: '#c4b5fd' }}>
                🟣 Multimodal Visual Mappings (Qwen3-VL) &bull; Photo {activePhotoIdx + 1} ({activeVisualMappings.length}):
              </h5>
              <div className="detection-items-grid">
                {activeVisualMappings.map((m, mIdx) => (
                  <div
                    key={`qwen-card-${mIdx}`}
                    className="detection-item-card"
                    style={{ background: '#0f172a', border: '1px solid #4f46e5' }}
                    data-testid={`qwen-mapping-item-${mIdx}`}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '100%' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                        <span style={{ fontWeight: 700, fontSize: '0.875rem', color: '#c4b5fd' }}>
                          🎯 {m.label || 'Symptom Region'}
                        </span>
                        <span
                          style={{
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            padding: '2px 8px',
                            borderRadius: '12px',
                            background: '#312e81',
                            color: '#e0e7ff',
                          }}
                        >
                          Qwen Confidence: {Math.round((m.confidence || 0.85) * 100)}%
                        </span>
                      </div>
                      {m.description && (
                        <p style={{ margin: '2px 0 0 0', fontSize: '0.8125rem', color: '#cbd5e1', lineHeight: 1.4 }}>
                          {m.description}
                        </p>
                      )}
                      {m.bbox_normalized && (
                        <span style={{ fontSize: '0.725rem', color: '#818cf8', marginTop: '2px' }}>
                          Normalized Region: [{m.bbox_normalized.x1.toFixed(2)}, {m.bbox_normalized.y1.toFixed(2)}] to [{m.bbox_normalized.x2.toFixed(2)}, {m.bbox_normalized.y2.toFixed(2)}]
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Mandatory AEO Explanatory Authority Banner */}
      <div className="aeo-authority-footnote">
        <p>
          <strong>Notice:</strong> AI visual findings and spatial mappings are preliminary indications based on the farmer&apos;s photo.
          They are not a confirmed diagnosis. Final assessment is by the Agricultural Extension Officer.
        </p>
      </div>
    </div>
  );
}
