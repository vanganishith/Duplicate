import os
import uuid
import re
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any, Tuple, List
from fastapi import UploadFile
from app.core.phone import normalize_phone
from app.database.session import get_supabase_client

# Local uploads directories for reliable media persistence
UPLOADS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "uploads")
AUDIO_UPLOADS_DIR = os.path.join(UPLOADS_DIR, "audio")
PHOTO_UPLOADS_DIR = os.path.join(UPLOADS_DIR, "photos")

os.makedirs(AUDIO_UPLOADS_DIR, exist_ok=True)
os.makedirs(PHOTO_UPLOADS_DIR, exist_ok=True)


def upload_incident_photo(file_bytes: bytes, filename: str, content_type: str = "image/jpeg") -> str:
    """
    Uploads a photo to Supabase Storage bucket 'incident-photos' and returns the public URL.
    Falls back to local persistent upload if bucket is not configured.
    """
    clean_name = re.sub(r'[^a-zA-Z0-9_.-]', '_', filename)
    storage_path = f"{uuid.uuid4()}_{clean_name}"
    
    # 1. Try Supabase Storage
    client = get_supabase_client()
    if client:
        bucket_name = "incident-photos"
        try:
            client.storage.from_(bucket_name).upload(
                path=storage_path,
                file=file_bytes,
                file_options={"content-type": content_type}
            )
            public_url = client.storage.from_(bucket_name).get_public_url(storage_path)
            return public_url
        except Exception:
            pass

    # 2. Local Persistent Storage Fallback
    local_file_path = os.path.join(PHOTO_UPLOADS_DIR, storage_path)
    with open(local_file_path, "wb") as f:
        f.write(file_bytes)
    return f"http://localhost:8000/uploads/photos/{storage_path}"


def upload_incident_audio(file_bytes: bytes, filename: str, content_type: str = "audio/webm") -> Optional[str]:
    """
    Uploads an audio file to Supabase Storage bucket 'incident-audio' and returns the public URL.
    Falls back to local persistent upload if bucket is not configured.
    """
    clean_name = re.sub(r'[^a-zA-Z0-9_.-]', '_', filename)
    storage_path = f"{uuid.uuid4()}_{clean_name}"
    
    # 1. Try Supabase Storage
    client = get_supabase_client()
    if client:
        bucket_name = "incident-audio"
        try:
            client.storage.from_(bucket_name).upload(
                path=storage_path,
                file=file_bytes,
                file_options={"content-type": content_type}
            )
            public_url = client.storage.from_(bucket_name).get_public_url(storage_path)
            return public_url
        except Exception:
            pass

    # 2. Local Persistent Storage Fallback
    local_file_path = os.path.join(AUDIO_UPLOADS_DIR, storage_path)
    with open(local_file_path, "wb") as f:
        f.write(file_bytes)
    return f"http://localhost:8000/uploads/audio/{storage_path}"


def get_or_create_farmer(name: str, phone: str, preferred_language: Optional[str] = "Telugu") -> Tuple[str, bool]:
    """
    Looks up an existing farmer by normalized phone. If not found, creates a new farmer record.
    Returns a tuple: (farmer_id, is_new_farmer).
    """
    client = get_supabase_client()
    if not client:
        raise RuntimeError("Database connection not configured")
    
    normalized_phone = normalize_phone(phone)
    
    # 1. Check for existing farmer
    response = client.table("farmers").select("id, name, phone").eq("phone", normalized_phone).execute()
    
    if response.data and len(response.data) > 0:
        existing_farmer = response.data[0]
        return str(existing_farmer["id"]), False
    
    # 2. Create new farmer
    new_farmer_payload = {
        "name": name.strip(),
        "phone": normalized_phone,
        "preferred_language": preferred_language or "Telugu",
    }
    
    insert_response = client.table("farmers").insert(new_farmer_payload).execute()
    if not insert_response.data or len(insert_response.data) == 0:
        raise RuntimeError("Failed to create farmer record in database")
    
    new_farmer = insert_response.data[0]
    return str(new_farmer["id"]), True


