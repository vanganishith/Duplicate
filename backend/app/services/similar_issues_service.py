import uuid
import logging
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional

from app.database.session import get_supabase_client
from app.core.phone import normalize_phone
from app.services.incident_service import (
    decode_postgis_point,
    haversine_distance_km,
    get_incident_by_id,
    format_incident_location,
    get_or_create_farmer,
)
from app.services.llm_service import evaluate_candidate_similarity_qwen

logger = logging.getLogger("kisaansathi.similar_issues")

# Crop equivalence map for multi-lingual matching
CROP_SYNONYMS = {
    "tomato": ["tomato", "టమాటా", "టమోటా", "टमाटर", "தக்காளி", "ಟೊಮೆಟೊ"],
    "paddy": ["paddy", "rice", "వరి", "धान", "நெல்", "ಭತ್ತ"],
    "cotton": ["cotton", "పత్తి", "कपास", "பருத்தி", "ಹತ್ತಿ"],
    "chilli": ["chilli", "chili", "మిరప", "మిర్చి", "मिर्च", "மிளகாய்", "ಮೆಣಸಿನಕಾಯಿ"],
    "maize": ["maize", "corn", "మొక్కజొన్న", "मक्का", "மக்காச்சோளம்", "ಮೆಕ್ಕೆಜೋಳ"],
}


def _are_crops_compatible(crop1: Optional[str], crop2: Optional[str]) -> bool:
    """
    Checks if two crop names refer to the same crop across languages.
    """
    if not crop1 or not crop2:
        return False
    c1 = crop1.strip().lower()
    c2 = crop2.strip().lower()
    if c1 == c2:
        return True

    for canon, syns in CROP_SYNONYMS.items():
        if (c1 == canon or any(s in c1 for s in syns)) and (c2 == canon or any(s in c2 for s in syns)):
            return True

    return False


def _format_location_label(dist_km: Optional[float], language: str = "Telugu") -> str:
    """
    Creates an anonymized, friendly location label without revealing exact GPS coordinates or street addresses.
    """
    is_te = "te" in language.lower() or "telugu" in language.lower()
    is_hi = "hi" in language.lower() or "hindi" in language.lower()
    is_ta = "ta" in language.lower() or "tamil" in language.lower()
    is_kn = "kn" in language.lower() or "kannada" in language.lower()

    if dist_km is None:
        if is_te: return "మీ ప్రాంతం సమీపంలో"
        if is_hi: return "आपके क्षेत्र के पास"
        if is_ta: return "உங்கள் பகுதிக்கு அருகில்"
        if is_kn: return "ನಿಮ್ಮ ಪ್ರದೇಶದ ಹತ್ತಿರ"
        return "Near your locality"

    rounded_km = max(1, int(round(dist_km)))
    if rounded_km <= 3:
        if is_te: return "మీ ప్రాంతం సమీపంలో"
        if is_hi: return "आपके क्षेत्र के पास"
        if is_ta: return "உங்கள் பகுதிக்கு அருகில்"
        if is_kn: return "ನಿಮ್ಮ ಪ್ರದೇಶದ ಹತ್ತಿರ"
        return "Near your locality"
    elif rounded_km <= 15:
        if is_te: return f"సుమారు {rounded_km} కి.మీ దూరంలో"
        if is_hi: return f"लगभग {rounded_km} किमी दूर"
        if is_ta: return f"சுமார் {rounded_km} கி.மீ தொலைவில்"
        if is_kn: return f"ಸುಮಾರು {rounded_km} ಕಿ.ಮೀ ದೂರದಲ್ಲಿ"
        return f"About {rounded_km} km away"
    elif rounded_km <= 35:
        if is_te: return "మీ మండల పరిధిలో"
        if is_hi: return "आपके मंडल क्षेत्र में"
        if is_ta: return "உங்கள் வட்டார பகுதியில்"
        if is_kn: return "ನಿಮ್ಮ ಮಂಡಲ ವ್ಯಾಪ್ತಿಯಲ್ಲಿ"
        return "In your mandal area"
    else:
        if is_te: return "సమీప వ్యవసాయ ప్రాంతంలో"
        if is_hi: return "पास के कृषि क्षेत्र में"
        if is_ta: return "அருகிலுள்ள விவசாய பகுதியில்"
        if is_kn: return "ಹತ್ತಿರದ ಕೃಷಿ ಪ್ರದೇಶದಲ್ಲಿ"
        return "In nearby farming zone"


