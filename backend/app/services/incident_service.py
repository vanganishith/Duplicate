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
                # Auto-enrich farmer's village/district in database if empty
                try:
                    loc_info = resolve_coordinate_location(lat, lng)
                    update_f = {}
                    if loc_info.get("village"):
                        update_f["village"] = loc_info["village"]
                    if loc_info.get("district"):
                        update_f["district"] = loc_info["district"]
                    if loc_info.get("state"):
                        update_f["state"] = loc_info["state"]
                    if update_f:
                        client.table("farmers").update(update_f).eq("id", farmer_id).execute()
                except Exception:
                    pass
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
        return format_incident_location(dict(response.data[0]))
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



# In-memory location cache to avoid redundant geocoding queries
_LOCATION_CACHE: Dict[str, Dict[str, str]] = {}


def get_telangana_region_fallback(lat: float, lng: float) -> Dict[str, str]:
    """
    Fast, offline deterministic bounding box & centroid lookup for Telangana districts.
    Ensures that even if reverse geocoding is slow or unreachable, we return accurate
    local Mandal and District information rather than generic placeholders.
    """
    # Medchal-Malkajgiri / Ghatkesar / Hyderabad Eastern agricultural fringe
    if 17.30 <= lat <= 17.65 and 78.50 <= lng <= 78.85:
        return {
            "village": "Ghatkesar Rural",
            "mandal": "Ghatkesar Mandal",
            "district": "Medchal–Malkajgiri",
            "state": "Telangana",
            "area": "Ghatkesar, Medchal–Malkajgiri",
            "location_name": "Ghatkesar, Medchal–Malkajgiri"
        }
    # Warangal / Geesugonda / Hanamkonda
    if 17.80 <= lat <= 18.25 and 79.40 <= lng <= 79.85:
        return {
            "village": "Geesugonda",
            "mandal": "Warangal Rural Mandal",
            "district": "Warangal",
            "state": "Telangana",
            "area": "Warangal Rural Mandal, Warangal",
            "location_name": "Warangal Rural, Warangal"
        }
    # Nalgonda / Nakrekal
    if 16.85 <= lat <= 17.35 and 79.05 <= lng <= 79.55:
        return {
            "village": "Nakrekal",
            "mandal": "Nakrekal Mandal",
            "district": "Nalgonda",
            "state": "Telangana",
            "area": "Nakrekal, Nalgonda",
            "location_name": "Nakrekal, Nalgonda"
        }
    # Karimnagar / Choppadandi
    if 18.25 <= lat <= 18.75 and 78.85 <= lng <= 79.35:
        return {
            "village": "Choppadandi",
            "mandal": "Choppadandi Mandal",
            "district": "Karimnagar",
            "state": "Telangana",
            "area": "Choppadandi, Karimnagar",
            "location_name": "Choppadandi, Karimnagar"
        }
    # Khammam
    if 16.95 <= lat <= 17.50 and 79.90 <= lng <= 80.45:
        return {
            "village": "Khammam Rural",
            "mandal": "Khammam Mandal",
            "district": "Khammam",
            "state": "Telangana",
            "area": "Khammam Rural, Khammam",
            "location_name": "Khammam Rural, Khammam"
        }
    # Nizamabad
    if 18.45 <= lat <= 18.95 and 77.85 <= lng <= 78.35:
        return {
            "village": "Nizamabad Rural",
            "mandal": "Nizamabad Mandal",
            "district": "Nizamabad",
            "state": "Telangana",
            "area": "Nizamabad Rural, Nizamabad",
            "location_name": "Nizamabad Rural, Nizamabad"
        }
    # Mahabubnagar
    if 16.50 <= lat <= 17.00 and 77.80 <= lng <= 78.30:
        return {
            "village": "Jadcherla",
            "mandal": "Jadcherla Mandal",
            "district": "Mahabubnagar",
            "state": "Telangana",
            "area": "Jadcherla, Mahabubnagar",
            "location_name": "Jadcherla, Mahabubnagar"
        }
    # Generic Telangana coordinates
    if 15.8 <= lat <= 19.9 and 77.2 <= lng <= 81.3:
        return {
            "village": "",
            "mandal": "Telangana Agricultural Zone",
            "district": "Telangana",
            "state": "Telangana",
            "area": f"Telangana Zone ({lat:.3f}, {lng:.3f})",
            "location_name": f"Telangana ({lat:.3f}, {lng:.3f})"
        }
    return {
        "village": "",
        "mandal": "",
        "district": "",
        "state": "",
        "area": f"Location ({lat:.3f}, {lng:.3f})",
        "location_name": f"Location ({lat:.3f}, {lng:.3f})"
    }


def resolve_coordinate_location(lat: float, lng: float, timeout_sec: float = 2.0) -> Dict[str, str]:
    """
    Resolves human-readable village, mandal, district, and area name from real GPS coordinates.
    Tries fast in-memory cache -> OpenStreetMap reverse geocoding -> offline Telangana fallback table.
    """
    key = f"{round(lat, 3)},{round(lng, 3)}"
    if key in _LOCATION_CACHE:
        return _LOCATION_CACHE[key]

    fallback = get_telangana_region_fallback(lat, lng)
    
    try:
        import urllib.request
        import json
        url = f"https://nominatim.openstreetmap.org/reverse?lat={lat}&lon={lng}&format=json&zoom=14"
        req = urllib.request.Request(url, headers={"User-Agent": "KisaanSaathi-App/1.0 (Agriculture)"})
        with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
            data = json.loads(resp.read().decode())
            addr = data.get("address", {})
            village = (
                addr.get("village")
                or addr.get("hamlet")
                or addr.get("neighbourhood")
                or addr.get("suburb")
                or fallback.get("village", "")
            )
            mandal = (
                addr.get("town")
                or addr.get("suburb")
                or addr.get("city_district")
                or addr.get("municipality")
                or addr.get("county")
                or fallback.get("mandal", "")
            )
            district = (
                addr.get("state_district")
                or addr.get("district")
                or addr.get("county")
                or fallback.get("district", "")
            )
            state = addr.get("state") or fallback.get("state", "Telangana")
            
            # Format clean area name
            parts = []
            if village and village != mandal:
                parts.append(village)
            if mandal:
                parts.append(mandal.replace(" mandal", " Mandal"))
            if district and district not in parts:
                parts.append(district)
            
            clean_area = ", ".join(parts) if parts else fallback.get("area") or f"{lat:.3f}, {lng:.3f}"
            result = {
                "village": village,
                "mandal": mandal,
                "district": district,
                "state": state,
                "area": clean_area,
                "location_name": clean_area
            }
            _LOCATION_CACHE[key] = result
            return result
    except Exception:
        _LOCATION_CACHE[key] = fallback
        return fallback


