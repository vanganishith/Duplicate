import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import FarmerAiAssistant from '../components/FarmerAiAssistant';
import SimilarPreviousCasesSection from '../components/SimilarPreviousCasesSection';
import { LanguageProvider } from '../context/LanguageContext';
import * as api from '../services/api';

vi.mock('../services/api', () => ({
  performIndicAsr: vi.fn(),
  analyzeConfirmedTranscript: vi.fn(),
  submitIncident: vi.fn(),
  getSimilarIssues: vi.fn(),
  confirmSimilarIssues: vi.fn(),
  getIncident: vi.fn(),
}));

describe('Similar Issues Check Feature', () => {
  const mockFarmer = {
    id: 'farmer-101',
    name: 'Ramesh Reddy',
    phone: '9876543210',
    village: 'Ghatkesar',
    crop: 'టమాటా',
    latitude: 17.45,
    longitude: 78.66,
  };

  const sampleSimilarIssues = [
    {
      incident_id: 'inc-hist-1',
      crop: 'టమాటా',
      problem: 'ఆకులపై గోధుమ రంగు మచ్చలు వ్యాపించాయి',
      location_label: 'మీ ప్రాంతం సమీపంలో',
      verification_status: 'AEO_VERIFIED',
      outcome: 'AEO confirmed early blight. Field verification and official advisory issued.',
      why_similar: 'టమాటా ఆకులపై ఇలాంటి మచ్చలు గతంలో నమోదయ్యాయి.',
      image_url: 'https://example.com/hist1.jpg',
    },
    {
      incident_id: 'inc-hist-2',
      crop: 'టమాటా',
      problem: 'ఆకులు ఎండిపోవడం మరియు రాలిపోవడం',
      location_label: 'సుమారు 3 కి.మీ దూరంలో',
      verification_status: 'AI_PRELIMINARY',
      outcome: 'Under observation by local agricultural officer.',
      why_similar: 'ఆకులు ఎండిపోయే లక్షణాలు సరిపోలుతున్నాయి.',
      image_url: null,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem('kisaansathi_lang', 'te');

    window.SpeechSynthesisUtterance = vi.fn();
    global.SpeechSynthesisUtterance = vi.fn();
    window.speechSynthesis = {
      speak: vi.fn(),
      cancel: vi.fn(),
    };
    global.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
    global.URL.revokeObjectURL = vi.fn();

    function MockMediaRecorder() {
      this.start = vi.fn();
      this.stop = vi.fn().mockImplementation(() => {
        if (this.onstop) this.onstop();
      });
      this.ondataavailable = null;
      this.onstop = null;
    }
    MockMediaRecorder.isTypeSupported = vi.fn().mockReturnValue(true);
    window.MediaRecorder = MockMediaRecorder;
    global.MediaRecorder = MockMediaRecorder;

    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: () => [{ stop: vi.fn() }],
        }),
      },
      writable: true,
      configurable: true,
    });
  });

  const advanceToPhotoGuidanceAndAttach = async (crop = 'టమాటా') => {
    api.performIndicAsr.mockResolvedValueOnce({
      transcript: 'ఆకులపై మచ్చలు ఉన్నాయి',
    });

    api.analyzeConfirmedTranscript.mockResolvedValueOnce({
      agriculture_related: true,
      intent_classification: 'AGRICULTURE_RELATED',
      conversational_response: 'మీ సమస్య అర్థమైంది.',
      photo_instructions_prompt: 'దయచేసి కొన్ని ఫోటోలు తీయండి.',
      complaint_summary_localized: {
        crop_label: 'పంట',
        crop_value: crop,
        problem_label: 'సమస్య',
        problem_value: 'ఆకులపై మచ్చలు',
      },
      crop_detected: crop,
    });

    fireEvent.click(screen.getByTestId('start-complaint-btn'));
    fireEvent.click(screen.getByTestId('record-voice-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('stop-voice-btn')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('stop-voice-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('confirm-summary-btn')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('confirm-summary-btn'));

    const file = new File(['dummy'], 'crop.jpg', { type: 'image/jpeg' });
    const galleryInput = screen.getByTestId('gallery-input');
    fireEvent.change(galleryInput, { target: { files: [file] } });
  };

  it('renders Similar Issues Check screen when matching historical cases are found after submission', async () => {
    api.submitIncident.mockResolvedValueOnce({
      success: true,
      incident_id: 'inc-new-1',
      reference_id: 'RB-NEW001',
      crop: 'టమాటా',
    });

    api.getSimilarIssues.mockResolvedValueOnce({
      success: true,
      incident_id: 'inc-new-1',
      similar_issues: sampleSimilarIssues,
    });

    render(
      <BrowserRouter>
        <LanguageProvider>
          <FarmerAiAssistant farmer={mockFarmer} />
        </LanguageProvider>
      </BrowserRouter>
    );

    await advanceToPhotoGuidanceAndAttach('టమాటా');

    const submitBtn = screen.getByTestId('submit-complaint-btn');
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByTestId('farmer-assistant-similar-issues')).toBeTruthy();
    });

    expect(screen.getByTestId('similar-case-card-0')).toBeTruthy();
    expect(screen.getByTestId('similar-case-card-1')).toBeTruthy();
    expect(screen.getByText('టమాటా ఆకులపై ఇలాంటి మచ్చలు గతంలో నమోదయ్యాయి.')).toBeTruthy();
  });

  it('allows farmer to toggle "Looks Like My Problem" and confirm similar issue on SAME incident', async () => {
    api.submitIncident.mockResolvedValueOnce({
      success: true,
      incident_id: 'inc-new-1',
      reference_id: 'RB-NEW001',
      crop: 'టమాటా',
    });

    api.getSimilarIssues.mockResolvedValueOnce({
      success: true,
      incident_id: 'inc-new-1',
      similar_issues: sampleSimilarIssues,
    });

    api.confirmSimilarIssues.mockResolvedValueOnce({
      success: true,
      incident_id: 'inc-new-1',
      confirmations: [{ matched_incident_id: 'inc-hist-1' }],
    });

    render(
      <BrowserRouter>
        <LanguageProvider>
          <FarmerAiAssistant farmer={mockFarmer} />
        </LanguageProvider>
      </BrowserRouter>
    );

    await advanceToPhotoGuidanceAndAttach('టమాటా');

    fireEvent.click(screen.getByTestId('submit-complaint-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('farmer-assistant-similar-issues')).toBeTruthy();
    });

    // Toggle first case
    const toggleBtn = screen.getByTestId('toggle-match-btn-0');
    fireEvent.click(toggleBtn);

    // Confirm Issue
    const confirmBtn = screen.getByTestId('confirm-similar-issue-btn');
    expect(confirmBtn.disabled).toBe(false);
    fireEvent.click(confirmBtn);

    // Verifies confirmSimilarIssues was called with the SAME incident id
    await waitFor(() => {
      expect(api.confirmSimilarIssues).toHaveBeenCalledWith(
        'inc-new-1',
        ['inc-hist-1'],
        mockFarmer.phone,
        mockFarmer.name
      );
    });

    // Advances smoothly to Screen 3 Success
    await waitFor(() => {
      expect(screen.getByTestId('farmer-assistant-screen-3')).toBeTruthy();
    });
  });

  it('advances directly to Screen 3 when clicking "None of These Match" without attaching confirmation', async () => {
    api.submitIncident.mockResolvedValueOnce({
      success: true,
      incident_id: 'inc-new-2',
      reference_id: 'RB-NEW002',
      crop: 'వరి',
    });

    api.getSimilarIssues.mockResolvedValueOnce({
      success: true,
      incident_id: 'inc-new-2',
      similar_issues: sampleSimilarIssues,
    });

    render(
      <BrowserRouter>
        <LanguageProvider>
          <FarmerAiAssistant farmer={mockFarmer} />
        </LanguageProvider>
      </BrowserRouter>
    );

    await advanceToPhotoGuidanceAndAttach('వరి');

    fireEvent.click(screen.getByTestId('submit-complaint-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('farmer-assistant-similar-issues')).toBeTruthy();
    });

    // Click "None of These Match"
    const noneBtn = screen.getByTestId('none-match-btn');
    fireEvent.click(noneBtn);

    // confirmSimilarIssues was NOT called
    expect(api.confirmSimilarIssues).not.toHaveBeenCalled();

    // Immediately shows Screen 3
    await waitFor(() => {
      expect(screen.getByTestId('farmer-assistant-screen-3')).toBeTruthy();
    });
  });

  it('proceeds directly to Screen 3 without blocking when 0 similar issues are found', async () => {
    api.submitIncident.mockResolvedValueOnce({
      success: true,
      incident_id: 'inc-new-3',
      reference_id: 'RB-NEW003',
      crop: 'మిరప',
    });

    api.getSimilarIssues.mockResolvedValueOnce({
      success: true,
      incident_id: 'inc-new-3',
      similar_issues: [], // 0 matches
    });

    render(
      <BrowserRouter>
        <LanguageProvider>
          <FarmerAiAssistant farmer={mockFarmer} />
        </LanguageProvider>
      </BrowserRouter>
    );

    await advanceToPhotoGuidanceAndAttach('మిరప');

    fireEvent.click(screen.getByTestId('submit-complaint-btn'));

    // Directly transitions to Screen 3 without showing similar issues screen
    await waitFor(() => {
      expect(screen.getByTestId('farmer-assistant-screen-3')).toBeTruthy();
    });
    expect(screen.queryByTestId('farmer-assistant-similar-issues')).toBeNull();
  });

  it('renders SimilarPreviousCasesSection in AEO view with confirmed cases and farmer confirmation signal', () => {
    const mockIncidentWithConfirmations = {
      id: 'inc-aeo-1',
      crop: 'Tomato',
      similar_issue_confirmations: [
        {
          id: 'conf-1',
          matched_incident_id: 'de0d80f9-d221-4da1-b296-4a1fd486efc4',
          matched_crop: 'Tomato',
          matched_problem: 'Farmer reports round brown spots on tomato leaves',
          matched_status: 'RESOLVED',
          matched_photo_url: 'https://example.com/resolved_tomato.jpg',
          created_at: '2026-09-04T12:00:00Z',
        },
      ],
    };

    render(<SimilarPreviousCasesSection incident={mockIncidentWithConfirmations} />);

    expect(screen.getByTestId('aeo-similar-previous-cases')).toBeTruthy();
    expect(screen.getByText('✓ 1 Confirmed by Farmer')).toBeTruthy();
    expect(screen.getByText('✓ Farmer Confirmed: "Looks Like My Problem"')).toBeTruthy();
    expect(screen.getByText(/Previous Complaint:/)).toBeTruthy();
    expect(screen.getByText(/Farmer reports round brown spots on tomato leaves/)).toBeTruthy();
  });
});