def create_farmer_incident(
    farmer_name: str,
    farmer_phone: str,
    description: str,
    crop: Optional[str] = None,
    language: Optional[str] = "Telugu",
    latitude: Optional[float] = None,
    longitude: Optional[float] = None,
    photo_url: Optional[str] = None,
    photos: Optional[List[str]] = None,
    photo_file: Optional[UploadFile] = None,
    photo_bytes: Optional[bytes] = None,
    photos_files: Optional[List[UploadFile]] = None,
    photos_bytes: Optional[List[bytes]] = None,
    photos_filenames: Optional[List[str]] = None,
    photos_content_types: Optional[List[str]] = None,
    audio_url: Optional[str] = None,
    audio_file: Optional[UploadFile] = None,
    audio_bytes: Optional[bytes] = None,
) -> Dict[str, Any]:
    """
    Phase 3: End-to-end farmer incident submission workflow.
    
    Steps:
    1. Validate input fields & enforce max 4 photos limit
    2. Normalize phone number
    3. Look up existing farmer or create new farmer (Deduplication)
    4. Handle multiple photos and audio upload if files or bytes provided
    5. Construct PostGIS POINT geometry for location if coordinates provided
    6. Insert incident record with status NEW and priority LOW
    7. Return standardized response
    """
    # 1. Validation
    if not farmer_name or not farmer_name.strip():
        raise ValueError("Farmer name is required.")
    
    if not description or not description.strip():
        raise ValueError("Problem description is required.")
    
    # Normalizes phone and raises ValueError if invalid
    normalized_phone = normalize_phone(farmer_phone)
    
    client = get_supabase_client()
    if not client:
        raise RuntimeError("Database connection not configured")
    
    # 2. Get or create farmer
    farmer_id, is_new = get_or_create_farmer(
        name=farmer_name,
        phone=normalized_phone,
        preferred_language=language
    )
    
    # 3. Handle multiple photos upload (Up to 4)
    all_photos_to_upload: List[Tuple[bytes, str, str]] = []
    
    # Single photo legacy input
    if photo_bytes is not None and len(photo_bytes) > 0:
        fname = (photo_file.filename if photo_file else "photo.jpg") or "photo.jpg"
        ctype = (photo_file.content_type if photo_file else "image/jpeg") or "image/jpeg"
        all_photos_to_upload.append((photo_bytes, fname, ctype))
    elif photo_file is not None:
        raw_b = photo_file.file.read() if hasattr(photo_file, 'file') else None
        if raw_b and len(raw_b) > 0:
            all_photos_to_upload.append((raw_b, photo_file.filename or "photo.jpg", photo_file.content_type or "image/jpeg"))

    # Multi-photo inputs
    if photos_bytes:
        for idx, p_b in enumerate(photos_bytes):
            if p_b and len(p_b) > 0:
                fname = (photos_filenames[idx] if photos_filenames and idx < len(photos_filenames) else f"photo_{idx+1}.jpg") or f"photo_{idx+1}.jpg"
                ctype = (photos_content_types[idx] if photos_content_types and idx < len(photos_content_types) else "image/jpeg") or "image/jpeg"
                all_photos_to_upload.append((p_b, fname, ctype))
    elif photos_files:
        for idx, pf in enumerate(photos_files):
            if pf is not None:
                raw_b = pf.file.read() if hasattr(pf, 'file') else None
                if raw_b and len(raw_b) > 0:
                    all_photos_to_upload.append((raw_b, pf.filename or f"photo_{idx+1}.jpg", pf.content_type or "image/jpeg"))

    # Existing URLs
    existing_urls: List[str] = []
    if photos and isinstance(photos, list):
        existing_urls.extend([u for u in photos if u and isinstance(u, str)])
    elif photo_url and photo_url.strip():
        existing_urls.append(photo_url.strip())

    total_photo_count = len(all_photos_to_upload) + len(existing_urls)
    if total_photo_count > 4:
        raise ValueError("Maximum 4 photos allowed per incident.")

    uploaded_photo_urls: List[str] = list(existing_urls)
    for p_b, fname, ctype in all_photos_to_upload:
        p_url = upload_incident_photo(file_bytes=p_b, filename=fname, content_type=ctype)
        if p_url:
            uploaded_photo_urls.append(p_url)

    final_photo_url = uploaded_photo_urls[0] if uploaded_photo_urls else None
        
    # 3b. Handle audio upload if file or bytes provided
    final_audio_url = audio_url
    raw_audio_bytes = audio_bytes
    if raw_audio_bytes is None and audio_file:
        raw_audio_bytes = audio_file.file.read()
        
    if raw_audio_bytes and len(raw_audio_bytes) > 0:
        final_audio_url = upload_incident_audio(
            file_bytes=raw_audio_bytes,
            filename=(audio_file.filename if audio_file else "recording.webm") or "recording.webm",
            content_type=(audio_file.content_type if audio_file else "audio/webm") or "audio/webm"
        )
    
    # 4. Handle location
    location_wkt = None
    location_source = "UNKNOWN"
    
    if latitude is not None and longitude is not None:
        try:
            lat = float(latitude)
            lng = float(longitude)
            if -90 <= lat <= 90 and -180 <= lng <= 180:
                # PostGIS format: POINT(longitude latitude)
                location_wkt = f"POINT({lng} {lat})"
                location_source = "GPS"
        except (ValueError, TypeError):
            location_wkt = None
            location_source = "UNKNOWN"
        except (ValueError, TypeError):
            location_wkt = None
            location_source = "UNKNOWN"
    
    # 5. Insert incident into Supabase
    incident_payload = {
        "farmer_id": farmer_id,
        "crop": crop.strip() if crop and crop.strip() else None,
        "description": description.strip(),
        "language": language or "Telugu",
        "location": location_wkt,
        "location_source": location_source,
        "photo_url": final_photo_url,
        "audio_url": final_audio_url,
        "status": "NEW",
        "priority": "LOW",
        "cluster_id": None,
        "assigned_aeo_id": None,
        "risk_score": None
    }
    
    try:
        payload_with_photos = dict(incident_payload)
        payload_with_photos["photos"] = uploaded_photo_urls
        incident_response = client.table("incidents").insert(payload_with_photos).execute()
    except Exception as e:
        if "photos" in str(e) or "PGRST204" in str(e):
            incident_response = client.table("incidents").insert(incident_payload).execute()
        else:
            raise e
    if not incident_response.data or len(incident_response.data) == 0:
        raise RuntimeError("Failed to create incident record in database")
    
    incident = incident_response.data[0]
    incident_id = str(incident["id"])
    reference_id = f"RB-{incident_id[:8].upper()}"
    
    return {
        "success": True,
        "incident_id": incident_id,
        "farmer_id": farmer_id,
        "reference_id": reference_id,
        "photos": uploaded_photo_urls,
        "photo_url": final_photo_url,
        "message": "Your problem has been reported successfully.",
        "incident": incident
    }