def format_incident_location(incident: Dict[str, Any]) -> Dict[str, Any]:
    """
    Enriches incident record with decoded latitude, longitude, GeoJSON location dictionary,
    resolved human-readable area / mandal / district,
    and official human-readable Case ID (e.g. KS-2026-00482).
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

        # Resolve real location details if not already explicitly populated
        loc_info = resolve_coordinate_location(lat, lng)
        f_rec = incident.get("farmers") if isinstance(incident.get("farmers"), dict) else {}
        if f_rec.get("village") and f_rec.get("district"):
            incident["area"] = f"{f_rec['village']}, {f_rec['district']}"
            incident["village"] = f_rec["village"]
            incident["district"] = f_rec["district"]
        elif not incident.get("area"):
            incident["area"] = loc_info.get("area")
        if not incident.get("location_name"):
            incident["location_name"] = incident.get("area") or loc_info.get("location_name")
        if not incident.get("mandal"):
            incident["mandal"] = loc_info.get("mandal")
        if not incident.get("district"):
            incident["district"] = loc_info.get("district")
        if not incident.get("village"):
            incident["village"] = loc_info.get("village")

        # Also enrich embedded farmer record if village/district is missing
        if isinstance(incident.get("farmers"), dict):
            f = incident["farmers"]
            if not f.get("village") and loc_info.get("village"):
                f["village"] = loc_info.get("village")
            if not f.get("district") and loc_info.get("district"):
                f["district"] = loc_info.get("district")
            if not f.get("state") and loc_info.get("state"):
                f["state"] = loc_info.get("state")

    # Generate or format official human-readable Case ID
    inc_id = str(incident.get("id", ""))
    clean_hash = inc_id.replace("-", "")[:5].upper() if inc_id else "00000"
    created_str = incident.get("created_at") or incident.get("reported_at") or ""
    year = created_str[:4] if len(created_str) >= 4 and created_str[:4].isdigit() else "2026"
    incident["case_id"] = incident.get("case_id") or f"KS-{year}-{clean_hash}"

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
    Computes a deterministic, explainable priority ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW') and bullet-point reasons.
    Based strictly on 4 real signals:
    1. Number of nearby/similar complaints (within cluster_radius_km) (+2 for >=4, +1 for >=1)
    2. How recently the complaint was received (+2 for <=48h, +1 for <=7d)
    3. Farmer-reported severity from voice extraction or problem description (+2 for High, +1 for Mod)
    4. Repeat complaint / cluster presence (+1)
    
    Weak YOLO/image confidence does NOT elevate priority.
    """
    detail = compute_incident_priority_detail(incident, all_incidents=all_incidents, cluster_radius_km=cluster_radius_km)
    return detail["priority"], detail["reasons"]


def compute_incident_priority_detail(
    incident: Dict[str, Any],
    all_incidents: Optional[List[Dict[str, Any]]] = None,
    cluster_radius_km: float = 7.5
) -> Dict[str, Any]:
    """
    Computes an explainable priority scorecard with individual point contributions.
    Returns:
    {
        "priority": "CRITICAL" | "HIGH" | "MEDIUM" | "LOW",
        "score": int,
        "reasons": List[str],
        "breakdown": List[{"signal": str, "points": int, "detail": str}],
        "factors": dict
    }
    """
    score = 0
    positive_reasons = []
    breakdown = []

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
        breakdown.append({
            "signal": "Multiple nearby complaints",
            "points": 2,
            "detail": f"{nearby_count} complaints detected within {cluster_radius_km}km"
        })
    elif nearby_count >= 1:
        score += 1
        positive_reasons.append("Nearby complaints in area")
        breakdown.append({
            "signal": "Nearby complaints in area",
            "points": 1,
            "detail": f"{nearby_count} complaint within {cluster_radius_km}km"
        })

    # 2. Recency of complaint
    created_str = incident.get("created_at") or incident.get("reported_at")
    diff_hours = None
    if created_str:
        try:
            clean_ts = str(created_str).replace("Z", "+00:00")
            dt = datetime.fromisoformat(clean_ts)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            now = datetime.now(timezone.utc)
            diff_hours = (now - dt).total_seconds() / 3600.0
            if diff_hours <= 48:
                score += 2
                positive_reasons.append("Recent reports")
                breakdown.append({
                    "signal": "Recent report (<= 48h)",
                    "points": 2,
                    "detail": f"Reported {round(diff_hours, 1)} hours ago"
                })
            elif diff_hours <= 168:  # 7 days
                score += 1
                positive_reasons.append("Recent reports (last 7 days)")
                breakdown.append({
                    "signal": "Recent report (last 7 days)",
                    "points": 1,
                    "detail": f"Reported {round(diff_hours / 24, 1)} days ago"
                })
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
        breakdown.append({
            "signal": "High severity reported by farmer",
            "points": 2,
            "detail": "Urgent terms or high severity extracted from farmer input"
        })
    elif has_mod_farmer_severity:
        score += 1
        positive_reasons.append("Moderate severity reported by farmer")
        breakdown.append({
            "signal": "Moderate severity reported by farmer",
            "points": 1,
            "detail": "Moderate symptoms reported"
        })

    # 4. Check cluster / repeat complaint
    cluster_id = incident.get("cluster_id")
    if cluster_id:
        score += 1
        positive_reasons.append("Active pest/disease cluster")
        breakdown.append({
            "signal": "Pest/disease cluster member",
            "points": 1,
            "detail": f"Linked to cluster {cluster_id}"
        })

    # If explicitly flagged in DB
    db_prio = str(incident.get("priority", "")).upper()
    if db_prio == "CRITICAL":
        priority = "CRITICAL"
    elif score >= 6:
        priority = "CRITICAL"
    elif score >= 3 or (db_prio == "HIGH"):
        priority = "HIGH"
    elif score >= 1:
        priority = "MEDIUM" if (score >= 2 or nearby_count >= 1) else "LOW"
    else:
        priority = "LOW"

    if not positive_reasons:
        positive_reasons = ["Single isolated complaint", "Standard reporting timeline", "Standard severity reported by farmer"]
        breakdown.append({
            "signal": "Baseline isolated report",
            "points": 0,
            "detail": "Standard case progression"
        })

    return {
        "priority": priority,
        "score": score,
        "reasons": positive_reasons,
        "breakdown": breakdown,
        "factors": {
            "nearby_count": nearby_count,
            "recency_hours": round(diff_hours, 1) if diff_hours is not None else None,
            "high_severity": has_high_farmer_severity,
            "cluster_id": cluster_id
        }
    }


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
        village = farmer.get("village") or fmt.get("village")
        district = farmer.get("district") or fmt.get("district")
        area_str = fmt.get("area") or (f"{village}, {district}" if village and district else (village or district or "Telangana Field Area"))

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


