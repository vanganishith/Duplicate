import React from 'react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import FarmerAiAssistant from '../components/FarmerAiAssistant';
import { LanguageProvider } from '../context/LanguageContext';
import * as api from '../services/api';

describe('Farmer AI Complaint Assistant Flow', () => {
  const mockFarmer = {
    name: 'Ramesh Reddy',
    phone: '9876543210',
    crop: 'Paddy',
    latitude: 17.4576,
    longitude: 78.6676,
  };

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('kisaansathi_lang', 'en');

    window.SpeechSynthesisUtterance = vi.fn();
    window.speechSynthesis = {
      speak: vi.fn(),
      cancel: vi.fn(),
    };

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

    global.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
    global.URL.revokeObjectURL = vi.fn();
  });

  const renderComponent = (farmer = mockFarmer) => {
    return render(
      <MemoryRouter>
        <LanguageProvider>
          <FarmerAiAssistant farmer={farmer} onSwitchFarmer={vi.fn()} />
        </LanguageProvider>
      </MemoryRouter>
    );
  };

  // =========================================================================
  // 1. SCREEN 1 (WELCOME / START COMPLAINT)
  // =========================================================================
  it('renders Screen 1 with prominent Start Complaint button and verified profile', () => {
    renderComponent();

    expect(screen.getByTestId('farmer-assistant-screen-1')).toBeInTheDocument();
    expect(screen.getByText(/Start a Complaint/i)).toBeInTheDocument();
    expect(screen.getByText(/Ramesh Reddy/i)).toBeInTheDocument();
    expect(screen.getByTestId('start-complaint-btn')).toBeInTheDocument();
  });

  // =========================================================================
  // 2. SCREEN 2: INITIAL AI GREETING & RECORD BUTTON
  // =========================================================================
  it('navigates to Screen 2 upon clicking Start Complaint and shows AI greeting', () => {
    renderComponent();

    const startBtn = screen.getByTestId('start-complaint-btn');
    fireEvent.click(startBtn);

    expect(screen.getByTestId('farmer-assistant-screen-2')).toBeInTheDocument();
    expect(screen.getByTestId('ai-bubble-greeting')).toBeInTheDocument();
    expect(screen.getByText(/Tell me about your farming problem/i)).toBeInTheDocument();
    expect(screen.getByTestId('record-voice-btn')).toBeInTheDocument();
  });

  // =========================================================================
  // 3. CASE A: NON-AGRICULTURAL COMPLAINT REJECTION
  // =========================================================================
  it('handles NOT_AGRICULTURE_RELATED: asks politely, offers Record Again, no photos, no incident', async () => {
    vi.spyOn(api, 'performIndicAsr').mockResolvedValue({
      transcript: 'I want to sell my car for good price',
    });

    vi.spyOn(api, 'analyzeConfirmedTranscript').mockResolvedValue({
      agriculture_related: false,
      intent_classification: 'NOT_AGRICULTURE_RELATED',
      conversational_response: 'Please tell me about a crop or plant problem.',
      reason: 'The complaint discusses selling a vehicle.',
      crop_detected: null,
      photo_guidance: [],
    });

    renderComponent();
    fireEvent.click(screen.getByTestId('start-complaint-btn'));

    // Trigger recording
    fireEvent.click(screen.getByTestId('record-voice-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('stop-voice-btn')).toBeInTheDocument();
    });

    // Trigger stop
    fireEvent.click(screen.getByTestId('stop-voice-btn'));

    // Verify non-agri card rendered
    await waitFor(() => {
      expect(screen.getByTestId('non-agri-notice')).toBeInTheDocument();
    });

    expect(screen.getByText(/Please tell me about a crop or plant problem/i)).toBeInTheDocument();
    expect(screen.getByTestId('record-again-btn')).toBeInTheDocument();
    // Photos must NOT be requested
    expect(screen.queryByTestId('take-photo-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('submit-complaint-btn')).not.toBeInTheDocument();
  });

  // =========================================================================
  // 4. CASE B: UNCLEAR COMPLAINT
  // =========================================================================
  it('handles UNCLEAR intent: asks clarification question and allows re-recording', async () => {
    vi.spyOn(api, 'performIndicAsr').mockResolvedValue({
      transcript: 'Leaves are spoiled',
    });

    vi.spyOn(api, 'analyzeConfirmedTranscript').mockResolvedValue({
      agriculture_related: true,
      intent_classification: 'UNCLEAR',
      conversational_response: 'Which crop is affected and what problem are you seeing?',
      clarification_question: 'Which crop is affected and what problem are you seeing?',
      photo_guidance: [],
    });

    renderComponent();
    fireEvent.click(screen.getByTestId('start-complaint-btn'));

    fireEvent.click(screen.getByTestId('record-voice-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('stop-voice-btn')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('stop-voice-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('unclear-notice')).toBeInTheDocument();
    });

    expect(screen.getByTestId('unclear-notice')).toHaveTextContent(/Which crop is affected and what problem are you seeing/i);
    expect(screen.getByTestId('record-again-btn')).toBeInTheDocument();
  });

  // =========================================================================
  // 5. CASE C: AGRICULTURE_RELATED & PHOTO FLOW & SUBMISSION
  // =========================================================================
  it('handles AGRICULTURE_RELATED: shows summary card, advances to photo guidance, and submits', async () => {
    vi.spyOn(api, 'performIndicAsr').mockResolvedValue({
      transcript: 'Paddy leaves drying and turning yellow',
    });

    vi.spyOn(api, 'analyzeConfirmedTranscript').mockResolvedValue({
      agriculture_related: true,
      intent_classification: 'AGRICULTURE_RELATED',
      conversational_response: 'We understood your farming problem. Does this look correct?',
      photo_instructions_prompt: 'Please take clear photos of the affected leaves.',
      complaint_summary_localized: {
        crop_label: 'Crop',
        crop_value: 'Paddy',
        problem_label: 'Problem',
        problem_value: 'Paddy leaves drying and turning yellow',
        duration_label: 'Duration',
        duration_value: '4 days',
        progression_label: 'Progress',
        progression_value: 'Spreading across field',
      },
      photo_guidance: [
        'Take a clear photo of the yellowing leaves',
        'Take a wider photo showing the affected field patch',
      ],
      crop_detected: 'Paddy',
    });

    vi.spyOn(api, 'submitIncident').mockResolvedValue({
      status: 'success',
      incident_id: 'inc-12345',
      reference_id: 'RB-TEST1234',
      crop: 'Paddy',
    });

    renderComponent();
    fireEvent.click(screen.getByTestId('start-complaint-btn'));

    fireEvent.click(screen.getByTestId('record-voice-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('stop-voice-btn')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('stop-voice-btn'));

    // Summary Card appears
    await waitFor(() => {
      expect(screen.getByTestId('farmer-summary-card')).toBeInTheDocument();
    });

    expect(screen.getByText('Paddy')).toBeInTheDocument();
    expect(screen.getByTestId('confirm-summary-btn')).toBeInTheDocument();

    // Click [✓ Yes, Continue]
    fireEvent.click(screen.getByTestId('confirm-summary-btn'));

    // Photo Guidance appears
    expect(screen.getByTestId('ai-photo-guidance-bubble')).toBeInTheDocument();
    expect(screen.getByText(/Take a clear photo of the yellowing leaves/i)).toBeInTheDocument();
    expect(screen.getByTestId('take-photo-btn')).toBeInTheDocument();
    expect(screen.getByTestId('choose-photo-btn')).toBeInTheDocument();

    // Attach 1 photo via file input
    const testFile = new File(['leaf'], 'crop_leaf.jpg', { type: 'image/jpeg' });
    const galleryInput = screen.getByTestId('gallery-input');
    fireEvent.change(galleryInput, { target: { files: [testFile] } });

    // Verify thumbnail and submit button
    await waitFor(() => {
      expect(screen.getByTestId('photo-thumb-0')).toBeInTheDocument();
    });

    const submitBtn = screen.getByTestId('submit-complaint-btn');
    expect(submitBtn).not.toBeDisabled();

    // Submit complaint
    fireEvent.click(submitBtn);

    // Screen 3 Success Card appears
    await waitFor(() => {
      expect(screen.getByTestId('farmer-assistant-screen-3')).toBeInTheDocument();
    });

    expect(screen.getByText('RB-TEST1234')).toBeInTheDocument();
    expect(screen.getByTestId('report-another-btn')).toBeInTheDocument();
  });

  // =========================================================================
  // 6. PHOTO FAILURE PRESERVES VOICE COMPLAINT
  // =========================================================================
  it('preserves voice complaint when photos fail verification and displays retry alert', async () => {
    vi.spyOn(api, 'performIndicAsr').mockResolvedValue({
      transcript: 'Cotton leaves have white spots',
    });

    vi.spyOn(api, 'analyzeConfirmedTranscript').mockResolvedValue({
      agriculture_related: true,
      intent_classification: 'AGRICULTURE_RELATED',
      conversational_response: 'Complaint understood.',
      photo_instructions_prompt: 'Please upload cotton leaf photos.',
      complaint_summary_localized: {
        crop_label: 'Crop',
        crop_value: 'Cotton',
        problem_label: 'Problem',
        problem_value: 'Cotton leaves have white spots',
      },
      photo_guidance: ['Take a closeup of the spot'],
      crop_detected: 'Cotton',
    });

    // Mock photo verification failure
    const photoErr = new Error('The photo did not show clear crop or plant evidence.');
    photoErr.photo_retry_required = true;
    vi.spyOn(api, 'submitIncident').mockRejectedValue(photoErr);

    renderComponent();
    fireEvent.click(screen.getByTestId('start-complaint-btn'));

    fireEvent.click(screen.getByTestId('record-voice-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('stop-voice-btn')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('stop-voice-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('confirm-summary-btn')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('confirm-summary-btn'));

    const testFile = new File(['blurry'], 'blurry.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByTestId('gallery-input'), { target: { files: [testFile] } });

    await waitFor(() => {
      expect(screen.getByTestId('submit-complaint-btn')).not.toBeDisabled();
    });

    fireEvent.click(screen.getByTestId('submit-complaint-btn'));

    // Retry alert is shown, voice message preserved
    await waitFor(() => {
      expect(screen.getByTestId('photo-retry-banner')).toBeInTheDocument();
    });

    expect(screen.getByText(/Your voice complaint is safe and does not need to be re-recorded/i)).toBeInTheDocument();
    // Transcript bubble still visible
    expect(screen.getByTestId('farmer-transcript-bubble')).toBeInTheDocument();
  });

  // =========================================================================
  // 7. TELUGU LOCALIZATION CONSISTENCY
  // =========================================================================
  it('renders strictly in Telugu when Telugu is selected with no English instructions', () => {
    localStorage.setItem('kisaansathi_lang', 'te');
    renderComponent();

    // Screen 1 in Telugu
    expect(screen.getByText(/సమస్య నమోదును ప్రారంభించండి/i)).toBeInTheDocument();
    expect(screen.getByTestId('start-complaint-btn')).toHaveTextContent(/సమస్యను ప్రారంభించండి/i);

    fireEvent.click(screen.getByTestId('start-complaint-btn'));

    // Screen 2 in Telugu
    expect(screen.getByText(/మీ వ్యవసాయ సమస్య గురించి చెప్పండి/i)).toBeInTheDocument();
    expect(screen.getByTestId('record-voice-btn')).toHaveTextContent(/మీ సమస్యను మాట్లాడండి/i);
  });

  // =========================================================================
  // 8. IRRELEVANT PHOTO RETRY LOCALIZATION (TELUGU)
  // =========================================================================
  it('displays and speaks irrelevant photo retry message in Telugu when Telugu is selected', async () => {
    localStorage.setItem('kisaansathi_lang', 'te');

    vi.spyOn(api, 'performIndicAsr').mockResolvedValue({
      transcript: 'వరి పంట సమస్య',
    });

    vi.spyOn(api, 'analyzeConfirmedTranscript').mockResolvedValue({
      agriculture_related: true,
      intent_classification: 'AGRICULTURE_RELATED',
      conversational_response: 'సమస్య వివరాలు అర్థమయ్యాయి.',
      photo_instructions_prompt: 'ఫోటోలు పంపండి.',
      complaint_summary_localized: {
        crop_label: 'పంట',
        crop_value: 'వరి',
        problem_label: 'సమస్య',
        problem_value: 'వరి పంట సమస్య',
      },
      photo_guidance: ['ఆకుల ఫోటో తీయండి'],
      crop_detected: 'Paddy',
    });

    const photoErr = new Error('The uploaded photo(s) appear to show a different plant');
    photoErr.photo_retry_required = true;
    photoErr.detail = {
      message_localized: 'మీరు పంపిన ఫోటో మీ సమస్యకు లేదా వరికి సంబంధించినదిగా కనిపించడం లేదు. మీ వాయిస్ నమోదు భద్రంగా ఉంది. దయచేసి మీ వరి దెబ్బతిన్న భాగాన్ని స్పష్టంగా చూపిస్తూ మరొక ఫోటో పంపండి.',
      reason_type: 'WRONG_CROP',
    };
    vi.spyOn(api, 'submitIncident').mockRejectedValue(photoErr);

    renderComponent();
    fireEvent.click(screen.getByTestId('start-complaint-btn'));

    fireEvent.click(screen.getByTestId('record-voice-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('stop-voice-btn')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('stop-voice-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('confirm-summary-btn')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('confirm-summary-btn'));

    const testFile = new File(['car'], 'car.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByTestId('gallery-input'), { target: { files: [testFile] } });

    await waitFor(() => {
      expect(screen.getByTestId('submit-complaint-btn')).not.toBeDisabled();
    });
    fireEvent.click(screen.getByTestId('submit-complaint-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('photo-retry-banner')).toBeInTheDocument();
    });

    // Verify Telugu banner title and retry text
    expect(screen.getByText('మరొక ఫోటో అవసరం')).toBeInTheDocument();
    expect(screen.getByText(/మీరు పంపిన ఫోటో మీ సమస్యకు లేదా వరికి సంబంధించినదిగా కనిపించడం లేదు/i)).toBeInTheDocument();
    expect(screen.getAllByText(/మీ వాయిస్ నమోదు భద్రంగా ఉంది/i).length).toBeGreaterThanOrEqual(1);
  });
});
