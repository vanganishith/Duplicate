import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FarmerLocationMap, { extractCoordinates } from '../components/FarmerLocationMap';

// Mock Leaflet
vi.mock('leaflet', () => {
  const mapMock = {
    setView: vi.fn().mockReturnThis(),
    remove: vi.fn(),
    removeLayer: vi.fn(),
    invalidateSize: vi.fn(),
  };

  const tileLayerMock = {
    addTo: vi.fn().mockReturnThis(),
  };

  const markerMock = {
    addTo: vi.fn().mockReturnThis(),
    bindPopup: vi.fn().mockReturnThis(),
    openPopup: vi.fn().mockReturnThis(),
  };

  const circleMock = {
    addTo: vi.fn().mockReturnThis(),
  };

  return {
    default: {
      map: vi.fn(() => mapMock),
      tileLayer: vi.fn(() => tileLayerMock),
      marker: vi.fn(() => markerMock),
      circle: vi.fn(() => circleMock),
      divIcon: vi.fn(() => ({})),
    },
  };
});

describe('Phase: FarmerLocationMap Real Map Component Tests', () => {
  const mockIncidentWithGeo = {
    id: 'inc-map-001',
    crop: 'Cotton',
    location: { type: 'Point', coordinates: [79.5941, 17.9689] },
    location_source: 'GPS',
    farmers: {
      name: 'Ramesh Reddy',
      village: 'Geesugonda',
      district: 'Warangal',
      state: 'Telangana',
    },
  };

  // 1. extractCoordinates helper
  it('correctly extracts coordinates from GeoJSON location', () => {
    const coords = extractCoordinates(mockIncidentWithGeo);
    expect(coords.lat).toBeCloseTo(17.9689);
    expect(coords.lng).toBeCloseTo(79.5941);
    expect(coords.isFallback).toBe(false);
  });

  it('correctly decodes PostGIS EWKB hex string coordinates', () => {
    const incident = {
      id: 'inc-ewkb-001',
      location: '0101000020E61000007E1D386744AA5340E223624A24753140',
      location_source: 'GPS',
    };
    const coords = extractCoordinates(incident);
    expect(coords.lat).toBeCloseTo(17.457585, 4);
    expect(coords.lng).toBeCloseTo(78.660425, 4);
    expect(coords.isFallback).toBe(false);
  });

  // 2. Component Rendering
  it('renders real map card with satellite layer switcher and Google maps button', () => {
    render(<FarmerLocationMap incident={mockIncidentWithGeo} />);

    expect(screen.getByTestId('farmer-real-map-card')).toBeDefined();
    expect(screen.getByTestId('leaflet-map-container')).toBeDefined();
    expect(screen.getByTestId('map-satellite-btn')).toBeDefined();
    expect(screen.getByTestId('map-street-btn')).toBeDefined();
    expect(screen.getByTestId('open-google-maps-btn')).toBeDefined();

    // Verify Google Maps URL contains coordinates
    const gmapsBtn = screen.getByTestId('open-google-maps-btn');
    expect(gmapsBtn.getAttribute('href')).toContain('17.9689');
    expect(gmapsBtn.getAttribute('href')).toContain('79.5941');
  });

  // 3. Layer Switcher
  it('toggles active state between Satellite View and Street Map', () => {
    render(<FarmerLocationMap incident={mockIncidentWithGeo} />);

    const satBtn = screen.getByTestId('map-satellite-btn');
    const streetBtn = screen.getByTestId('map-street-btn');

    expect(satBtn.classList.contains('active')).toBe(true);
    expect(streetBtn.classList.contains('active')).toBe(false);

    // Switch to street
    fireEvent.click(streetBtn);
    expect(streetBtn.classList.contains('active')).toBe(true);
    expect(satBtn.classList.contains('active')).toBe(false);
  });
});