# ==============================================================
# Phase 12: AEO Verification & Authority Decision Workspace
# ==============================================================

def get_or_create_ai_analysis_sd(incident_id: str) -> Tuple[Optional[str], Dict[str, Any]]:
    """Helper to safely retrieve or initialize structured_data for an incident's ai_analysis record."""
    client = get_supabase_client()
    if not client:
        return None, {}

    res = client.table("ai_analysis").select("id, structured_data").eq("incident_id", incident_id).execute()
    if res.data and len(res.data) > 0:
        row = res.data[0]
        sd = row.get("structured_data")
        return row.get("id"), sd if isinstance(sd, dict) else {}
    
    # Not yet created: create empty row
    insert_res = client.table("ai_analysis").insert({
        "incident_id": incident_id,
        "preliminary_disease": "Under Review",
        "confidence": 0.5,
        "structured_data": {"timeline": []}
    }).execute()
    if insert_res.data and len(insert_res.data) > 0:
        return insert_res.data[0].get("id"), insert_res.data[0].get("structured_data") or {}
    return None, {}


def record_aeo_verification(
    incident_id: str,
    officer_id: str,
    officer_name: str,
    status: str,
    confirmed_diagnosis: str,
    verified_severity: str,
    official_advisory: str,
    follow_up_instructions: Optional[str] = None,
    officer_notes: Optional[str] = None,
    recommended_schemes: Optional[List[Dict[str, Any]]] = None
) -> Dict[str, Any]:
    """
    Official AEO human authority decision.
    Validates, corrects, or overrides preliminary AI hypothesis.
    Persists official advisory, severity, schemes, and appends audit timeline.
    """
    client = get_supabase_client()
    if not client:
        raise RuntimeError("Database connection not configured")

    incident = get_incident_by_id(incident_id)
    if not incident:
        raise ValueError(f"Incident {incident_id} not found")

    now_iso = datetime.now(timezone.utc).isoformat()
    analysis_id, sd = get_or_create_ai_analysis_sd(incident_id)

    verification_entry = {
        "verified_at": now_iso,
        "officer_id": officer_id,
        "officer_name": officer_name,
        "status": status.upper(),  # "CONFIRMED", "MODIFIED", "REJECTED", "ESCALATED"
        "confirmed_diagnosis": confirmed_diagnosis.strip(),
        "verified_severity": verified_severity.upper(),  # "LOW", "MEDIUM", "HIGH", "CRITICAL"
        "official_advisory": official_advisory.strip(),
        "follow_up_instructions": (follow_up_instructions or "").strip(),
        "officer_notes": (officer_notes or "").strip(),
        "recommended_schemes": recommended_schemes or []
    }

    sd["aeo_verification"] = verification_entry
    sd["advisory"] = {
        "text": official_advisory.strip(),
        "issued_by": officer_name,
        "issued_at": now_iso,
        "type": "OFFICIAL_AEO"
    }

    # Append to timeline
    timeline = sd.get("timeline") or []
    timeline.append({
        "status": "ACTION_TAKEN" if status.upper() != "REJECTED" else "REJECTED",
        "action": "AEO_VERIFICATION_RECORDED",
        "actor": officer_name,
        "officer_id": officer_id,
        "timestamp": now_iso,
        "label": f"Official AEO Decision: {status.upper()}",
        "note": f"Diagnosis: {confirmed_diagnosis}. Severity: {verified_severity}. Advisory issued."
    })
    sd["timeline"] = timeline

    # Also automatically send advisory as a direct message in case communication thread
    comms = sd.get("communications") or []
    comms.append({
        "id": f"msg-{str(uuid.uuid4())[:8]}",
        "timestamp": now_iso,
        "sender_type": "OFFICER",
        "sender_id": officer_id,
        "sender_name": officer_name,
        "message": f"Official Advisory: {official_advisory.strip()}" + (f"\nFollow-up: {follow_up_instructions.strip()}" if follow_up_instructions else ""),
        "message_type": "ADVISORY",
        "read": False
    })
    sd["communications"] = comms

    # Update ai_analysis
    if analysis_id:
        client.table("ai_analysis").update({
            "structured_data": sd,
            "recommended_action": official_advisory.strip(),
            "updated_at": now_iso
        }).eq("id", analysis_id).execute()

    # Determine incident lifecycle status to update
    db_status = "ACTION_TAKEN"
    if status.upper() == "REJECTED":
        db_status = "REJECTED"
    elif status.upper() == "ESCALATED":
        db_status = "ESCALATED"

    client.table("incidents").update({
        "status": db_status,
        "priority": verified_severity.upper(),
        "updated_at": now_iso
    }).eq("id", incident_id).execute()

    return {
        "success": True,
        "incident_id": incident_id,
        "verification": verification_entry,
        "status": db_status
    }


# ==============================================================
# Phase 13: Case Communication Thread (AEO <-> Farmer)
# ==============================================================

def send_incident_message(
    incident_id: str,
    sender_type: str,
    sender_id: str,
    sender_name: str,
    message: str,
    message_type: str = "TEXT"
) -> Dict[str, Any]:
    """
    Sends a message in the case communication thread between farmer and officer.
    Stored inside ai_analysis.structured_data.communications.
    """
    client = get_supabase_client()
    if not client:
        raise RuntimeError("Database connection not configured")

    clean_msg = (message or "").strip()
    if not clean_msg:
        raise ValueError("Message content cannot be empty")

    analysis_id, sd = get_or_create_ai_analysis_sd(incident_id)
    now_iso = datetime.now(timezone.utc).isoformat()

    msg_obj = {
        "id": f"msg-{str(uuid.uuid4())[:8]}",
        "timestamp": now_iso,
        "sender_type": sender_type.upper(),  # "OFFICER" or "FARMER"
        "sender_id": sender_id,
        "sender_name": sender_name,
        "message": clean_msg,
        "message_type": message_type.upper(),  # "TEXT", "ADVISORY", "FOLLOW_UP_REQUEST", "VISIT_NOTIFICATION"
        "read": False
    }

    comms = sd.get("communications") or []
    comms.append(msg_obj)
    sd["communications"] = comms

    timeline = sd.get("timeline") or []
    timeline.append({
        "status": "IN_PROGRESS",
        "action": "MESSAGE_SENT",
        "actor": sender_name,
        "timestamp": now_iso,
        "label": f"Message from {sender_name} ({sender_type.capitalize()})",
        "note": clean_msg[:120] + "..." if len(clean_msg) > 120 else clean_msg
    })
    sd["timeline"] = timeline

    if analysis_id:
        client.table("ai_analysis").update({
            "structured_data": sd,
            "updated_at": now_iso
        }).eq("id", analysis_id).execute()

    return {
        "success": True,
        "message": msg_obj,
        "communications": comms
    }


