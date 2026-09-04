import React from 'react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PhotoEvidenceCapture from '../components/PhotoEvidenceCapture';
import AnnotatedImageViewer from '../components/AnnotatedImageViewer';
import EvidenceComparisonCard from '../components/EvidenceComparisonCard';

describe('Phase 5F — Multi-Photo Evidence Capture & Inspection', () => {
  // 1. PhotoEvidenceCapture renders mandatory 1 to 4 photos indicator
  it('renders mandatory photo capture with 0/4 indicator', () => {
    render(<PhotoEvidenceCapture photos={[]} onPhotosChange={vi.fn()} />);

    expect(screen.getByTestId('photo-count-pill')).toHaveTextContent('0/4 Photos (At least 1 required)');
    expect(screen.getByTestId('open-camera-btn')).toBeInTheDocument();
    expect(screen.getByTestId('choose-gallery-btn')).toBeInTheDocument();
  });

  // 2. PhotoEvidenceCapture handles multiple photo items and removal
  it('displays photo thumbnails and allows removal', () => {
    const handlePhotosChange = vi.fn();
    const photos = [
      { file: new File(['fake1'], 'leaf1.jpg', { type: 'image/jpeg' }), preview: 'blob:leaf1' },
      { file: new File(['fake2'], 'leaf2.jpg', { type: 'image/jpeg' }), preview: 'blob:leaf2' },
    ];

    render(<PhotoEvidenceCapture photos={photos} onPhotosChange={handlePhotosChange} />);

    expect(screen.getByTestId('photo-count-pill')).toHaveTextContent('2/4 Photos');
    expect(screen.getByTestId('photo-preview-item-0')).toBeInTheDocument();
    expect(screen.getByTestId('photo-preview-item-1')).toBeInTheDocument();

    const removeBtn0 = screen.getByTestId('remove-photo-btn-0');
    fireEvent.click(removeBtn0);

    expect(handlePhotosChange).toHaveBeenCalledWith([photos[1]]);
  });

  // 3. PhotoEvidenceCapture displays max limit reached notice when 4 photos selected
  it('displays max 4 photos reached notice and hides add buttons', () => {
    const photos = [
      { file: new File(['1'], 'p1.jpg', { type: 'image/jpeg' }), preview: 'blob:1' },
      { file: new File(['2'], 'p2.jpg', { type: 'image/jpeg' }), preview: 'blob:2' },
      { file: new File(['3'], 'p3.jpg', { type: 'image/jpeg' }), preview: 'blob:3' },
      { file: new File(['4'], 'p4.jpg', { type: 'image/jpeg' }), preview: 'blob:4' },
    ];

    render(<PhotoEvidenceCapture photos={photos} onPhotosChange={vi.fn()} />);

    expect(screen.getByTestId('photo-count-pill')).toHaveTextContent('4/4 Photos');
    expect(screen.getByTestId('max-photos-reached-msg')).toBeInTheDocument();
    expect(screen.queryByTestId('open-camera-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('choose-gallery-btn')).not.toBeInTheDocument();
  });

  // 4. AnnotatedImageViewer with multiple photos displays switcher tabs and isolates bounding boxes
  it('renders multi-photo switcher tabs and isolates detections per photo', () => {
    const visionData = {
      total_images: 2,
      images: [
        {
          index: 0,
          photo_url: 'http://localhost:8000/photo1.jpg',
          status: 'detected',
          quality: { level: 'good', usable: true },
          detections: [
            { label: 'early_blight', confidence: 0.88, bbox: { x1: 20, y1: 20, x2: 120, y2: 120 } }
          ],
          image_width: 640,
          image_height: 480
        },
        {
          index: 1,
          photo_url: 'http://localhost:8000/photo2.jpg',
          status: 'non_agricultural',
          quality: { level: 'good', usable: true },
          detections: [],
          image_width: 640,
          image_height: 480
        }
      ]
    };

    render(
      <AnnotatedImageViewer
        photoUrl="http://localhost:8000/photo1.jpg"
        photos={['http://localhost:8000/photo1.jpg', 'http://localhost:8000/photo2.jpg']}
        visionData={visionData}
      />
    );

    // Switcher bar is rendered
    expect(screen.getByTestId('multi-photo-selector-bar')).toBeInTheDocument();
    expect(screen.getByTestId('photo-tab-0')).toHaveTextContent('Photo 1');
    expect(screen.getByTestId('photo-tab-1')).toHaveTextContent('Photo 2');

    // Photo 1 has 1 detection
    expect(screen.getByTestId('detection-box-0')).toBeInTheDocument();
    expect(screen.getByTestId('detection-item-0')).toHaveTextContent('Early Blight');

    // Click Photo 2 (Non-agricultural)
    fireEvent.click(screen.getByTestId('photo-tab-1'));

    // Bounding box from Photo 1 must NOT appear on Photo 2
    expect(screen.queryByTestId('detection-box-0')).not.toBeInTheDocument();
    expect(screen.getByTestId('non-agri-banner')).toBeInTheDocument();
  });

  // 5. Zero photo incident in EvidenceComparisonCard renders clean placeholder
  it('renders clean placeholder when incident has no photos', () => {
    const incident = {
      id: 'inc-no-photos',
      crop: 'Paddy',
      description: 'Voice only report',
      photo_url: null,
      photos: [],
      audio_url: 'http://localhost:8000/audio.webm'
    };

    render(<EvidenceComparisonCard incident={incident} />);

    expect(screen.getByTestId('no-photo-empty-state')).toHaveTextContent('No farmer photo was provided.');
  });
});
