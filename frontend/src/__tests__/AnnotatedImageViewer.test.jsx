import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AnnotatedImageViewer from '../components/AnnotatedImageViewer';

describe('Phase 5F: AnnotatedImageViewer Component', () => {
  const samplePhotoUrl = 'https://supabase.co/storage/v1/object/public/incident-photos/sample_leaf.jpg';

  const singleDetectionVision = {
    image_width: 800,
    image_height: 600,
    status: 'detected',
    quality: {
      usable: true,
      level: 'good',
      confidence: 0.92,
    },
    detections: [
      {
        bbox: { x1: 200, y1: 150, x2: 400, y2: 300 },
        label: 'powdery_mildew',
        confidence: 0.063,
      },
    ],
    model: {
      name: 'f4m1/plant-disease-detector-12',
      type: 'YOLO11',
    },
  };

  const multipleDetectionsVision = {
    image_width: 1920,
    image_height: 1080,
    status: 'detected',
    quality: {
      usable: true,
      level: 'medium',
      confidence: 0.78,
    },
    detections: [
      {
        bbox: { x1: 100, y1: 120, x2: 450, y2: 400 },
        label: 'leaf_spot',
        confidence: 0.82,
      },
      {
        bbox: { x1: 600, y1: 500, x2: 950, y2: 850 },
        label: 'early_blight',
        confidence: 0.74,
      },
      {
        bbox: { x1: 1100, y1: 200, x2: 1500, y2: 600 },
        label: 'late_blight',
        confidence: 0.68,
      },
    ],
  };

  // 1. Incident with photo + one detection
  it('renders original photo and single SVG detection box', () => {
    render(<AnnotatedImageViewer photoUrl={samplePhotoUrl} visionData={singleDetectionVision} />);

    const img = screen.getByTestId('original-photo-img');
    expect(img).toBeDefined();
    expect(img.getAttribute('src')).toBe(samplePhotoUrl);

    const svg = screen.getByTestId('vision-svg-overlay');
    expect(svg).toBeDefined();
    expect(svg.getAttribute('viewBox')).toBe('0 0 800 600');

    const box = screen.getByTestId('detection-box-0');
    expect(box).toBeDefined();
    expect(screen.getByText(/Powdery Mildew • 6.3%/i)).toBeDefined();
  });

  // 2. Incident with photo + multiple detections
  it('renders multiple bounding boxes and detailed detection items', () => {
    render(<AnnotatedImageViewer photoUrl={samplePhotoUrl} visionData={multipleDetectionsVision} />);

    expect(screen.getAllByText(/Leaf Spot/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Early Blight/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Late Blight/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByTestId('detection-item-0')).toBeDefined();
    expect(screen.getByTestId('detection-item-1')).toBeDefined();
    expect(screen.getByTestId('detection-item-2')).toBeDefined();
  });

  // 3. No reliable detection state -> does NOT say "plant is healthy"
  it('handles no reliable detection state correctly without claiming healthy', () => {
    const noDetectionVision = {
      image_width: 800,
      image_height: 600,
      status: 'no_reliable_detection',
      detections: [],
      quality: { level: 'good' },
    };

    render(<AnnotatedImageViewer photoUrl={samplePhotoUrl} visionData={noDetectionVision} />);

    const banner = screen.getByTestId('no-detection-banner');
    expect(banner).toBeDefined();
    expect(screen.getByText(/No reliable visual finding detected/i)).toBeDefined();
    expect(screen.getByText(/AEO review required/i)).toBeDefined();

    // Must NEVER say "Plant is healthy"
    expect(screen.queryByText(/healthy/i)).toBeNull();
    expect(screen.queryByTestId('vision-svg-overlay')).toBeNull();
  });

  // 4. Analysis failed state -> shows warning banner and preserves photo
  it('handles analysis failed state while keeping original photo visible', () => {
    const failedVision = {
      status: 'analysis_failed',
      detections: [],
    };

    render(<AnnotatedImageViewer photoUrl={samplePhotoUrl} visionData={failedVision} />);

    expect(screen.getByTestId('analysis-failed-banner')).toBeDefined();
    expect(screen.getByText(/AI image analysis unavailable/i)).toBeDefined();

    // Original photo must still be present
    const img = screen.getByTestId('original-photo-img');
    expect(img.getAttribute('src')).toBe(samplePhotoUrl);
  });

  // 5. Original image toggle hides SVG overlay
  it('hides SVG overlay when Original mode is selected', () => {
    render(<AnnotatedImageViewer photoUrl={samplePhotoUrl} visionData={singleDetectionVision} />);

    expect(screen.getByTestId('vision-svg-overlay')).toBeDefined();

    const originalBtn = screen.getByTestId('toggle-original-btn');
    fireEvent.click(originalBtn);

    // SVG overlay is hidden
    expect(screen.queryByTestId('vision-svg-overlay')).toBeNull();
    // Original photo remains visible
    expect(screen.getByTestId('original-photo-img')).toBeDefined();
  });

  // 6. AI findings toggle reveals SVG overlay
  it('reveals SVG overlay when toggled back to AI Findings', () => {
    render(<AnnotatedImageViewer photoUrl={samplePhotoUrl} visionData={singleDetectionVision} />);

    const originalBtn = screen.getByTestId('toggle-original-btn');
    const aiBtn = screen.getByTestId('toggle-ai-btn');

    fireEvent.click(originalBtn);
    expect(screen.queryByTestId('vision-svg-overlay')).toBeNull();

    fireEvent.click(aiBtn);
    expect(screen.getByTestId('vision-svg-overlay')).toBeDefined();
  });

  // 7. Responsive Coordinate Scaling & viewBox Verification
  it('accurately sets viewBox and relative rect coordinates', () => {
    render(<AnnotatedImageViewer photoUrl={samplePhotoUrl} visionData={singleDetectionVision} />);

    const svg = screen.getByTestId('vision-svg-overlay');
    expect(svg.getAttribute('viewBox')).toBe('0 0 800 600');

    const boxGroup = screen.getByTestId('detection-box-0');
    const rect = boxGroup.querySelector('rect');
    expect(rect.getAttribute('x')).toBe('200');
    expect(rect.getAttribute('y')).toBe('150');
    expect(rect.getAttribute('width')).toBe('200'); // 400 - 200
    expect(rect.getAttribute('height')).toBe('150'); // 300 - 150
  });

  // 8. Portrait Aspect Ratio (600x800)
  it('supports portrait aspect ratio coordinates without distortion', () => {
    const portraitVision = {
      image_width: 600,
      image_height: 800,
      status: 'detected',
      detections: [
        {
          bbox: { x1: 50, y1: 100, x2: 550, y2: 700 },
          label: 'leaf_rust',
          confidence: 0.88,
        },
      ],
    };

    render(<AnnotatedImageViewer photoUrl={samplePhotoUrl} visionData={portraitVision} />);

    const svg = screen.getByTestId('vision-svg-overlay');
    expect(svg.getAttribute('viewBox')).toBe('0 0 600 800');
  });

  // 9. Missing vision data gracefully handled
  it('renders cleanly when visionData is null', () => {
    render(<AnnotatedImageViewer photoUrl={samplePhotoUrl} visionData={null} />);

    expect(screen.getByTestId('original-photo-img')).toBeDefined();
    expect(screen.getByTestId('no-detection-banner')).toBeDefined();
  });

  // 10. Missing photo URL displays empty state
  it('renders placeholder when photoUrl is missing', () => {
    render(<AnnotatedImageViewer photoUrl={null} visionData={null} />);

    expect(screen.getByTestId('missing-photo-placeholder')).toBeDefined();
    expect(screen.getByText(/No photo evidence uploaded/i)).toBeDefined();
  });

  // 11. Low-confidence visual indication phrasing
  it('uses preliminary visual indication phrasing without claiming confirmed disease', () => {
    render(<AnnotatedImageViewer photoUrl={samplePhotoUrl} visionData={singleDetectionVision} />);

    expect(screen.getByText(/AI visual indication: 6.3%/i)).toBeDefined();
    expect(screen.getByText(/preliminary indications based on the farmer's photo/i)).toBeDefined();
  });

  // 12. Quality badge levels
  it('displays correct quality badges for good, medium, and poor ratings', () => {
    const { rerender } = render(
      <AnnotatedImageViewer photoUrl={samplePhotoUrl} visionData={{ quality: { level: 'good' } }} />
    );
    expect(screen.getByText(/Photo quality: Good/i)).toBeDefined();

    rerender(
      <AnnotatedImageViewer photoUrl={samplePhotoUrl} visionData={{ quality: { level: 'medium' } }} />
    );
    expect(screen.getByText(/Photo quality: Moderate/i)).toBeDefined();

    rerender(
      <AnnotatedImageViewer photoUrl={samplePhotoUrl} visionData={{ quality: { level: 'poor' } }} />
    );
    expect(screen.getByText(/Photo quality: Poor/i)).toBeDefined();
  });
});