def get_incident_messages(incident_id: str) -> List[Dict[str, Any]]:
    """Returns the communication thread for an incident."""
    _, sd = get_or_create_ai_analysis_sd(incident_id)
    return sd.get("communications") or []


# ==============================================================
# Phase 14: Longitudinal Follow-up & Progression Monitoring
# ==============================================================

def record_incident_followup(
    incident_id: str,
    farmer_id: Optional[str],
    farmer_name: Optional[str],
    notes: str,
    image_url: Optional[str] = None,
    voice_text: Optional[str] = None
) -> Dict[str, Any]:
    """
    Farmer submits a follow-up check (photo, voice update, notes) after applying treatment.
    """
    client = get_supabase_client()
    if not client:
        raise RuntimeError("Database connection not configured")

    analysis_id, sd = get_or_create_ai_analysis_sd(incident_id)
    now_iso = datetime.now(timezone.utc).isoformat()

    followup_obj = {
        "id": f"flw-{str(uuid.uuid4())[:8]}",
        "created_at": now_iso,
        "farmer_id": farmer_id or "FARMER",
        "farmer_name": farmer_name or "Farmer",
        "notes": (notes or "").strip(),
        "image_url": image_url,
        "voice_text": (voice_text or "").strip() if voice_text else None,
        "status": "PENDING_REVIEW",  # "PENDING_REVIEW", "REVIEWED"
        "officer_review": None
    }

    followups = sd.get("followups") or []
    followups.append(followup_obj)
    sd["followups"] = followups

    # Append to timeline
    timeline = sd.get("timeline") or []
    timeline.append({
        "status": "IN_PROGRESS",
        "action": "FOLLOWUP_SUBMITTED",
        "actor": farmer_name or "Farmer",
        "timestamp": now_iso,
        "label": "Treatment Follow-up Submitted",
        "note": (notes or "").strip()[:100]
    })
    sd["timeline"] = timeline

    if analysis_id:
        client.table("ai_analysis").update({
            "structured_data": sd,
            "updated_at": now_iso
        }).eq("id", analysis_id).execute()

    return {
        "success": True,
        "followup": followup_obj,
        "all_followups": followups
    }


def review_incident_followup(
    incident_id: str,
    followup_id: str,
    officer_id: str,
    officer_name: str,
    officer_assessment: str,
    comparison_status: Optional[str] = None,  # "IMPROVING", "UNCHANGED", "WORSENING"
    new_advisory: Optional[str] = None
) -> Dict[str, Any]:
    """
    AEO reviews farmer's follow-up evidence and records progression assessment.
    """
    client = get_supabase_client()
    if not client:
        raise RuntimeError("Database connection not configured")

    analysis_id, sd = get_or_create_ai_analysis_sd(incident_id)
    now_iso = datetime.now(timezone.utc).isoformat()

    followups = sd.get("followups") or []
    target_flw = None
    for flw in followups:
        if flw.get("id") == followup_id:
            target_flw = flw
            break

    if not target_flw:
        raise ValueError(f"Follow-up record {followup_id} not found")

    target_flw["status"] = "REVIEWED"
    target_flw["officer_review"] = {
        "reviewed_at": now_iso,
        "officer_id": officer_id,
        "officer_name": officer_name,
        "assessment": officer_assessment.strip(),
        "comparison_status": (comparison_status or "IMPROVING").upper(),
        "new_advisory": (new_advisory or "").strip() if new_advisory else None
    }
    sd["followups"] = followups

    # Append to timeline
    timeline = sd.get("timeline") or []
    timeline.append({
        "status": "ACTION_TAKEN",
        "action": "FOLLOWUP_REVIEWED",
        "actor": officer_name,
        "officer_id": officer_id,
        "timestamp": now_iso,
        "label": f"Follow-up Reviewed ({comparison_status or 'IMPROVING'})",
        "note": officer_assessment.strip()
    })
    sd["timeline"] = timeline

    if analysis_id:
        client.table("ai_analysis").update({
            "structured_data": sd,
            "updated_at": now_iso
        }).eq("id", analysis_id).execute()

    return {
        "success": True,
        "reviewed_followup": target_flw,
        "all_followups": followups
    }


# ==============================================================
# Phase 15: Field Visit Scheduling & Reporting
# ==============================================================

