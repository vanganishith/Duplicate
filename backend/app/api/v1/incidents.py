from typing import Optional, Dict, Any, List
from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Body, Query, status
from fastapi.responses import JSONResponse
from app.models.database_models import (
    IncidentSubmissionRequest,
    IncidentSubmissionResponse,
    MapOverviewResponse,
    CommunityConfirmationRequest,
    CommunityConfirmationResponse,
    NearbyIncidentsResponse,
    AdvisorySubmissionRequest,
    AdvisoryResponse
    , CommunityPostRequest, CommunityCommentRequest
)
from app.services.incident_service import (
    create_farmer_incident,
    get_incident_by_id,
    start_work_on_incident,
    reject_incident,
    format_incident_location,
    get_map_incidents_and_clusters,
    compute_incident_priority,
    update_incident_workflow_status,
    get_incident_timeline,
    get_next_valid_statuses
)
from app.services.community_confirmation_service import (
    record_community_confirmation,
    get_incident_community_summary,
    get_nearby_incidents_for_farmer
)
from app.services.community_service import (
    list_posts, get_post, create_post, create_comment,
    add_helpful_reaction, get_problem, create_problem_comment, list_farmer_incidents, upload_community_photo
)
from app.services.advisory_service import (
    create_or_update_officer_advisory,
    get_incident_advisory
)
from app.services.voice_service import process_voice_for_incident
from app.services.vision_service import process_vision_for_incident, process_multiple_vision_for_incident
from app.services.stt_service import transcribe_audio
from app.services.llm_service import (
    extract_agricultural_meaning,
    validate_and_understand_agricultural_complaint,
    evaluate_multimodal_evidence
)
from app.database.session import get_supabase_client
from app.core.phone import normalize_phone

router = APIRouter(tags=["Incidents"])


def _community_error(exc: Exception):
    if isinstance(exc, ValueError):
        return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail={"success": False, "message": str(exc)})
    if isinstance(exc, RuntimeError):
        return HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail={"success": False, "message": str(exc)})
    return HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail={"success": False, "message": str(exc)})


@router.get("/community/posts", summary="List farmer community posts")
async def community_posts(limit: int = Query(30, ge=1, le=50)):
    try:
        return list_posts(limit)
    except Exception as exc:
        raise _community_error(exc)


@router.get("/community/my-issues", summary="List the current farmer's reported issues")
async def community_my_issues(farmer_id: Optional[str] = Query(None), farmer_phone: Optional[str] = Query(None), limit: int = Query(30, ge=1, le=50)):
    try:
        return list_farmer_incidents(farmer_id, farmer_phone, limit)
    except Exception as exc:
        raise _community_error(exc)


@router.get("/community/posts/{post_id}", summary="Get a farmer community post")
async def community_post(post_id: str):
    try:
        return get_post(post_id)
    except Exception as exc:
        raise _community_error(exc)


@router.post("/community/posts", status_code=status.HTTP_201_CREATED, summary="Create a farmer community post")
async def create_community_post(payload: CommunityPostRequest):
    try:
        return create_post(payload.farmer_id, payload.farmer_phone, payload.content, payload.crop, payload.incident_id, payload.photo_url)
    except Exception as exc:
        raise _community_error(exc)


@router.post("/community/posts/{post_id}/comments", status_code=status.HTTP_201_CREATED, summary="Add a farmer community comment")
async def create_community_comment(post_id: str, payload: CommunityCommentRequest):
    try:
        return create_comment(post_id, payload.farmer_id, payload.farmer_phone, payload.content)
    except Exception as exc:
        raise _community_error(exc)


@router.post("/community/problems/{problem_id}/comments", status_code=status.HTTP_201_CREATED, summary="Comment on a reported problem")
async def create_problem_community_comment(problem_id: str, payload: CommunityCommentRequest):
    try:
        return create_problem_comment(problem_id, payload.farmer_id, payload.farmer_phone, payload.content)
    except Exception as exc:
        raise _community_error(exc)


@router.post("/community/comments/{comment_id}/helpful", summary="Mark a community comment Helpful")
async def mark_comment_helpful(comment_id: str, payload: Dict[str, Any] = Body(...)):
    try:
        return add_helpful_reaction(comment_id, payload.get("farmer_id"), payload.get("farmer_phone"))
    except Exception as exc:
        raise _community_error(exc)


