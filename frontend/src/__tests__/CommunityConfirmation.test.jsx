import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import CommunityConfirmationSection from '../components/CommunityConfirmationSection';
import * as api from '../services/api';

vi.mock('../services/api');

describe('Phase 10: Community Confirmation Component Tests', () => {
  const mockIncidentWithNearby = {
    id: 'inc-community-100',
    crop: 'Paddy',
    has_nearby_complaints: true,
    nearby_complaints_count: 4,
    community_stats: {
      yes_count: 3,
      no_count: 1,
      not_sure_count: 2,
      total_responses: 6,
    },
  };

  const mockIncidentIsolated = {
    id: 'inc-isolated-200',
    crop: 'Cotton',
    has_nearby_complaints: false,
    nearby_complaints_count: 0,
    community_stats: {
      yes_count: 0,
      no_count: 0,
      not_sure_count: 0,
      total_responses: 0,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders aggregated confirmation counts and safety disclaimer', () => {
    render(<CommunityConfirmationSection incident={mockIncidentWithNearby} />);

    expect(screen.getByTestId('community-confirmation-section')).toBeInTheDocument();
    expect(screen.getByTestId('comm-yes-count')).toHaveTextContent('3');
    expect(screen.getByTestId('comm-no-count')).toHaveTextContent('1');
    expect(screen.getByTestId('comm-notsure-count')).toHaveTextContent('2');
    expect(screen.getByTestId('comm-total-count')).toHaveTextContent('6');

    // Safety disclaimer
    expect(screen.getByTestId('community-safety-note')).toBeInTheDocument();
    expect(screen.getAllByText(/Supporting Field Evidence/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/not a confirmed disease or outbreak diagnosis/i)).toBeInTheDocument();
  });

  it('displays nearby complaints alert banner when nearby reports exist', () => {
    render(<CommunityConfirmationSection incident={mockIncidentWithNearby} />);
    expect(screen.getByText(/4 nearby complaints/i)).toBeInTheDocument();
  });

  it('displays single isolated notice when no nearby complaints exist', () => {
    render(<CommunityConfirmationSection incident={mockIncidentIsolated} />);
    expect(screen.getByText(/Single isolated report/i)).toBeInTheDocument();
  });

  it('allows nearby farmer to open form, select YES/NO/NOT_SURE and submit response', async () => {
    api.submitCommunityConfirmation.mockResolvedValue({
      success: true,
      incident_id: 'inc-community-100',
      response: 'YES',
      stats: {
        yes_count: 4,
        no_count: 1,
        not_sure_count: 2,
        total_responses: 7,
      },
      message: 'Community confirmation recorded successfully.',
    });

    const onSubmitted = vi.fn();
    render(
      <CommunityConfirmationSection
        incident={mockIncidentWithNearby}
        onConfirmationSubmitted={onSubmitted}
      />
    );

    // Open form
    const toggleBtn = screen.getByTestId('toggle-add-confirmation-btn');
    fireEvent.click(toggleBtn);

    expect(screen.getByTestId('community-response-form')).toBeInTheDocument();
    expect(screen.getByText(/Have you seen this problem on nearby fields/i)).toBeInTheDocument();

    // Select YES
    const radioYes = screen.getByTestId('radio-response-yes');
    fireEvent.click(radioYes);

    // Fill phone number
    const phoneInput = screen.getByTestId('farmer-phone-input');
    fireEvent.change(phoneInput, { target: { value: '9876543210' } });

    // Fill farmer name
    const nameInput = screen.getByTestId('farmer-name-input');
    fireEvent.change(nameInput, { target: { value: 'Srinivas' } });

    // Submit
    const submitBtn = screen.getByTestId('submit-confirmation-btn');
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(api.submitCommunityConfirmation).toHaveBeenCalledWith({
        incidentId: 'inc-community-100',
        farmerPhone: '9876543210',
        farmerName: 'Srinivas',
        response: 'YES',
      });
      expect(screen.getByTestId('comm-yes-count')).toHaveTextContent('4');
      expect(screen.getByTestId('comm-total-count')).toHaveTextContent('7');
      expect(onSubmitted).toHaveBeenCalled();
    });
  });

  it('displays error message when phone number is too short or invalid', async () => {
    render(<CommunityConfirmationSection incident={mockIncidentWithNearby} />);

    fireEvent.click(screen.getByTestId('toggle-add-confirmation-btn'));

    const phoneInput = screen.getByTestId('farmer-phone-input');
    fireEvent.change(phoneInput, { target: { value: '123' } });

    const submitBtn = screen.getByTestId('submit-confirmation-btn');
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByTestId('confirmation-error-msg')).toHaveTextContent(/valid 10-digit/i);
    });
  });

  it('displays duplicate prevention error from backend gracefully', async () => {
    api.submitCommunityConfirmation.mockRejectedValue(
      new Error('Farmer with phone +919876543210 has already submitted a community response for this incident.')
    );

    render(<CommunityConfirmationSection incident={mockIncidentWithNearby} />);

    fireEvent.click(screen.getByTestId('toggle-add-confirmation-btn'));

    const phoneInput = screen.getByTestId('farmer-phone-input');
    fireEvent.change(phoneInput, { target: { value: '9876543210' } });

    const submitBtn = screen.getByTestId('submit-confirmation-btn');
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByTestId('confirmation-error-msg')).toHaveTextContent(/already submitted/i);
    });
  });
});
