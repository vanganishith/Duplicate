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
      const err = new Error(errorMessage);
      if (data && typeof data.detail === 'object') {
        err.photo_retry_required = Boolean(data.detail.photo_retry_required);
        err.image_evaluations = data.detail.image_evaluations || [];
        err.detail = data.detail;
      }
      throw err;
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

function communityProfilePayload() {
  try {
    const profile = JSON.parse(localStorage.getItem('kisaansathi_farmer_profile') || 'null');
    return profile?.farmer_id ? { farmer_id: profile.farmer_id } : {};
  } catch {
    return {};
  }
}

export async function getCommunityPosts(limit = 30) {
  const response = await fetch(`${API_BASE_URL}/api/v1/community/posts?limit=${limit}`);
  const data = await response.json();
  if (!response.ok) throw new Error(data?.detail?.message || data?.message || 'Failed to load farmer community');
  return data;
}

export async function lookupFarmerByPhone(phone) {
  const response = await fetch(`${API_BASE_URL}/api/v1/farmers/lookup?phone=${encodeURIComponent(phone)}`);
  const data = await response.json();
  if (!response.ok) throw new Error(data?.detail?.message || data?.message || 'Failed to lookup farmer phone');
  return data;
}

export async function getMyIssues(limit = 30, farmerPhone = null) {
  const profile = farmerPhone ? { farmer_phone: farmerPhone } : communityProfilePayload();
  const params = new URLSearchParams({ limit: String(limit), ...profile });
  const response = await fetch(`${API_BASE_URL}/api/v1/community/my-issues?${params.toString()}`);
  const data = await response.json();
  if (!response.ok) throw new Error(data?.detail?.message || data?.message || 'Failed to load your issues');
  return data;
}

export async function getCommunityProblem(problemId) {
  const response = await fetch(`${API_BASE_URL}/api/v1/community/problems/${problemId}`);
  const data = await response.json();
  if (!response.ok) throw new Error(data?.detail?.message || data?.message || 'Failed to load agricultural problem');
  return data;
}

export async function createCommunityPost({ content, crop, incidentId = null, photoUrl = null }) {
  const response = await fetch(`${API_BASE_URL}/api/v1/community/posts`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...communityProfilePayload(), content, crop: crop || null, incident_id: incidentId || null, photo_url: photoUrl || null }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.detail?.message || data?.message || 'Failed to create community post');
  return data;
}

export async function uploadCommunityPhoto(file) {
  const formData = new FormData();
  formData.append('file', file);
  const response = await fetch(`${API_BASE_URL}/api/v1/community/photos`, { method: 'POST', body: formData });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.detail?.message || data?.message || 'Failed to upload community photo');
  return data;
}

export async function addCommunityComment(postId, content) {
  const response = await fetch(`${API_BASE_URL}/api/v1/community/posts/${postId}/comments`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...communityProfilePayload(), content }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.detail?.message || data?.message || 'Failed to add comment');
  return data;
}

export async function addProblemComment(problemId, content) {
  const response = await fetch(`${API_BASE_URL}/api/v1/community/problems/${problemId}/comments`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...communityProfilePayload(), content }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.detail?.message || data?.message || 'Failed to add comment');
  return data;
}