def get_incident_by_id(incident_id: str) -> Optional[Dict[str, Any]]:
    """
    Fetches an incident and its associated farmer details by incident_id.
    """
    client = get_supabase_client()
    if not client:
        raise RuntimeError("Database connection not configured")
    
    response = client.table("incidents").select("*, farmers(*)").eq("id", incident_id).execute()
    if response.data and len(response.data) > 0:
        return response.data[0]
    return None


# ==============================================================
# Phase 11: AEO Case Workflow State Machine
# ==============================================================
VALID_LIFECYCLE_STATUSES = {
    "NEW",
    "AI_ANALYZED",
    "AEO_NOTIFIED",
    "ACKNOWLEDGED",
    "INVESTIGATING",
    "ACTION_TAKEN",
    "RESOLVED",
    "REJECTED",
    "ESCALATED",
}

VALID_STATUS_TRANSITIONS = {
    "NEW": {"ACKNOWLEDGED", "REJECTED"},
    "AI_ANALYZED": {"ACKNOWLEDGED", "REJECTED"},
    "AEO_NOTIFIED": {"ACKNOWLEDGED", "REJECTED"},
    "ACKNOWLEDGED": {"INVESTIGATING", "REJECTED"},
    "INVESTIGATING": {"ACTION_TAKEN", "ESCALATED", "REJECTED"},
    "ACTION_TAKEN": {"RESOLVED", "ESCALATED", "INVESTIGATING"},
    "ESCALATED": {"INVESTIGATING", "ACTION_TAKEN", "RESOLVED"},
    "RESOLVED": set(),
    "REJECTED": set(),
}


def get_next_valid_statuses(current_status: str) -> List[str]:
    """Returns the list of valid next status transitions for an incident."""
    curr = (current_status or "NEW").upper()
    return list(VALID_STATUS_TRANSITIONS.get(curr, set()))