@router.get("/community/problems/{problem_id}", summary="Get a privacy-safe nearby problem discussion")
async def community_problem(problem_id: str):
    try:
        return get_problem(problem_id)
    except Exception as exc:
        raise _community_error(exc)


@router.post("/community/photos", summary="Upload a community photo")
async def community_photo(file: UploadFile = File(...)):
    try:
        content_type = file.content_type or "image/jpeg"
        if not content_type.startswith("image/"):
            raise ValueError("Community uploads must be images.")
        content = await file.read()
        if not content or len(content) > 10 * 1024 * 1024:
            raise ValueError("Community images must be between 1 byte and 10 MB.")
        return {"success": True, "photo_url": upload_community_photo(content, file.filename or "community.jpg", content_type)}
    except Exception as exc:
        raise _community_error(exc)


@router.get("/farmers/lookup", summary="Lookup farmer by mobile number")
async def lookup_farmer(phone: str = Query(..., description="Farmer 10-digit mobile number")):
    """
    Checks if a farmer already exists in the database by phone number.
    Returns farmer details if found, or exists: false if not registered yet.
    """
    try:
        norm_phone = normalize_phone(phone)
    except ValueError as ve:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"success": False, "message": str(ve)}
        )
    
    client = get_supabase_client()
    if not client:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"success": False, "message": "Database connection not configured"}
        )
    
    try:
        response = client.table("farmers").select("id, name, phone, preferred_language, village, district, state").eq("phone", norm_phone).limit(1).execute()
        if response.data and len(response.data) > 0:
            farmer_data = response.data[0]
            return {
                "success": True,
                "exists": True,
                "farmer": {
                    "id": str(farmer_data.get("id")),
                    "name": farmer_data.get("name"),
                    "phone": farmer_data.get("phone"),
                    "preferred_language": farmer_data.get("preferred_language"),
                    "village": farmer_data.get("village"),
                    "district": farmer_data.get("district"),
                    "state": farmer_data.get("state"),
                }
            }
        return {
            "success": True,
            "exists": False,
            "farmer": None
        }
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"success": False, "message": f"Database error: {str(exc)}"}
        )


@router.post(
    "/incidents",
    response_model=IncidentSubmissionResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Submit a Farmer Agricultural Incident",
    description="Allows a farmer to submit an agricultural incident without authentication. Automatically normalizes phone number and links to existing or newly created farmer record.",
)
async def submit_incident_json(
    payload: IncidentSubmissionRequest = Body(...)
):
    """
    JSON Endpoint for farmer incident submission.
    """
    try:
        result = create_farmer_incident(
            farmer_name=payload.farmer_name,
            farmer_phone=payload.farmer_phone,
            description=payload.description,
            crop=payload.crop,
            language=payload.language,
            latitude=payload.latitude,
            longitude=payload.longitude,
            photo_url=payload.photo_url,
            photos=payload.photos,
            photo_file=None
        )
        return result
    except ValueError as ve:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"success": False, "message": str(ve)}
        )
    except RuntimeError as re:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"success": False, "message": str(re)}
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"success": False, "message": f"An unexpected error occurred: {str(e)}"}
        )


