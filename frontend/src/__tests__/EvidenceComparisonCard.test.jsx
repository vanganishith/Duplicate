import React from 'react';
import '@testing-library/jest-dom';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import EvidenceComparisonCard from '../components/EvidenceComparisonCard';

describe('Phase 5G Step 2: EvidenceComparisonCard Tripartite Provenance Tests', () => {
  const samplePhotoUrl = 'https://supabase.co/storage/v1/object/public/incident-photos/sample_leaf.jpg';
  const sampleAudioUrl = 'https://supabase.co/storage/v1/object/public/incident-audio/sample_audio.webm';

  const fullVoiceData = {
    transcript: 'వరి చేనులో ఆకులు పసుపు రంగులోకి మారుతున్నాయి',
    detected_language: 'Telugu',
    crop_detected: 'Paddy',
    symptoms: ['ఆకులు పసుపు రంగులోకి మారడం', 'గోధుమ మచ్చలు'],
    structured_data: {
      voice: {
        crop: 'Paddy',
        symptoms: ['yellow leaves', 'brown spots'],
        duration: '1 week',
        affected_part: 'Leaves',
        severity: 'Moderate spreading',
        context: 'After continuous rain',
        farmer_concern: 'Crop loss fear',
      },
    },
  };

  const fullVisionData = {
    image_width: 800,
    image_height: 600,
    status: 'detected',
    quality: {
      usable: true,
      level: 'good',
      confidence: 0.95,
    },
    detections: [
      {
        bbox: { x1: 200, y1: 150, x2: 400, y2: 300 },
        label: 'leaf_spot',
        confidence: 0.632,
      },
    ],
  };

  // 1. Voice-Only Incident
  it('renders voice-only incident with voice details and empty photo state', () => {
    const voiceOnlyIncident = {
      id: 'inc-voice-only',
      audio_url: sampleAudioUrl,
      description: 'Farmer reported issue via voice note',
      crop: 'Paddy',
      ai_analysis: [fullVoiceData],
    };

    render(<EvidenceComparisonCard incident={voiceOnlyIncident} />);

    expect(screen.getByTestId('voice-evidence-section')).toBeDefined();
    expect(screen.getByText(/ACCORDING TO FARMER'S VOICE/i)).toBeDefined();
    expect(screen.getByText(/వరి చేనులో ఆకులు పసుపు రంగులోకి మారుతున్నాయి/i)).toBeDefined();
    expect(screen.getByTestId('no-photo-empty-state')).toBeDefined();
    expect(screen.getByText(/No farmer photo was provided/i)).toBeDefined();
  });

  // 2. Photo-Only Incident
  it('renders photo-only incident with image evidence and empty voice state', () => {
    const photoOnlyIncident = {
      id: 'inc-photo-only',
      photo_url: samplePhotoUrl,
      description: 'Leaf spots observed on chilli crop',
      crop: 'Chilli',
      ai_analysis: [
        {
          structured_data: {
            vision: fullVisionData,
          },
        },
      ],
    };

    render(<EvidenceComparisonCard incident={photoOnlyIncident} />);

    expect(screen.getByTestId('image-evidence-section')).toBeDefined();
    expect(screen.getByText(/ACCORDING TO IMAGE/i)).toBeDefined();
    expect(screen.getByTestId('no-voice-empty-state')).toBeDefined();
    expect(screen.getByText(/No voice report was provided/i)).toBeDefined();
    expect(screen.getByTestId('original-photo-img')).toBeDefined();
  });

  // 3. Voice + Photo Incident Coexistence
  it('renders both voice and photo evidence cleanly in their respective sections', () => {
    const multimodalIncident = {
      id: 'inc-multimodal',
      photo_url: samplePhotoUrl,
      audio_url: sampleAudioUrl,
      description: 'Paddy yellowing and leaf lesions',
      crop: 'Paddy',
      ai_analysis: [
        {
          ...fullVoiceData,
          structured_data: {
            voice: fullVoiceData.structured_data.voice,
            vision: fullVisionData,
          },
        },
      ],
    };

    render(<EvidenceComparisonCard incident={multimodalIncident} />);

    // Section 1: Voice
    expect(screen.getByText(/ACCORDING TO FARMER'S VOICE/i)).toBeDefined();
    expect(screen.getByText(/వరి చేనులో ఆకులు/i)).toBeDefined();

    // Section 2: Image
    expect(screen.getByText(/ACCORDING TO IMAGE/i)).toBeDefined();
    expect(screen.getByTestId('original-photo-img')).toBeDefined();
    expect(screen.getByTestId('vision-svg-overlay')).toBeDefined();
  });

  // 4. Voice Transcript & Language Rendering
  it('renders spoken transcript quote and language tag', () => {
    const incident = {
      id: 'inc-4',
      ai_analysis: [fullVoiceData],
    };

    render(<EvidenceComparisonCard incident={incident} />);

    expect(screen.getByTestId('voice-transcript-box')).toBeDefined();
    expect(screen.getByTestId('voice-language-badge')).toBeDefined();
    expect(screen.getByText(/Language: Telugu/i)).toBeDefined();
  });

  // 5. Voice Symptoms Rendering
  it('renders farmer-reported symptoms as items in a list', () => {
    const incident = {
      id: 'inc-5',
      ai_analysis: [fullVoiceData],
    };

    render(<EvidenceComparisonCard incident={incident} />);

    expect(screen.getByTestId('voice-symptom-0')).toBeDefined();
    expect(screen.getByText(/• ఆకులు పసుపు రంగులోకి మారడం/i)).toBeDefined();
  });

  // 6. Voice Duration & Attributes Rendering
  it('renders reported duration and affected plant parts', () => {
    const incident = {
      id: 'inc-6',
      ai_analysis: [fullVoiceData],
    };

    render(<EvidenceComparisonCard incident={incident} />);

    expect(screen.getByTestId('voice-duration-item')).toBeDefined();
    expect(screen.getByText(/1 week/i)).toBeDefined();
    expect(screen.getByTestId('voice-part-item')).toBeDefined();
    expect(screen.getByText(/Leaves/i)).toBeDefined();
  });

  // 7. Image Rendering from Supabase Storage
  it('renders image directly from incident.photo_url', () => {
    const incident = {
      id: 'inc-7',
      photo_url: samplePhotoUrl,
      ai_analysis: [{ structured_data: { vision: fullVisionData } }],
    };

    render(<EvidenceComparisonCard incident={incident} />);

    const img = screen.getByTestId('original-photo-img');
    expect(img.getAttribute('src')).toBe(samplePhotoUrl);
  });

  // 8. Vision Detection Rendering & Real Confidence Display (63.2%)
  it('displays detection label with exact formatted confidence percentage', () => {
    const incident = {
      id: 'inc-8',
      photo_url: samplePhotoUrl,
      ai_analysis: [{ structured_data: { vision: fullVisionData } }],
    };

    render(<EvidenceComparisonCard incident={incident} />);

    expect(screen.getAllByText(/Leaf Spot/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/AI visual indication: 63.2%/i)).toBeDefined();
  });

  // 9. Multiple Image Detections
  it('renders multiple bounding box visual indications', () => {
    const multiVisionData = {
      image_width: 800,
      image_height: 600,
      status: 'detected',
      detections: [
        { bbox: { x1: 10, y1: 10, x2: 200, y2: 200 }, label: 'early_blight', confidence: 0.85 },
        { bbox: { x1: 300, y1: 300, x2: 500, y2: 500 }, label: 'powdery_mildew', confidence: 0.72 },
      ],
    };

    const incident = {
      id: 'inc-9',
      photo_url: samplePhotoUrl,
      ai_analysis: [{ structured_data: { vision: multiVisionData } }],
    };

    render(<EvidenceComparisonCard incident={incident} />);

    expect(screen.getByTestId('detection-box-0')).toBeDefined();
    expect(screen.getByTestId('detection-box-1')).toBeDefined();
  });

  // 10. No Voice State
  it('displays empty state when no voice report was provided', () => {
    const incident = {
      id: 'inc-10',
      photo_url: samplePhotoUrl,
      ai_analysis: [],
    };

    render(<EvidenceComparisonCard incident={incident} />);

    expect(screen.getByTestId('no-voice-empty-state')).toBeDefined();
    expect(screen.getByText(/No voice report was provided/i)).toBeDefined();
  });

  // 11. No Photo State
  it('displays empty state when no farmer photo was provided', () => {
    const incident = {
      id: 'inc-11',
      audio_url: sampleAudioUrl,
      ai_analysis: [fullVoiceData],
    };

    render(<EvidenceComparisonCard incident={incident} />);

    expect(screen.getByTestId('no-photo-empty-state')).toBeDefined();
    expect(screen.getByText(/No farmer photo was provided/i)).toBeDefined();
  });

  // 12. No Vision Result (Photo provided but visionData is null)
  it('displays banner when photo exists but vision analysis is missing', () => {
    const incident = {
      id: 'inc-12',
      photo_url: samplePhotoUrl,
      ai_analysis: [],
    };

    render(<EvidenceComparisonCard incident={incident} />);

    expect(screen.getByTestId('original-photo-img')).toBeDefined();
    expect(screen.getByTestId('no-vision-data-banner')).toBeDefined();
    expect(screen.getByText(/No AI visual analysis is available for this incident/i)).toBeDefined();
  });

  // 13. No Reliable Detection State
  it('renders no reliable detection banner without claiming plant is healthy', () => {
    const noDetVision = {
      image_width: 800,
      image_height: 600,
      status: 'no_reliable_detection',
      detections: [],
    };

    const incident = {
      id: 'inc-13',
      photo_url: samplePhotoUrl,
      ai_analysis: [{ structured_data: { vision: noDetVision } }],
    };

    render(<EvidenceComparisonCard incident={incident} />);

    expect(screen.getByTestId('no-detection-banner')).toBeDefined();
    expect(screen.getByText(/No reliable visual finding detected/i)).toBeDefined();
    expect(screen.queryByText(/healthy/i)).toBeNull();
  });

  // 14. Vision Analysis Failure State
  it('renders analysis failed banner while preserving original photo', () => {
    const failedVision = {
      status: 'analysis_failed',
      detections: [],
    };

    const incident = {
      id: 'inc-14',
      photo_url: samplePhotoUrl,
      ai_analysis: [{ structured_data: { vision: failedVision } }],
    };

    render(<EvidenceComparisonCard incident={incident} />);

    expect(screen.getByTestId('analysis-failed-banner')).toBeDefined();
    expect(screen.getByText(/AI image analysis unavailable/i)).toBeDefined();
    expect(screen.getByTestId('original-photo-img')).toBeDefined();
  });

  // 15. AI Assessment Placeholder Section (Readiness)
  it('renders AI Assessment placeholder section for upcoming Step 3', () => {
    const incident = {
      id: 'inc-15',
      photo_url: samplePhotoUrl,
      audio_url: sampleAudioUrl,
    };

    render(<EvidenceComparisonCard incident={incident} />);

    expect(screen.getByTestId('ai-assessment-section')).toBeDefined();
    expect(screen.getByText(/AI Assessment not available yet/i)).toBeDefined();
  });

  // 16. Graceful Handling of Null / Missing Fields
  it('handles completely empty incident object without crashing', () => {
    const emptyIncident = { id: 'empty-1' };
    render(<EvidenceComparisonCard incident={emptyIncident} />);

    expect(screen.getByTestId('no-voice-empty-state')).toBeDefined();
    expect(screen.getByTestId('no-photo-empty-state')).toBeDefined();
  });

  // 17. Disclaimers: Voice Observations are Not Confirmed Diagnoses
  it('renders farmer-reported observation note in voice card', () => {
    const incident = {
      id: 'inc-17',
      ai_analysis: [fullVoiceData],
    };

    render(<EvidenceComparisonCard incident={incident} />);

    expect(screen.getByText(/Farmer-Reported Observation/i)).toBeDefined();
    expect(screen.getByText(/All items above are extracted from the farmer's voice statement/i)).toBeDefined();
  });

  // 18. Mandatory AEO Authority Disclaimer Banner
  it('renders master AEO human review authority banner', () => {
    const incident = {
      id: 'inc-18',
      photo_url: samplePhotoUrl,
    };

    render(<EvidenceComparisonCard incident={incident} />);

    expect(screen.getByTestId('aeo-authority-banner')).toBeDefined();
    expect(screen.getByText(/AEO HUMAN REVIEW REQUIRED/i)).toBeDefined();
    expect(screen.getByText(/Final diagnosis, advisory confirmation, and field dispatch belong to the Agricultural Extension Officer/i)).toBeDefined();
  });

  // 19. Two Voice Options: Listen Directly vs View Summary Switching
  it('allows switching between Option 1 (Listen Directly) and Option 2 (View Summary)', () => {
    const incident = {
      id: 'inc-19',
      audio_url: sampleAudioUrl,
      ai_analysis: [fullVoiceData],
    };

    render(<EvidenceComparisonCard incident={incident} />);

    // Check mode buttons exist
    expect(screen.getByTestId('voice-mode-listen-btn')).toBeDefined();
    expect(screen.getByTestId('voice-mode-summary-btn')).toBeDefined();
    expect(screen.getByTestId('voice-mode-all-btn')).toBeDefined();

    // Switch to Listen Directly
    fireEvent.click(screen.getByTestId('voice-mode-listen-btn'));
    expect(screen.getByTestId('voice-audio-player')).toBeDefined();
    expect(screen.queryByTestId('voice-attributes-grid')).toBeNull();

    // Switch to View Summary
    fireEvent.click(screen.getByTestId('voice-mode-summary-btn'));
    expect(screen.getByTestId('voice-attributes-grid')).toBeDefined();
    expect(screen.queryByTestId('voice-audio-player')).toBeNull();

    // Switch back to Both
    fireEvent.click(screen.getByTestId('voice-mode-all-btn'));
    expect(screen.getByTestId('voice-audio-player')).toBeDefined();
    expect(screen.getByTestId('voice-attributes-grid')).toBeDefined();
  });

  // 20. Tomato Incident Voice Evidence & Separation from Vision
  it('renders all farmer voice-derived attributes for tomato incident while maintaining vision separation', () => {
    const tomatoIncident = {
      id: '392f281c-1caa-41e9-93d7-f7d712881938',
      crop: 'టమాటా',
      description: 'Farmer reports round brown spots on tomato leaves for the past 5 days, which are spreading and causing some leaves to dry.',
      audio_url: 'http://localhost:8000/uploads/audio/sample_tomato.webm',
      photo_url: samplePhotoUrl,
      ai_analysis: [
        {
          id: 'ai-vision-1',
          structured_data: {
            vision: {
              status: 'detected',
              detections: [{ bbox: { x1: 27, y1: 26, x2: 300, y2: 310 }, label: 'early_blight', confidence: 0.817 }],
            },
          },
        },
      ],
    };

    render(<EvidenceComparisonCard incident={tomatoIncident} />);

    // 1. Voice Evidence (Option 2)
    expect(screen.getByTestId('voice-crop-item')).toHaveTextContent(/టమాటా|Tomato/i);
    expect(screen.getByTestId('voice-duration-item')).toHaveTextContent(/5 days/i);
    expect(screen.getByTestId('voice-part-item')).toHaveTextContent(/Leaves/i);
    expect(screen.getByTestId('voice-progression-item')).toHaveTextContent(/Spreading/i);
    expect(screen.getByTestId('voice-severity-item')).toHaveTextContent(/Spreading|Moderate/i);
    expect(screen.getByTestId('voice-symptoms-box')).toHaveTextContent(/round brown spots/i);

    // 2. Vision Section remains distinct with YOLO detection
    expect(screen.getByTestId('image-evidence-section')).toBeDefined();
    expect(screen.getAllByText(/Early Blight/i).length).toBeGreaterThanOrEqual(1);
  });
});