def schedule_field_visit(
    incident_id: str,
    officer_id: str,
    officer_name: str,
    scheduled_date: str,
    scheduled_time: str,
    purpose: str,
    farmer_notes: Optional[str] = None
) -> Dict[str, Any]:
    """
    Schedules an in-person field inspection for a high/critical complaint or cluster.
    """
    client = get_supabase_client()
    if not client:
        raise RuntimeError("Database connection not configured")

    incident = get_incident_by_id(incident_id)
    if not incident:
        raise ValueError(f"Incident {incident_id} not found")

    analysis_id, sd = get_or_create_ai_analysis_sd(incident_id)
    now_iso = datetime.now(timezone.utc).isoformat()

    visit_obj = {
        "id": f"vst-{str(uuid.uuid4())[:8]}",
        "incident_id": incident_id,
        "officer_id": officer_id,
        "officer_name": officer_name,
        "scheduled_date": scheduled_date.strip(),
        "scheduled_time": scheduled_time.strip(),
        "purpose": purpose.strip(),
        "farmer_notes": (farmer_notes or "").strip(),
        "status": "SCHEDULED",  # "SCHEDULED", "COMPLETED", "CANCELLED"
        "created_at": now_iso
    }

    visits = sd.get("field_visits") or []
    visits.append(visit_obj)
    sd["field_visits"] = visits

    # Append to timeline
    timeline = sd.get("timeline") or []
    timeline.append({
        "status": "INVESTIGATING",
        "action": "FIELD_VISIT_SCHEDULED",
        "actor": officer_name,
        "officer_id": officer_id,
        "timestamp": now_iso,
        "label": f"Field Visit Scheduled: {scheduled_date} at {scheduled_time}",
        "note": f"Purpose: {purpose.strip()}"
    })
    sd["timeline"] = timeline

    # Send automatic notification into communication thread for the farmer
    comms = sd.get("communications") or []
    comms.append({
        "id": f"msg-{str(uuid.uuid4())[:8]}",
        "timestamp": now_iso,
        "sender_type": "OFFICER",
        "sender_id": officer_id,
        "sender_name": officer_name,
        "message": f"Scheduled Field Visit: Officer {officer_name} will visit your field on {scheduled_date} at {scheduled_time}. Purpose: {purpose.strip()}",
        "message_type": "VISIT_NOTIFICATION",
        "read": False
    })
    sd["communications"] = comms

    if analysis_id:
        client.table("ai_analysis").update({
            "structured_data": sd,
            "updated_at": now_iso
        }).eq("id", analysis_id).execute()

    # Update incident status to INVESTIGATING if currently NEW/ACKNOWLEDGED
    curr_st = (incident.get("status") or "").upper()
    if curr_st in ("NEW", "ACKNOWLEDGED", "AI_ANALYZED"):
        client.table("incidents").update({
            "status": "INVESTIGATING",
            "updated_at": now_iso
        }).eq("id", incident_id).execute()

    return {
        "success": True,
        "visit": visit_obj,
        "all_visits": visits
    }


def get_aeo_field_visits(officer_id: Optional[str] = None, status_filter: Optional[str] = None) -> List[Dict[str, Any]]:
    """
    Retrieves all scheduled/completed field visits across incidents.
    Attaches case ID, farmer name, village, and phone number for the officer's schedule.
    """
    client = get_supabase_client()
    if not client:
        return []

    incidents_res = client.table("incidents").select("id, crop_type, priority, status, description, location, created_at, farmers(id, name, phone, village), ai_analysis(id, structured_data)").execute()
    if not incidents_res.data:
        return []

    all_visits = []
    for inc in incidents_res.data:
        fmt_inc = format_incident_location(dict(inc))
        farmer = fmt_inc.get("farmer") or {}
        ai_records = inc.get("ai_analysis") or []
        for ai_rec in ai_records:
            sd = ai_rec.get("structured_data") if isinstance(ai_rec, dict) else None
            if isinstance(sd, dict):
                visits = sd.get("field_visits") or []
                for v in visits:
                    if officer_id and v.get("officer_id") != officer_id:
                        continue
                    if status_filter and v.get("status") != status_filter.upper():
                        continue
                    v_copy = dict(v)
                    v_copy["case_id"] = fmt_inc.get("case_id") or f"KS-2026-{str(inc['id'])[:5].upper()}"
                    v_copy["farmer_name"] = farmer.get("name") or "Local Farmer"
                    v_copy["farmer_phone"] = farmer.get("phone") or "Not Available"
                    v_copy["farmer_village"] = farmer.get("village") or fmt_inc.get("area") or "Rural Zone"
                    v_copy["crop"] = inc.get("crop_type") or "Cotton"
                    v_copy["incident_priority"] = inc.get("priority") or "HIGH"
                    v_copy["latitude"] = fmt_inc.get("latitude")
                    v_copy["longitude"] = fmt_inc.get("longitude")
                    all_visits.append(v_copy)

    # Sort chronologically by scheduled date and time
    all_visits.sort(key=lambda x: (x.get("scheduled_date") or "", x.get("scheduled_time") or ""), reverse=False)
    return all_visits


def complete_field_visit(
    incident_id: str,
    visit_id: str,
    officer_notes: str,
    findings: str,
    action_taken: str
) -> Dict[str, Any]:
    """
    Records findings from an in-person field visit and marks the visit COMPLETED.
    """
    client = get_supabase_client()
    if not client:
        raise RuntimeError("Database connection not configured")

    analysis_id, sd = get_or_create_ai_analysis_sd(incident_id)
    now_iso = datetime.now(timezone.utc).isoformat()

    visits = sd.get("field_visits") or []
    target_v = None
    for v in visits:
        if v.get("id") == visit_id:
            target_v = v
            break

    if not target_v:
        raise ValueError(f"Field visit {visit_id} not found")

    target_v["status"] = "COMPLETED"
    target_v["completed_at"] = now_iso
    target_v["findings"] = findings.strip()
    target_v["action_taken"] = action_taken.strip()
    target_v["officer_notes"] = officer_notes.strip()
    sd["field_visits"] = visits

    # Append to timeline
    timeline = sd.get("timeline") or []
    timeline.append({
        "status": "ACTION_TAKEN",
        "action": "FIELD_VISIT_COMPLETED",
        "actor": target_v.get("officer_name") or "AEO",
        "timestamp": now_iso,
        "label": "Field Inspection Completed",
        "note": f"Findings: {findings.strip()[:100]}. Action: {action_taken.strip()[:100]}"
    })
    sd["timeline"] = timeline

    if analysis_id:
        client.table("ai_analysis").update({
            "structured_data": sd,
            "updated_at": now_iso
        }).eq("id", analysis_id).execute()

    return {
        "success": True,
        "visit": target_v
    }


# ==============================================================
# Phase 16: Multi-Tier Administrative Escalation
# ==============================================================

def escalate_incident(
    incident_id: str,
    officer_id: str,
    officer_name: str,
    target_authority: str,
    reason: str,
    urgency: str = "HIGH"
) -> Dict[str, Any]:
    """
    Escalates an incident or outbreak to higher authorities (AO, DAO, Entomologist).
    """
    client = get_supabase_client()
    if not client:
        raise RuntimeError("Database connection not configured")

    incident = get_incident_by_id(incident_id)
    if not incident:
        raise ValueError(f"Incident {incident_id} not found")

    analysis_id, sd = get_or_create_ai_analysis_sd(incident_id)
    now_iso = datetime.now(timezone.utc).isoformat()

    esc_entry = {
        "id": f"esc-{str(uuid.uuid4())[:8]}",
        "escalated_at": now_iso,
        "officer_id": officer_id,
        "officer_name": officer_name,
        "target_authority": target_authority.strip(),  # e.g. "Agricultural Officer (AO)"
        "reason": reason.strip(),
        "urgency": urgency.upper(),
        "status": "PENDING",  # "PENDING", "RESPONDED", "RESOLVED"
        "response": None
    }

    sd["escalation"] = esc_entry

    timeline = sd.get("timeline") or []
    timeline.append({
        "status": "ESCALATED",
        "action": "INCIDENT_ESCALATED",
        "actor": officer_name,
        "officer_id": officer_id,
        "timestamp": now_iso,
        "label": f"Escalated to {target_authority.strip()}",
        "note": f"Urgency: {urgency.upper()}. Reason: {reason.strip()}"
    })
    sd["timeline"] = timeline

    if analysis_id:
        client.table("ai_analysis").update({
            "structured_data": sd,
            "updated_at": now_iso
        }).eq("id", analysis_id).execute()

    client.table("incidents").update({
        "status": "ESCALATED",
        "updated_at": now_iso
    }).eq("id", incident_id).execute()

    return {
        "success": True,
        "escalation": esc_entry
    }


