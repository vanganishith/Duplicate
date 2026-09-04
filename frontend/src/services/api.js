/**
 * API Service for communicating with the FastAPI backend.
 */

const API_BASE_URL = import.meta.env.VITE_API_URL || import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

export async function checkHealth() {
  try {
    const response = await fetch(`${API_BASE_URL}/health`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Failed to connect to backend health check:', error);
    throw error;
  }
}

/**
 * Submits a farmer incident.
 * If photo_file or audio_file is present, uses multipart/form-data (/api/v1/incidents/upload).
 * Otherwise uses application/json (/api/v1/incidents).
 */
export async function submitIncident({
  farmer_name,
  farmer_phone,
  description = '',
  crop = '',
  language = 'Telugu',
  latitude = null,
  longitude = null,
  photo_file = null,
  photo_files = [],
  photos = [],
  audio_file = null,
}) {
  try {
    let response;

    const allPhotoFiles = [...(photo_files || [])];
    if (photo_file && !allPhotoFiles.includes(photo_file)) {
      allPhotoFiles.unshift(photo_file);
    }

    if (allPhotoFiles.length > 0 || audio_file) {
      const formData = new FormData();
      formData.append('farmer_name', farmer_name.trim());
      formData.append('farmer_phone', farmer_phone.trim());
      if (description && description.trim()) formData.append('description', description.trim());
      if (crop && crop.trim()) formData.append('crop', crop.trim());
      if (language) formData.append('language', language);
      if (latitude !== null && latitude !== undefined) formData.append('latitude', latitude);
      if (longitude !== null && longitude !== undefined) formData.append('longitude', longitude);
      
      // Append all photos up to 4
      allPhotoFiles.slice(0, 4).forEach((file) => {
        if (file) formData.append('photos', file);
      });
      if (audio_file) formData.append('audio', audio_file);

      response = await fetch(`${API_BASE_URL}/api/v1/incidents/upload`, {
        method: 'POST',
        body: formData,
      });
    } else {
      const payload = {
        farmer_name: farmer_name.trim(),
        farmer_phone: farmer_phone.trim(),
        description: description.trim(),
        crop: crop && crop.trim() ? crop.trim() : null,
        language: language || 'Telugu',
        latitude: latitude !== null && latitude !== undefined ? parseFloat(latitude) : null,
        longitude: longitude !== null && longitude !== undefined ? parseFloat(longitude) : null,
        photos: photos && photos.length > 0 ? photos.slice(0, 4) : undefined,
      };

      response = await fetch(`${API_BASE_URL}/api/v1/incidents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
    }

    const data = await response.json();

    if (!response.ok) {
      let errorMessage = 'Failed to submit incident. Please check your details.';
      if (data && data.detail) {
        if (typeof data.detail === 'object' && data.detail.message) {
          errorMessage = data.detail.message;
        } else if (typeof data.detail === 'string') {
          errorMessage = data.detail;
        } else if (Array.isArray(data.detail) && data.detail.length > 0) {
          errorMessage = data.detail[0].msg || errorMessage;
        }
      } else if (data && data.message) {
        errorMessage = data.message;
      }
      throw new Error(errorMessage);
    }

    return data;
  } catch (error) {
    console.error('Error submitting incident:', error);
    throw error;
  }
}

/**
 * Sends a voice recording to be transcribed by GSTT and analyzed by LLM.
 */
export async function processVoiceIncident(incidentId, audioFile, language = 'Telugu') {
  try {
    const formData = new FormData();
    formData.append('audio', audioFile);
    formData.append('language', language);

    const response = await fetch(`${API_BASE_URL}/api/v1/incidents/${incidentId}/voice`, {
      method: 'POST',
      body: formData,
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.detail?.message || data?.message || 'Failed to process voice recording');
    }
    return data;
  } catch (error) {
    console.error('Error in voice AI processing:', error);
    throw error;
  }
}

/**
 * Preview voice transcription & extracted meaning instantly.
 */
export async function previewVoice(audioFile, language = 'Telugu') {
  try {
    const formData = new FormData();
    formData.append('audio', audioFile);
    formData.append('language', language);

    const response = await fetch(`${API_BASE_URL}/api/v1/voice/preview`, {
      method: 'POST',
      body: formData,
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.detail?.message || data?.message || 'Voice transcription failed');
    }
    return data;
  } catch (error) {
    console.error('Error in voice preview:', error);
    throw error;
  }
}

/**
 * Authoritative AI4Bharat IndicConformer ASR transcription.
 */
export async function performIndicAsr(audioFile, language = 'Telugu') {
  try {
    const formData = new FormData();
    formData.append('audio', audioFile);
    formData.append('language', language);

    const response = await fetch(`${API_BASE_URL}/api/v1/voice/asr`, {
      method: 'POST',
      body: formData,
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.detail?.message || data?.message || 'IndicConformer transcription failed');
    }
    return data;
  } catch (error) {
    console.error('Error in IndicConformer ASR:', error);
    throw error;
  }
}

/**
 * Sends farmer-confirmed transcript to agricultural LLM for structured reasoning.
 */
export async function analyzeConfirmedTranscript(transcript, language = 'Telugu') {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/voice/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript, language }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.detail?.message || data?.message || 'Agricultural analysis failed');
    }
    return data;
  } catch (error) {
    console.error('Error in agricultural reasoning:', error);
    throw error;
  }
}

/**
 * Fetches an incident by ID.
 */
export async function getIncident(incidentId) {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/incidents/${incidentId}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch incident with ID: ${incidentId}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Error fetching incident:', error);
    throw error;
  }
}

/**
 * Fetches recent incidents for AEO review.
 */
export async function listIncidents(limit = 30) {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/incidents?limit=${limit}`);
    if (!response.ok) {
      throw new Error(`Failed to list incidents: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Error listing incidents:', error);
    throw error;
  }
}

/**
 * Officer Action: Starts handling/investigating an incident.
 */
export async function startWorkOnIncident(incidentId, officerId = 'AEO001') {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/incidents/${incidentId}/start-work`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ officer_id: officerId }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.detail?.message || data?.message || 'Failed to start work on incident');
    }
    return data;
  } catch (error) {
    console.error('Error starting work on incident:', error);
    throw error;
  }
}

/**
 * Officer Action: Rejects an incident with a mandatory recorded reason.
 */
export async function rejectIncident(incidentId, reason, officerId = 'AEO001') {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/incidents/${incidentId}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: reason.trim(), officer_id: officerId }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.detail?.message || data?.message || 'Failed to reject incident');
    }
    return data;
  } catch (error) {
    console.error('Error rejecting incident:', error);
    throw error;
  }
}