export async function markCommunityCommentHelpful(commentId) {
  const response = await fetch(`${API_BASE_URL}/api/v1/community/comments/${commentId}/helpful`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(communityProfilePayload()),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.detail?.message || data?.message || 'Failed to mark comment Helpful');
  return data;
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

/**
 * Phase 13+: AEO Workspace API Extensions
 */

export async function officerLogin(credentials) {
  const res = await fetch(`${API_BASE_URL}/api/v1/officers/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.detail?.message || data?.message || 'Officer login failed');
  return data;
}

export async function submitAeoVerification({
  incidentId,
  officerId = 'AEO001',
  officerName = 'Srinivas Rao (AEO)',
  status = 'CONFIRMED',
  confirmedDiagnosis,
  verifiedSeverity = 'HIGH',
  officialAdvisory,
  followUpInstructions = '',
  officerNotes = '',
  recommendedSchemes = [],
}) {
  const res = await fetch(`${API_BASE_URL}/api/v1/incidents/${incidentId}/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      officer_id: officerId,
      officer_name: officerName,
      status,
      confirmed_diagnosis: confirmedDiagnosis,
      verified_severity: verifiedSeverity,
      official_advisory: officialAdvisory,
      follow_up_instructions: followUpInstructions,
      officer_notes: officerNotes,
      recommended_schemes: recommendedSchemes,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.detail?.message || data?.message || 'Failed to record AEO verification');
  return data;
}

export async function sendCaseMessage({
  incidentId,
  senderType = 'OFFICER',
  senderId = 'AEO001',
  senderName = 'Srinivas Rao (AEO)',
  message,
  messageType = 'TEXT',
}) {
  const res = await fetch(`${API_BASE_URL}/api/v1/incidents/${incidentId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sender_type: senderType,
      sender_id: senderId,
      sender_name: senderName,
      message,
      message_type: messageType,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.detail?.message || data?.message || 'Failed to send message');
  return data;
}

export async function getCaseMessages(incidentId) {
  const res = await fetch(`${API_BASE_URL}/api/v1/incidents/${incidentId}/messages`);
  const data = await res.json();
  if (!res.ok) throw new Error(data?.detail?.message || 'Failed to fetch messages');
  return data;
}

export async function submitCaseFollowup({
  incidentId,
  farmerId,
  farmerName,
  notes,
  imageUrl,
  voiceText,
}) {
  const res = await fetch(`${API_BASE_URL}/api/v1/incidents/${incidentId}/followups`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      farmer_id: farmerId,
      farmer_name: farmerName,
      notes,
      image_url: imageUrl,
      voice_text: voiceText,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.detail?.message || 'Failed to submit follow-up');
  return data;
}

export async function reviewCaseFollowup({
  incidentId,
  followupId,
  officerId = 'AEO001',
  officerName = 'Srinivas Rao (AEO)',
  officerAssessment,
  comparisonStatus = 'IMPROVING',
  newAdvisory = '',
  baselineImage = null,
  followupImage = null,
  crop = 'Cotton',
  initialDiagnosis = 'Pest infestation',
  farmerNotes = '',
}) {
  const res = await fetch(`${API_BASE_URL}/api/v1/incidents/${incidentId}/followups/${followupId}/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      officer_id: officerId,
      officer_name: officerName,
      officer_assessment: officerAssessment,
      comparison_status: comparisonStatus,
      new_advisory: newAdvisory,
      baseline_image: baselineImage,
      followup_image: followupImage,
      crop,
      initial_diagnosis: initialDiagnosis,
      farmer_notes: farmerNotes,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.detail?.message || 'Failed to submit follow-up review');
  return data;
}

export async function scheduleFieldVisit({
  incidentId,
  officerId = 'AEO001',
  officerName = 'Srinivas Rao (AEO)',
  scheduledDate,
  scheduledTime = '10:00 AM',
  purpose = 'Field Inspection',
  farmerNotes = '',
}) {
  const res = await fetch(`${API_BASE_URL}/api/v1/incidents/${incidentId}/field-visits`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      officer_id: officerId,
      officer_name: officerName,
      scheduled_date: scheduledDate,
      scheduled_time: scheduledTime,
      purpose,
      farmer_notes: farmerNotes,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.detail?.message || 'Failed to schedule visit');
  return data;
}

export async function getScheduledFieldVisits({ officerId, statusFilter } = {}) {
  const params = new URLSearchParams();
  if (officerId) params.append('officer_id', officerId);
  if (statusFilter) params.append('status_filter', statusFilter);
  const res = await fetch(`${API_BASE_URL}/api/v1/aeo/field-visits?${params.toString()}`);
  const data = await res.json();
  if (!res.ok) throw new Error('Failed to fetch field visits');
  return data;
}

export async function completeFieldVisit({
  incidentId,
  visitId,
  officerNotes = '',
  findings = '',
  actionTaken = '',
}) {
  const res = await fetch(`${API_BASE_URL}/api/v1/incidents/${incidentId}/field-visits/${visitId}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      officer_notes: officerNotes,
      findings,
      action_taken: actionTaken,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.detail?.message || 'Failed to complete visit');
  return data;
}

export async function escalateIncident({
  incidentId,
  officerId = 'AEO001',
  officerName = 'Srinivas Rao (AEO)',
  targetAuthority = 'Mandal Agricultural Officer (AO)',
  reason,
  urgency = 'HIGH',
}) {
  const res = await fetch(`${API_BASE_URL}/api/v1/incidents/${incidentId}/escalate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      officer_id: officerId,
      officer_name: officerName,
      target_authority: targetAuthority,
      reason,
      urgency,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.detail?.message || 'Failed to escalate incident');
  return data;
}

export async function getGovernmentSupport(incidentId) {
  const res = await fetch(`${API_BASE_URL}/api/v1/incidents/${incidentId}/government-support`);
  const data = await res.json();
  if (!res.ok) throw new Error('Failed to fetch government support schemes');
  return data;
}

export async function getClusterDetails(clusterId) {
  const res = await fetch(`${API_BASE_URL}/api/v1/clusters/${clusterId}/details`);
  const data = await res.json();
  if (!res.ok) throw new Error('Failed to fetch cluster details');
  return data;
}

export async function getAeoAnalytics(assignedArea) {
  const params = assignedArea ? `?assigned_area=${encodeURIComponent(assignedArea)}` : '';
  const res = await fetch(`${API_BASE_URL}/api/v1/aeo/analytics${params}`);
  const data = await res.json();
  if (!res.ok) throw new Error('Failed to fetch AEO analytics');
  return data;
}

export async function getAeoNotifications(officerId) {
  const params = officerId ? `?officer_id=${encodeURIComponent(officerId)}` : '';
  const res = await fetch(`${API_BASE_URL}/api/v1/aeo/notifications${params}`);
  const data = await res.json();
  if (!res.ok) throw new Error('Failed to fetch notifications');
  return data;
}

export async function getFarmerHistory(farmerId) {
  const res = await fetch(`${API_BASE_URL}/api/v1/farmers/${farmerId}/history`);
  const data = await res.json();
  if (!res.ok) throw new Error('Failed to fetch farmer history');
  return data;
}

export async function analyzeIncidentMultimodal(incidentId) {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/incidents/${incidentId}/analyze-multimodal`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.message || `Failed with status ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Failed to run multimodal analysis on incident:', error);
    throw error;
  }
}