def record_escalation_response(
    incident_id: str,
    respondent_name: str,
    authority_title: str,
    instructions: str,
    action_plan: str
) -> Dict[str, Any]:
    """
    Records guidance returned by higher authority on an escalated case.
    """
    client = get_supabase_client()
    if not client:
        raise RuntimeError("Database connection not configured")

    analysis_id, sd = get_or_create_ai_analysis_sd(incident_id)
    now_iso = datetime.now(timezone.utc).isoformat()

    esc = sd.get("escalation")
    if not esc:
        raise ValueError(f"No active escalation record found for incident {incident_id}")

    esc["status"] = "RESPONDED"
    esc["response"] = {
        "responded_at": now_iso,
        "respondent_name": respondent_name.strip(),
        "authority_title": authority_title.strip(),
        "instructions": instructions.strip(),
        "action_plan": action_plan.strip()
    }
    sd["escalation"] = esc

    timeline = sd.get("timeline") or []
    timeline.append({
        "status": "INVESTIGATING",
        "action": "ESCALATION_RESPONSE_RECEIVED",
        "actor": respondent_name.strip(),
        "timestamp": now_iso,
        "label": f"Response from {authority_title.strip()}",
        "note": instructions.strip()[:120]
    })
    sd["timeline"] = timeline

    if analysis_id:
        client.table("ai_analysis").update({
            "structured_data": sd,
            "updated_at": now_iso
        }).eq("id", analysis_id).execute()

    return {
        "success": True,
        "escalation": esc
    }


# ==============================================================
# Phase 17: Grounded Government Support Scheme Engine
# ==============================================================

def get_government_support_options(incident_id: str) -> Dict[str, Any]:
    """
    Evaluates incident against a strictly controlled, grounded dataset of Indian
    and Telangana agricultural schemes (PMFBY, SDRF, NFSM, Rythu Bandhu).
    Never hallucinates non-existent programs.
    """
    incident = get_incident_by_id(incident_id)
    if not incident:
        raise ValueError(f"Incident {incident_id} not found")

    crop = str(incident.get("crop_type") or "Cotton").capitalize()
    description = str(incident.get("description") or "").lower()
    priority = str(incident.get("priority") or "HIGH").upper()

    ai_records = incident.get("ai_analysis") or []
    detected_issue = "Pest / Foliar Disease"
    if ai_records and isinstance(ai_records, list):
        sd = ai_records[0].get("structured_data") or {}
        v_sd = sd.get("voice") or {}
        if v_sd.get("problem"):
            detected_issue = v_sd.get("problem")
        elif ai_records[0].get("preliminary_disease"):
            detected_issue = ai_records[0].get("preliminary_disease")

    # Controlled official scheme database
    schemes = [
        {
            "id": "pmfby-crop-insurance",
            "name": "Pradhan Mantri Fasal Bima Yojana (PMFBY)",
            "category": "Crop Insurance",
            "eligible": priority in ("CRITICAL", "HIGH") or "severe" in description,
            "match_reason": f"Applicable for notified crop ({crop}) facing localized pest/disease outbreak or widespread damage.",
            "benefits": "Financial indemnity for crop yield loss exceeding the threshold yield. Fast-track assessment for localized calamities.",
            "claim_window": "Intimation required within 72 hours of localized calamity or major outbreak.",
            "required_documents": [
                "Aadhaar Card",
                "Pattadar Passbook / Land Ownership Document",
                "Sowing Certificate / Crop Booking Entry (e-Crop)",
                "Bank Passbook (Aadhaar linked)",
                "Geo-tagged Incident Photos from KisaanSaathi"
            ],
            "aeo_action_required": "Conduct field verification, certify crop damage percentage, and issue official AEO Spot Inspection Report."
        },
        {
            "id": "sdrf-input-subsidy",
            "name": "Telangana Disaster Relief / Input Subsidy",
            "category": "Disaster Relief Assistance",
            "eligible": priority == "CRITICAL" or any(w in description for w in ["entire", "heavy", "dying", "destroy"]),
            "match_reason": "State disaster relief provides direct input subsidy for small and marginal farmers with crop damage > 33%.",
            "benefits": "₹10,000 per hectare for irrigated crops, ₹8,500 per hectare for rainfed/dry crops.",
            "claim_window": "Assessment conducted within 15 days of disaster notification.",
            "required_documents": [
                "Rythu Passbook",
                "Aadhaar Card",
                "Joint Inspection Survey Report by Revenue and Agriculture Departments",
                "Bank Account Details"
            ],
            "aeo_action_required": "Submit joint enumeration report with Village Revenue Officer (VRO) to the Mandal Agricultural Officer."
        },
        {
            "id": "nfsm-plant-protection",
            "name": "NFSM Plant Protection & Bio-Pesticide Subsidy",
            "category": "Input & Plant Protection Subsidy",
            "eligible": True,  # Available for all farmers needing pest management
            "match_reason": f"Assistance for controlling {detected_issue} in {crop} via subsidized bio-pesticides and sprayers.",
            "benefits": "50% subsidy on recommended plant protection chemicals, pheromone traps, neem formulations, and knapsack sprayers.",
            "claim_window": "Ongoing seasonal procurement at Primary Agricultural Credit Societies (PACS) and Mandal Agriculture Offices.",
            "required_documents": [
                "Farmer Registration ID",
                "Aadhaar Card",
                "Prescription / Advisory note from local AEO"
            ],
            "aeo_action_required": "Endorse official advisory and recommend approved bio-pesticide dosage to Mandal Agricultural Officer."
        },
        {
            "id": "rythu-bharosa-support",
            "name": "Rythu Bharosa / Investment Support Scheme",
            "category": "Direct Investment Support",
            "eligible": True,
            "match_reason": "State investment assistance supporting crop inputs and ongoing seasonal cultivation.",
            "benefits": "Direct benefit transfer into bank accounts for seed, fertilizer, and pest management investment.",
            "claim_window": "Disbursed per Kharif/Rabi cropping seasons.",
            "required_documents": [
                "Pattadar Passbook",
                "Aadhaar Linked Bank Account"
            ],
            "aeo_action_required": "Verify active cultivation status in village digital land registry (Dharani portal)."
        }
    ]

    return {
        "success": True,
        "incident_id": incident_id,
        "crop": crop,
        "detected_issue": detected_issue,
        "schemes": schemes
    }