/**
 * Phase 6: Fetches real PostGIS incident coordinates and emerging clusters for AEO map.
 */
export async function getMapOverview({ status = 'all', time_filter = 'all', priority = null, modality = 'all' } = {}) {
  try {
    const params = new URLSearchParams();
    if (status) params.append('status', status);
    if (time_filter) params.append('time_filter', time_filter);
    if (priority) params.append('priority', priority);
    if (modality) params.append('modality', modality);

    const response = await fetch(`${API_BASE_URL}/api/v1/incidents/map?${params.toString()}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch map overview: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Error loading map overview:', error);
    throw error;
  }
}

/**
 * Phase 6: Fetches active/emerging clusters summary.
 */
export async function getClusters({ status = 'all', time_filter = 'all' } = {}) {
  try {
    const params = new URLSearchParams();
    if (status) params.append('status', status);
    if (time_filter) params.append('time_filter', time_filter);

    const response = await fetch(`${API_BASE_URL}/api/v1/clusters?${params.toString()}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch clusters: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Error fetching clusters:', error);
    throw error;
  }
}

/**
 * Phase 10: Submits a community confirmation response (YES, NO, NOT_SURE) or "Me Too".
 */
export async function submitCommunityConfirmation({
  incidentId,
  farmerPhone,
  response = 'YES',
  farmerName = 'Nearby Farmer',
  latitude = null,
  longitude = null,
}) {
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/incidents/${incidentId}/confirmations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        farmer_phone: farmerPhone.trim(),
        farmer_name: farmerName.trim(),
        response: response.trim(),
        latitude: latitude !== null ? Number(latitude) : null,
        longitude: longitude !== null ? Number(longitude) : null,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.detail?.message || data?.message || 'Failed to submit community confirmation');
    }
    return data;
  } catch (error) {
    console.error('Error submitting community confirmation:', error);
    throw error;
  }
}

