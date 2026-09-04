import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BrowserRouter } from 'react-router-dom';
import AeoDashboard from '../pages/AeoDashboard';
import PriorityClustersPanel from '../components/PriorityClustersPanel';
import ClusterDetailModal from '../components/ClusterDetailModal';
import * as api from '../services/api';

vi.mock('../services/api');

const mockIncidents = [
  {
    id: 'inc-high-1',
    farmer_name: 'Mallesh Rao',
    crop: 'Paddy',
    description: 'Severe yellowing and rotting across field',
    status: 'NEW',
    priority: 'HIGH',
    priority_reasons: [
      'Multiple nearby complaints',
      'Recent reports',
      'High severity reported by farmer',
    ],
    latitude: 17.4575,
    longitude: 78.6604,
    created_at: new Date().toISOString(),
    farmers: {
      name: 'Mallesh Rao',
      phone: '+919876543210',
      village: 'Geesugonda',
      district: 'Warangal',
    },
    ai_analysis: [],
  },
  {
    id: 'inc-med-2',
    farmer_name: 'Laxmi Devi',
    crop: 'Cotton',
    description: 'Minor spots on leaves',
    status: 'NEW',
    priority: 'MEDIUM',
    priority_reasons: ['Recent reports'],
    latitude: 17.4580,
    longitude: 78.6610,
    created_at: new Date().toISOString(),
    farmers: {
      name: 'Laxmi Devi',
      phone: '+919876543211',
      village: 'Geesugonda',
      district: 'Warangal',
    },
    ai_analysis: [],
  },
  {
    id: 'inc-low-3',
    farmer_name: 'Kavitha K',
    crop: 'Chilli',
    description: 'Old inquiry from last month',
    status: 'RESOLVED',
    priority: 'LOW',
    priority_reasons: [
      'Single isolated complaint',
      'Standard reporting timeline',
      'Standard severity reported by farmer',
    ],
    latitude: 18.0000,
    longitude: 79.0000,
    created_at: new Date(Date.now() - 15 * 86400000).toISOString(),
    farmers: {
      name: 'Kavitha K',
      phone: '+919876543212',
      village: 'Choppadandi',
      district: 'Karimnagar',
    },
    ai_analysis: [],
  },
];

const mockClusters = [
  {
    cluster_id: 'cluster-001',
    incident_count: 5,
    priority: 'HIGH',
    priority_reason: '5 nearby complaints within 7.5km zone',
    crop: 'Paddy',
    common_issue: 'Similar reports: Yellowing / leaf spots',
    area: 'Geesugonda, Warangal',
    incident_ids: ['inc-high-1', 'inc-med-2'],
  },
];

describe('AEO Dashboard Priority System', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listIncidents.mockResolvedValue({
      success: true,
      incidents: mockIncidents,
    });
    api.getMapOverview.mockResolvedValue({
      success: true,
      incidents: mockIncidents,
      clusters: mockClusters,
      summary: {
        total: 3,
        new: 2,
        in_progress: 0,
        resolved: 1,
        rejected: 0,
        high_priority: 1,
      },
    });
    api.getIncident.mockImplementation(async (id) => {
      const found = mockIncidents.find((i) => i.id === id) || mockIncidents[0];
      return { success: true, incident: found, ai_analysis: [] };
    });
  });

  it('renders priority badges on every complaint in the queue', async () => {
    render(
      <BrowserRouter>
        <AeoDashboard />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('incident-priority-badge-inc-high-1')).toBeInTheDocument();
      expect(screen.getByTestId('incident-priority-badge-inc-med-2')).toBeInTheDocument();
      expect(screen.getByTestId('incident-priority-badge-inc-low-3')).toBeInTheDocument();
    });

    expect(screen.getByTestId('incident-priority-badge-inc-high-1')).toHaveTextContent(/HIGH/i);
    expect(screen.getByTestId('incident-priority-badge-inc-med-2')).toHaveTextContent(/MEDIUM/i);
    expect(screen.getByTestId('incident-priority-badge-inc-low-3')).toHaveTextContent(/LOW/i);
  });

  it('displays Priority: HIGH and "Why this priority?" reasons on incident details page', async () => {
    render(
      <BrowserRouter>
        <AeoDashboard />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('view-details-btn-inc-high-1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('view-details-btn-inc-high-1'));

    await waitFor(() => {
      expect(screen.getByTestId('detail-priority-card')).toBeInTheDocument();
    });

    expect(screen.getByTestId('detail-priority-value')).toHaveTextContent(/HIGH/i);
    expect(screen.getByText('Why this priority?')).toBeInTheDocument();
    expect(screen.getByText(/Multiple nearby complaints/i)).toBeInTheDocument();
    expect(screen.getByText(/Recent reports/i)).toBeInTheDocument();
    expect(screen.getByText(/High severity reported by farmer/i)).toBeInTheDocument();
  });

  it('renders priority and short reason on the PriorityClustersPanel', () => {
    render(
      <PriorityClustersPanel
        clusters={mockClusters}
        onSelectCluster={() => {}}
        loading={false}
      />
    );

    expect(screen.getByTestId('cluster-priority-tag-cluster-001')).toHaveTextContent(/HIGH/i);
    expect(screen.getByTestId('cluster-reason-cluster-001')).toHaveTextContent(
      /5 nearby complaints within 7.5km zone/i
    );
  });

  it('renders priority and reason on ClusterDetailModal', () => {
    render(
      <ClusterDetailModal
        cluster={mockClusters[0]}
        allIncidents={mockIncidents}
        onClose={() => {}}
        onSelectIncident={() => {}}
      />
    );

    expect(screen.getByTestId('cluster-modal-priority-badge')).toHaveTextContent(/HIGH/i);
    expect(screen.getByText(/5 nearby complaints within 7.5km zone/i)).toBeInTheDocument();
  });
});