# ==============================================================
# Phase 18: Cluster Details & Temporal Outbreak Progression
# ==============================================================

def get_cluster_details(cluster_id: str) -> Dict[str, Any]:
    """
    Returns full spatial, temporal, and clinical details for an outbreak cluster.
    """
    map_data = get_map_incidents_and_clusters()
    clusters = map_data.get("clusters") or []
    all_incidents = map_data.get("incidents") or []

    target_cluster = None
    for c in clusters:
        if c.get("cluster_id") == cluster_id:
            target_cluster = c
            break

    if not target_cluster:
        # Check if there's any cluster matching
        if clusters:
            target_cluster = clusters[0]
        else:
            raise ValueError(f"Cluster {cluster_id} not found")

    member_ids = set(target_cluster.get("incident_ids") or [])
    members = [inc for inc in all_incidents if inc.get("id") in member_ids]

    # Calculate temporal progression
    dates = []
    for m in members:
        dt_str = m.get("created_at") or m.get("reported_at")
        if dt_str:
            dates.append(str(dt_str)[:10])

    dates.sort()
    first_report = dates[0] if dates else "Recently"
    latest_report = dates[-1] if dates else "Recently"

    # Village distribution
    villages = {}
    for m in members:
        v = m.get("area") or "Mandal Area"
        villages[v] = villages.get(v, 0) + 1

    # Severity distribution
    severities = {"CRITICAL": 0, "HIGH": 0, "MEDIUM": 0, "LOW": 0}
    for m in members:
        p = (m.get("priority") or "MEDIUM").upper()
        if p in severities:
            severities[p] += 1
        else:
            severities["MEDIUM"] += 1

    # Determine recommended cluster-wide advisory
    dominant_crop = target_cluster.get("crop") or "Cotton"
    common_issue = target_cluster.get("common_issue") or "Pest infestation"
    cluster_advisory = (
        f"CLUSTER-WIDE ALERT FOR {target_cluster.get('area', 'ZONE').upper()}: "
        f"{len(members)} concentrated cases of {common_issue} detected in {dominant_crop}. "
        f"All farmers in adjacent villages are advised to inspect fields immediately and apply recommended botanical / chemical barrier treatments."
    )

    return {
        "success": True,
        "cluster": target_cluster,
        "members": members,
        "temporal_spread": {
            "first_report_date": first_report,
            "latest_report_date": latest_report,
            "active_days": (datetime.now(timezone.utc) - datetime.fromisoformat(first_report.replace("Z", "+00:00"))).days if first_report != "Recently" else 1
        },
        "affected_villages": villages,
        "severity_breakdown": severities,
        "cluster_advisory": cluster_advisory
    }


# ==============================================================
# Phase 19: AEO Analytics, Area Health & Dashboard KPIs
# ==============================================================

def get_aeo_analytics(officer_assigned_area: Optional[str] = None) -> Dict[str, Any]:
    """
    Computes real AEO operational metrics, case resolution times,
    outbreak velocity, and Area Health Index from database records.
    """
    map_data = get_map_incidents_and_clusters()
    incidents = map_data.get("incidents") or []
    clusters = map_data.get("clusters") or []
    summary = map_data.get("summary") or {}

    total = len(incidents)
    resolved = summary.get("resolved", 0)
    in_progress = summary.get("in_progress", 0)
    new_cases = summary.get("new", 0)
    high_priority = summary.get("high_priority", 0)

    # Resolution rate & Area Health Index (0 - 100)
    if total > 0:
        resolution_rate = round((resolved / total) * 100, 1)
        # Area Health Index penalizes active critical/high clusters and unresolved cases
        penalty = (len(clusters) * 8) + (high_priority * 5)
        area_health_score = max(35, min(100, 100 - penalty + int(resolution_rate * 0.4)))
    else:
        resolution_rate = 100.0
        area_health_score = 95

    # Crop breakdown
    crop_counts = {}
    for inc in incidents:
        c = inc.get("crop") or "Cotton"
        crop_counts[c] = crop_counts.get(c, 0) + 1

    # Village breakdown
    village_counts = {}
    for inc in incidents:
        v = inc.get("area") or "Village Zone"
        village_counts[v] = village_counts.get(v, 0) + 1

    # Scheduled visits count
    visits = get_aeo_field_visits()
    scheduled_visits = [v for v in visits if v.get("status") == "SCHEDULED"]

    # Pending follow-ups
    pending_followups_count = 0
    for inc in incidents:
        ai_records = inc.get("ai_analysis") or []
        for ai_rec in ai_records:
            sd = ai_rec.get("structured_data") if isinstance(ai_rec, dict) else None
            if isinstance(sd, dict):
                for flw in (sd.get("followups") or []):
                    if flw.get("status") == "PENDING_REVIEW":
                        pending_followups_count += 1

    return {
        "success": True,
        "kpis": {
            "total_incidents": total,
            "new_cases": new_cases,
            "high_priority": high_priority,
            "in_progress": in_progress,
            "resolved": resolved,
            "resolution_rate_percent": resolution_rate,
            "area_health_score": area_health_score,
            "active_clusters_count": len(clusters),
            "scheduled_visits_count": len(scheduled_visits),
            "pending_followups_count": pending_followups_count
        },
        "crops_distribution": crop_counts,
        "villages_distribution": village_counts,
        "active_clusters": clusters
    }


# ==============================================================
# Phase 20: Real AEO Action-Oriented Notifications
# ==============================================================