@router.post(
    "/incidents/upload",
    response_model=IncidentSubmissionResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Submit a Farmer Agricultural Incident with Photo & Voice Upload",
    description="Multipart form submission allowing direct photo (up to 4) and voice audio upload alongside incident details.",
)
async def submit_incident_form(
    farmer_name: str = Form(...),
    farmer_phone: str = Form(...),
    description: Optional[str] = Form(None),
    crop: Optional[str] = Form(None),
    language: Optional[str] = Form("Telugu"),
    latitude: Optional[float] = Form(None),
    longitude: Optional[float] = Form(None),
    photo_url: Optional[str] = Form(None),
    photo: Optional[UploadFile] = File(None),
    photos: Optional[List[UploadFile]] = File(None),
    audio: Optional[UploadFile] = File(None),
):
    """
    Form-data Endpoint for farmer incident submission with optional direct photo (up to 4) & audio upload.
    """
    # If farmer spoke instead of typing, provide placeholder until transcription completes
    effective_description = description.strip() if description and description.strip() else ("Voice Agricultural Incident" if audio else "")
    
    if not effective_description:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"success": False, "message": "Please provide a problem description or record a voice note."}
        )

    # Collect and validate all uploaded photos (mandatory: 1 to 4 photos)
    all_photo_files: List[UploadFile] = []
    if photo:
        all_photo_files.append(photo)
    if photos:
        for pf in photos:
            if pf is not None and hasattr(pf, 'filename') and pf.filename:
                all_photo_files.append(pf)

    if len(all_photo_files) > 4:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"success": False, "message": "Maximum 4 photos allowed per incident."}
        )

    try:
        # Read photo bytes and audio bytes upfront
        photos_bytes_list: List[bytes] = []
        photos_filenames: List[str] = []
        photos_content_types: List[str] = []
        for pf in all_photo_files:
            p_bytes = await pf.read()
            if p_bytes and len(p_bytes) > 0:
                photos_bytes_list.append(p_bytes)
                photos_filenames.append(pf.filename or "photo.jpg")
                photos_content_types.append(pf.content_type or "image/jpeg")

        audio_bytes = await audio.read() if audio else None
        
        # 1. Create base incident with persistent media files
        result = create_farmer_incident(
            farmer_name=farmer_name,
            farmer_phone=farmer_phone,
            description=effective_description,
            crop=crop,
            language=language,
            latitude=latitude,
            longitude=longitude,
            photo_url=photo_url,
            photos_bytes=photos_bytes_list,
            photos_filenames=photos_filenames,
            photos_content_types=photos_content_types,
            audio_file=audio,
            audio_bytes=audio_bytes
        )

        incident_id = result["incident_id"]
        uploaded_photos = result.get("photos", [])

        # 2. If voice audio is provided, process Voice AI
        if audio_bytes and len(audio_bytes) > 0:
            try:
                voice_ai_result = await process_voice_for_incident(
                    incident_id=incident_id,
                    audio_bytes=audio_bytes,
                    filename=audio.filename or "recording.webm" if audio else "recording.webm",
                    content_type=audio.content_type or "audio/webm" if audio else "audio/webm",
                    language=language
                )
                result["voice_ai"] = voice_ai_result
                if voice_ai_result.get("summary"):
                    result["ai_summary"] = voice_ai_result["summary"]
            except Exception as voice_err:
                result["voice_ai_error"] = str(voice_err)

        # 3. If photos are provided, evaluate each photo independently via Phase 5 Vision AI (YOLO11)
        #    AND Featherless Qwen3-VL Multimodal Reasoning
        if photos_bytes_list and len(photos_bytes_list) > 0:
            photos_data = []
            for idx, p_bytes in enumerate(photos_bytes_list):
                p_url = uploaded_photos[idx] if idx < len(uploaded_photos) else None
                photos_data.append({"bytes": p_bytes, "url": p_url, "index": idx})
                
            vision_ai_result = {}
            try:
                vision_ai_result = process_multiple_vision_for_incident(
                    incident_id=incident_id,
                    photos_data=photos_data
                )
                result["vision_ai"] = vision_ai_result
            except Exception as vision_err:
                result["vision_ai_error"] = str(vision_err)

            # Featherless Qwen3-VL Multimodal Reasoning Stage
            try:
                complaint_ctx = {
                    "crop": crop,
                    "description": effective_description,
                    "language": language
                }
                multimodal_ai_result = await evaluate_multimodal_evidence(
                    complaint=complaint_ctx,
                    photos_data=photos_data,
                    yolo_findings=vision_ai_result.get("images", []) if isinstance(vision_ai_result, dict) else []
                )
                result["multimodal_ai"] = multimodal_ai_result
                result["safe_aeo_approach"] = multimodal_ai_result.get("safe_aeo_approach")
                result["assessment"] = multimodal_ai_result.get("assessment")

                # Merge multimodal evaluation into ai_analysis table
                client = get_supabase_client()
                if client:
                    existing_ai = client.table("ai_analysis").select("*").eq("incident_id", incident_id).execute()
                    if existing_ai.data and len(existing_ai.data) > 0:
                        row = existing_ai.data[0]
                        sd = row.get("structured_data")
                        if not isinstance(sd, dict):
                            sd = {}
                        sd["multimodal"] = multimodal_ai_result
                        sd["safe_aeo_approach"] = multimodal_ai_result.get("safe_aeo_approach")
                        sd["assessment"] = multimodal_ai_result.get("assessment")
                        client.table("ai_analysis").update({
                            "structured_data": sd,
                            "llm_summary": multimodal_ai_result.get("assessment", {}).get("summary") or row.get("llm_summary")
                        }).eq("id", row["id"]).execute()

                # INCIDENT-LEVEL ACCEPTANCE RULE:
                # If at least ONE photo is RELEVANT or LIMITED_EVIDENCE -> Accept incident
                # If ALL photos are NON_RELEVANT, NON_AGRICULTURAL, or ANALYSIS_FAILED -> Reject photos, ask for retry
                images_eval = multimodal_ai_result.get("images", [])
                any_useful = any(img.get("status") in ["RELEVANT", "LIMITED_EVIDENCE"] for img in images_eval)

                if images_eval and not any_useful:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail={
                            "success": False,
                            "photo_retry_required": True,
                            "message": "The uploaded photo(s) did not show recognizable plant or crop problems related to your complaint. Your voice complaint has been preserved. Please upload a clearer photo of the affected plant.",
                            "incident_id": incident_id,
                            "image_evaluations": images_eval
                        }
                    )
            except HTTPException:
                raise
            except Exception as mm_err:
                result["multimodal_error"] = str(mm_err)

        return result
    except ValueError as ve:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"success": False, "message": str(ve)}
        )
    except RuntimeError as re:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"success": False, "message": str(re)}
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"success": False, "message": f"An unexpected error occurred: {str(e)}"}
        )