/**
 * Fetches 3-4 genuine historical similar cases for an incident.
 */
export async function getSimilarIssues(incidentId, language = 'Telugu') {
  try {
    const encodedLang = encodeURIComponent(language || 'Telugu');
    const response = await fetch(`${API_BASE_URL}/api/v1/incidents/${incidentId}/similar-issues?language=${encodedLang}`);
    if (!response.ok) {
      return { success: true, similar_issues: [] };
    }
    return await response.json();
  } catch (error) {
    console.warn('Failed to fetch similar issues:', error);
    return { success: true, similar_issues: [] };
  }
}

/**
 * Attaches farmer confirmation of similar issues to the same incident.
 */
export async function confirmSimilarIssues(incidentId, matchedIncidentIds, farmerPhone = null, farmerName = null) {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/incidents/${incidentId}/confirm-similar`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        matched_incident_ids: matchedIncidentIds || [],
        farmer_phone: farmerPhone,
        farmer_name: farmerName,
      }),
    });
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.detail || 'Failed to record similar issue confirmation');
    }
    return await response.json();
  } catch (error) {
    console.error('Error confirming similar issues:', error);
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
  analyzeIncidentMultimodal,
  startWorkOnIncident,
  rejectIncident,
  getMapOverview,
  getClusters,
  submitCommunityConfirmation,
  getIncidentConfirmations,
  updateCaseStatus,
  submitOfficerAdvisory,
  getOfficerAdvisory,
  officerLogin,
  submitAeoVerification,
  sendCaseMessage,
  getCaseMessages,
  submitCaseFollowup,
  reviewCaseFollowup,
  scheduleFieldVisit,
  getScheduledFieldVisits,
  completeFieldVisit,
  escalateIncident,
  getGovernmentSupport,
  getClusterDetails,
  getAeoAnalytics,
  getAeoNotifications,
  getFarmerHistory,
  getSimilarIssues,
  confirmSimilarIssues,
  API_BASE_URL,
};


