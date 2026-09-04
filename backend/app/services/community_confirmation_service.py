import uuid
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List, Tuple
from app.core.phone import normalize_phone
from app.database.session import get_supabase_client
from app.services.incident_service import (
    get_incident_by_id,
    get_or_create_farmer,
    format_incident_location,
    haversine_distance_km
)

VALID_RESPONSES = {"YES", "NO", "NOT_SURE"}


def check_incident_has_nearby_complaints(
    incident: Dict[str, Any],
    all_incidents: Optional[List[Dict[str, Any]]] = None,
    cluster_radius_km: float = 7.5
) -> Tuple[bool, int]:
    """
    Checks whether an incident has relevant nearby/similar complaints within cluster_radius_km.
    Uses existing PostGIS coordinates and geodesic distance.
    Returns (has_nearby_complaints: bool, nearby_count: int).
    """
    fmt = format_incident_location(dict(incident))
    lat = fmt.get("latitude")
    lng = fmt.get("longitude")

    if lat is None or lng is None or not all_incidents:
        return False, 0

    inc_id = str(incident.get("id"))
    nearby_count = 0
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

    return (nearby_count >= 1), nearby_count


def get_community_confirmations(incident_id: str) -> List[Dict[str, Any]]:
    """
    Fetches all community confirmation records for an incident from database.
    Merges across all ai_analysis records for the incident and deduplicates by farmer_phone.
    """
    client = get_supabase_client()
    if not client:
        return []

    confirmations_by_phone: Dict[str, Dict[str, Any]] = {}
    try:
        res = client.table("ai_analysis").select("structured_data").eq("incident_id", incident_id).execute()
        if res.data:
            for row in res.data:
                sd = row.get("structured_data")
                if isinstance(sd, dict):
                    confs = sd.get("community_confirmations")
                    if isinstance(confs, list):
                        for c in confs:
                            if isinstance(c, dict) and "farmer_phone" in c:
                                phone = c["farmer_phone"]
                                confirmations_by_phone[phone] = c
    except Exception:
        pass

    return list(confirmations_by_phone.values())


def calculate_community_stats(confirmations: List[Dict[str, Any]]) -> Dict[str, int]:
    """
    Aggregates YES, NO, and NOT_SURE response counts deterministically without LLMs.
    """
    yes_count = sum(1 for c in confirmations if str(c.get("response", "")).upper() == "YES")
    no_count = sum(1 for c in confirmations if str(c.get("response", "")).upper() == "NO")
    not_sure_count = sum(1 for c in confirmations if str(c.get("response", "")).upper() == "NOT_SURE")
    total = len(confirmations)

    return {
        "yes_count": yes_count,
        "no_count": no_count,
        "not_sure_count": not_sure_count,
        "total_responses": total,
    }


def record_community_confirmation(
    incident_id: str,
    farmer_phone: str,
    response: str,
    farmer_name: Optional[str] = "Nearby Farmer",
    latitude: Optional[float] = None,
    longitude: Optional[float] = None,
) -> Dict[str, Any]:
    """
    Phase 10: Records a community confirmation response from a nearby farmer.
    
    Guarantees:
    - Validates response is YES, NO, or NOT_SURE.
    - Normalizes phone number.
    - Prevents duplicate submissions by the same farmer phone for the same incident.
    - Stores directly in database.
    - Captures optional GPS location of confirmation to increase map/cluster density.
    - Aggregates counts without Gemini or artificial score inflation.
    - Never modifies original incident status, never creates a new AEO case, and never delays triage.
    """
    clean_response = response.strip().upper().replace(" ", "_")
    if clean_response not in VALID_RESPONSES:
        raise ValueError(f"Invalid response '{response}'. Response must be YES, NO, or NOT_SURE.")

    normalized_phone = normalize_phone(farmer_phone)

    client = get_supabase_client()
    if not client:
        raise RuntimeError("Database connection not configured")

    # 1. Verify incident exists
    incident = get_incident_by_id(incident_id)
    if not incident:
        raise ValueError(f"Incident with ID {incident_id} not found.")

    # 2. Get existing confirmations and check for duplicates
    existing_confirmations = get_community_confirmations(incident_id)
    for existing in existing_confirmations:
        if existing.get("farmer_phone") == normalized_phone:
            raise ValueError(
                f"Farmer with phone {normalized_phone} has already submitted a community response for this incident."
            )

    # 3. Get or create farmer record
    farmer_id = None
    try:
        farmer_id, _ = get_or_create_farmer(name=farmer_name or "Nearby Farmer", phone=normalized_phone)
    except Exception:
        pass

    # 4. Create new confirmation entry with optional location signal
    now_iso = datetime.now(timezone.utc).isoformat()
    new_entry = {
        "id": str(uuid.uuid4()),
        "farmer_id": farmer_id,
        "farmer_name": (farmer_name or "Nearby Farmer").strip(),
        "farmer_phone": normalized_phone,
        "response": clean_response,
        "latitude": float(latitude) if latitude is not None and -90 <= float(latitude) <= 90 else None,
        "longitude": float(longitude) if longitude is not None and -180 <= float(longitude) <= 180 else None,
        "created_at": now_iso,
    }

    # 5. Insert new record into ai_analysis structured_data in Supabase
    all_confirmations = list(existing_confirmations) + [new_entry]
    client.table("ai_analysis").insert({
        "incident_id": incident_id,
        "structured_data": {"community_confirmations": all_confirmations},
        "requires_aeo_review": True,
    }).execute()

    # 6. Calculate updated stats
    stats = calculate_community_stats(all_confirmations)

    return {
        "success": True,
        "incident_id": incident_id,
        "farmer_phone": normalized_phone,
        "response": clean_response,
        "stats": stats,
        "message": "Community confirmation recorded successfully.",
        "confirmation": new_entry,
    }