@router.post(
    "/incidents/{incident_id}/voice",
    summary="Process Voice Recording for Incident",
    description="Transcribes audio using Google Speech-to-Text and extracts agricultural meaning via LLM, storing results in ai_analysis table.",
)
async def process_incident_voice(
    incident_id: str,
    audio: UploadFile = File(...),
    language: Optional[str] = Form("Telugu"),
):
    """
    Dedicated endpoint to process voice recording for an existing incident.
    """
    if not audio:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"success": False, "message": "Audio file is required."}
        )

    audio_bytes = await audio.read()
    if len(audio_bytes) < 100:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"success": False, "message": "Audio recording is empty or too short."}
        )

    try:
        result = await process_voice_for_incident(
            incident_id=incident_id,
            audio_bytes=audio_bytes,
            filename=audio.filename or "recording.webm",
            content_type=audio.content_type or "audio/webm",
            language=language
        )
        return result
    except ValueError as ve:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"success": False, "message": str(ve)}
        )
    except RuntimeError as re:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"success": False, "message": str(re)}
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"success": False, "message": str(e)}
        )


@router.post(
    "/voice/asr",
    summary="AI4Bharat IndicConformer Authoritative ASR",
    description="Transcribes finalized full audio file using AI4Bharat IndicConformer into native Indic script.",
)
async def process_indic_asr(
    audio: UploadFile = File(...),
    language: Optional[str] = Form("Telugu"),
):
    """
    Authoritative IndicConformer ASR endpoint. Returns raw model transcript in native script.
    """
    if not audio:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"success": False, "message": "Audio file is required."}
        )

    audio_bytes = await audio.read()
    if len(audio_bytes) < 50:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"success": False, "message": "Audio recording is empty or too short."}
        )

    try:
        transcript, detected_lang = await transcribe_audio(
            audio_bytes=audio_bytes,
            content_type=audio.content_type or "audio/webm",
            language=language or "Telugu"
        )
        return {
            "success": True,
            "transcript": transcript,
            "language": detected_lang,
            "model": "ai4bharat-indicconformer",
            "version": "1.0",
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"success": False, "message": f"IndicConformer ASR failed: {str(e)}"}
        )


@router.post(
    "/voice/analyze",
    summary="Extract Agricultural Meaning from Confirmed Transcript",
    description="Passes farmer-verified transcript text to Agricultural LLM for structured entity extraction.",
)
async def analyze_confirmed_transcript(
    payload: Dict[str, Any] = Body(...)
):
    """
    LLM Agricultural reasoning endpoint. Strictly receives text (not raw audio).
    """
    transcript = payload.get("transcript", "").strip()
    language = payload.get("language", "Telugu")

    if not transcript:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"success": False, "message": "Transcript text is required for analysis."}
        )

    try:
        stage1 = await validate_and_understand_agricultural_complaint(
            transcript=transcript,
            language_hint=language
        )
        complaint = stage1.get("complaint") or {}
        return {
            "success": True,
            "agriculture_related": stage1.get("agriculture_related", False),
            "reason": stage1.get("reason", ""),
            "complaint": complaint,
            "photo_guidance": stage1.get("photo_guidance", []),
            "crop_detected": complaint.get("crop"),
            "symptoms": complaint.get("symptoms", []),
            "possible_conditions": [complaint.get("suspected_problem")] if complaint.get("suspected_problem") else [],
            "summary": complaint.get("farmer_concern") or transcript[:200],
            "structured_data": stage1,
            "requires_aeo_review": True,
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"success": False, "message": f"Agricultural LLM reasoning failed: {str(e)}"}
        )