/**
 * Farmer-Facing: Retrieves similar community issues within 3 KM radius.
 */
export async function getNearbyCommunityIncidents({
  latitude,
  longitude,
  radiusKm = 3.0,
  crop = null,
  currentIncidentId = null,
  limit = 20,
}) {
  try {
    const params = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
      radius_km: String(radiusKm),
      limit: String(limit),
    });
    if (crop) params.append('crop', crop);
    if (currentIncidentId) params.append('current_incident_id', currentIncidentId);

    const res = await fetch(`${API_BASE_URL}/api/v1/incidents/nearby?${params.toString()}`);
    if (!res.ok) {
      throw new Error('Failed to fetch nearby community issues');
    }
    return await res.json();
  } catch (error) {
    console.error('Error fetching nearby community incidents:', error);
    throw error;
  }
}

/**
 * Phase 10: Retrieves aggregated community confirmation stats and responses.
 */
export async function getIncidentConfirmations(incidentId) {
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/incidents/${incidentId}/confirmations`);
    if (!res.ok) {
      throw new Error(`Failed to fetch confirmations for incident: ${incidentId}`);
    }
    return await res.json();
  } catch (error) {
    console.error('Error fetching community confirmations:', error);
    throw error;
  }
}

/**
 * Phase 11: Updates case workflow status (NEW -> ACKNOWLEDGED -> INVESTIGATING -> ACTION_TAKEN -> RESOLVED).
 */
export async function updateCaseStatus({ incidentId, status, note = '', officerId = 'AEO001' }) {
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/incidents/${incidentId}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: status.trim(),
        note: note ? note.trim() : null,
        officer_id: officerId,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.detail?.message || data?.message || 'Failed to update case workflow status');
    }
    return data;
  } catch (error) {
    console.error('Error updating case workflow status:', error);
    throw error;
  }
}

/**
 * Phase 12: Submits an official AEO advisory and triggers local-language translation and TTS speech.
 */
export async function submitOfficerAdvisory({ incidentId, advisoryText, targetLanguage = 'Telugu', officerId = 'AEO001' }) {
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/incidents/${incidentId}/advisory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        advisory_text: advisoryText.trim(),
        target_language: targetLanguage,
        officer_id: officerId,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.detail?.message || data?.message || 'Failed to submit official advisory');
    }
    return data;
  } catch (error) {
    console.error('Error submitting AEO advisory:', error);
    throw error;
  }
}

/**
 * Phase 12: Fetches official AEO advisory for an incident.
 */
export async function getOfficerAdvisory(incidentId) {
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/incidents/${incidentId}/advisory`);
    if (!res.ok) {
      throw new Error(`Failed to fetch advisory for incident: ${incidentId}`);
    }
    return await res.json();
  } catch (error) {
    console.error('Error fetching advisory:', error);
    throw error;
  }
}

export default {
  checkHealth,
  submitIncident,
  processVoiceIncident,
  previewVoice,
  performIndicAsr,
  analyzeConfirmedTranscript,
  getIncident,
  listIncidents,
  startWorkOnIncident,
  rejectIncident,
  getMapOverview,
  getClusters,
  submitCommunityConfirmation,
  getIncidentConfirmations,
  updateCaseStatus,
  submitOfficerAdvisory,
  getOfficerAdvisory,
  API_BASE_URL,
};


