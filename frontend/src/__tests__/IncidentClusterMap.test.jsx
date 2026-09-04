import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import IncidentClusterMap from '../components/IncidentClusterMap';
import PriorityClustersPanel from '../components/PriorityClustersPanel';
import ClusterDetailModal from '../components/ClusterDetailModal';


describe('Phase 6 — AEO Incident Cluster Map & Density Overview', () => {
  const sampleIncidents = [
    {
      id: 'inc-101',
      farmer_name: 'Ramesh Kumar',
      crop: 'Chilli',
      description: 'Chilli leaf curl symptoms with yellow patches',
      status: 'NEW',
      priority: 'HIGH',
      latitude: 17.9692,
      longitude: 79.6755,
      area: 'Geesugonda, Warangal',
      created_at: '2026-09-02T10:00:00Z',
      photo_url: 'https://example.com/photo1.jpg',
      audio_url: 'https://example.com/audio1.webm',
    },
    {
      id: 'inc-102',
      farmer_name: 'Suresh Patel',
      crop: 'Chilli',
      description: 'Chilli plants stunted and curling upward',
      status: 'NEW',
      priority: 'HIGH',
      latitude: 17.9685,
      longitude: 79.6750,
      area: 'Geesugonda, Warangal',
      created_at: '2026-09-02T11:00:00Z',
    },
    {
      id: 'inc-103',
      farmer_name: 'Anil Reddy',
      crop: 'Cotton',
      description: 'Cotton bollworm pest infestation in flower buds',
      status: 'ACKNOWLEDGED',
      priority: 'MEDIUM',
      latitude: 18.5840,
      longitude: 79.1670,
      area: 'Choppadandi, Karimnagar',
      created_at: '2026-09-01T08:00:00Z',
    },
  ];

  const sampleClusters = [
    {
      cluster_id: 'cluster-chilli-warangal',
      incident_count: 2,
      center: { latitude: 17.96885, longitude: 79.67525 },
      crop: 'Chilli',
      common_issue: 'Similar reports: Leaf curl / curling symptoms',
      priority: 'HIGH',
      status: 'EMERGING',
      area: 'Geesugonda, Warangal',
      incident_ids: ['inc-101', 'inc-102'],
      created_at: '2026-09-02T10:00:00Z',
    },
  ];

  it('renders the IncidentClusterMap with interactive canvas and controls', () => {
    render(
      <IncidentClusterMap
        incidents={sampleIncidents}
        clusters={sampleClusters}
        onSelectIncident={() => {}}
        onSelectCluster={() => {}}
      />
    );

    expect(screen.getByTestId('incident-cluster-map-card')).toBeInTheDocument();
    expect(screen.getByTestId('cluster-map-canvas')).toBeInTheDocument();
    expect(screen.getByTestId('reset-map-bounds-btn')).toBeInTheDocument();
    expect(screen.getByTestId('map-street-btn')).toBeInTheDocument();
    expect(screen.getByTestId('map-satellite-btn')).toBeInTheDocument();
    expect(screen.getByText(/3 mapped incidents/i)).toBeInTheDocument();
  });

  it('safely handles empty incidents list without crashing', () => {
    render(
      <IncidentClusterMap
        incidents={[]}
        clusters={[]}
        onSelectIncident={() => {}}
        onSelectCluster={() => {}}
      />
    );

    expect(screen.getByTestId('incident-cluster-map-card')).toBeInTheDocument();
    expect(screen.getByText(/0 mapped incidents/i)).toBeInTheDocument();
  });

  it('renders PriorityClustersPanel with real cluster counts, crops, and area', () => {
    const handleSelectCluster = vi.fn();
    render(
      <PriorityClustersPanel
        clusters={sampleClusters}
        onSelectCluster={handleSelectCluster}
        loading={false}
      />
    );

    expect(screen.getByTestId('priority-clusters-panel')).toBeInTheDocument();
    expect(screen.getByTestId('cluster-total-badge')).toHaveTextContent('1 Cluster');
    expect(screen.getByText(/Geesugonda, Warangal/i)).toBeInTheDocument();
    expect(screen.getByTestId('cluster-reports-pill')).toHaveTextContent(/2.*reports/i);
    expect(screen.getByText(/Chilli/i)).toBeInTheDocument();

    expect(screen.getByText(/Similar reports: Leaf curl/i)).toBeInTheDocument();

    // Click View Cluster
    const viewBtn = screen.getByTestId('view-cluster-btn-cluster-chilli-warangal');
    fireEvent.click(viewBtn);
    expect(handleSelectCluster).toHaveBeenCalledWith(sampleClusters[0]);
  });

  it('renders empty state in PriorityClustersPanel when no clusters exist', () => {
    render(
      <PriorityClustersPanel
        clusters={[]}
        onSelectCluster={() => {}}
        loading={false}
      />
    );

    expect(screen.getByTestId('clusters-empty-state')).toBeInTheDocument();
    expect(screen.getByText(/No Emerging Clusters/i)).toBeInTheDocument();
  });

  it('renders ClusterDetailModal with all related farmer complaints and view details action', () => {
    const handleClose = vi.fn();
    const handleSelectIncident = vi.fn();

    render(
      <ClusterDetailModal
        cluster={sampleClusters[0]}
        allIncidents={sampleIncidents}
        onClose={handleClose}
        onSelectIncident={handleSelectIncident}
      />
    );

    expect(screen.getByTestId('cluster-detail-modal')).toBeInTheDocument();
    expect(screen.getByText(/Agricultural Cluster Overview/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Geesugonda, Warangal/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Related Farmer Complaints \(2\)/i)).toBeInTheDocument();


    // Verify both individual complaints are listed
    expect(screen.getByTestId('cluster-incident-inc-101')).toBeInTheDocument();
    expect(screen.getByTestId('cluster-incident-inc-102')).toBeInTheDocument();
    expect(screen.getByText('Ramesh Kumar')).toBeInTheDocument();
    expect(screen.getByText('Suresh Patel')).toBeInTheDocument();

    // Clicking View Details on an incident in the cluster opens it
    const viewIncidentBtn = screen.getByTestId('cluster-view-detail-btn-inc-101');
    fireEvent.click(viewIncidentBtn);
    expect(handleClose).toHaveBeenCalled();
    expect(handleSelectIncident).toHaveBeenCalledWith(sampleIncidents[0], true);
  });
});