@router.post(
    "/voice/preview",
    summary="Preview Voice Transcription & AI Meaning",
    description="Instantly transcribes voice audio and extracts preliminary meaning for live user UI feedback.",
)
async def preview_voice_transcription(
    audio: UploadFile = File(...),
    language: Optional[str] = Form("Telugu"),
):
    """
    Live voice preview endpoint: transcribes audio and extracts agricultural meaning
    without creating a database incident yet.
    """
    if not audio:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"success": False, "message": "Audio file is required."}
        )

    audio_bytes = await audio.read()
    if len(audio_bytes) < 50:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"success": False, "message": "Audio recording is empty or too short."}
        )

    try:
        transcript, detected_lang = await transcribe_audio(
            audio_bytes=audio_bytes,
            content_type=audio.content_type or "audio/webm",
            language=language or "Telugu"
        )

        extracted = {}
        try:
            extracted = await extract_agricultural_meaning(
                transcript=transcript,
                language_hint=detected_lang
            )
        except Exception:
            extracted = {
                "crop_detected": None,
                "symptoms": [],
                "possible_conditions": [],
                "llm_summary": transcript,
            }

        return {
            "success": True,
            "transcript": transcript,
            "detected_language": detected_lang,
            "crop_detected": extracted.get("crop_detected"),
            "symptoms": extracted.get("symptoms", []),
            "possible_conditions": extracted.get("possible_conditions", []),
            "summary": extracted.get("llm_summary"),
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"success": False, "message": f"Voice preview failed: {str(e)}"}
        )


@router.get(
    "/incidents/map",
    response_model=MapOverviewResponse,
    summary="Get Incidents Density Map & Emerging Clusters",
    description="Returns real PostGIS coordinates and metadata for incidents along with server-side geospatial clusters for the AEO cluster map.",
)
async def get_map_overview(
    status: Optional[str] = Query("all", description="Status filter: all, new, acknowledged, resolved, rejected, high_priority"),
    time_filter: Optional[str] = Query("all", description="Time filter: all, today, 7d, 30d"),
    priority: Optional[str] = Query(None, description="Priority filter: LOW, MEDIUM, HIGH, CRITICAL"),
    modality: Optional[str] = Query("all", description="Modality filter: all, photo, voice"),
):
    try:
        overview = get_map_incidents_and_clusters(
            status_filter=status,
            time_filter=time_filter,
            priority_filter=priority,
            modality_filter=modality
        )
        return overview
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail={"success": False, "message": f"Failed to generate map overview: {str(e)}"}
        )


@router.get(
    "/clusters",
    summary="Get Emerging Clusters Summary",
    description="Returns current active/emerging agricultural clusters for AEO monitoring.",
)
async def get_clusters_summary(
    status: Optional[str] = Query("all"),
    time_filter: Optional[str] = Query("all"),
):
    try:
        overview = get_map_incidents_and_clusters(
            status_filter=status,
            time_filter=time_filter,
        )
        return {"success": True, "clusters": overview.get("clusters", []), "total_clusters": len(overview.get("clusters", []))}
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail={"success": False, "message": f"Failed to retrieve clusters: {str(e)}"}
        )


# ==========================================
# 3 KM Nearby Feed Endpoint (Must be declared before parameterized {incident_id})
# ==========================================
@router.get(
    "/incidents/nearby",
    response_model=NearbyIncidentsResponse,
    summary="Get Nearby Community Issues (3 KM Default Radius)",
    description="Farmer-facing nearby search within 3 KM radius. Privacy-sanitized, distance-sorted, and crop-prioritized.",
)
async def get_nearby_incidents(
    latitude: float = Query(..., description="Farmer's current GPS latitude"),
    longitude: float = Query(..., description="Farmer's current GPS longitude"),
    radius_km: float = Query(3.0, description="Search radius in kilometers (default 3.0 KM)"),
    crop: Optional[str] = Query(None, description="Optional crop filter for relevance prioritization"),
    current_incident_id: Optional[str] = Query(None, description="Exclude currently reported incident"),
    limit: int = Query(20, description="Max number of items to return"),
):
    try:
        result = get_nearby_incidents_for_farmer(
            latitude=latitude,
            longitude=longitude,
            radius_km=radius_km,
            crop=crop,
            current_incident_id=current_incident_id,
            limit=limit,
        )
        return result
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"success": False, "message": f"Failed to retrieve nearby issues: {str(e)}"}
        )


