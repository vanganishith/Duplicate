import React from 'react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import NearbyCommunityIssues from '../components/NearbyCommunityIssues';
import * as api from '../services/api';

describe('NearbyCommunityIssues Component (3 KM Farmer-Facing Feed)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const mockNearbyResponse = {
    success: true,
    count: 2,
    radius_km: 3.0,
    items: [
      {
        id: 'inc-near-1',
        crop: 'Tomato',
        problem_summary: 'Round brown spots on leaves for 5 days',
        description: 'Spreading and causing leaf dry',
        distance_km: 0.4,
        distance_text: '0.4 km away',
        locality: 'Near your locality',
        photo_url: 'http://localhost:8000/uploads/photos/leaf1.jpg',
        created_at: '2026-09-03T10:00:00Z',
        status: 'OPEN',
        community_confirmations_count: 2,
        has_similar_crop: true,
      },
      {
        id: 'inc-near-2',
        crop: 'Paddy',
        problem_summary: 'Yellowing in leaf tips',
        description: 'Tip burn symptoms observed',
        distance_km: 1.8,
        distance_text: '1.8 km away',
        locality: 'Warangal Rural Area',
        photo_url: null,
        created_at: '2026-09-02T12:00:00Z',
        status: 'OPEN',
        community_confirmations_count: 0,
        has_similar_crop: false,
      },
    ],
  };

  it('does not render when latitude or longitude are missing', () => {
    const { container } = render(
      <NearbyCommunityIssues latitude={null} longitude={null} crop="Tomato" />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nearby issues with distance badges and privacy protection badge', async () => {
    vi.spyOn(api, 'getNearbyCommunityIncidents').mockResolvedValue(mockNearbyResponse);

    render(
      <NearbyCommunityIssues
        latitude={17.9689}
        longitude={79.5941}
        crop="Tomato"
        farmerPhone="9876543210"
        farmerName="Ramesh"
      />
    );

    expect(screen.getByTestId('nearby-loading')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId('nearby-community-section')).toBeInTheDocument();
    });

    expect(screen.getByText(/Similar Community Issues Nearby/i)).toBeInTheDocument();
    expect(screen.getByText(/Within 3 km of your selected farm location/i)).toBeInTheDocument();
    expect(screen.getByText(/🔒 Privacy Protected/i)).toBeInTheDocument();

    // Verify distance badges
    expect(screen.getByText(/0.4 km away/i)).toBeInTheDocument();
    expect(screen.getByText(/1.8 km away/i)).toBeInTheDocument();

    // Verify problem summaries
    expect(screen.getByText(/Round brown spots on leaves for 5 days/i)).toBeInTheDocument();
    expect(screen.getByText(/Yellowing in leaf tips/i)).toBeInTheDocument();

    // Verify confirmation counts
    expect(screen.getByText(/2 nearby farmers confirmed/i)).toBeInTheDocument();
    expect(screen.getByText(/Be the first to confirm/i)).toBeInTheDocument();
  });

  it('renders empty state "No similar issues found nearby" when count is 0', async () => {
    vi.spyOn(api, 'getNearbyCommunityIncidents').mockResolvedValue({
      success: true,
      count: 0,
      radius_km: 3.0,
      items: [],
      message: 'No similar issues found nearby.',
    });

    render(
      <NearbyCommunityIssues
        latitude={17.9689}
        longitude={79.5941}
        crop="Tomato"
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('nearby-empty-state')).toBeInTheDocument();
    });

    expect(screen.getByText(/No similar issues found nearby/i)).toBeInTheDocument();
    expect(screen.getByText(/No other complaints recorded within 3 km/i)).toBeInTheDocument();
  });

  it('submits community confirmation (Me Too) without creating a new incident', async () => {
    vi.spyOn(api, 'getNearbyCommunityIncidents').mockResolvedValue(mockNearbyResponse);
    const confirmSpy = vi.spyOn(api, 'submitCommunityConfirmation').mockResolvedValue({
      success: true,
      incident_id: 'inc-near-1',
      stats: { yes_count: 3 },
    });

    render(
      <NearbyCommunityIssues
        latitude={17.9689}
        longitude={79.5941}
        crop="Tomato"
        farmerPhone="9876543210"
        farmerName="Ramesh"
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('me-too-btn-inc-near-1')).toBeInTheDocument();
    });

    const meTooBtn = screen.getByTestId('me-too-btn-inc-near-1');
    fireEvent.click(meTooBtn);

    await waitFor(() => {
      expect(confirmSpy).toHaveBeenCalledWith({
        incidentId: 'inc-near-1',
        farmerPhone: '9876543210',
        response: 'YES',
        farmerName: 'Ramesh',
        latitude: 17.9689,
        longitude: 79.5941,
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('me-too-confirmed')).toBeInTheDocument();
      expect(screen.getByText(/✓ Confirmed \(Me Too recorded\)/i)).toBeInTheDocument();
    });
  });
});
