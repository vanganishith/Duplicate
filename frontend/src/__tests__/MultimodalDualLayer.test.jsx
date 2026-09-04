import '@testing-library/jest-dom';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AnnotatedImageViewer from '../components/AnnotatedImageViewer';
import EvidenceComparisonCard from '../components/EvidenceComparisonCard';

describe('Dual-Layer Multimodal Visual Evidence Pipeline Tests', () => {
  const samplePhotoUrl = 'https://supabase.co/storage/v1/object/public/incident-photos/sample_tomato.png';

  const sampleYoloVision = {
    image_width: 553,
    image_height: 414,
    status: 'detected',
    detections: [
      {
        bbox: { x1: 27, y1: 26, x2: 300, y2: 310 },
        label: 'early_blight',
        confidence: 0.817,
      },
    ],
  };

  const sampleVisualMappings = [
    {
      image_index: 1,
      image_id: 'image_1',
      label: 'Brown circular lesion on lower leaf',
      description: 'Necrotic foliar lesion with concentric rings and chlorotic halo',
      confidence: 0.88,
      bbox_normalized: { x1: 0.15, y1: 0.2, x2: 0.48, y2: 0.55 },
      source: 'QWEN3_VL',
      evidence_type: 'QWEN_VISUAL_MAPPING',
    },
  ];

  const sampleMultimodalAssessment = {
    model: 'Qwen/Qwen3-VL-30B-A3B-Instruct',
    voice_image_relationship: 'CONSISTENT',
    confidence: 0.88,
    reasoning: 'Reported expanding brown leaf spots align with visible circular necrotic lesions on tomato foliage.',
    supporting_evidence: ['Brown circular lesions on foliage', 'Chlorotic halos around lesions'],
    contradictions: [],
    missing_evidence: [],
    possible_conditions: ['Possible early stage fungal foliar spot or blight'],
    evidence_strength: 'STRONG',
    why_ai_reached_assessment: 'Target lesions with concentric halos observed on tomato leaves.',
    recommended_aeo_checks: [
      'Inspect underside of leaves for sporulation',
      'Check spread across canopy',
    ],
  };

  it('renders both YOLO11 and Qwen3-VL bounding boxes in dual-layer viewer', () => {
    render(
      <AnnotatedImageViewer
        photoUrl={samplePhotoUrl}
        visionData={sampleYoloVision}
        visualMappings={sampleVisualMappings}
      />
    );

    // Both layers are active by default
    expect(screen.getByTestId('vision-svg-overlay')).toBeDefined();
    expect(screen.getByTestId('detection-box-0')).toBeDefined();
    expect(screen.getByTestId('qwen-mapping-box-0')).toBeDefined();

    // Detections & Mappings breakdown lists
    expect(screen.getByTestId('detections-list')).toBeDefined();
    expect(screen.getByTestId('qwen-mappings-list')).toBeDefined();
    expect(screen.getByText(/Computer Vision Detections \(YOLO11\)/i)).toBeDefined();
    expect(screen.getByText(/Multimodal Visual Mappings \(Qwen3-VL\)/i)).toBeDefined();
  });

  it('allows toggling YOLO11 layer off while keeping Qwen3-VL spatial mappings visible', () => {
    render(
      <AnnotatedImageViewer
        photoUrl={samplePhotoUrl}
        visionData={sampleYoloVision}
        visualMappings={sampleVisualMappings}
      />
    );

    const yoloCheckbox = screen.getByTestId('toggle-yolo-layer-checkbox');
    expect(yoloCheckbox.checked).toBe(true);

    // Toggle off YOLO
    fireEvent.click(yoloCheckbox);
    expect(yoloCheckbox.checked).toBe(false);

    // YOLO box should be hidden, Qwen box still rendered
    expect(screen.queryByTestId('detection-box-0')).toBeNull();
    expect(screen.getByTestId('qwen-mapping-box-0')).toBeDefined();
  });

  it('allows toggling Qwen3-VL layer off while keeping YOLO11 detections visible', () => {
    render(
      <AnnotatedImageViewer
        photoUrl={samplePhotoUrl}
        visionData={sampleYoloVision}
        visualMappings={sampleVisualMappings}
      />
    );

    const qwenCheckbox = screen.getByTestId('toggle-qwen-layer-checkbox');
    expect(qwenCheckbox.checked).toBe(true);

    // Toggle off Qwen
    fireEvent.click(qwenCheckbox);
    expect(qwenCheckbox.checked).toBe(false);

    // Qwen box should be hidden, YOLO box still rendered
    expect(screen.queryByTestId('qwen-mapping-box-0')).toBeNull();
    expect(screen.getByTestId('detection-box-0')).toBeDefined();
  });

  it('renders complete Voice <-> Image Cross-Review and AEO Field Checklist in EvidenceComparisonCard', () => {
    const incident = {
      id: 'inc-mm-1',
      photo_url: samplePhotoUrl,
      description: 'Brown spots on tomato leaves',
      crop: 'Tomato',
      multimodal_assessment: sampleMultimodalAssessment,
      voice_image_assessment: {
        relationship: 'CONSISTENT',
        confidence: 0.88,
        reasoning: sampleMultimodalAssessment.reasoning,
        supporting_visual_evidence: sampleMultimodalAssessment.supporting_evidence,
      },
      visual_mappings: sampleVisualMappings,
      ai_analysis: [
        {
          structured_data: {
            vision: sampleYoloVision,
            multimodal_assessment: sampleMultimodalAssessment,
            visual_mappings: sampleVisualMappings,
          },
        },
      ],
    };

    render(<EvidenceComparisonCard incident={incident} />);

    // 1. Cross-review section
    expect(screen.getByTestId('voice-image-cross-review')).toBeDefined();
    expect(screen.getByTestId('assessment-relationship-pill')).toHaveTextContent('CONSISTENT');
    expect(screen.getByText(/Alignment Confidence: 88%/i)).toBeDefined();
    expect(screen.getByText(/Evidence Strength: STRONG/i)).toBeDefined();

    // 2. Supporting evidence points
    expect(screen.getByText(/✓ Brown circular lesions on foliage/i)).toBeDefined();
    expect(screen.getByText(/✓ Chlorotic halos around lesions/i)).toBeDefined();

    // 3. Recommended on-field checklist for AEO
    expect(screen.getByTestId('safe-aeo-approach-section')).toBeDefined();
    expect(screen.getByText(/Recommended On-Field Inspection Checklist for AEO:/i)).toBeDefined();
    expect(screen.getByText(/Inspect underside of leaves for sporulation/i)).toBeDefined();
    expect(screen.getByText(/Check spread across canopy/i)).toBeDefined();

    // 4. Tentative conditions disclaimer
    expect(screen.getByText(/Possible early stage fungal foliar spot or blight/i)).toBeDefined();
    expect(screen.getByText(/Tentative Possibilities for Officer Consideration/i)).toBeDefined();
  });
});