@router.get(
    "/incidents/{incident_id}",
    summary="Get Incident Details by ID",
    description="Fetches an incident record and associated farmer and AI analysis data.",
)
async def get_incident(incident_id: str):
    try:
        incident = get_incident_by_id(incident_id)
        if not incident:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"success": False, "message": f"Incident {incident_id} not found"}
            )
        
        client = get_supabase_client()
        ai_records = []
        all_incidents = []
        if client:
            ai_res = client.table("ai_analysis").select("*").eq("incident_id", incident_id).execute()
            ai_records = ai_res.data or []
            all_res = client.table("incidents").select("id, location, created_at, description, crop").limit(100).execute()
            all_incidents = all_res.data or []

        incident_with_ai = dict(incident)
        incident_with_ai["ai_analysis"] = ai_records
        priority, priority_reasons = compute_incident_priority(incident_with_ai, all_incidents=all_incidents)

        # Community confirmation summary for this incident
        comm_summary = get_incident_community_summary(incident_id, all_incidents=all_incidents)

        # Case workflow timeline & next transitions
        timeline = get_incident_timeline(incident_id, incident_with_ai)
        next_statuses = get_next_valid_statuses(incident_with_ai.get("status"))

        # Official AEO Advisory
        advisory = get_incident_advisory(incident_id)

        formatted_incident = format_incident_location(incident_with_ai)
        formatted_incident["priority"] = priority
        formatted_incident["priority_reasons"] = priority_reasons
        formatted_incident["community_stats"] = comm_summary.get("stats")
        formatted_incident["has_nearby_complaints"] = comm_summary.get("has_nearby_complaints", False)
        formatted_incident["nearby_complaints_count"] = comm_summary.get("nearby_complaints_count", 0)
        formatted_incident["community_confirmations"] = comm_summary.get("confirmations", [])
        formatted_incident["timeline"] = timeline
        formatted_incident["next_valid_statuses"] = next_statuses
        formatted_incident["advisory"] = advisory

        return {
            "success": True,
            "incident": formatted_incident,
            "ai_analysis": ai_records,
            "community_summary": comm_summary,
            "timeline": timeline,
            "next_valid_statuses": next_statuses,
            "advisory": advisory,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"success": False, "message": str(e)}
        )


@router.get(
    "/incidents",
    summary="List Recent Incidents",
    description="Lists recent incident submissions for monitoring and verification.",
)
async def list_incidents(limit: int = 20):
    client = get_supabase_client()
    if not client:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"success": False, "message": "Database not configured"}
        )
    try:
        res = client.table("incidents").select("*, farmers(*), ai_analysis(*)").order("created_at", desc=True).limit(limit).execute()
        raw_list = res.data or []
        formatted_list = []
        for inc in raw_list:
            priority, priority_reasons = compute_incident_priority(inc, all_incidents=raw_list)
            fmt = format_incident_location(dict(inc))
            fmt["priority"] = priority
            fmt["priority_reasons"] = priority_reasons
            formatted_list.append(fmt)
        return {"success": True, "incidents": formatted_list}
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"success": False, "message": str(e)}
        )


@router.post(
    "/incidents/{incident_id}/start-work",
    summary="Officer Starts Work on Incident",
    description="Transitions an incident to ACKNOWLEDGED lifecycle status to record officer response.",
)
async def officer_start_work(
    incident_id: str,
    payload: Optional[Dict[str, Any]] = Body(None)
):
    try:
        officer_id = payload.get("officer_id", "AEO001") if payload else "AEO001"
        result = start_work_on_incident(incident_id=incident_id, officer_id=officer_id)
        return result
    except ValueError as ve:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"success": False, "message": str(ve)}
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"success": False, "message": str(e)}
        )


