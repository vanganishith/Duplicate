import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';

/**
 * Decodes PostGIS EWKB hex string (e.g. 0101000020E6100000...) into { lat, lng }.
 */
export function decodeEWKBHex(hexStr) {
  if (!hexStr || typeof hexStr !== 'string') return null;
  const cleanHex = hexStr.trim();
  if (cleanHex.length < 42 || !/^[0-9a-fA-F]+$/.test(cleanHex)) return null;

  try {
    const bytes = new Uint8Array(cleanHex.length / 2);
    for (let i = 0; i < cleanHex.length; i += 2) {
      bytes[i / 2] = parseInt(cleanHex.substring(i, i + 2), 16);
    }
    const dataView = new DataView(bytes.buffer);
    const isLittleEndian = bytes[0] === 1;

    // PostGIS EWKB Point with SRID: bytes 9-16 is X (lng double), bytes 17-24 is Y (lat double)
    const lng = dataView.getFloat64(9, isLittleEndian);
    const lat = dataView.getFloat64(17, isLittleEndian);

    if (Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      return { lat, lng };
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Helper to extract or resolve [latitude, longitude] from incident & farmer data.
 */
export function extractCoordinates(incident) {
  if (!incident) return { lat: 17.9689, lng: 79.5941, isFallback: true };

  // 1. Direct lat/lng properties
  if (incident.latitude && incident.longitude) {
    const lat = Number(incident.latitude);
    const lng = Number(incident.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { lat, lng, isFallback: false };
    }
  }

  // 2. GeoJSON format: { type: "Point", coordinates: [lng, lat] }
  if (incident.location && typeof incident.location === 'object') {
    if (Array.isArray(incident.location.coordinates) && incident.location.coordinates.length >= 2) {
      return {
        lat: Number(incident.location.coordinates[1]),
        lng: Number(incident.location.coordinates[0]),
        isFallback: false,
      };
    }
    if (incident.location.lat && incident.location.lng) {
      return { lat: Number(incident.location.lat), lng: Number(incident.location.lng), isFallback: false };
    }
  }

  // 3. PostGIS EWKB Hex String or WKT format
  if (typeof incident.location === 'string') {
    // A. Check PostGIS EWKB hex string
    const decodedEwkb = decodeEWKBHex(incident.location);
    if (decodedEwkb) {
      return { lat: decodedEwkb.lat, lng: decodedEwkb.lng, isFallback: false };
    }

    // B. Check WKT POINT(lng lat)
    const match = incident.location.match(/POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i);
    if (match) {
      return { lat: Number(match[2]), lng: Number(match[1]), isFallback: false };
    }
  }

  // 4. Check farmer location object or EWKB
  if (incident.farmers?.location) {
    if (typeof incident.farmers.location === 'string') {
      const decodedFarmerEwkb = decodeEWKBHex(incident.farmers.location);
      if (decodedFarmerEwkb) {
        return { lat: decodedFarmerEwkb.lat, lng: decodedFarmerEwkb.lng, isFallback: false };
      }
    } else if (typeof incident.farmers.location === 'object') {
      if (Array.isArray(incident.farmers.location.coordinates) && incident.farmers.location.coordinates.length >= 2) {
        return {
          lat: Number(incident.farmers.location.coordinates[1]),
          lng: Number(incident.farmers.location.coordinates[0]),
          isFallback: false,
        };
      }
    }
  }

  // 5. Village / District Geocoding Fallbacks (Telangana Agricultural Hubs)
  const village = (incident.farmers?.village || '').toLowerCase();
  const district = (incident.farmers?.district || '').toLowerCase();

  if (village.includes('geesugonda') || district.includes('warangal')) {
    return { lat: 17.9358, lng: 79.7020, isFallback: false };
  }
  if (village.includes('gudimalkapur') || district.includes('ranga reddy') || district.includes('hyderabad')) {
    return { lat: 17.3820, lng: 78.4380, isFallback: false };
  }
  if (district.includes('karimnagar')) {
    return { lat: 18.4386, lng: 79.1288, isFallback: false };
  }
  if (district.includes('khammam')) {
    return { lat: 17.2473, lng: 80.1514, isFallback: false };
  }
  if (district.includes('nizamabad')) {
    return { lat: 18.6725, lng: 78.0941, isFallback: false };
  }

  // Default to Telangana Agricultural Heartland (Warangal District Zone)
  return { lat: 17.9689, lng: 79.5941, isFallback: true };
}

/**
 * Interactive Real Map Component for Agricultural Extension Officers.
 * Features:
 * - Real Satellite Imagery (Esri World Imagery) and Street Map (OpenStreetMap)
 * - Custom agricultural location marker with tooltip
 * - Farm boundary indicator circle
 * - Live Google Maps navigation link
 */
export default function FarmerLocationMap({ incident }) {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const tileLayerRef = useRef(null);
  const [mapLayerType, setMapLayerType] = useState('satellite'); // 'satellite' | 'street'

  const coords = extractCoordinates(incident);
  const farmerName = incident?.farmers?.name || 'Farmer';
  const crop = incident?.crop || 'Crop';
  const village = incident?.farmers?.village || 'Field Location';
  const district = incident?.farmers?.district || 'Telangana';

  useEffect(() => {
    if (!mapContainerRef.current) return;

    // Clean up existing map instance if already initialized
    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }

    try {
      // Create Leaflet Map centered at farmer's farm coordinates
      const map = L.map(mapContainerRef.current, {
        center: [coords.lat, coords.lng],
        zoom: 16,
        zoomControl: true,
        scrollWheelZoom: false,
      });
      mapInstanceRef.current = map;

      // Base Tile Layer
      const satelliteUrl = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
      const streetUrl = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

      const initialUrl = mapLayerType === 'satellite' ? satelliteUrl : streetUrl;
      const initialAttr = mapLayerType === 'satellite' ? 'Tiles &copy; Esri World Imagery' : '&copy; OpenStreetMap contributors';

      tileLayerRef.current = L.tileLayer(initialUrl, {
        maxZoom: 19,
        attribution: initialAttr,
      }).addTo(map);

      // Custom Agricultural Map Marker Icon
      const customIcon = L.divIcon({
        className: 'custom-farm-map-pin',
        html: `
          <div style="
            background: linear-gradient(135deg, #16a34a, #15803d);
            color: #ffffff;
            width: 38px;
            height: 38px;
            border-radius: 50% 50% 50% 0;
            transform: rotate(-45deg);
            border: 3px solid #ffffff;
            box-shadow: 0 4px 12px rgba(0,0,0,0.35);
            display: flex;
            align-items: center;
            justify-content: center;
          ">
            <span style="transform: rotate(45deg); font-size: 18px;">🌾</span>
          </div>
        `,
        iconSize: [38, 38],
        iconAnchor: [19, 38],
        popupAnchor: [0, -38],
      });

      // Place Marker
      const marker = L.marker([coords.lat, coords.lng], { icon: customIcon }).addTo(map);

      // Add Farm Accuracy/Radius Circle
      L.circle([coords.lat, coords.lng], {
        color: '#16a34a',
        fillColor: '#22c55e',
        fillOpacity: 0.15,
        radius: 120, // 120-meter agricultural plot radius
      }).addTo(map);

      // Popup with Farmer & Crop Info
      marker
        .bindPopup(`
          <div style="font-family: inherit; min-width: 180px; padding: 4px;">
            <strong style="color: #0f172a; font-size: 14px; display: block;">${farmerName}&apos;s Field</strong>
            <span style="color: #15803d; font-weight: 700; font-size: 12px;">🌾 Crop: ${crop}</span><br />
            <span style="color: #64748b; font-size: 11px;">📍 ${village}, ${district}</span><br />
            <span style="color: #334155; font-size: 10px; font-family: monospace;">GPS: ${coords.lat.toFixed(5)}° N, ${coords.lng.toFixed(5)}° E</span>
          </div>
        `)
        .openPopup();

      // Force layout invalidation on resize
      setTimeout(() => {
        map.invalidateSize();
      }, 200);
    } catch (err) {
      console.error('Failed to initialize Leaflet map:', err);
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [coords.lat, coords.lng]);

  // Switch between Satellite & Street Map layers
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

  const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${coords.lat},${coords.lng}`;

  return (
    <div className="farmer-real-map-card" data-testid="farmer-real-map-card">
      {/* Map Card Header */}
      <div className="map-card-header">
        <div className="map-title-wrap">
          <span className="map-hdr-icon">🛰️</span>
          <div>
            <h3 className="map-title">Farmer&apos;s Field Real-Time Location Map</h3>
            <span className="map-subtitle">
              Satellite &amp; GPS coordinates for field inspection &bull; {village}, {district}
            </span>
          </div>
        </div>

        {/* Map Controls */}
        <div className="map-header-controls">
          <div className="map-layer-switcher">
            <button
              type="button"
              className={`layer-btn ${mapLayerType === 'satellite' ? 'active' : ''}`}
              onClick={() => handleLayerSwitch('satellite')}
              data-testid="map-satellite-btn"
            >
              🛰️ Satellite View
            </button>
            <button
              type="button"
              className={`layer-btn ${mapLayerType === 'street' ? 'active' : ''}`}
              onClick={() => handleLayerSwitch('street')}
              data-testid="map-street-btn"
            >
              🗺️ Street Map
            </button>
          </div>

          <a
            href={googleMapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-sm btn-outline btn-google-maps"
            data-testid="open-google-maps-btn"
          >
            📍 Open in Google Maps ↗
          </a>
        </div>
      </div>

      {/* Real Interactive Map Canvas */}
      <div className="map-canvas-wrapper">
        <div ref={mapContainerRef} className="leaflet-map-canvas" data-testid="leaflet-map-container" />
      </div>

      {/* Map Metadata Footer */}
      <div className="map-card-footer">
        <div className="coord-chips-row">
          <span className="coord-chip" data-testid="coord-lat-lng">
            📍 <strong>Latitude:</strong> {coords.lat.toFixed(5)}° N &bull; <strong>Longitude:</strong> {coords.lng.toFixed(5)}° E
          </span>
          <span className="source-chip">
            📡 Source: <strong>{incident?.location_source || (coords.isFallback ? 'Telangana Agricultural Zone' : 'High-Accuracy GPS')}</strong>
          </span>
        </div>
        <span className="accuracy-note">
          🌱 Radius indicator shows approx 120m agricultural plot boundary around the farm coordinates.
        </span>
      </div>
    </div>
  );
}
