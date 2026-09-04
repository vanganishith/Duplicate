import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';

/**
 * Interactive Incident Cluster & Density Map for AEO.
 * Visualizes geographic concentration of farmer complaints with real coordinates.
 * Allows inspecting individual incident pins or zooming into high-density agricultural hubs.
 */
export default function IncidentClusterMap({
  incidents = [],
  clusters = [],
  selectedIncident = null,
  onSelectIncident = () => {},
  onSelectCluster = () => {},
}) {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const tileLayerRef = useRef(null);
  const markersLayerGroupRef = useRef(null);
  const densityLayerGroupRef = useRef(null);

  const [mapLayerType, setMapLayerType] = useState('street'); // 'street' | 'satellite'
  const [activeZoom, setActiveZoom] = useState(11);

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }

    try {
      // Default center: Telangana Agricultural Heartland (Warangal / Hyderabad region)
      const defaultCenter = [17.9689, 79.5941];

      const map = L.map(mapContainerRef.current, {
        center: defaultCenter,
        zoom: 11,
        zoomControl: true,
        scrollWheelZoom: true,
      });
      mapInstanceRef.current = map;

      // Base Tile Layer
      const streetUrl = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
      const satelliteUrl = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

      const initialUrl = mapLayerType === 'satellite' ? satelliteUrl : streetUrl;
      const initialAttr =
        mapLayerType === 'satellite' ? 'Tiles &copy; Esri World Imagery' : '&copy; OpenStreetMap contributors';

      tileLayerRef.current = L.tileLayer(initialUrl, {
        maxZoom: 19,
        attribution: initialAttr,
      }).addTo(map);

      // Layer groups for density circles and incident pins
      densityLayerGroupRef.current = L.layerGroup().addTo(map);
      markersLayerGroupRef.current = L.layerGroup().addTo(map);

      map.on('zoomend', () => {
        setActiveZoom(map.getZoom());
      });

      // Force layout invalidation on load
      setTimeout(() => {
        map.invalidateSize();
      }, 250);
    } catch (err) {
      console.error('Failed to initialize Leaflet cluster map:', err);
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // Update Layers when Incidents or Clusters change
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !densityLayerGroupRef.current || !markersLayerGroupRef.current) return;

    densityLayerGroupRef.current.clearLayers();
    markersLayerGroupRef.current.clearLayers();

    const validIncidents = incidents.filter(
      (inc) =>
        inc &&
        Number.isFinite(Number(inc.latitude)) &&
        Number.isFinite(Number(inc.longitude)) &&
        inc.latitude >= -90 &&
        inc.latitude <= 90 &&
        inc.longitude >= -180 &&
        inc.longitude <= 180
    );

    // 1. Render Density Concentration Layers
    // Draw density heat circles around clusters or multi-incident zones
    if (clusters && clusters.length > 0) {
      clusters.forEach((cluster) => {
        if (!cluster.center || !Number.isFinite(cluster.center.latitude) || !Number.isFinite(cluster.center.longitude))
          return;

        const count = cluster.incident_count || 1;
        // Radius and color intensity scaled by incident density
        const radiusMeters = Math.min(2500 + count * 600, 8000);
        const fillColor =
          count >= 6
            ? '#ef4444' // Red hot
            : count >= 3
              ? '#f59e0b' // Amber medium
              : '#10b981'; // Green light

        // Density Outer Halo Circle
        const densityCircle = L.circle([cluster.center.latitude, cluster.center.longitude], {
          radius: radiusMeters,
          color: fillColor,
          weight: 1.5,
          opacity: 0.7,
          fillColor: fillColor,
          fillOpacity: Math.min(0.12 + count * 0.04, 0.38),
          className: 'cluster-density-halo',
        }).addTo(densityLayerGroupRef.current);

        densityCircle.on('click', () => {
          onSelectCluster(cluster);
        });

        // Cluster Centroid Indicator Badge
        const clusterBadgeIcon = L.divIcon({
          className: 'cluster-centroid-badge-wrapper',
          html: `
            <div style="
              background: ${fillColor};
              color: #ffffff;
              font-weight: 700;
              font-size: 13px;
              width: 34px;
              height: 34px;
              border-radius: 50%;
              border: 2.5px solid #ffffff;
              box-shadow: 0 4px 10px rgba(0,0,0,0.3);
              display: flex;
              align-items: center;
              justify-content: center;
              cursor: pointer;
            " title="${cluster.incident_count} reports in ${cluster.area || 'this area'}">
              ${cluster.incident_count}
            </div>
          `,
          iconSize: [34, 34],
          iconAnchor: [17, 17],
        });

        const clusterMarker = L.marker([cluster.center.latitude, cluster.center.longitude], {
          icon: clusterBadgeIcon,
          zIndexOffset: 50,
        }).addTo(densityLayerGroupRef.current);

        clusterMarker.on('click', () => {
          onSelectCluster(cluster);
        });
      });
    }

    // 2. Render Individual Incident Markers
    validIncidents.forEach((inc) => {
      const isSelected = selectedIncident && selectedIncident.id === inc.id;
      const statusColor =
        inc.status === 'NEW'
          ? '#2563eb' // Blue
          : inc.status === 'ACKNOWLEDGED' || inc.status === 'INVESTIGATING'
            ? '#f59e0b' // Amber
            : inc.status === 'REJECTED'
              ? '#dc2626' // Red
              : '#16a34a'; // Green

      const markerHtml = `
        <div style="
          background: ${isSelected ? '#0f172a' : statusColor};
          color: #ffffff;
          width: ${isSelected ? '32px' : '26px'};
          height: ${isSelected ? '32px' : '26px'};
          border-radius: 50% 50% 50% 0;
          transform: rotate(-45deg);
          border: 2px solid #ffffff;
          box-shadow: 0 3px 8px rgba(0,0,0,0.35);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: transform 0.2s ease;
        ">
          <span style="transform: rotate(45deg); font-size: ${isSelected ? '14px' : '11px'};">🌾</span>
        </div>
      `;

      const incidentIcon = L.divIcon({
        className: `custom-incident-pin ${isSelected ? 'selected' : ''}`,
        html: markerHtml,
        iconSize: [28, 28],
        iconAnchor: [14, 28],
        popupAnchor: [0, -28],
      });

      const marker = L.marker([Number(inc.latitude), Number(inc.longitude)], {
        icon: incidentIcon,
        zIndexOffset: isSelected ? 1000 : 100,
      }).addTo(markersLayerGroupRef.current);

      // Interactive Popup for individual incident
      const popupContent = document.createElement('div');
      popupContent.className = 'incident-map-popup-card';
      popupContent.innerHTML = `
        <div style="font-family: inherit; min-width: 220px; padding: 2px 0;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
            <strong style="color: #0f172a; font-size: 14px;">${escapeHtml(inc.farmer_name || 'Farmer')}</strong>
            <span style="background: ${statusColor}15; color: ${statusColor}; border: 1px solid ${statusColor}40; border-radius: 9999px; font-size: 10px; font-weight: 700; padding: 2px 6px;">
              ${escapeHtml(inc.status)}
            </span>
          </div>
          ${inc.crop ? `<div style="color: #16a34a; font-weight: 600; font-size: 12px; margin-bottom: 4px;">🌾 Crop: ${escapeHtml(inc.crop)}</div>` : ''}
          <div style="color: #475569; font-size: 11px; margin-bottom: 6px; line-height: 1.4; max-height: 48px; overflow: hidden; text-overflow: ellipsis;">
            ${escapeHtml(inc.description || 'No description provided.')}
          </div>
          <div style="color: #64748b; font-size: 10px; margin-bottom: 8px;">
            📍 ${escapeHtml(inc.area || 'Telangana')}
          </div>
          <button type="button" class="btn btn-sm btn-primary popup-view-btn" style="width: 100%; padding: 4px 8px; font-size: 12px; cursor: pointer;">
            View Details &rarr;
          </button>
        </div>
      `;

      const viewBtn = popupContent.querySelector('.popup-view-btn');
      if (viewBtn) {
        viewBtn.onclick = (e) => {
          e.stopPropagation();
          onSelectIncident(inc, true);
        };
      }

      marker.bindPopup(popupContent);

      marker.on('click', () => {
        onSelectIncident(inc, false);
      });
    });

    // 3. Auto-fit bounds if we have incidents and not currently user-dragged
    if (validIncidents.length > 0) {
      try {
        const bounds = L.latLngBounds(validIncidents.map((i) => [Number(i.latitude), Number(i.longitude)]));
        if (bounds.isValid()) {
          map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
        }
      } catch {
        // Fallback gracefully
      }
    }
  }, [incidents, clusters, selectedIncident]);

  // Handle Layer Switch
  const handleLayerSwitch = (type) => {
    setMapLayerType(type);
    if (mapInstanceRef.current && tileLayerRef.current) {
      mapInstanceRef.current.removeLayer(tileLayerRef.current);
      const url =
        type === 'satellite'
          ? 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
          : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
      const attr = type === 'satellite' ? 'Tiles &copy; Esri World Imagery' : '&copy; OpenStreetMap contributors';

      tileLayerRef.current = L.tileLayer(url, {
        maxZoom: 19,
        attribution: attr,
      }).addTo(mapInstanceRef.current);
    }
  };

  // Reset / Fit Bounds Button
  const handleResetBounds = () => {
    const map = mapInstanceRef.current;
    if (!map) return;
    const validIncidents = incidents.filter(
      (inc) => inc && Number.isFinite(Number(inc.latitude)) && Number.isFinite(Number(inc.longitude))
    );
    if (validIncidents.length > 0) {
      const bounds = L.latLngBounds(validIncidents.map((i) => [Number(i.latitude), Number(i.longitude)]));
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 14 });
    } else {
      map.setView([17.9689, 79.5941], 11);
    }
  };

  return (
    <div className="incident-cluster-map-card" data-testid="incident-cluster-map-card">
      {/* Map Card Header */}
      <div className="map-card-header">
        <div className="map-title-wrap">
          <span className="map-hdr-icon">🗺️</span>
          <div>
            <h3 className="map-title">Incident Density &amp; Concentration Map</h3>
            <span className="map-subtitle">
              Geographic overview of verified farmer reports &bull; {incidents.length} mapped incidents
            </span>
          </div>
        </div>

        {/* Map Header Controls */}
        <div className="map-header-controls">
          <button
            type="button"
            className="btn btn-sm btn-outline reset-bounds-btn"
            onClick={handleResetBounds}
            title="Fit to all incident locations"
            data-testid="reset-map-bounds-btn"
          >
            🎯 Fit View
          </button>

          <div className="map-layer-switcher">
            <button
              type="button"
              className={`layer-btn ${mapLayerType === 'street' ? 'active' : ''}`}
              onClick={() => handleLayerSwitch('street')}
              data-testid="map-street-btn"
            >
              🗺️ Street
            </button>
            <button
              type="button"
              className={`layer-btn ${mapLayerType === 'satellite' ? 'active' : ''}`}
              onClick={() => handleLayerSwitch('satellite')}
              data-testid="map-satellite-btn"
            >
              🛰️ Satellite
            </button>
          </div>
        </div>
      </div>

      {/* Real Interactive Leaflet Canvas */}
      <div className="map-canvas-wrapper" style={{ height: '420px', position: 'relative' }}>
        <div ref={mapContainerRef} className="leaflet-map-canvas" data-testid="cluster-map-canvas" />

        {/* Map Legend Overlay */}
        <div className="map-density-legend-overlay">
          <span className="legend-title">Density Indicator</span>
          <div className="legend-items">
            <span className="legend-item">
              <span className="legend-dot dot-light" /> 1-2 reports
            </span>
            <span className="legend-item">
              <span className="legend-dot dot-med" /> 3-5 reports
            </span>
            <span className="legend-item">
              <span className="legend-dot dot-high" /> 6+ reports
            </span>
          </div>
        </div>
      </div>

      {/* Footer Info */}
      <div className="map-card-footer">
        <div className="coord-chips-row">
          <span className="coord-chip">
            📍 <strong>Active Incidents:</strong> {incidents.length} &bull; <strong>Emerging Clusters:</strong> {clusters.length}
          </span>
          <span className="source-chip">
            💡 <em>Click any incident pin to inspect or open full complaint details.</em>
          </span>
        </div>
      </div>
    </div>
  );
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