@router.post(
    "/incidents/{incident_id}/reject",
    summary="Officer Rejects Complaint with Reason",
    description="Records officer rejection and required reason without destroying complaint audit history.",
)
async def officer_reject_incident(
    incident_id: str,
    payload: Dict[str, Any] = Body(...)
):
    reason = payload.get("reason", "").strip() if payload else ""
    if not reason:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"success": False, "message": "A non-empty rejection reason is required."}
        )
        
    try:
        officer_id = payload.get("officer_id", "AEO001")
        result = reject_incident(incident_id=incident_id, reason=reason, officer_id=officer_id)
        return result
    except ValueError as ve:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"success": False, "message": str(ve)}
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"success": False, "message": str(e)}
        )


# ==========================================
# Phase 10: Community Confirmation Endpoints
# ==========================================


@router.post(
    "/incidents/{incident_id}/confirmations",
    response_model=CommunityConfirmationResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Submit Community Confirmation Response / Me Too",
    description="Allows nearby farmers to respond YES/NO/NOT_SURE or 'Me Too'. Does NOT create an AEO ticket.",
)
async def submit_community_confirmation(
    incident_id: str,
    payload: CommunityConfirmationRequest = Body(...),
):
    try:
        result = record_community_confirmation(
            incident_id=incident_id,
            farmer_phone=payload.farmer_phone,
            response=payload.response,
            farmer_name=payload.farmer_name,
            latitude=payload.latitude,
            longitude=payload.longitude,
        )
        return result
    except ValueError as ve:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"success": False, "message": str(ve)}
        )
    except RuntimeError as re:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"success": False, "message": str(re)}
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"success": False, "message": str(e)}
        )


@router.get(
    "/incidents/{incident_id}/confirmations",
    summary="Get Community Confirmation Summary",
    description="Retrieves aggregated confirmation responses (YES, NO, NOT_SURE counts) and supporting field evidence.",
)
async def get_incident_confirmations(incident_id: str):
    try:
        client = get_supabase_client()
        all_incidents = []
        if client:
            all_res = client.table("incidents").select("id, location, created_at, description, crop").limit(100).execute()
            all_incidents = all_res.data or []
        summary = get_incident_community_summary(incident_id, all_incidents=all_incidents)
        return summary
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"success": False, "message": str(e)}
        )


# ==========================================
# Phase 11: Case Lifecycle Status Workflow
# ==========================================

@router.post(
    "/incidents/{incident_id}/status",
    summary="Update Case Workflow Status",
    description="Transitions an incident through its lifecycle: NEW -> ACKNOWLEDGED -> INVESTIGATING -> ACTION_TAKEN -> RESOLVED.",
)
async def update_case_workflow_status(
    incident_id: str,
    payload: Dict[str, Any] = Body(...)
):
    target_status = payload.get("status", "").strip()
    if not target_status:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"success": False, "message": "Target status is required."}
        )
    note = payload.get("note")
    officer_id = payload.get("officer_id", "AEO001")
    
    try:
        result = update_incident_workflow_status(
            incident_id=incident_id,
            new_status=target_status,
            note=note,
            officer_id=officer_id
        )
        return result
    except ValueError as ve:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"success": False, "message": str(ve)}
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"success": False, "message": str(e)}
        )


# ==========================================
# Phase 12: AEO Advisory & TTS Endpoints
# ==========================================

@router.post(
    "/incidents/{incident_id}/advisory",
    response_model=AdvisoryResponse,
    summary="Submit Official AEO Advisory with Local-Language TTS",
    description="Records AEO-written advisory, translates to farmer preferred language with Featherless AI, and generates audio speech.",
)
async def submit_officer_advisory(
    incident_id: str,
    payload: AdvisorySubmissionRequest = Body(...),
):
    try:
        result = create_or_update_officer_advisory(
            incident_id=incident_id,
            advisory_text=payload.advisory_text,
            target_language=payload.target_language or "Telugu",
            officer_id=payload.officer_id or "AEO001"
        )
        return result
    except ValueError as ve:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"success": False, "message": str(ve)}
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"success": False, "message": str(e)}
        )


@router.get(
    "/incidents/{incident_id}/advisory",
    summary="Get Official AEO Advisory",
    description="Retrieves the official advisory, localized message, and audio player reference.",
)
async def get_advisory(incident_id: str):
    advisory = get_incident_advisory(incident_id)
    return {"success": True, "incident_id": incident_id, "advisory": advisory}




