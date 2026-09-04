import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet's default icon paths for Vite bundler
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// Custom Red Pin Icon for the draggable picker
const customPinIcon = L.divIcon({
  className: 'custom-map-pin',
  html: `
    <div style="
      background-color: #e53e3e;
      width: 24px;
      height: 24px;
      border-radius: 50% 50% 50% 0;
      transform: rotate(-45deg);
      border: 3px solid #ffffff;
      box-shadow: 0 4px 8px rgba(0,0,0,0.3);
      display: flex;
      align-items: center;
      justify-content: center;
    ">
      <div style="
        width: 8px;
        height: 8px;
        background: white;
        border-radius: 50%;
      "></div>
    </div>
  `,
  iconSize: [24, 24],
  iconAnchor: [12, 24],
  popupAnchor: [0, -24],
});

export default function LocationPickerMap({
  latitude,
  longitude,
  area,
  landmark,
  onLocationChange,
  disabled = false,
}) {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markerRef = useRef(null);

  const [isLocating, setIsLocating] = useState(false);
  const [gpsError, setGpsError] = useState('');
  const [isGeocoding, setIsGeocoding] = useState(false);

  // Default fallback center: Telangana (Warangal / Hyderabad region)
  const defaultLat = latitude || 17.9689;
  const defaultLng = longitude || 79.6750;

  // Perform reverse geocoding to retrieve village / locality / landmark
  const reverseGeocode = async (lat, lng) => {
    setIsGeocoding(true);
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`,
        {
          headers: {
            'Accept-Language': 'en',
          },
        }
      );
      if (response.ok) {
        const data = await response.json();
        const addr = data.address || {};

        const extractedArea =
          addr.suburb ||
          addr.village ||
          addr.neighbourhood ||
          addr.residential ||
          addr.county ||
          addr.town ||
          addr.city ||
          '';

        const extractedLandmark =
          addr.road ||
          addr.amenity ||
          addr.building ||
          addr.commercial ||
          addr.state_district ||
          '';

        if (onLocationChange) {
          onLocationChange({
            latitude: lat,
            longitude: lng,
            area: extractedArea || area || '',
            landmark: extractedLandmark || landmark || '',
          });
        }
      } else {
        if (onLocationChange) {
          onLocationChange({
            latitude: lat,
            longitude: lng,
            area: area || '',
            landmark: landmark || '',
          });
        }
      }
    } catch (err) {
      console.warn('Reverse geocoding failed:', err);
      if (onLocationChange) {
        onLocationChange({
          latitude: lat,
          longitude: lng,
          area: area || '',
          landmark: landmark || '',
        });
      }
    } finally {
      setIsGeocoding(false);
    }
  };

  // Initialize Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        center: [defaultLat, defaultLng],
        zoom: 14,
        zoomControl: true,
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);

      // Create draggable marker
      const marker = L.marker([defaultLat, defaultLng], {
        icon: customPinIcon,
        draggable: !disabled,
      }).addTo(map);

      marker.bindPopup('<b>Your Incident Location</b><br/>Drag or click map to reposition.').openPopup();

      // Handle marker drag
      marker.on('dragend', (e) => {
        const { lat, lng } = e.target.getLatLng();
        reverseGeocode(parseFloat(lat.toFixed(6)), parseFloat(lng.toFixed(6)));
      });

      // Handle click on map to reposition marker
      map.on('click', (e) => {
        if (disabled) return;
        const { lat, lng } = e.latlng;
        marker.setLatLng([lat, lng]);
        marker.openPopup();
        reverseGeocode(parseFloat(lat.toFixed(6)), parseFloat(lng.toFixed(6)));
      });

      mapInstanceRef.current = map;
      markerRef.current = marker;
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        markerRef.current = null;
      }
    };
  }, []);

  // Update marker position when external lat/lng changes
  useEffect(() => {
    if (mapInstanceRef.current && markerRef.current && latitude && longitude) {
      const currentPos = markerRef.current.getLatLng();
      if (
        Math.abs(currentPos.lat - latitude) > 0.0001 ||
        Math.abs(currentPos.lng - longitude) > 0.0001
      ) {
        markerRef.current.setLatLng([latitude, longitude]);
        mapInstanceRef.current.setView([latitude, longitude], 15);
      }
    }
  }, [latitude, longitude]);

  // GPS Locate Button Handler
  const handleGpsLocate = () => {
    setGpsError('');
    if (!navigator.geolocation) {
      setGpsError('Geolocation is not supported by your browser.');
      return;
    }

    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setIsLocating(false);
        const lat = parseFloat(pos.coords.latitude.toFixed(6));
        const lng = parseFloat(pos.coords.longitude.toFixed(6));

        if (mapInstanceRef.current && markerRef.current) {
          markerRef.current.setLatLng([lat, lng]);
          mapInstanceRef.current.setView([lat, lng], 16);
          markerRef.current.openPopup();
        }

        reverseGeocode(lat, lng);
      },
      (err) => {
        setIsLocating(false);
        console.error('GPS locate error:', err);
        if (err.code === err.PERMISSION_DENIED) {
          setGpsError('Location permission denied. Please allow location access or click on map.');
        } else {
          setGpsError('Could not retrieve GPS position. Please select location on map.');
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  return (
    <div className="location-picker-wrapper">
      <div className="location-header-row">
        <div className="location-title-group">
          <span className="location-icon">📍</span>
          <h3 className="location-heading">Location Details</h3>
        </div>
        <button
          type="button"
          onClick={handleGpsLocate}
          disabled={isLocating || disabled}
          className="btn btn-gps-locate"
        >
          <span className="gps-target-icon">🎯</span>
          <span>{isLocating ? 'Locating GPS...' : 'LOCATE MY GPS POSITION'}</span>
        </button>
      </div>

      {gpsError && (
        <div className="alert alert-warning alert-sm" style={{ marginBottom: '8px' }}>
          <span>⚠️ {gpsError}</span>
        </div>
      )}

      {/* Interactive Map View */}
      <div className="map-frame">
        <div ref={mapContainerRef} className="leaflet-map-root" />
        {isGeocoding && (
          <div className="geocoding-badge">
            <span className="spinner-small"></span> Finding Address Details...
          </div>
        )}
      </div>

      <div className="map-instruction-bar">
        <span>📌 <strong>Click on the map or drag the red pin</strong> to adjust location &mdash; Area auto-fills!</span>
      </div>

      {/* Structured Form Inputs */}
      <div className="location-fields-grid">
        <div className="form-group">
          <label className="form-label" htmlFor="map-latitude">Latitude</label>
          <input
            id="map-latitude"
            type="number"
            step="0.000001"
            className="form-input text-mono"
            value={latitude !== null && latitude !== undefined ? latitude : ''}
            onChange={(e) => {
              const val = e.target.value ? parseFloat(e.target.value) : null;
              if (onLocationChange) {
                onLocationChange({
                  latitude: val,
                  longitude: longitude,
                  area: area || '',
                  landmark: landmark || '',
                });
              }
            }}
            placeholder="e.g. 17.968900"
            disabled={disabled}
          />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="map-longitude">Longitude</label>
          <input
            id="map-longitude"
            type="number"
            step="0.000001"
            className="form-input text-mono"
            value={longitude !== null && longitude !== undefined ? longitude : ''}
            onChange={(e) => {
              const val = e.target.value ? parseFloat(e.target.value) : null;
              if (onLocationChange) {
                onLocationChange({
                  latitude: latitude,
                  longitude: val,
                  area: area || '',
                  landmark: landmark || '',
                });
              }
            }}
            placeholder="e.g. 79.675000"
            disabled={disabled}
          />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="map-area">Area / Locality *</label>
          <input
            id="map-area"
            type="text"
            className="form-input"
            value={area || ''}
            onChange={(e) => {
              if (onLocationChange) {
                onLocationChange({
                  latitude: latitude,
                  longitude: longitude,
                  area: e.target.value,
                  landmark: landmark || '',
                });
              }
            }}
            placeholder="Village, Mandal, or Locality"
            disabled={disabled}
          />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="map-landmark">Landmark / Sub-district</label>
          <input
            id="map-landmark"
            type="text"
            className="form-input"
            value={landmark || ''}
            onChange={(e) => {
              if (onLocationChange) {
                onLocationChange({
                  latitude: latitude,
                  longitude: longitude,
                  area: area || '',
                  landmark: e.target.value,
                });
              }
            }}
            placeholder="e.g. Near Water Tank, Beside Main Canal"
            disabled={disabled}
          />
        </div>
      </div>
    </div>
  );
}
