import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import OfficerAdvisorySection from '../components/OfficerAdvisorySection';
import * as api from '../services/api';

vi.mock('../services/api');

describe('Phase 12: Officer Advisory Component Tests', () => {
  const mockIncidentWithoutAdvisory = {
    id: 'inc-adv-100',
    language: 'Telugu',
    crop: 'Chilli',
    farmers: { name: 'Srinivas', phone: '9876543210', preferred_language: 'Telugu' },
    advisory: null,
  };

  const mockIncidentWithAdvisory = {
    id: 'inc-adv-200',
    language: 'Telugu',
    crop: 'Paddy',
    farmers: { name: 'Ramesh', phone: '9876512345' },
    advisory: {
      original_advisory: 'Spray 5ml neem oil per liter in early morning.',
      target_language: 'Telugu',
      language_code: 'te',
      localized_advisory: 'ఉదయం పూట లీటరు నీటికి 5 మి.లీ వేప నూనెను పిచికారీ చేయండి.',
      audio_url: '/uploads/advisory_audio/advisory_inc-adv-200_te.mp3',
      officer_id: 'AEO001',
      created_at: '2026-09-02T10:30:00Z',
    },
  };

  const mockIncidentAudioFallback = {
    id: 'inc-adv-300',
    language: 'Hindi',
    crop: 'Cotton',
    advisory: {
      original_advisory: 'Apply bio-fertilizer before irrigation.',
      target_language: 'Hindi',
      language_code: 'hi',
      localized_advisory: 'सिंचाई से पहले जैव उर्वरक का प्रयोग करें।',
      audio_url: null,
      officer_id: 'AEO001',
      created_at: '2026-09-02T11:00:00Z',
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders advisory input form and defaults to farmer preferred language', () => {
    render(<OfficerAdvisorySection incident={mockIncidentWithoutAdvisory} />);

    expect(screen.getByTestId('aeo-advisory-section')).toBeInTheDocument();
    expect(screen.getByTestId('advisory-form-card')).toBeInTheDocument();
    expect(screen.getByTestId('advisory-lang-select')).toHaveValue('Telugu');
    expect(screen.getByTestId('advisory-text-input')).toBeInTheDocument();
    expect(screen.getByTestId('send-advisory-btn')).toBeInTheDocument();
    expect(screen.getByTestId('advisory-safety-note')).toBeInTheDocument();
  });

  it('submits advisory, translates, and displays localized text and audio player', async () => {
    api.submitOfficerAdvisory.mockResolvedValue({
      success: true,
      incident_id: 'inc-adv-100',
      advisory: {
        original_advisory: 'Spray copper fungicide.',
        target_language: 'Telugu',
        language_code: 'te',
        localized_advisory: 'రాగి శిలీంద్ర సంహారిణిని పిచికారీ చేయండి.',
        audio_url: '/uploads/advisory_audio/advisory_inc-adv-100_te.mp3',
        officer_id: 'AEO001',
        created_at: '2026-09-02T12:00:00Z',
      },
      message: 'Advisory saved.',
    });

    const onSaved = vi.fn();
    render(
      <OfficerAdvisorySection
        incident={mockIncidentWithoutAdvisory}
        onAdvisorySaved={onSaved}
      />
    );

    // Type advisory text
    const textInput = screen.getByTestId('advisory-text-input');
    fireEvent.change(textInput, { target: { value: 'Spray copper fungicide.' } });

    // Click submit
    const submitBtn = screen.getByTestId('send-advisory-btn');
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(api.submitOfficerAdvisory).toHaveBeenCalledWith({
        incidentId: 'inc-adv-100',
        advisoryText: 'Spray copper fungicide.',
        targetLanguage: 'Telugu',
        officerId: 'AEO001',
      });
      expect(screen.getByTestId('advisory-display-card')).toBeInTheDocument();
      expect(screen.getByTestId('advisory-localized-text')).toHaveTextContent('రాగి శిలీంద్ర సంహారిణిని పిచికారీ చేయండి.');
      expect(screen.getByTestId('advisory-original-box')).toHaveTextContent('Spray copper fungicide.');
      expect(screen.getByTestId('advisory-audio-player')).toBeInTheDocument();
      expect(onSaved).toHaveBeenCalled();
    });
  });

  it('renders existing advisory with localized text, original text, and audio player', () => {
    render(<OfficerAdvisorySection incident={mockIncidentWithAdvisory} />);

    expect(screen.getByTestId('advisory-display-card')).toBeInTheDocument();
    expect(screen.getByTestId('advisory-lang-badge')).toHaveTextContent('Telugu');
    expect(screen.getByTestId('advisory-localized-text')).toHaveTextContent('ఉదయం పూట లీటరు నీటికి 5 మి.లీ వేప నూనెను పిచికారీ చేయండి.');
    expect(screen.getByTestId('advisory-original-box')).toHaveTextContent('Spray 5ml neem oil per liter in early morning.');
    expect(screen.getByTestId('advisory-audio-player')).toBeInTheDocument();
  });

  it('handles audio fallback when TTS audio is null gracefully', () => {
    render(<OfficerAdvisorySection incident={mockIncidentAudioFallback} />);

    expect(screen.getByTestId('advisory-display-card')).toBeInTheDocument();
    expect(screen.getByTestId('advisory-localized-text')).toHaveTextContent('सिंचाई से पहले जैव उर्वरक का प्रयोग करें।');
    expect(screen.getByTestId('audio-fallback-pill')).toBeInTheDocument();
    expect(screen.queryByTestId('advisory-audio-player')).not.toBeInTheDocument();
  });
});