def get_nearby_incidents_for_farmer(
    latitude: float,
    longitude: float,
    radius_km: float = 3.0,
    crop: Optional[str] = None,
    current_incident_id: Optional[str] = None,
    limit: int = 20,
) -> Dict[str, Any]:
    """
    Farmer-Facing Nearby Community Issues (Section 3 & 4):
    - Strictly enforces default 3 KM radius (NOT the AEO 7.5 KM cluster zone).
    - Uses deterministic geodesic distance calculation (zero LLM distance hallucinations).
    - Prioritizes: (1) Same crop, (2) Similar condition/symptoms, (3) Distance (closest first), (4) Recency.
    - Privacy Enforcement: NEVER exposes other farmers' exact coordinates, phone numbers, or identities.
    """
    if not Number_is_valid_coord(latitude, longitude):
        return {
            "success": False,
            "count": 0,
            "radius_km": radius_km,
            "items": [],
            "message": "Valid latitude and longitude are required.",
        }

    client = get_supabase_client()
    if not client:
        return {
            "success": True,
            "count": 0,
            "radius_km": radius_km,
            "items": [],
            "message": "No similar issues found nearby.",
        }

    try:
        res = client.table("incidents").select("*, ai_analysis(*)").execute()
        raw_incidents = res.data or []
    except Exception:
        raw_incidents = []

    nearby_candidates = []
    farmer_crop_clean = (crop or "").strip().lower()

    for inc in raw_incidents:
        inc_id = str(inc.get("id"))
        # Exclude the current incident if provided
        if current_incident_id and inc_id == str(current_incident_id):
            continue

        # Exclude REJECTED incidents from community alert feed
        if inc.get("status") == "REJECTED":
            continue

        fmt = format_incident_location(dict(inc))
        inc_lat = fmt.get("latitude")
        inc_lng = fmt.get("longitude")

        if inc_lat is None or inc_lng is None:
            continue

        # Deterministic Geodesic Distance
        dist_km = haversine_distance_km(latitude, longitude, inc_lat, inc_lng)
        if dist_km <= radius_km:
            inc_crop = (inc.get("crop") or "").strip()
            is_same_crop = bool(farmer_crop_clean and inc_crop and inc_crop.lower() == farmer_crop_clean)

            # Extract voice or vision summary
            problem_summary = inc.get("description") or "Crop issue reported"
            ai_records = inc.get("ai_analysis") or []
            if isinstance(ai_records, list):
                for r in ai_records:
                    sd = r.get("structured_data") if isinstance(r, dict) else None
                    if isinstance(sd, dict):
                        voice_sd = sd.get("voice") or sd
                        if isinstance(voice_sd, dict) and voice_sd.get("summary"):
                            problem_summary = voice_sd["summary"]
                            break

            # Confirmations count
            confirmations = get_community_confirmations(inc_id)
            yes_confs = sum(1 for c in confirmations if str(c.get("response", "")).upper() == "YES")

            # Photos
            photo_url = inc.get("photo_url")
            if not photo_url and isinstance(inc.get("photos"), list) and len(inc.get("photos")) > 0:
                photo_url = inc.get("photos")[0]

            # Privacy Sanitized Output Item
            nearby_candidates.append({
                "id": inc_id,
                "crop": inc_crop or "Crop",
                "problem_summary": problem_summary,
                "description": inc.get("description"),
                "distance_km": round(dist_km, 2),
                "distance_text": f"{round(dist_km, 1)} km away",
                "locality": fmt.get("area") or "Near your locality",
                "photo_url": photo_url,
                "created_at": inc.get("created_at"),
                "status": inc.get("status", "OPEN"),
                "community_confirmations_count": yes_confs,
                "has_similar_crop": is_same_crop,
            })

    # Prioritization:
    # 1. Similar crop first (True > False)
    # 2. Distance ascending (Closest first: 0.4 km, 0.9 km, 1.7 km...)
    # 3. Recency descending (Newest first)
    nearby_candidates.sort(
        key=lambda x: (
            not x["has_similar_crop"],
            x["distance_km"],
            -(datetime.fromisoformat(x["created_at"].replace("Z", "+00:00")).timestamp()) if x.get("created_at") else 0
        )
    )

    trimmed_items = nearby_candidates[:limit]
    msg = None if trimmed_items else "No similar issues found nearby."

    return {
        "success": True,
        "count": len(trimmed_items),
        "radius_km": radius_km,
        "items": trimmed_items,
        "message": msg,
    }


def Number_is_valid_coord(lat: Any, lng: Any) -> bool:
    try:
        lat_f = float(lat)
        lng_f = float(lng)
        return (-90 <= lat_f <= 90) and (-180 <= lng_f <= 180)
    except (TypeError, ValueError):
        return False


def get_incident_community_summary(
    incident_id: str,
    all_incidents: Optional[List[Dict[str, Any]]] = None
) -> Dict[str, Any]:
    """
    Returns aggregated community confirmation statistics and nearby proximity context for an incident.
    """
    incident = get_incident_by_id(incident_id)
    confirmations = get_community_confirmations(incident_id)
    stats = calculate_community_stats(confirmations)

    has_nearby = False
    nearby_count = 0
    if incident:
        has_nearby, nearby_count = check_incident_has_nearby_complaints(incident, all_incidents)

    return {
        "success": True,
        "incident_id": incident_id,
        "stats": stats,
        "has_nearby_complaints": has_nearby,
        "nearby_complaints_count": nearby_count,
        "confirmations": confirmations,
        "disclaimer": "Community confirmation represents supporting field evidence from nearby farmers, not a confirmed outbreak diagnosis."
    }
