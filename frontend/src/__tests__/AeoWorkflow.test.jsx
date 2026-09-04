import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import AeoDashboard from '../pages/AeoDashboard';
import * as api from '../services/api';

vi.mock('../services/api');

describe('Phase: AEO Officer Workflow Tests', () => {
  const mockIncidents = [
    {
      id: 'inc-001-aaaa',
      farmer_id: 'farmer-1',
      description: 'Chilli leaves turning yellow with brown spots',
      crop: 'Chilli',
      status: 'NEW',
      photo_url: 'https://supabase.co/storage/v1/object/public/incident-photos/leaf.jpg',
      audio_url: 'https://supabase.co/storage/v1/object/public/incident-audio/audio.webm',
      created_at: '2026-09-02T10:00:00Z',
      farmers: { name: 'Ramesh Reddy', phone: '9876543210' },
      ai_analysis: [
        {
          id: 'ai-001',
          transcript: 'మిరప తోటలో ఆకులు పసుపు రంగులోకి మారుతున్నాయి',
          detected_language: 'Telugu',
          crop_detected: 'Chilli',
          symptoms: ['yellow leaves', 'brown spots'],
          structured_data: {
            voice: {
              crop: 'Chilli',
              symptoms: ['yellow leaves', 'brown spots'],
              duration: '4 days',
              affected_part: 'Leaves',
            },
            vision: {
              image_width: 800,
              image_height: 600,
              status: 'detected',
              quality: { level: 'good' },
              detections: [
                {
                  bbox: { x1: 50, y1: 50, x2: 250, y2: 250 },
                  label: 'leaf_spot',
                  confidence: 0.745,
                },
              ],
            },
          },
        },
      ],
    },
    {
      id: 'inc-002-bbbb',
      farmer_id: 'farmer-2',
      description: 'Paddy stem borer issue',
      crop: 'Paddy',
      status: 'ACKNOWLEDGED',
      photo_url: null,
      audio_url: null,
      created_at: '2026-09-01T14:00:00Z',
      farmers: { name: 'Suresh Kumar', phone: '9123456780' },
      ai_analysis: [],
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('aeo_officer_session', JSON.stringify({ officer_id: 'AEO001' }));
    api.listIncidents.mockResolvedValue({ incidents: mockIncidents });
    api.getIncident.mockImplementation(async (id) => {
      const found = mockIncidents.find((i) => i.id === id);
      return { incident: found, ai_analysis: found?.ai_analysis || [] };
    });
  });

  const renderDashboard = () =>
    render(
      <BrowserRouter>
        <AeoDashboard />
      </BrowserRouter>
    );

  // 1. Lists real incidents from API
  it('renders incoming incident triage queue with real incident details', async () => {
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByTestId('incident-item-inc-001-aaaa')).toBeDefined();
      expect(screen.getByTestId('incident-item-inc-002-bbbb')).toBeDefined();
    });

    expect(screen.getAllByText(/Ramesh Reddy/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Suresh Kumar/i).length).toBeGreaterThanOrEqual(1);
  });

  // 2. Audio player uses original persisted audio_url
  it('renders audio player with source farmer audio URL', async () => {
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByTestId('view-details-btn-inc-001-aaaa')).toBeDefined();
    });

    fireEvent.click(screen.getByTestId('view-details-btn-inc-001-aaaa'));

    await waitFor(() => {
      expect(screen.getByTestId('farmer-audio-player')).toBeDefined();
    });

    const audio = screen.getByTestId('farmer-audio-player');
    expect(audio.getAttribute('src')).toBe(mockIncidents[0].audio_url);
  });

  // 3. Structured Data JSON Inspector
  it('toggles structured AI JSON inspector on click', async () => {
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByTestId('view-details-btn-inc-001-aaaa')).toBeDefined();
    });

    fireEvent.click(screen.getByTestId('view-details-btn-inc-001-aaaa'));

    await waitFor(() => {
      expect(screen.getByTestId('toggle-json-viewer-btn')).toBeDefined();
    });

    // Initially hidden
    expect(screen.queryByTestId('json-viewer-body')).toBeNull();

    // Click to open
    fireEvent.click(screen.getByTestId('toggle-json-viewer-btn'));
    expect(screen.getByTestId('json-viewer-body')).toBeDefined();
    expect(screen.getByTestId('structured-json-pre')).toBeDefined();
  });

  // 4. Start Work action updates status to ACKNOWLEDGED
  it('handles Start Work button, calls API, and updates UI status', async () => {
    api.startWorkOnIncident.mockResolvedValue({
      success: true,
      status: 'ACKNOWLEDGED',
      acknowledged_at: '2026-09-02T12:00:00Z',
    });

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByTestId('view-details-btn-inc-001-aaaa')).toBeDefined();
    });

    fireEvent.click(screen.getByTestId('view-details-btn-inc-001-aaaa'));

    await waitFor(() => {
      expect(screen.getByTestId('start-work-btn')).toBeDefined();
    });

    const startWorkBtn = screen.getByTestId('start-work-btn');
    fireEvent.click(startWorkBtn);

    await waitFor(() => {
      expect(api.startWorkOnIncident).toHaveBeenCalledWith('inc-001-aaaa', 'AEO001');
      expect(screen.getByTestId('action-success-banner')).toBeDefined();
      expect(screen.getByText(/Work started successfully/i)).toBeDefined();
    });
  });

  // 5. Reject action opens modal, validates non-empty reason, and updates status
  it('handles Reject action with reason modal and updates incident status', async () => {
    api.rejectIncident.mockResolvedValue({
      success: true,
      status: 'REJECTED',
      rejection_reason: 'Photo does not appear to show a crop',
      rejected_at: '2026-09-02T12:05:00Z',
    });

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByTestId('view-details-btn-inc-001-aaaa')).toBeDefined();
    });

    fireEvent.click(screen.getByTestId('view-details-btn-inc-001-aaaa'));

    await waitFor(() => {
      expect(screen.getByTestId('reject-incident-btn')).toBeDefined();
    });

    // Click reject button to open modal
    fireEvent.click(screen.getByTestId('reject-incident-btn'));
    expect(screen.getByTestId('rejection-modal')).toBeDefined();

    // Attempt to confirm without entering reason -> triggers error
    const confirmBtn = screen.getByTestId('confirm-rejection-btn');
    fireEvent.click(confirmBtn);
    expect(screen.getByTestId('rejection-error-msg')).toBeDefined();

    // Enter valid reason
    const reasonInput = screen.getByTestId('rejection-reason-input');
    fireEvent.change(reasonInput, { target: { value: 'Photo does not appear to show a crop' } });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(api.rejectIncident).toHaveBeenCalledWith(
        'inc-001-aaaa',
        'Photo does not appear to show a crop',
        'AEO001'
      );
      expect(screen.getByTestId('action-success-banner')).toBeDefined();
      expect(screen.getByText(/marked as REJECTED/i)).toBeDefined();
    });
  });

  // 6. RESOLVED incident hides Start Work and Reject buttons and shows completed indicator
  it('hides Start Work and Reject buttons and renders resolved indicator for RESOLVED incident', async () => {
    const resolvedInc = {
      id: 'inc-003-resolved',
      farmer_id: 'farmer-3',
      description: 'Tomato issue resolved',
      crop: 'Tomato',
      status: 'RESOLVED',
      created_at: '2026-09-01T10:00:00Z',
      resolved_at: '2026-09-02T16:00:00Z',
      farmers: { name: 'Anil Kumar', phone: '9848012345' },
      ai_analysis: [],
    };

    api.listIncidents.mockResolvedValue({ incidents: [resolvedInc] });
    api.getIncident.mockResolvedValue({ incident: resolvedInc, ai_analysis: [] });

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByTestId('view-details-btn-inc-003-resolved')).toBeDefined();
    });

    fireEvent.click(screen.getByTestId('view-details-btn-inc-003-resolved'));

    await waitFor(() => {
      expect(screen.getByTestId('resolved-status-indicator')).toBeDefined();
    });

    expect(screen.queryByTestId('start-work-btn')).toBeNull();
    expect(screen.queryByTestId('reject-incident-btn')).toBeNull();
  });
});