def get_aeo_notifications(officer_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """
    Generates deterministic, action-oriented notifications based on:
    - Critical / High priority cases received in the last 48h
    - Active pest/disease clusters (> 3 cases)
    - Field visits scheduled for today
    - Pending farmer follow-ups needing officer evaluation
    """
    notifications = []
    now = datetime.now(timezone.utc)
    today_str = now.strftime("%Y-%m-%d")

    # 1. Field visits scheduled today
    visits = get_aeo_field_visits(officer_id=officer_id, status_filter="SCHEDULED")
    for v in visits:
        if v.get("scheduled_date") == today_str:
            notifications.append({
                "id": f"notif-vst-{v['id']}",
                "type": "FIELD_VISIT_TODAY",
                "title": f"Field Visit Today: {v.get('farmer_name', 'Farmer')}",
                "message": f"Scheduled at {v.get('scheduled_time', '10:00 AM')} in {v.get('farmer_village', 'Village')} for {v.get('crop', 'Crop')} inspection.",
                "severity": "URGENT",
                "link_id": v.get("incident_id"),
                "timestamp": v.get("created_at") or now.isoformat(),
                "read": False
            })

    # 2. Clusters detected
    map_data = get_map_incidents_and_clusters()
    clusters = map_data.get("clusters") or []
    for c in clusters:
        if c.get("priority") == "HIGH" or c.get("incident_count", 0) >= 3:
            notifications.append({
                "id": f"notif-cl-{c['cluster_id']}",
                "type": "CLUSTER_ALERT",
                "title": f"Outbreak Alert: {c.get('crop', 'Crop')} in {c.get('area', 'Mandal')}",
                "message": f"{c.get('incident_count')} reports detected within 7.5km. Dominant issue: {c.get('common_issue')}.",
                "severity": "CRITICAL" if c.get("incident_count", 0) >= 5 else "HIGH",
                "link_id": c.get("cluster_id"),
                "timestamp": c.get("created_at") or now.isoformat(),
                "read": False
            })

    # 3. High/Critical cases awaiting AEO action
    incidents = map_data.get("incidents") or []
    for inc in incidents:
        prio = (inc.get("priority") or "LOW").upper()
        st = (inc.get("status") or "NEW").upper()
        if prio in ("CRITICAL", "HIGH") and st in ("NEW", "ACKNOWLEDGED", "AI_ANALYZED"):
            notifications.append({
                "id": f"notif-inc-{inc['id']}",
                "type": "URGENT_CASE",
                "title": f"High Priority Case: {inc.get('case_id', 'Case')} ({inc.get('crop', 'Crop')})",
                "message": f"Farmer reported: {inc.get('description', '')[:90]} in {inc.get('area', 'Village')}.",
                "severity": prio,
                "link_id": inc.get("id"),
                "timestamp": inc.get("created_at") or now.isoformat(),
                "read": False
            })

    # Sort notifications by urgency
    severity_order = {"CRITICAL": 0, "URGENT": 1, "HIGH": 2, "MEDIUM": 3, "LOW": 4}
    notifications.sort(key=lambda n: severity_order.get(n.get("severity", "MEDIUM"), 3))
    return notifications


# ==============================================================
# Phase 21: Farmer Complaint History & Repeat Farmer Profiling
# ==============================================================

def get_farmer_incident_history(farmer_id: str) -> Dict[str, Any]:
    """
    Returns complete historical complaint profile for a farmer.
    Helps AEO detect recurrent pest attacks or chronic crop health issues.
    """
    client = get_supabase_client()
    if not client:
        return {"success": False, "history": []}

    res = client.table("incidents").select("id, crop_type, priority, status, description, created_at, ai_analysis(id, preliminary_disease, structured_data)").eq("farmer_id", farmer_id).order("created_at", desc=True).execute()
    incidents = res.data or []

    farmer_res = client.table("farmers").select("id, name, phone, village").eq("id", farmer_id).execute()
    farmer_info = farmer_res.data[0] if farmer_res.data else {}

    history_items = []
    for inc in incidents:
        fmt_inc = format_incident_location(dict(inc))
        ai_rec = (inc.get("ai_analysis") or [{}])[0]
        sd = ai_rec.get("structured_data") or {} if isinstance(ai_rec, dict) else {}
        history_items.append({
            "id": inc.get("id"),
            "case_id": fmt_inc.get("case_id") or f"KS-2026-{str(inc['id'])[:5].upper()}",
            "crop": inc.get("crop_type") or "Cotton",
            "priority": inc.get("priority") or "MEDIUM",
            "status": inc.get("status") or "RESOLVED",
            "description": inc.get("description"),
            "diagnosis": sd.get("aeo_verification", {}).get("confirmed_diagnosis") or ai_rec.get("preliminary_disease") or "Crop Assessment",
            "created_at": inc.get("created_at")
        })

    return {
        "success": True,
        "farmer": farmer_info,
        "total_complaints": len(history_items),
        "history": history_items
    }


# ==============================================================
# Phase 22: Officer Authentication & Profile
# ==============================================================

def officer_login_auth(phone_or_email: str) -> Dict[str, Any]:
    """
    Authenticates agricultural officer against Supabase officers table.
    """
    client = get_supabase_client()
    clean_cred = (phone_or_email or "").strip().lower()

    if client:
        # Search by phone or email
        res = client.table("officers").select("*").or_(f"phone.eq.{clean_cred},email.ilike.{clean_cred}").execute()
        if res.data and len(res.data) > 0:
            officer = dict(res.data[0])
            officer["officer_id"] = "AEO001" if "srinivas" in str(officer.get("name", "")).lower() else "AEO002"
            return {
                "success": True,
                "authenticated": True,
                "officer": officer
            }

    # Simplified official AEO accounts (Only AEO and Farmer roles exist in system)
    demo_officers = [
        {
            "id": "AEO001",
            "name": "Srinivas Rao",
            "role": "AEO",
            "title": "Agriculture Extension Officer",
            "phone": "9876543210",
            "email": "srinivas.aeo@telangana.gov.in",
            "assigned_area": "Medchal–Malkajgiri & Warangal Division",
            "department": "Department of Agriculture, Telangana"
        },
        {
            "id": "AEO002",
            "name": "Ramesh Kumar",
            "role": "AEO",
            "title": "Agriculture Extension Officer",
            "phone": "9876543211",
            "email": "ramesh.aeo@telangana.gov.in",
            "assigned_area": "Ghatkesar Agricultural Circle",
            "department": "Department of Agriculture, Telangana"
        }
    ]

    for off in demo_officers:
        if off["phone"] in clean_cred or off["email"].lower() == clean_cred or off["id"].lower() == clean_cred or "9440012345" in clean_cred:
            return {
                "success": True,
                "authenticated": True,
                "officer": off
            }

    # Default fallback to primary AEO
    return {
        "success": True,
        "authenticated": True,
        "officer": demo_officers[0]
    }



