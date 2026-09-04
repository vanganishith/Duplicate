import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import CaseWorkflowSection from '../components/CaseWorkflowSection';
import * as api from '../services/api';

vi.mock('../services/api');

describe('Phase 11: Case Workflow Component Tests', () => {
  const mockNewIncident = {
    id: 'inc-wf-100',
    status: 'NEW',
    description: 'Yellowing leaves on tomato crop',
    created_at: '2026-09-02T10:00:00Z',
    timeline: [
      {
        status: 'NEW',
        label: 'Complaint Received',
        timestamp: '2026-09-02T10:00:00Z',
        note: 'Yellowing leaves on tomato crop',
      },
    ],
  };

  const mockAckIncident = {
    id: 'inc-wf-200',
    status: 'ACKNOWLEDGED',
    description: 'Chilli leaf curl report',
    acknowledged_at: '2026-09-02T11:00:00Z',
    timeline: [
      { status: 'NEW', label: 'Complaint Received', timestamp: '2026-09-02T10:00:00Z' },
      { status: 'ACKNOWLEDGED', label: 'Acknowledged', timestamp: '2026-09-02T11:00:00Z', officer_id: 'AEO001' },
    ],
  };

  const mockResolvedIncident = {
    id: 'inc-wf-300',
    status: 'RESOLVED',
    description: 'Paddy blast resolved',
    resolved_at: '2026-09-02T15:00:00Z',
    timeline: [
      { status: 'NEW', label: 'Complaint Received', timestamp: '2026-09-02T10:00:00Z' },
      { status: 'ACKNOWLEDGED', label: 'Acknowledged', timestamp: '2026-09-02T11:00:00Z' },
      { status: 'INVESTIGATING', label: 'Investigating', timestamp: '2026-09-02T12:00:00Z' },
      { status: 'ACTION_TAKEN', label: 'Action Taken', timestamp: '2026-09-02T14:00:00Z' },
      { status: 'RESOLVED', label: 'Resolved', timestamp: '2026-09-02T15:00:00Z', note: 'Crop fully recovered' },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders current status badge, stepper, and initial Acknowledge action for NEW incident', () => {
    render(<CaseWorkflowSection incident={mockNewIncident} />);

    expect(screen.getByTestId('case-workflow-section')).toBeInTheDocument();
    expect(screen.getByTestId('current-workflow-status-badge')).toHaveTextContent('NEW');
    expect(screen.getByTestId('workflow-stepper')).toBeInTheDocument();
    expect(screen.getByTestId('btn-action-acknowledge')).toBeInTheDocument();
    expect(screen.getByTestId('btn-action-reject-initial')).toBeInTheDocument();
  });

  it('renders Start Field Investigation action for ACKNOWLEDGED incident', () => {
    render(<CaseWorkflowSection incident={mockAckIncident} />);

    expect(screen.getByTestId('current-workflow-status-badge')).toHaveTextContent('ACKNOWLEDGED');
    expect(screen.getByTestId('btn-action-investigate')).toBeInTheDocument();
    expect(screen.queryByTestId('btn-action-acknowledge')).not.toBeInTheDocument();
  });

  it('renders Case Completed banner and no next actions for RESOLVED incident', () => {
    render(<CaseWorkflowSection incident={mockResolvedIncident} />);

    expect(screen.getByTestId('current-workflow-status-badge')).toHaveTextContent('RESOLVED');
    expect(screen.getByTestId('case-completed-banner')).toBeInTheDocument();
    expect(screen.queryByTestId('workflow-actions-bar')).not.toBeInTheDocument();
  });

  it('allows AEO to select an action, input note, and transition status', async () => {
    api.updateCaseStatus.mockResolvedValue({
      success: true,
      incident_id: 'inc-wf-200',
      status: 'INVESTIGATING',
      timeline: [
        { status: 'NEW', label: 'Complaint Received', timestamp: '2026-09-02T10:00:00Z' },
        { status: 'ACKNOWLEDGED', label: 'Acknowledged', timestamp: '2026-09-02T11:00:00Z' },
        { status: 'INVESTIGATING', label: 'Investigating', timestamp: '2026-09-02T12:00:00Z', note: 'Field visit arranged' },
      ],
      message: 'Incident transitioned to INVESTIGATING successfully.',
      incident: {
        ...mockAckIncident,
        status: 'INVESTIGATING',
      },
    });

    const onUpdated = vi.fn();
    render(
      <CaseWorkflowSection
        incident={mockAckIncident}
        onStatusUpdated={onUpdated}
      />
    );

    // Click Start Investigation
    const invBtn = screen.getByTestId('btn-action-investigate');
    fireEvent.click(invBtn);

    expect(screen.getByTestId('action-note-card')).toBeInTheDocument();

    // Type note
    const noteInput = screen.getByTestId('officer-note-input');
    fireEvent.change(noteInput, { target: { value: 'Field visit arranged' } });

    // Confirm
    const confirmBtn = screen.getByTestId('confirm-transition-btn');
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(api.updateCaseStatus).toHaveBeenCalledWith({
        incidentId: 'inc-wf-200',
        status: 'INVESTIGATING',
        note: 'Field visit arranged',
        officerId: 'AEO001',
      });
      expect(onUpdated).toHaveBeenCalled();
    });
  });

  it('renders chronological case timeline list', () => {
    render(<CaseWorkflowSection incident={mockResolvedIncident} />);

    expect(screen.getByTestId('case-timeline-section')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-list')).toBeInTheDocument();
    expect(screen.getByText(/Crop fully recovered/i)).toBeInTheDocument();
  });

  it('renders valid actions for INVESTIGATING state (Action Taken, Escalate, Reject)', () => {
    const mockInvIncident = {
      id: 'inc-wf-400',
      status: 'INVESTIGATING',
      description: 'Field visit underway',
    };
    render(<CaseWorkflowSection incident={mockInvIncident} />);

    expect(screen.getByTestId('current-workflow-status-badge')).toHaveTextContent('INVESTIGATING');
    expect(screen.getByTestId('btn-action-action-taken')).toBeInTheDocument();
    expect(screen.getByTestId('btn-action-escalate')).toBeInTheDocument();
    expect(screen.getByTestId('btn-action-reject-inv')).toBeInTheDocument();
    expect(screen.queryByTestId('btn-action-acknowledge')).not.toBeInTheDocument();
    expect(screen.queryByTestId('btn-action-resolve')).not.toBeInTheDocument();
  });

  it('renders valid actions for ACTION_TAKEN state (Resolve, Escalate)', () => {
    const mockActionTakenIncident = {
      id: 'inc-wf-500',
      status: 'ACTION_TAKEN',
      description: 'Pesticide sprayed',
    };
    render(<CaseWorkflowSection incident={mockActionTakenIncident} />);

    expect(screen.getByTestId('current-workflow-status-badge')).toHaveTextContent('ACTION TAKEN');
    expect(screen.getByTestId('btn-action-resolve')).toBeInTheDocument();
    expect(screen.getByTestId('btn-action-escalate-act')).toBeInTheDocument();
    expect(screen.queryByTestId('btn-action-acknowledge')).not.toBeInTheDocument();
    expect(screen.queryByTestId('btn-action-reject-initial')).not.toBeInTheDocument();
  });

  it('renders valid actions for ESCALATED state (Record Field Action, Resolve)', () => {
    const mockEscalatedIncident = {
      id: 'inc-wf-600',
      status: 'ESCALATED',
      description: 'Escalated to AO',
    };
    render(<CaseWorkflowSection incident={mockEscalatedIncident} />);

    expect(screen.getByTestId('current-workflow-status-badge')).toHaveTextContent('ESCALATED');
    expect(screen.getByTestId('btn-action-action-taken-esc')).toBeInTheDocument();
    expect(screen.getByTestId('btn-action-resolve-esc')).toBeInTheDocument();
    expect(screen.queryByTestId('btn-action-acknowledge')).not.toBeInTheDocument();
    expect(screen.queryByTestId('btn-action-reject-initial')).not.toBeInTheDocument();
  });

  it('renders Case Rejected banner and hides all action buttons for REJECTED state', () => {
    const mockRejectedIncident = {
      id: 'inc-wf-700',
      status: 'REJECTED',
      description: 'Invalid photo',
    };
    render(<CaseWorkflowSection incident={mockRejectedIncident} />);

    expect(screen.getByTestId('current-workflow-status-badge')).toHaveTextContent('REJECTED');
    expect(screen.getByTestId('case-rejected-banner')).toBeInTheDocument();
    expect(screen.queryByTestId('workflow-actions-bar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('workflow-stepper')).not.toBeInTheDocument();
  });

  it('shows all completed steps through RESOLVED in stepper when status is RESOLVED', () => {
    render(<CaseWorkflowSection incident={mockResolvedIncident} />);

    const stepper = screen.getByTestId('workflow-stepper');
    expect(stepper).toBeInTheDocument();
    expect(screen.getByTestId('step-new')).toHaveClass('step-passed');
    expect(screen.getByTestId('step-acknowledged')).toHaveClass('step-passed');
    expect(screen.getByTestId('step-investigating')).toHaveClass('step-passed');
    expect(screen.getByTestId('step-action_taken')).toHaveClass('step-passed');
    expect(screen.getByTestId('step-resolved')).toHaveClass('step-passed');
  });
});