def get_incident_timeline(incident_id: str, incident: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    """
    Retrieves the chronological audit timeline / status history for an incident.
    """
    client = get_supabase_client()
    events = []
    
    inc = incident or (get_incident_by_id(incident_id) if client else None)
    if inc:
        created_at = inc.get("created_at") or inc.get("reported_at")
        if created_at:
            events.append({
                "status": "NEW",
                "label": "Complaint Received",
                "timestamp": created_at,
                "note": inc.get("description", "Farmer reported agricultural incident"),
                "officer_id": None
            })
    
    if client:
        try:
            ai_res = client.table("ai_analysis").select("structured_data, created_at").eq("incident_id", incident_id).execute()
            if ai_res.data:
                for row in ai_res.data:
                    sd = row.get("structured_data")
                    if isinstance(sd, dict):
                        tl = sd.get("timeline")
                        if isinstance(tl, list):
                            for item in tl:
                                if isinstance(item, dict) and item not in events:
                                    events.append(item)
                        rej = sd.get("rejection")
                        if isinstance(rej, dict):
                            rej_event = {
                                "status": "REJECTED",
                                "label": "Case Rejected",
                                "timestamp": rej.get("rejected_at"),
                                "note": rej.get("reason"),
                                "officer_id": rej.get("officer_id", "AEO001")
                            }
                            if rej_event not in events:
                                events.append(rej_event)
        except Exception:
            pass

    try:
        events.sort(key=lambda e: e.get("timestamp") or "")
    except Exception:
        pass

    return events


def update_incident_workflow_status(
    incident_id: str,
    new_status: str,
    note: Optional[str] = None,
    officer_id: Optional[str] = "AEO001"
) -> Dict[str, Any]:
    """
    Phase 11: Advances an incident through its lifecycle state machine.
    NEW -> ACKNOWLEDGED -> INVESTIGATING -> ACTION_TAKEN -> RESOLVED (or REJECTED / ESCALATED).
    """
    client = get_supabase_client()
    if not client:
        raise RuntimeError("Database connection not configured")
        
    incident = get_incident_by_id(incident_id)
    if not incident:
        raise ValueError(f"Incident {incident_id} does not exist.")
        
    current_status = (incident.get("status") or "NEW").upper()
    target_status = new_status.strip().upper()
    
    if target_status not in VALID_LIFECYCLE_STATUSES:
        raise ValueError(f"Invalid status '{new_status}'. Allowed statuses: {sorted(list(VALID_LIFECYCLE_STATUSES))}")
        
    allowed_next = VALID_STATUS_TRANSITIONS.get(current_status, set())
    if target_status not in allowed_next:
        raise ValueError(
            f"Invalid status transition from '{current_status}' to '{target_status}'. "
            f"Allowed next transitions: {sorted(list(allowed_next)) if allowed_next else 'None (Case Completed)'}"
        )
        
    now_iso = datetime.now(timezone.utc).isoformat()
    clean_note = (note or "").strip()
    
    # 1. Update incidents record in database
    update_payload = {
        "status": target_status,
        "updated_at": now_iso
    }
    if target_status == "ACKNOWLEDGED" and not incident.get("acknowledged_at"):
        update_payload["acknowledged_at"] = now_iso
    elif target_status in ("RESOLVED", "REJECTED"):
        update_payload["resolved_at"] = now_iso
        
    update_res = client.table("incidents").update(update_payload).eq("id", incident_id).execute()
    updated_incident = update_res.data[0] if update_res.data else incident
    
    # 2. Append timeline event to ai_analysis structured_data
    timeline_event = {
        "from_status": current_status,
        "to_status": target_status,
        "status": target_status,
        "label": target_status.replace("_", " ").title(),
        "note": clean_note if clean_note else None,
        "officer_id": officer_id or "AEO001",
        "timestamp": now_iso
    }
    
    ai_res = client.table("ai_analysis").select("id, structured_data").eq("incident_id", incident_id).execute()
    existing_sd = {}
    if ai_res.data and len(ai_res.data) > 0:
        sd = ai_res.data[0].get("structured_data")
        if isinstance(sd, dict):
            existing_sd = dict(sd)
            
    current_timeline = list(existing_sd.get("timeline", []))
    current_timeline.append(timeline_event)
    existing_sd["timeline"] = current_timeline
    
    client.table("ai_analysis").insert({
        "incident_id": incident_id,
        "structured_data": existing_sd,
        "requires_aeo_review": True
    }).execute()
    
    return {
        "success": True,
        "incident_id": incident_id,
        "status": target_status,
        "previous_status": current_status,
        "note": clean_note if clean_note else None,
        "updated_at": now_iso,
        "timeline": current_timeline,
        "message": f"Incident transitioned to {target_status} successfully.",
        "incident": updated_incident
    }


def start_work_on_incident(incident_id: str, officer_id: Optional[str] = "AEO001") -> Dict[str, Any]:
    """
    Officer workflow: Transitions an incident to ACKNOWLEDGED status to record that
    the Agricultural Extension Officer has started active handling.
    """
    incident = get_incident_by_id(incident_id)
    if not incident:
        raise ValueError(f"Incident {incident_id} does not exist.")
        
    current_status = (incident.get("status") or "NEW").upper()
    if current_status == "ACKNOWLEDGED":
        now_iso = incident.get("acknowledged_at") or datetime.now(timezone.utc).isoformat()
        return {
            "success": True,
            "incident_id": incident_id,
            "status": "ACKNOWLEDGED",
            "acknowledged_at": now_iso,
            "message": "Officer has started handling this complaint.",
            "incident": incident
        }
    return update_incident_workflow_status(
        incident_id=incident_id,
        new_status="ACKNOWLEDGED",
        note="Officer started active handling",
        officer_id=officer_id
    )


def reject_incident(incident_id: str, reason: str, officer_id: Optional[str] = "AEO001") -> Dict[str, Any]:
    """
    Officer workflow: Rejects an invalid or duplicate complaint with a mandatory rejection reason.
    Persists the reason inside ai_analysis.structured_data['rejection'] and updates incident lifecycle.
    """
    if not reason or not reason.strip():
        raise ValueError("A rejection reason is mandatory.")
        
    client = get_supabase_client()
    if not client:
        raise RuntimeError("Database connection not configured")
        
    incident = get_incident_by_id(incident_id)
    if not incident:
        raise ValueError(f"Incident {incident_id} does not exist.")
        
    now_iso = datetime.now(timezone.utc).isoformat()
    clean_reason = reason.strip()
    
    # 1. Update incident status and timestamps (Never deletes the record)
    update_payload = {
        "status": "REJECTED",
        "resolved_at": now_iso,
        "updated_at": now_iso
    }
    update_res = client.table("incidents").update(update_payload).eq("id", incident_id).execute()
    updated_incident = update_res.data[0] if update_res.data else incident
    
    # 2. Persist rejection record in ai_analysis structured_data without destroying AI evidence
    rejection_meta = {
        "status": "REJECTED",
        "reason": clean_reason,
        "rejected_at": now_iso,
        "officer_id": officer_id or "AEO001"
    }
    
    ai_res = client.table("ai_analysis").select("id, structured_data").eq("incident_id", incident_id).execute()
    existing_sd = {}
    if ai_res.data and len(ai_res.data) > 0:
        sd = ai_res.data[0].get("structured_data")
        if isinstance(sd, dict):
            existing_sd = dict(sd)
            
    existing_sd["rejection"] = rejection_meta
    
    # Also append to timeline
    current_timeline = list(existing_sd.get("timeline", []))
    current_timeline.append({
        "from_status": incident.get("status", "NEW"),
        "to_status": "REJECTED",
        "status": "REJECTED",
        "label": "Case Rejected",
        "note": clean_reason,
        "officer_id": officer_id or "AEO001",
        "timestamp": now_iso
    })
    existing_sd["timeline"] = current_timeline
    
    client.table("ai_analysis").insert({
        "incident_id": incident_id,
        "structured_data": existing_sd,
        "requires_aeo_review": True
    }).execute()
        
    return {
        "success": True,
        "incident_id": incident_id,
        "status": "REJECTED",
        "rejection_reason": clean_reason,
        "rejected_at": now_iso,
        "message": "Incident rejected successfully.",
        "incident": updated_incident
    }


def decode_postgis_point(location_val: Any) -> Optional[Tuple[float, float]]:
    """
    Decodes PostGIS geometry point value (EWKB hex string, WKT string, GeoJSON dict, or coordinates tuple)
    into (latitude, longitude).
    """
    if not location_val:
        return None
    
    if isinstance(location_val, dict):
        coords = location_val.get("coordinates")
        if isinstance(coords, (list, tuple)) and len(coords) >= 2:
            return float(coords[1]), float(coords[0])
        if "lat" in location_val and "lng" in location_val:
            return float(location_val["lat"]), float(location_val["lng"])
        if "latitude" in location_val and "longitude" in location_val:
            return float(location_val["latitude"]), float(location_val["longitude"])
            
    if isinstance(location_val, str):
        hex_clean = location_val.strip()
        # 1. Check if PostGIS EWKB hex string (e.g. 0101000020E6100000...)
        if len(hex_clean) >= 42 and all(c in "0123456789abcdefABCDEF" for c in hex_clean):
            try:
                import struct
                raw_bytes = bytes.fromhex(hex_clean)
                endian = '<' if raw_bytes[0] == 1 else '>'
                # EWKB with SRID flag (0x20): bytes 9-16 is X (lng), bytes 17-24 is Y (lat)
                lng, lat = struct.unpack(f"{endian}dd", raw_bytes[9:25])
                if -90 <= lat <= 90 and -180 <= lng <= 180:
                    return lat, lng
            except Exception:
                pass
        
        # 2. Check if WKT POINT(lng lat)
        wkt_match = re.search(r'POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)', hex_clean, re.IGNORECASE)
        if wkt_match:
            try:
                lng = float(wkt_match.group(1))
                lat = float(wkt_match.group(2))
                return lat, lng
            except Exception:
                pass
                
    return None


def format_incident_location(incident: Dict[str, Any]) -> Dict[str, Any]:
    """
    Enriches incident record with decoded latitude, longitude, and GeoJSON location dictionary.
    """
    if not incident:
        return incident
        
    lat_lng = decode_postgis_point(incident.get("location"))
    if lat_lng:
        lat, lng = lat_lng
        incident["latitude"] = lat
        incident["longitude"] = lng
        incident["location"] = {
            "type": "Point",
            "coordinates": [lng, lat]
        }
    return incident


def haversine_distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Computes real geodesic distance in kilometers between two lat/lon coordinates using the Haversine formula.
    """
    import math
    R = 6371.0  # Earth's radius in kilometers
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c


def compute_incident_priority(
    incident: Dict[str, Any],
    all_incidents: Optional[List[Dict[str, Any]]] = None,
    cluster_radius_km: float = 7.5
) -> Tuple[str, List[str]]:
    """
    Computes a deterministic, explainable priority ('LOW', 'MEDIUM', 'HIGH') and bullet-point reasons.
    Based strictly on 3 real signals:
    1. Number of nearby/similar complaints (within cluster_radius_km)
    2. How recently the complaint was received
    3. Farmer-reported severity from voice extraction or problem description
    
    Weak YOLO/image confidence does NOT elevate priority.
    """
    score = 0
    positive_reasons = []

    # 1. Nearby / similar complaints count
    fmt_inc = format_incident_location(dict(incident))
    lat = fmt_inc.get("latitude")
    lng = fmt_inc.get("longitude")

    nearby_count = 0
    if lat is not None and lng is not None and all_incidents:
        inc_id = str(incident.get("id"))
        for other in all_incidents:
            if str(other.get("id")) == inc_id:
                continue
            fmt_other = format_incident_location(dict(other))
            o_lat = fmt_other.get("latitude")
            o_lng = fmt_other.get("longitude")
            if o_lat is not None and o_lng is not None:
                dist = haversine_distance_km(lat, lng, o_lat, o_lng)
                if dist <= cluster_radius_km:
                    nearby_count += 1

    if nearby_count >= 4:
        score += 2
        positive_reasons.append("Multiple nearby complaints")
    elif nearby_count >= 1:
        score += 1
        positive_reasons.append("Nearby complaints in area")

    # 2. Recency of complaint
    created_str = incident.get("created_at")
    if created_str:
        try:
            clean_ts = created_str.replace("Z", "+00:00")
            dt = datetime.fromisoformat(clean_ts)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            now = datetime.now(timezone.utc)
            diff_hours = (now - dt).total_seconds() / 3600.0
            if diff_hours <= 48:
                score += 2
                positive_reasons.append("Recent reports")
            elif diff_hours <= 168:  # 7 days
                score += 1
                positive_reasons.append("Recent reports (last 7 days)")
        except Exception:
            pass

    # 3. Farmer-reported severity
    has_high_farmer_severity = False
    has_mod_farmer_severity = False

    # Check ai_analysis voice extraction
    ai_records = incident.get("ai_analysis")
    if isinstance(ai_records, list) and len(ai_records) > 0:
        for ai_rec in ai_records:
            sd = ai_rec.get("structured_data") if isinstance(ai_rec, dict) else None
            if isinstance(sd, dict):
                v_sd = sd.get("voice") or {}
                sev = str(v_sd.get("severity", "")).lower()
                if any(w in sev for w in ["high", "severe", "critical", "urgent", "heavy"]):
                    has_high_farmer_severity = True
                elif any(w in sev for w in ["medium", "moderate"]):
                    has_mod_farmer_severity = True

    # Check problem description for severity keywords
    desc = str(incident.get("description", "")).lower()
    high_keywords = ["severe", "heavy", "urgent", "critical", "emergency", "dying", "destroy", "entire field", "తీవ్ర", "ఎక్కువ", "మొత్తం", "నష్టం", "పాడై"]
    if any(kw in desc for kw in high_keywords):
        has_high_farmer_severity = True

    if has_high_farmer_severity:
        score += 2
        positive_reasons.append("High severity reported by farmer")
    elif has_mod_farmer_severity:
        score += 1
        positive_reasons.append("Moderate severity reported by farmer")

    # If already set in db to HIGH or LOW, factor that into scoring if valid
    db_prio = str(incident.get("priority", "")).upper()
    if db_prio == "HIGH" and score < 3:
        score = max(score, 2)

    # Calculate final priority
    if score >= 3:
        priority = "HIGH"
    elif score >= 1:
        priority = "MEDIUM" if (score >= 2 or nearby_count >= 1) else "LOW"
    else:
        priority = "LOW"

    if not positive_reasons:
        positive_reasons = ["Single isolated complaint", "Standard reporting timeline", "Standard severity reported by farmer"]

    return priority, positive_reasons


def compute_cluster_priority(cluster_members: List[Dict[str, Any]]) -> Tuple[str, str]:
    """
    Computes priority ('LOW', 'MEDIUM', 'HIGH') and short explainable reason for a cluster.
    """
    count = len(cluster_members)
    has_high = any(m.get("priority") == "HIGH" for m in cluster_members)

    if count >= 5 or (count >= 3 and has_high):
        priority = "HIGH"
        reason = f"{count} nearby complaints within 7.5km zone"
    elif count >= 2:
        priority = "MEDIUM"
        reason = f"{count} localized complaints within 7.5km zone"
    else:
        priority = "LOW"
        reason = "Single or low-density concentration"

    return priority, reason


def get_map_incidents_and_clusters(
    status_filter: Optional[str] = "all",
    time_filter: Optional[str] = "all",
    priority_filter: Optional[str] = None,
    modality_filter: Optional[str] = "all",
    cluster_radius_km: float = 7.5,
    min_cluster_size: int = 2
) -> Dict[str, Any]:
    """
    Phase 6: Retrieves real PostGIS incident coordinates and performs explainable
    geospatial clustering for the AEO interactive map and priority summary panel.

    Key principles:
    - Zero fake coordinates / zero hardcoded locations.
    - Clustering is an intelligence and prioritization layer; every individual complaint remains accessible.
    - Uses safe descriptive terminology ('Similar reports', 'Possible emerging issue').
    """
    client = get_supabase_client()
    if not client:
        raise RuntimeError("Database connection not configured")

    # 1. Fetch incidents with joined farmer & ai_analysis data
    query = client.table("incidents").select("*, farmers(*), ai_analysis(*)").order("created_at", desc=True)
    res = query.execute()
    raw_incidents = res.data or []

    # Compute priorities and reasons for all raw incidents
    for inc in raw_incidents:
        prio, reasons = compute_incident_priority(inc, all_incidents=raw_incidents, cluster_radius_km=cluster_radius_km)
        inc["priority"] = prio
        inc["priority_reasons"] = reasons

    # 2. Time Filtering
    now = datetime.now(timezone.utc)
    time_filtered = []
    for inc in raw_incidents:
        created_str = inc.get("created_at")
        if not created_str:
            time_filtered.append(inc)
            continue
        try:
            clean_ts = created_str.replace("Z", "+00:00")
            dt = datetime.fromisoformat(clean_ts)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)

            if time_filter == "today":
                if (now - dt).total_seconds() > 86400:
                    continue
            elif time_filter == "7d":
                if (now - dt).days > 7:
                    continue
            elif time_filter == "30d":
                if (now - dt).days > 30:
                    continue
        except Exception:
            pass
        time_filtered.append(inc)

    # 3. Status & Modality & Priority Filtering
    filtered_incidents = []
    for inc in time_filtered:
        status_val = inc.get("status", "NEW")
        is_rej = status_val == "REJECTED" or bool(inc.get("ai_analysis") and len(inc["ai_analysis"]) > 0 and inc["ai_analysis"][0].get("structured_data", {}).get("rejection"))

        if status_filter == "new":
            if status_val not in ("NEW", "AI_ANALYZED"):
                continue
        elif status_filter in ("acknowledged", "in_progress"):
            if status_val not in ("ACKNOWLEDGED", "INVESTIGATING"):
                continue
        elif status_filter == "resolved":
            if status_val not in ("RESOLVED", "ACTION_TAKEN") or is_rej:
                continue
        elif status_filter == "rejected":
            if not is_rej:
                continue
        elif status_filter == "high_priority":
            if inc.get("priority") not in ("HIGH", "CRITICAL"):
                continue

        if priority_filter and priority_filter.upper() != "ALL":
            if inc.get("priority", "LOW").upper() != priority_filter.upper():
                continue

        if modality_filter == "photo" and not inc.get("photo_url"):
            continue
        if modality_filter == "voice" and not inc.get("audio_url"):
            continue

        filtered_incidents.append(inc)

    # 4. Summary Statistics (Calculated from all real database incidents for accurate global counts)
    total_count = len(raw_incidents)
    new_count = sum(1 for i in raw_incidents if i.get("status") in ("NEW", "AI_ANALYZED"))
    in_progress_count = sum(1 for i in raw_incidents if i.get("status") in ("ACKNOWLEDGED", "INVESTIGATING"))
    resolved_count = sum(1 for i in raw_incidents if i.get("status") in ("RESOLVED", "ACTION_TAKEN") and not (i.get("status") == "REJECTED" or bool(i.get("ai_analysis") and len(i["ai_analysis"]) > 0 and i["ai_analysis"][0].get("structured_data", {}).get("rejection"))))
    rejected_count = sum(1 for i in raw_incidents if i.get("status") == "REJECTED" or bool(i.get("ai_analysis") and len(i["ai_analysis"]) > 0 and i["ai_analysis"][0].get("structured_data", {}).get("rejection")))
    high_priority_count = sum(1 for i in raw_incidents if i.get("priority") in ("HIGH", "CRITICAL"))

    # 5. Extract Real Coordinates & Map Items
    map_incidents = []
    incidents_with_coords = []

    for inc in filtered_incidents:
        fmt = format_incident_location(dict(inc))
        lat = fmt.get("latitude")
        lng = fmt.get("longitude")

        farmer = inc.get("farmers") or {}
        farmer_name = farmer.get("name") or "Farmer"
        village = farmer.get("village")
        district = farmer.get("district")
        area_str = f"{village}, {district}" if village and district else (village or district or "Telangana Agricultural Zone")

        # If incident has valid real coordinates
        if lat is not None and lng is not None and -90 <= lat <= 90 and -180 <= lng <= 180:
            item = {
                "id": str(inc["id"]),
                "farmer_name": farmer_name,
                "crop": inc.get("crop"),
                "description": inc.get("description", ""),
                "status": inc.get("status", "NEW"),
                "priority": inc.get("priority", "LOW"),
                "priority_reasons": inc.get("priority_reasons", []),
                "latitude": float(lat),
                "longitude": float(lng),
                "location_source": inc.get("location_source", "UNKNOWN"),
                "area": area_str,
                "has_photo": bool(inc.get("photo_url")),
                "has_audio": bool(inc.get("audio_url")),
                "photo_url": inc.get("photo_url"),
                "audio_url": inc.get("audio_url"),
                "created_at": inc.get("created_at", ""),
                "cluster_id": str(inc.get("cluster_id")) if inc.get("cluster_id") else None,
                "community_confirmations_count": sum(
                    1 for c in (
                        inc.get("ai_analysis", [{}])[0].get("structured_data", {}).get("community_confirmations", [])
                        if isinstance(inc.get("ai_analysis"), list) and len(inc.get("ai_analysis")) > 0
                        else []
                    )
                    if isinstance(c, dict) and str(c.get("response", "")).upper() == "YES"
                ),
            }
            map_incidents.append(item)
            incidents_with_coords.append(item)

    # 6. Geospatial Clustering Logic (Explainable density grouping by proximity & crop)
    clusters = []
    visited_ids = set()

    for i, base_inc in enumerate(incidents_with_coords):
        if base_inc["id"] in visited_ids:
            continue

        cluster_members = [base_inc]
        for j, other_inc in enumerate(incidents_with_coords):
            if i == j or other_inc["id"] in visited_ids:
                continue

            dist = haversine_distance_km(
                base_inc["latitude"], base_inc["longitude"],
                other_inc["latitude"], other_inc["longitude"]
            )
            if dist <= cluster_radius_km:
                cluster_members.append(other_inc)

        if len(cluster_members) >= min_cluster_size:
            for m in cluster_members:
                visited_ids.add(m["id"])

            avg_lat = sum(m["latitude"] for m in cluster_members) / len(cluster_members)
            avg_lng = sum(m["longitude"] for m in cluster_members) / len(cluster_members)

            crops = [m["crop"] for m in cluster_members if m.get("crop")]
            dominant_crop = max(set(crops), key=crops.count) if crops else "Multiple Crops"

            common_issues = []
            for m in cluster_members:
                desc = m.get("description", "").lower()
                if "leaf curl" in desc or "curl" in desc:
                    common_issues.append("Leaf curl / curling symptoms")
                elif "yellow" in desc or "chlorosis" in desc:
                    common_issues.append("Yellowing / leaf spots")
                elif "pest" in desc or "worm" in desc or "bollworm" in desc:
                    common_issues.append("Pest / insect infestation")
                elif "lesion" in desc or "blast" in desc or "spot" in desc:
                    common_issues.append("Foliar lesions / spot symptoms")
                elif "wilt" in desc:
                    common_issues.append("Wilting / stunting")

            if common_issues:
                issue_summary = f"Similar reports: {max(set(common_issues), key=common_issues.count)}"
            else:
                issue_summary = f"Concentration of {len(cluster_members)} agricultural reports"

            areas = [m["area"] for m in cluster_members if m.get("area")]
            cluster_area = max(set(areas), key=areas.count) if areas else "Telangana Agricultural Zone"

            total_confs = sum(m.get("community_confirmations_count", 0) for m in cluster_members)
            cluster_priority, cluster_reason = compute_cluster_priority(cluster_members)
            cluster_id = cluster_members[0].get("cluster_id") or f"cluster-{str(uuid.uuid4())[:8]}"

            for m in cluster_members:
                m["cluster_id"] = cluster_id

            clusters.append({
                "cluster_id": cluster_id,
                "incident_count": len(cluster_members),
                "community_confirmations_count": total_confs,
                "density_score": len(cluster_members) + (total_confs * 0.5),
                "center": {
                    "latitude": round(avg_lat, 6),
                    "longitude": round(avg_lng, 6),
                },
                "crop": dominant_crop,
                "common_issue": issue_summary,
                "priority": cluster_priority,
                "priority_reason": cluster_reason,
                "status": "EMERGING" if len(cluster_members) < 5 else "ACTIVE",
                "area": cluster_area,
                "incident_ids": [m["id"] for m in cluster_members],
                "created_at": min(m["created_at"] for m in cluster_members if m.get("created_at")) if cluster_members else None,
            })

    clusters.sort(key=lambda c: (c["priority"] == "HIGH", c.get("density_score", c["incident_count"])), reverse=True)

    return {
        "success": True,
        "incidents": map_incidents,
        "clusters": clusters,
        "summary": {
            "total": total_count,
            "new": new_count,
            "in_progress": in_progress_count,
            "resolved": resolved_count,
            "rejected": rejected_count,
            "high_priority": high_priority_count,
        }
    }