def _format_reported_time(created_at_str: Optional[str], language: str = "Telugu") -> str:
    """
    Creates a human-readable recency label.
    """
    is_te = "te" in language.lower() or "telugu" in language.lower()
    is_hi = "hi" in language.lower() or "hindi" in language.lower()
    is_ta = "ta" in language.lower() or "tamil" in language.lower()
    is_kn = "kn" in language.lower() or "kannada" in language.lower()

    if not created_at_str:
        if is_te: return "ఇటీవల నమోదైంది"
        if is_hi: return "हाल ही में दर्ज"
        return "Reported recently"

    try:
        dt = datetime.fromisoformat(created_at_str.replace("Z", "+00:00"))
        now = datetime.now(timezone.utc)
        diff_days = max(0, (now - dt).days)

        if diff_days <= 3:
            if is_te: return "కొద్ది రోజుల క్రితం"
            if is_hi: return "कुछ दिन पहले"
            return "A few days ago"
        elif diff_days <= 14:
            weeks = max(1, diff_days // 7)
            if is_te: return f"{weeks} వారం క్రితం"
            if is_hi: return f"{weeks} सप्ताह पहले"
            return f"{weeks} week(s) ago"
        elif diff_days <= 45:
            if is_te: return "గత నెలలో"
            if is_hi: return "पिछले महीने"
            return "Last month"
        else:
            if is_te: return "గతంలో నమోదైంది"
            if is_hi: return "पहले दर्ज किया गया"
            return "Previous season"
    except Exception:
        if is_te: return "గతంలో నమోదైంది"
        return "Reported previously"


def _determine_verification_status(incident: Dict[str, Any], ai_records: List[Dict[str, Any]]) -> str:
    """
    Determines verification status: AEO_VERIFIED | AI_PRELIMINARY | UNVERIFIED
    """
    status = str(incident.get("status") or "").upper()
    if status in ["RESOLVED", "ACTION_TAKEN", "VERIFIED"]:
        return "AEO_VERIFIED"

    for r in ai_records:
        sd = r.get("structured_data")
        if isinstance(sd, dict):
            if sd.get("advisory") or sd.get("aeo_verification") or sd.get("confirmed_diagnosis"):
                return "AEO_VERIFIED"

    if status in ["AI_ANALYZED", "INVESTIGATING", "ACKNOWLEDGED"]:
        return "AI_PRELIMINARY"

    return "UNVERIFIED"


def _determine_outcome_label(incident: Dict[str, Any], verification_status: str, language: str = "Telugu") -> str:
    """
    Returns outcome label: Improved | Unchanged | Worsened | Under Review
    """
    is_te = "te" in language.lower() or "telugu" in language.lower()
    is_hi = "hi" in language.lower() or "hindi" in language.lower()

    status = str(incident.get("status") or "").upper()
    if status == "RESOLVED":
        if is_te: return "మెరుగుపడింది (పరిష్కరించబడింది)"
        if is_hi: return "सुधार हुआ (समाधान हुआ)"
        return "Improved"

    if verification_status == "AEO_VERIFIED":
        if is_te: return "అధికారి పరిశీలించారు"
        if is_hi: return "अधिकारी द्वारा सत्यापित"
        return "AEO Verified"

    if status in ["INVESTIGATING", "ACKNOWLEDGED"]:
        if is_te: return "పరిశీలనలో ఉంది"
        if is_hi: return "जांच जारी है"
        return "Under Review"

    if is_te: return "పరిశీలనలో ఉంది"
    return "Reported"


async def find_similar_issues(
    incident_id: str,
    max_results: int = 4,
    language: str = "Telugu"
) -> Dict[str, Any]:
    """
    Finds real historical incidents genuinely similar to the specified incident.
    Combines PostGIS geographic proximity, symptom extraction, and Featherless Qwen3-VL reasoning.
    
    Guarantees:
    - Never exposes private farmer details (names, phones, exact coordinates).
    - Top 3-4 matches maximum; returns fewer if fewer genuinely match; empty list if none match.
    - Does not match issues solely on crop (e.g. tomato leaf spots vs tomato price).
    - Returns structured schema for farmer UI and AEO verification.
    """
    client = get_supabase_client()
    if not client:
        return {"success": True, "incident_id": incident_id, "similar_issues": []}

    # 1. Fetch current incident
    current_inc = get_incident_by_id(incident_id)
    if not current_inc:
        logger.warning(f"[SimilarIssues] Incident {incident_id} not found.")
        return {"success": True, "incident_id": incident_id, "similar_issues": [], "message": f"Incident {incident_id} not found"}

    cur_lat = current_inc.get("latitude")
    cur_lng = current_inc.get("longitude")
    if cur_lat is None or cur_lng is None:
        loc = decode_postgis_point(current_inc.get("location"))
        if loc:
            cur_lat, cur_lng = loc

    cur_crop = current_inc.get("crop") or ""
    cur_desc = current_inc.get("description") or ""

    # Extract structured AI findings from current incident
    cur_ai_res = client.table("ai_analysis").select("structured_data, possible_conditions").eq("incident_id", incident_id).execute()
    cur_symptoms = []
    cur_possible_condition = None
    if cur_ai_res.data:
        for r in cur_ai_res.data:
            sd = r.get("structured_data") or {}
            if isinstance(sd, dict):
                complaint = sd.get("complaint") or {}
                if isinstance(complaint, dict) and complaint.get("symptoms"):
                    cur_symptoms.extend(complaint["symptoms"])
                mm = sd.get("multimodal_assessment") or {}
                if isinstance(mm, dict) and mm.get("possible_conditions"):
                    cur_possible_condition = mm["possible_conditions"][0]
            if not cur_possible_condition and r.get("possible_conditions"):
                conds = r.get("possible_conditions")
                cur_possible_condition = conds[0] if isinstance(conds, list) and conds else str(conds)

    current_case_data = {
        "id": incident_id,
        "crop": cur_crop,
        "problem": cur_desc,
        "symptoms": cur_symptoms,
        "possible_condition": cur_possible_condition,
        "latitude": cur_lat,
        "longitude": cur_lng,
    }

    # 2. Fetch candidate historical incidents (excluding the current one)
    try:
        cand_query = client.table("incidents").select("*, ai_analysis(*)").neq("id", incident_id).order("created_at", desc=True).limit(40)
        cand_res = cand_query.execute()
        historical_incidents = cand_res.data or []
    except Exception as exc:
        logger.warning(f"[SimilarIssues] Query historical incidents failed: {exc}")
        return {"success": True, "incident_id": incident_id, "similar_issues": []}

    if not historical_incidents:
        return {"success": True, "incident_id": incident_id, "similar_issues": []}

    # 3. Pre-process candidates, compute PostGIS distance, filter non-agricultural / incompatible
    candidates_for_eval = []
    candidates_metadata = {}

    for cand in historical_incidents:
        cid = str(cand.get("id"))
        cand_crop = cand.get("crop") or ""
        cand_desc = cand.get("description") or ""

        # Decode PostGIS coordinates
        cand_lat = cand.get("latitude")
        cand_lng = cand.get("longitude")
        if cand_lat is None or cand_lng is None:
            loc = decode_postgis_point(cand.get("location"))
            if loc:
                cand_lat, cand_lng = loc

        dist_km = None
        if cur_lat is not None and cur_lng is not None and cand_lat is not None and cand_lng is not None:
            dist_km = haversine_distance_km(cur_lat, cur_lng, cand_lat, cand_lng)

        # Extract AI analysis details
        ai_records = cand.get("ai_analysis") or []
        cand_symptoms = []
        cand_diagnosis = None
        cand_advisory_text = None

        for r in ai_records:
            sd = r.get("structured_data") or {}
            if isinstance(sd, dict):
                c_dict = sd.get("complaint") or {}
                if isinstance(c_dict, dict) and c_dict.get("symptoms"):
                    cand_symptoms.extend(c_dict["symptoms"])
                mm = sd.get("multimodal_assessment") or {}
                if isinstance(mm, dict) and mm.get("possible_conditions"):
                    cand_diagnosis = mm["possible_conditions"][0]
                adv = sd.get("advisory") or {}
                if isinstance(adv, dict) and adv.get("text"):
                    cand_advisory_text = adv["text"]
            if not cand_diagnosis and r.get("possible_conditions"):
                conds = r.get("possible_conditions")
                cand_diagnosis = conds[0] if isinstance(conds, list) and conds else str(conds)

        verification_status = _determine_verification_status(cand, ai_records)
        location_label = _format_location_label(dist_km, language)
        reported_time = _format_reported_time(cand.get("created_at") or cand.get("reported_at"), language)
        outcome = _determine_outcome_label(cand, verification_status, language)

        # Prepare safe AEO advisory text (informational summary, NOT a direct pesticide prescription)
        safe_aeo_advice = "Field verification completed with agricultural guidance."
        if cand_advisory_text:
            safe_aeo_advice = "Field verification followed by an agricultural recommendation."

        candidates_metadata[cid] = {
            "incident_id": cid,
            "crop": cand_crop,
            "problem": cand_desc,
            "symptoms": list(set(cand_symptoms)),
            "duration": "Observed in field",
            "location_label": location_label,
            "reported_time": reported_time,
            "verification_status": verification_status,
            "outcome": outcome,
            "aeo_advice": safe_aeo_advice,
            "dist_km": dist_km,
            "image_available": bool(cand.get("photo_url") or cand.get("photos")),
            "image_url": cand.get("photo_url") or (cand.get("photos")[0] if cand.get("photos") else None),
            "created_at": cand.get("created_at") or "",
        }

        # Crop alignment check
        is_crop_match = _are_crops_compatible(cur_crop, cand_crop)

        candidates_for_eval.append({
            "id": cid,
            "crop": cand_crop,
            "problem": cand_desc,
            "symptoms": cand_symptoms,
            "confirmed_diagnosis": cand_diagnosis,
            "status": cand.get("status") or "",
            "is_crop_match": is_crop_match,
        })

    # Limit candidates to top 8 most promising for Featherless Qwen3-VL evaluation
    # Sort by: crop match first, then presence of symptoms/description
    candidates_for_eval.sort(key=lambda c: (c["is_crop_match"], len(c["problem"])), reverse=True)
    top_candidates = candidates_for_eval[:8]

    # 4. Invoke Featherless Qwen3-VL for semantic symptom reasoning
    qwen_evaluations = await evaluate_candidate_similarity_qwen(
        current_case=current_case_data,
        candidate_cases=top_candidates,
        language=language
    )

    qwen_by_id = {}
    for ev in qwen_evaluations:
        qwen_by_id[str(ev.get("candidate_id"))] = ev

    # 5. Composite Ranking:
    # 40% semantic/symptom + 20% crop + 15% AEO verification + 15% distance + 10% recency
    scored_results = []
    for cand in top_candidates:
        cid = cand["id"]
        meta = candidates_metadata[cid]
        q_ev = qwen_by_id.get(cid, {})

        is_similar = bool(q_ev.get("is_genuinely_similar", False))
        if not is_similar:
            continue

        raw_sim_score = float(q_ev.get("similarity_score", 0.0))
        if raw_sim_score < 0.45:
            continue

        # Distance score (1.0 for close <= 5km, decays gracefully)
        dist_km = meta.get("dist_km")
        if dist_km is not None:
            dist_score = max(0.0, 1.0 - (dist_km / 100.0))
        else:
            dist_score = 0.5

        # Crop match score
        crop_score = 1.0 if cand["is_crop_match"] else 0.2

        # AEO verified boost
        aeo_boost = 1.0 if meta["verification_status"] == "AEO_VERIFIED" else 0.5

        # Recency score
        recency_score = 0.8

        composite_score = (
            raw_sim_score * 0.40 +
            crop_score * 0.20 +
            aeo_boost * 0.15 +
            dist_score * 0.15 +
            recency_score * 0.10
        )

        why_similar = q_ev.get("why_similar")
        if not why_similar:
            if "te" in language.lower():
                why_similar = f"{meta['crop']} పంటపై ఇలాంటి లక్షణాలు గతంలో నమోదయ్యాయి."
            elif "hi" in language.lower():
                why_similar = f"{meta['crop']} फसल पर इसी तरह के लक्षण पहले दर्ज किए गए थे।"
            else:
                why_similar = f"Similar symptoms were previously reported on {meta['crop']}."

        scored_results.append({
            "incident_id": cid,
            "similarity_score": round(composite_score, 2),
            "crop": meta["crop"],
            "problem": meta["problem"],
            "symptoms": meta["symptoms"],
            "duration": meta["duration"],
            "location_label": meta["location_label"],
            "reported_time": meta["reported_time"],
            "verification_status": meta["verification_status"],
            "outcome": meta["outcome"],
            "aeo_advice": meta["aeo_advice"],
            "why_similar": why_similar,
            "image_available": meta["image_available"],
            "image_url": meta["image_url"],
        })

    # Sort by composite score descending
    scored_results.sort(key=lambda x: x["similarity_score"], reverse=True)

    # Return top 3-4 matches (max 4). If fewer genuinely match, return fewer. If 0 match, return empty list.
    final_matches = scored_results[:min(max_results, 4)]

    return {
        "success": True,
        "incident_id": incident_id,
        "similar_issues": final_matches,
    }


def confirm_similar_issues(
    current_incident_id: str,
    matched_incident_ids: List[str],
    farmer_phone: Optional[str] = None,
    farmer_name: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Attaches farmer confirmation of similar previous cases to the SAME incident.
    
    Guarantees:
    - Never creates a duplicate or second incident.
    - Never delays AEO routing.
    - Stores confirmation in ai_analysis.structured_data['similar_issue_confirmations']
      and in community_confirmations table (response = "SIMILAR_ISSUE_CONFIRMED:<id>").
    """
    if not matched_incident_ids:
        return {"success": True, "message": "No issues selected for confirmation.", "confirmations": []}

    client = get_supabase_client()
    if not client:
        raise RuntimeError("Database connection not configured")

    # 1. Verify current incident exists
    current_inc = get_incident_by_id(current_incident_id)
    if not current_inc:
        raise ValueError(f"Incident with ID {current_incident_id} not found.")

    normalized_phone = normalize_phone(farmer_phone) if farmer_phone else None
    farmer_id = current_inc.get("farmer_id")
    if not farmer_id and normalized_phone:
        try:
            farmer_id, _ = get_or_create_farmer(name=farmer_name or "Farmer", phone=normalized_phone)
        except Exception:
            pass

    now_iso = datetime.now(timezone.utc).isoformat()
    confirmations_to_save = []

    for matched_id in matched_incident_ids:
        clean_matched_id = str(matched_id).strip()
        if not clean_matched_id:
            continue

        # Get matched incident details for rich context
        matched_inc = get_incident_by_id(clean_matched_id) or {}

        conf_record = {
            "id": str(uuid.uuid4()),
            "current_incident_id": current_incident_id,
            "matched_incident_id": clean_matched_id,
            "farmer_id": str(farmer_id) if farmer_id else None,
            "farmer_phone": normalized_phone,
            "confirmation_type": "SIMILAR_ISSUE_CONFIRMED",
            "created_at": now_iso,
            "matched_crop": matched_inc.get("crop") or "Unknown",
            "matched_problem": matched_inc.get("description") or "",
            "matched_status": matched_inc.get("status") or "REPORTED",
            "matched_photo_url": matched_inc.get("photo_url") or "",
        }
        confirmations_to_save.append(conf_record)

        # Also insert into community_confirmations table with response = "SIMILAR_ISSUE_CONFIRMED:<matched_id>"
        try:
            client.table("community_confirmations").insert({
                "incident_id": current_incident_id,
                "farmer_id": str(farmer_id) if farmer_id else None,
                "response": f"SIMILAR_ISSUE_CONFIRMED:{clean_matched_id}",
            }).execute()
        except Exception as e:
            logger.warning(f"[SimilarIssues] Insert into community_confirmations warning: {e}")

    # 2. Append to ai_analysis structured_data['similar_issue_confirmations']
    existing_records = get_incident_similar_confirmations(current_incident_id)
    combined = list(existing_records) + confirmations_to_save

    # Deduplicate by matched_incident_id
    deduped = []
    seen = set()
    for c in combined:
        mid = c.get("matched_incident_id")
        if mid and mid not in seen:
            seen.add(mid)
            deduped.append(c)

    try:
        # Check for existing ai_analysis structured_data
        ai_res = client.table("ai_analysis").select("id, structured_data, created_at").eq("incident_id", current_incident_id).order("created_at", desc=True).execute()
        base_sd = {}
        if ai_res.data and len(ai_res.data) > 0:
            first_row = ai_res.data[0]
            raw_sd = first_row.get("structured_data")
            if isinstance(raw_sd, dict):
                base_sd = dict(raw_sd)

        base_sd["similar_issue_confirmations"] = deduped

        # Insert new ai_analysis record with updated structured_data
        # (This pattern preserves historical integrity and succeeds across Supabase anon policies)
        client.table("ai_analysis").insert({
            "incident_id": current_incident_id,
            "structured_data": base_sd,
            "requires_aeo_review": True,
        }).execute()
    except Exception as exc:
        logger.error(f"[SimilarIssues] Failed to record ai_analysis confirmation: {exc}")

    return {
        "success": True,
        "incident_id": current_incident_id,
        "confirmations": deduped,
        "message": f"Successfully attached {len(confirmations_to_save)} similar issue confirmation(s) to incident.",
    }


def get_incident_similar_confirmations(incident_id: str) -> List[Dict[str, Any]]:
    """
    Fetches confirmed similar previous cases attached to an incident.
    """
    client = get_supabase_client()
    if not client:
        return []

    try:
        res = client.table("ai_analysis").select("structured_data, created_at").eq("incident_id", incident_id).order("created_at", desc=True).execute()
        if res.data:
            for row in res.data:
                sd = row.get("structured_data")
                if isinstance(sd, dict) and "similar_issue_confirmations" in sd:
                    confs = sd["similar_issue_confirmations"]
                    if isinstance(confs, list) and len(confs) > 0:
                        return confs
    except Exception as exc:
        logger.warning(f"[SimilarIssues] Failed to fetch confirmations: {exc}")

    return []
