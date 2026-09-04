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
    compute_incident_priority_detail,
    update_incident_workflow_status,
    get_incident_timeline,
    get_next_valid_statuses,
    record_aeo_verification,
    send_incident_message,
    get_incident_messages,
    record_incident_followup,
    review_incident_followup,
    schedule_field_visit,
    get_aeo_field_visits,
    complete_field_visit,
    escalate_incident,
    record_escalation_response,
    get_cluster_details,
    get_government_support_options,
    get_aeo_analytics,
    get_aeo_notifications,
    get_farmer_incident_history,
    officer_login_auth
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
    evaluate_multimodal_evidence,
    compare_followup_evidence,
)
from app.services.similar_issues_service import (
    find_similar_issues,
    confirm_similar_issues,
    get_incident_similar_confirmations,
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


def _build_localized_photo_retry_message(reason_code: str, crop: Optional[str], language: Optional[str]) -> str:
    """
    Generates a clear, respectful message in the farmer's native tongue explaining why
    the uploaded photo cannot be accepted, and asking for a clearer photo while reassuring
    them that their voice complaint is preserved.
    """
    lang_normalized = (language or "Telugu").strip().lower()
    crop_str = (crop or "").strip()

    if any(k in lang_normalized for k in ["te", "telugu", "తెలుగు"]):
        target_lang = "te"
    elif any(k in lang_normalized for k in ["hi", "hindi", "हिन्दी"]):
        target_lang = "hi"
    elif any(k in lang_normalized for k in ["ta", "tamil", "தமிழ்"]):
        target_lang = "ta"
    elif any(k in lang_normalized for k in ["kn", "kannada", "ಕನ್ನಡ"]):
        target_lang = "kn"
    elif any(k in lang_normalized for k in ["mr", "marathi", "मराठी"]):
        target_lang = "mr"
    else:
        target_lang = "en"

    crop_names = {
        "te": {"paddy": "వరి", "cotton": "పత్తి", "chilli": "మిరప", "maize": "మొక్కజొన్న", "default": "పంట"},
        "hi": {"paddy": "धान", "cotton": "कपास", "chilli": "मिर्च", "maize": "मक्का", "default": "फसल"},
        "ta": {"paddy": "நெல்", "cotton": "பருத்தி", "chilli": "மிளகாய்", "maize": "மக்காச்சோளம்", "default": "பயிர்"},
        "kn": {"paddy": "ಭತ್ತ", "cotton": "ಹತ್ತಿ", "chilli": "ಮೆಣಸಿನಕಾಯಿ", "maize": "ಮೆಕ್ಕೆಜೋಳ", "default": "ಬೆಳೆ"},
        "mr": {"paddy": "भात", "cotton": "कापूस", "chilli": "मिरची", "maize": "मका", "default": "पीक"},
        "en": {"paddy": "paddy", "cotton": "cotton", "chilli": "chilli", "maize": "maize", "default": "crop"},
    }

    c_key = crop_str.lower()
    localized_crop = crop_names.get(target_lang, {}).get(c_key, crop_str or crop_names.get(target_lang, {}).get("default", "crop"))

    if target_lang == "te":
        if reason_code == "WRONG_CROP":
            return f"మీరు పంపిన ఫోటో మీ సమస్యకు లేదా {localized_crop}కు సంబంధించినదిగా కనిపించడం లేదు. మీ వాయిస్ నమోదు భద్రంగా ఉంది. దయచేసి మీ {localized_crop} దెబ్బతిన్న భాగాన్ని స్పష్టంగా చూపిస్తూ మరొక ఫోటో పంపండి."
        elif reason_code == "HEALTHY_CROP":
            return f"అప్‌లోడ్ చేసిన ఫోటోలో {localized_crop} ఆరోగ్యంగా ఉంది, ఎటువంటి తెగులు లేదా సమస్య కనిపించడం లేదు. మీ వాయిస్ నమోదు భద్రంగా ఉంది. దయచేసి సమస్య ఉన్న భాగాన్ని స్పష్టంగా చూపిస్తూ ఫోటో పంపండి."
        else:
            return "సమస్యను అర్థం చేసుకోవడానికి ఫోటో స్పష్టంగా లేదు లేదా పంటకు సంబంధించినది కాదు. మీ వాయిస్ నమోదు భద్రంగా ఉంది. దయచేసి దెబ్బతిన్న మొక్క లేదా ఆకుల స్పష్టమైన ఫోటో పంపండి."
    elif target_lang == "hi":
        if reason_code == "WRONG_CROP":
            return f"अपलोड की गई फोटो आपकी {localized_crop} की समस्या से संबंधित नहीं लग रही है। आपकी आवाज की शिकायत सुरक्षित है। कृपया प्रभावित {localized_crop} की स्पष्ट फोटो भेजें।"
        elif reason_code == "HEALTHY_CROP":
            return f"अपलोड की गई फोटो में {localized_crop} पर कोई कीट या रोग का लक्षण नहीं दिख रहा है। कृपया प्रभावित या रोगग्रस्त हिस्से की स्पष्ट फोटो भेजें।"
        else:
            return "समस्या को समझने के लिए फोटो स्पष्ट नहीं है। आपकी आवाज की शिकायत सुरक्षित है। कृपया प्रभावित पौधे की स्पष्ट फोटो भेजें।"
    elif target_lang == "ta":
        if reason_code == "WRONG_CROP":
            return f"பதிவேற்றப்பட்ட புகைப்படம் உங்கள் {localized_crop} பிரச்சனையுடன் தொடர்புடையதாக தெரியவில்லை. உங்கள் குரல் பதிவு பாதுகாப்பாக உள்ளது. தயவுசெய்து பாதிக்கப்பட்ட {localized_crop} தெளிவான புகைப்படத்தை அனுப்பவும்."
        elif reason_code == "HEALTHY_CROP":
            return f"பதிவேற்றிய புகைப்படத்தில் எந்த சேதமும் தெரியவில்லை. தயவுசெய்து பாதிக்கப்பட்ட பகுதியை தெளிவாக காட்டும் புகைப்படத்தை அனுப்பவும்."
        else:
            return "பிரச்சனையை அடையாளம் காண புகைப்படம் தெளிவாக இல்லை. உங்கள் குரல் பதிவு பாதுகாப்பாக உள்ளது. தயவுசெய்து பாதிக்கப்பட்ட செடியின் தெளிவான புகைப்படத்தை அனுப்பவும்."
    elif target_lang == "kn":
        if reason_code == "WRONG_CROP":
            return f"ಅಪ್‌ಲೋಡ್ ಮಾಡಿದ ಫೋಟೋ ನಿಮ್ಮ {localized_crop} ಸಮಸ್ಯೆಗೆ ಸಂಬಂಧಿಸಿದಂತೆ ಕಾಣಿಸುತ್ತಿಲ್ಲ. ನಿಮ್ಮ ಧ್ವನಿ ದೂರು ಸುರಕ್ಷಿತವಾಗಿದೆ. ದಯವಿಟ್ಟು ಬಾಧಿತ {localized_crop} ಸ್ಪಷ್ಟ ಫೋಟೋ ಕಳುಹಿಸಿ."
        elif reason_code == "HEALTHY_CROP":
            return f"ಅಪ್‌ಲೋಡ್ ಮಾಡಿದ ಫೋಟೋದಲ್ಲಿ ಯಾವುದೇ ರೋಗ ಅಥವಾ ಹಾನಿಯ ಲಕ್ಷಣಗಳು ಕಂಡುಬರುತ್ತಿಲ್ಲ. ದಯವಿಟ್ಟು ಬಾಧಿತ ಭಾಗದ ಸ್ಪಷ್ಟ ಫೋಟೋ ಕಳುಹಿಸಿ."
        else:
            return "ಸಮಸ್ಯೆಯನ್ನು ಗುರುತಿಸಲು ಫೋಟೋ ಸ್ಪಷ್ಟವಾಗಿಲ್ಲ. ನಿಮ್ಮ ಧ್ವನಿ ದೂರು ಸುರಕ್ಷಿತವಾಗಿದೆ. ದಯವಿಟ್ಟು ಬಾಧಿತ ಸಸ್ಯದ ಸ್ಪಷ್ಟ ಫೋಟೋ ಕಳುಹಿಸಿ."
    elif target_lang == "mr":
        if reason_code == "WRONG_CROP":
            return f"अपलोड केलेला फोटो तुमच्या {localized_crop} समस्येशी संबंधित दिसत नाही. तुमची व्हॉइस तक्रार सुरक्षित आहे. कृपया बाधित {localized_crop} चा स्पष्ट फोटो पाठवा."
        elif reason_code == "HEALTHY_CROP":
            return f"अपलोड केलेल्या फोटोमध्ये कोणतीही कीड किंवा रोग दिसत नाही. कृपया बाधित भागाचा स्पष्ट फोटो पाठवा."
        else:
            return "समस्या समजून घेण्यासाठी फोटो स्पष्ट नाही. तुमची व्हॉइस तक्रार सुरक्षित आहे. कृपया बाधित वनस्पतीचा स्पष्ट फोटो पाठवा."
    else:
        if reason_code == "WRONG_CROP":
            return f"The uploaded photo(s) appear to show a different plant or object than your reported complaint ({localized_crop}). Your voice complaint is safe. Please upload photos of your actual affected {localized_crop}."
        elif reason_code == "HEALTHY_CROP":
            return f"The uploaded photo(s) show completely healthy plants with no visible signs of damage, pest, or disease. Please upload a photo clearly showing the affected or damaged parts of your {localized_crop}."
        else:
            return "The uploaded photo(s) did not show recognizable plant or crop problems related to your complaint. Your voice complaint has been preserved. Please upload a clearer photo of the affected plant."




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
                        sd["multimodal_assessment"] = multimodal_ai_result.get("multimodal_assessment")
                        sd["visual_mappings"] = multimodal_ai_result.get("visual_mappings") or []
                        sd["voice_image_assessment"] = multimodal_ai_result.get("voice_image_assessment")
                        sd["vision_multimodal"] = multimodal_ai_result.get("vision")
                        sd["safe_aeo_approach"] = multimodal_ai_result.get("safe_aeo_approach")
                        sd["assessment"] = multimodal_ai_result.get("assessment")
                        client.table("ai_analysis").update({
                            "structured_data": sd,
                            "llm_summary": multimodal_ai_result.get("assessment", {}).get("summary") or row.get("llm_summary")
                        }).eq("id", row["id"]).execute()

                # INCIDENT-LEVEL ACCEPTANCE RULE:
                # If at least ONE photo is RELEVANT or LIMITED_EVIDENCE -> Accept incident
                # If ALL photos are HEALTHY_CROP, WRONG_CROP, NON_RELEVANT, NON_AGRICULTURAL, or ANALYSIS_FAILED -> Reject photos, ask for retry
                images_eval = multimodal_ai_result.get("images", [])
                any_useful = any(img.get("status") in ["RELEVANT", "LIMITED_EVIDENCE"] for img in images_eval)

                if images_eval and not any_useful:
                    has_wrong_crop = any(img.get("status") == "WRONG_CROP" for img in images_eval)
                    all_healthy = all(img.get("status") == "HEALTHY_CROP" for img in images_eval)

                    if has_wrong_crop:
                        reason_code = "WRONG_CROP"
                    elif all_healthy:
                        reason_code = "HEALTHY_CROP"
                    else:
                        reason_code = "IRRELEVANT"

                    reject_msg = _build_localized_photo_retry_message(reason_code, crop, language)

                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail={
                            "success": False,
                            "photo_retry_required": True,
                            "reason_type": reason_code,
                            "message": reject_msg,
                            "message_localized": reject_msg,
                            "incident_id": incident_id,
                            "image_evaluations": images_eval
                        }
                    )
            except HTTPException:
                raise
            except Exception as mm_err:
                result["multimodal_error"] = str(mm_err)

        return result
    except HTTPException:
        raise
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
    "/incidents/{incident_id}/analyze-multimodal",
    summary="Trigger Featherless Qwen3-VL Multimodal Evidence Analysis on Incident",
    description="Analyzes incident photo(s), YOLO findings, and voice complaint via Featherless Qwen3-VL, generating normalized spatial mappings and cross-evidence review.",
)
async def analyze_incident_multimodal_endpoint(incident_id: str):
    import httpx
    client = get_supabase_client()
    if not client:
        raise HTTPException(status_code=500, detail={"success": False, "message": "Database not configured"})

    incident = get_incident_by_id(incident_id)
    if not incident:
        raise HTTPException(status_code=404, detail={"success": False, "message": f"Incident {incident_id} not found"})

    # Collect photos
    photos_list = []
    if isinstance(incident.get("photos"), list) and incident.get("photos"):
        photos_list = [p for p in incident["photos"] if p]
    if not photos_list and incident.get("photo_url"):
        photos_list = [incident["photo_url"]]

    if not photos_list:
        raise HTTPException(status_code=400, detail={"success": False, "message": "No photos available for this incident to analyze."})

    # Download photo bytes
    photos_data = []
    async with httpx.AsyncClient(timeout=30.0) as http_client:
        for idx, p_url in enumerate(photos_list[:4]):
            try:
                if p_url.startswith("http://") or p_url.startswith("https://"):
                    resp = await http_client.get(p_url)
                    if resp.status_code == 200 and resp.content:
                        photos_data.append({"bytes": resp.content, "url": p_url, "index": idx})
            except Exception as dl_err:
                print(f"[AnalyzeMultimodal] Error downloading photo {p_url}: {dl_err}")

    if not photos_data:
        raise HTTPException(status_code=400, detail={"success": False, "message": "Failed to download photo evidence."})

    # Fetch existing AI analysis record
    existing_ai = client.table("ai_analysis").select("*").eq("incident_id", incident_id).execute()
    yolo_images = []
    existing_transcript = None
    existing_row = None

    if existing_ai.data and len(existing_ai.data) > 0:
        existing_row = existing_ai.data[0]
        existing_transcript = existing_row.get("transcript")
        sd = existing_row.get("structured_data") or {}
        vision_sd = sd.get("vision")
        if vision_sd:
            yolo_images = [vision_sd] if isinstance(vision_sd, dict) else vision_sd

    # If no YOLO detections in DB yet, run local YOLO11
    if not yolo_images:
        try:
            vision_ai_result = process_multiple_vision_for_incident(
                incident_id=incident_id,
                photos_data=photos_data
            )
            yolo_images = vision_ai_result.get("images", []) if isinstance(vision_ai_result, dict) else []
        except Exception as v_err:
            print(f"[AnalyzeMultimodal] Vision error: {v_err}")

    # Build complaint context
    description = existing_transcript or incident.get("description") or "Farmer agricultural problem report"
    complaint_ctx = {
        "crop": incident.get("crop"),
        "description": description,
        "language": incident.get("language") or "Telugu"
    }

    # Run Featherless Qwen3-VL Multimodal Analysis
    multimodal_result = await evaluate_multimodal_evidence(
        complaint=complaint_ctx,
        photos_data=photos_data,
        yolo_findings=yolo_images
    )

    # Persist in Supabase ai_analysis table (append-only record with merged structured_data)
    merged_sd = {}
    if existing_ai.data:
        for r in reversed(sorted(existing_ai.data, key=lambda x: x.get("created_at") or "")):
            if isinstance(r.get("structured_data"), dict):
                merged_sd.update(r["structured_data"])

    merged_sd["multimodal"] = multimodal_result
    merged_sd["multimodal_assessment"] = multimodal_result.get("multimodal_assessment")
    merged_sd["visual_mappings"] = multimodal_result.get("visual_mappings") or []
    merged_sd["voice_image_assessment"] = multimodal_result.get("voice_image_assessment")
    merged_sd["vision_multimodal"] = multimodal_result.get("vision")
    merged_sd["safe_aeo_approach"] = multimodal_result.get("safe_aeo_approach")
    merged_sd["assessment"] = multimodal_result.get("assessment")

    client.table("ai_analysis").insert({
        "incident_id": incident_id,
        "requires_aeo_review": True,
        "llm_summary": multimodal_result.get("assessment", {}).get("summary"),
        "structured_data": merged_sd
    }).execute()

    return {
        "success": True,
        "incident_id": incident_id,
        "multimodal_ai": multimodal_result,
        "visual_mappings": multimodal_result.get("visual_mappings", []),
        "multimodal_assessment": multimodal_result.get("multimodal_assessment"),
        "voice_image_assessment": multimodal_result.get("voice_image_assessment"),
        "safe_aeo_approach": multimodal_result.get("safe_aeo_approach")
    }


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
@router.post(
    "/incidents/voice/analyze",
    include_in_schema=False
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
            "intent_classification": stage1.get("intent_classification") or ("AGRICULTURE_RELATED" if stage1.get("agriculture_related") else "NOT_AGRICULTURE_RELATED"),
            "reason": stage1.get("reason", ""),
            "conversational_response": stage1.get("conversational_response", ""),
            "photo_instructions_prompt": stage1.get("photo_instructions_prompt"),
            "complaint": complaint,
            "complaint_summary_localized": stage1.get("complaint_summary_localized", {}),
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
            ai_res = client.table("ai_analysis").select("*").eq("incident_id", incident_id).order("created_at", desc=True).execute()
            ai_records = ai_res.data or []
            all_res = client.table("incidents").select("id, location, created_at, description, crop").limit(100).execute()
            all_incidents = all_res.data or []

        incident_with_ai = dict(incident)
        incident_with_ai["ai_analysis"] = ai_records
        priority_detail = compute_incident_priority_detail(incident_with_ai, all_incidents=all_incidents)
        priority = priority_detail["priority"]
        priority_reasons = priority_detail["reasons"]

        # Community confirmation summary for this incident
        comm_summary = get_incident_community_summary(incident_id, all_incidents=all_incidents)

        # Case workflow timeline & next transitions
        timeline = get_incident_timeline(incident_id, incident_with_ai)
        next_statuses = get_next_valid_statuses(incident_with_ai.get("status"))

        # Official AEO Advisory
        advisory = get_incident_advisory(incident_id)

        # Extract rich AEO structured data across all records (newest takes precedence)
        sd = {}
        if ai_records and isinstance(ai_records, list):
            for r in reversed(sorted(ai_records, key=lambda x: x.get("created_at") or "")):
                cur_sd = r.get("structured_data")
                if isinstance(cur_sd, dict):
                    sd.update(cur_sd)

        # Grounded government schemes
        try:
            gov_support = get_government_support_options(incident_id).get("schemes", [])
        except Exception:
            gov_support = []

        formatted_incident = format_incident_location(incident_with_ai)
        formatted_incident["priority"] = priority
        formatted_incident["priority_reasons"] = priority_reasons
        formatted_incident["priority_detail"] = priority_detail
        formatted_incident["community_stats"] = comm_summary.get("stats")
        formatted_incident["has_nearby_complaints"] = comm_summary.get("has_nearby_complaints", False)
        formatted_incident["nearby_complaints_count"] = comm_summary.get("nearby_complaints_count", 0)
        formatted_incident["community_confirmations"] = comm_summary.get("confirmations", [])
        formatted_incident["timeline"] = timeline
        formatted_incident["next_valid_statuses"] = next_statuses
        formatted_incident["advisory"] = advisory
        formatted_incident["aeo_verification"] = sd.get("aeo_verification")
        formatted_incident["communications"] = sd.get("communications", [])
        formatted_incident["followups"] = sd.get("followups", [])
        formatted_incident["field_visits"] = sd.get("field_visits", [])
        formatted_incident["escalation"] = sd.get("escalation")
        formatted_incident["government_support"] = gov_support

        # Similar previous cases confirmed by farmer
        similar_confs = sd.get("similar_issue_confirmations") or get_incident_similar_confirmations(incident_id)
        formatted_incident["similar_issue_confirmations"] = similar_confs

        # Multimodal reasoning fields
        multimodal_assessment = sd.get("multimodal_assessment") or sd.get("multimodal", {}).get("multimodal_assessment")
        visual_mappings = sd.get("visual_mappings") or sd.get("multimodal", {}).get("visual_mappings") or []
        voice_image_assessment = sd.get("voice_image_assessment") or sd.get("multimodal", {}).get("voice_image_assessment")
        safe_aeo_approach = sd.get("safe_aeo_approach") or sd.get("multimodal", {}).get("safe_aeo_approach")
        assessment = sd.get("assessment") or sd.get("multimodal", {}).get("assessment")

        formatted_incident["multimodal_assessment"] = multimodal_assessment
        formatted_incident["visual_mappings"] = visual_mappings
        formatted_incident["voice_image_assessment"] = voice_image_assessment
        formatted_incident["safe_aeo_approach"] = safe_aeo_approach
        formatted_incident["assessment"] = assessment

        return {
            "success": True,
            "incident": formatted_incident,
            "ai_analysis": ai_records,
            "multimodal_assessment": multimodal_assessment,
            "visual_mappings": visual_mappings,
            "voice_image_assessment": voice_image_assessment,
            "safe_aeo_approach": safe_aeo_approach,
            "assessment": assessment,
            "community_summary": comm_summary,
            "timeline": timeline,
            "next_valid_statuses": next_statuses,
            "advisory": advisory,
            "priority_detail": priority_detail,
            "aeo_verification": sd.get("aeo_verification"),
            "communications": sd.get("communications", []),
            "followups": sd.get("followups", []),
            "field_visits": sd.get("field_visits", []),
            "escalation": sd.get("escalation"),
            "government_support": gov_support,
            "similar_issue_confirmations": similar_confs
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


# ==========================================
# Phase 13: AEO Verification & Authority Decision
# ==========================================

@router.post(
    "/incidents/{incident_id}/verify",
    summary="Submit Official AEO Verification Decision",
    description="Records human officer authority verification, confirmed diagnosis, severity, official advisory, and recommended schemes.",
)
async def verify_incident_by_officer(
    incident_id: str,
    payload: Dict[str, Any] = Body(...),
):
    try:
        officer_id = payload.get("officer_id") or "AEO001"
        officer_name = payload.get("officer_name") or "Srinivas Rao (AEO)"
        status_val = payload.get("status") or "CONFIRMED"
        confirmed_diagnosis = payload.get("confirmed_diagnosis") or "Verified Crop Condition"
        verified_severity = payload.get("verified_severity") or "HIGH"
        official_advisory = payload.get("official_advisory") or "Standard agricultural advisory"
        follow_up_instructions = payload.get("follow_up_instructions")
        officer_notes = payload.get("officer_notes")
        recommended_schemes = payload.get("recommended_schemes")

        result = record_aeo_verification(
            incident_id=incident_id,
            officer_id=officer_id,
            officer_name=officer_name,
            status=status_val,
            confirmed_diagnosis=confirmed_diagnosis,
            verified_severity=verified_severity,
            official_advisory=official_advisory,
            follow_up_instructions=follow_up_instructions,
            officer_notes=officer_notes,
            recommended_schemes=recommended_schemes,
        )
        return result
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail={"success": False, "message": str(ve)})
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail={"success": False, "message": str(e)})


# ==========================================
# Phase 14: Case Communication (AEO <-> Farmer)
# ==========================================

@router.post(
    "/incidents/{incident_id}/messages",
    summary="Send Case Message",
    description="Sends a direct message or advisory update in the incident communication thread.",
)
async def send_case_message(
    incident_id: str,
    payload: Dict[str, Any] = Body(...),
):
    try:
        sender_type = payload.get("sender_type") or "OFFICER"
        sender_id = payload.get("sender_id") or "AEO001"
        sender_name = payload.get("sender_name") or "AEO Officer"
        message = payload.get("message") or ""
        message_type = payload.get("message_type") or "TEXT"

        result = send_incident_message(
            incident_id=incident_id,
            sender_type=sender_type,
            sender_id=sender_id,
            sender_name=sender_name,
            message=message,
            message_type=message_type,
        )
        return result
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail={"success": False, "message": str(ve)})
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail={"success": False, "message": str(e)})


@router.get(
    "/incidents/{incident_id}/messages",
    summary="Get Case Communication Thread",
    description="Retrieves the chronological communication thread between officer and farmer.",
)
async def list_case_messages(incident_id: str):
    messages = get_incident_messages(incident_id)
    return {"success": True, "incident_id": incident_id, "messages": messages}


# ==========================================
# Phase 15: Longitudinal Follow-up & Progression
# ==========================================

@router.post(
    "/incidents/{incident_id}/followups",
    summary="Submit Farmer Follow-up Evidence",
    description="Farmer submits follow-up photo, audio or notes after applying treatment.",
)
async def submit_case_followup(
    incident_id: str,
    payload: Dict[str, Any] = Body(...),
):
    try:
        farmer_id = payload.get("farmer_id")
        farmer_name = payload.get("farmer_name")
        notes = payload.get("notes") or "Follow-up update submitted"
        image_url = payload.get("image_url")
        voice_text = payload.get("voice_text")

        result = record_incident_followup(
            incident_id=incident_id,
            farmer_id=farmer_id,
            farmer_name=farmer_name,
            notes=notes,
            image_url=image_url,
            voice_text=voice_text,
        )
        return result
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail={"success": False, "message": str(ve)})
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail={"success": False, "message": str(e)})


@router.post(
    "/incidents/{incident_id}/followups/{followup_id}/review",
    summary="Review Farmer Follow-up",
    description="AEO evaluates follow-up evidence, records progression status and updated advice.",
)
async def review_case_followup(
    incident_id: str,
    followup_id: str,
    payload: Dict[str, Any] = Body(...),
):
    try:
        officer_id = payload.get("officer_id") or "AEO001"
        officer_name = payload.get("officer_name") or "Srinivas Rao (AEO)"
        officer_assessment = payload.get("officer_assessment") or "Follow-up reviewed"
        comparison_status = payload.get("comparison_status") or "IMPROVING"
        new_advisory = payload.get("new_advisory")

        # Optionally trigger Featherless Qwen3-VL comparison if baseline and followup images exist
        baseline_image = payload.get("baseline_image")
        followup_image = payload.get("followup_image")
        ai_progression = None
        if baseline_image and followup_image:
            try:
                ai_progression = compare_followup_evidence(
                    crop=payload.get("crop") or "Cotton",
                    initial_diagnosis=payload.get("initial_diagnosis") or "Pest attack",
                    baseline_image_url=baseline_image,
                    followup_image_url=followup_image,
                    farmer_notes=payload.get("farmer_notes")
                )
            except Exception:
                pass

        result = review_incident_followup(
            incident_id=incident_id,
            followup_id=followup_id,
            officer_id=officer_id,
            officer_name=officer_name,
            officer_assessment=officer_assessment,
            comparison_status=comparison_status,
            new_advisory=new_advisory,
        )
        if ai_progression:
            result["ai_progression"] = ai_progression
        return result
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail={"success": False, "message": str(ve)})
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail={"success": False, "message": str(e)})


# ==========================================
# Phase 16: Field Visit Scheduling & Reporting
# ==========================================

@router.post(
    "/incidents/{incident_id}/field-visits",
    summary="Schedule In-Person Field Visit",
    description="Schedules a field inspection visit and notifies the farmer.",
)
async def schedule_visit(
    incident_id: str,
    payload: Dict[str, Any] = Body(...),
):
    try:
        officer_id = payload.get("officer_id") or "AEO001"
        officer_name = payload.get("officer_name") or "Srinivas Rao (AEO)"
        scheduled_date = payload.get("scheduled_date")
        scheduled_time = payload.get("scheduled_time") or "10:00 AM"
        purpose = payload.get("purpose") or "Field Inspection"
        farmer_notes = payload.get("farmer_notes")

        if not scheduled_date:
            raise ValueError("scheduled_date is required (YYYY-MM-DD)")

        result = schedule_field_visit(
            incident_id=incident_id,
            officer_id=officer_id,
            officer_name=officer_name,
            scheduled_date=scheduled_date,
            scheduled_time=scheduled_time,
            purpose=purpose,
            farmer_notes=farmer_notes,
        )
        return result
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail={"success": False, "message": str(ve)})
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail={"success": False, "message": str(e)})


@router.get(
    "/aeo/field-visits",
    summary="List Scheduled Field Visits",
    description="Returns all field visits scheduled across the AEO's area.",
)
async def list_scheduled_field_visits(
    officer_id: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None),
):
    visits = get_aeo_field_visits(officer_id=officer_id, status_filter=status_filter)
    return {"success": True, "visits": visits, "total": len(visits)}


@router.post(
    "/incidents/{incident_id}/field-visits/{visit_id}/complete",
    summary="Complete Field Visit",
    description="Records findings and marks in-person visit completed.",
)
async def finish_field_visit(
    incident_id: str,
    visit_id: str,
    payload: Dict[str, Any] = Body(...),
):
    try:
        officer_notes = payload.get("officer_notes") or ""
        findings = payload.get("findings") or "Inspection completed"
        action_taken = payload.get("action_taken") or "Provided spot advisory"

        result = complete_field_visit(
            incident_id=incident_id,
            visit_id=visit_id,
            officer_notes=officer_notes,
            findings=findings,
            action_taken=action_taken,
        )
        return result
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail={"success": False, "message": str(ve)})
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail={"success": False, "message": str(e)})


# ==========================================
# Phase 17: Administrative Escalation
# ==========================================

@router.post(
    "/incidents/{incident_id}/escalate",
    summary="Escalate Incident to Higher Authority",
    description="Escalates an outbreak or severe case to AO, DAO, or Entomologist.",
)
async def escalate_case(
    incident_id: str,
    payload: Dict[str, Any] = Body(...),
):
    try:
        officer_id = payload.get("officer_id") or "AEO001"
        officer_name = payload.get("officer_name") or "Srinivas Rao (AEO)"
        target_authority = payload.get("target_authority") or "Mandal Agricultural Officer (AO)"
        reason = payload.get("reason") or "Severe localized outbreak requires higher intervention"
        urgency = payload.get("urgency") or "HIGH"

        result = escalate_incident(
            incident_id=incident_id,
            officer_id=officer_id,
            officer_name=officer_name,
            target_authority=target_authority,
            reason=reason,
            urgency=urgency,
        )
        return result
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail={"success": False, "message": str(ve)})
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail={"success": False, "message": str(e)})


@router.post(
    "/incidents/{incident_id}/escalate/respond",
    summary="Record Escalation Response",
    description="Records official response and action plan from higher authority.",
)
async def respond_to_escalation(
    incident_id: str,
    payload: Dict[str, Any] = Body(...),
):
    try:
        respondent_name = payload.get("respondent_name") or "Dr. K. Rao"
        authority_title = payload.get("authority_title") or "District Agricultural Officer"
        instructions = payload.get("instructions") or "Proceed with coordinated spray"
        action_plan = payload.get("action_plan") or "Emergency input distribution"

        result = record_escalation_response(
            incident_id=incident_id,
            respondent_name=respondent_name,
            authority_title=authority_title,
            instructions=instructions,
            action_plan=action_plan,
        )
        return result
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail={"success": False, "message": str(ve)})
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail={"success": False, "message": str(e)})


# ==========================================
# Phase 18: Grounded Government Support Schemes
# ==========================================

@router.get(
    "/incidents/{incident_id}/government-support",
    summary="Get Grounded Government Support Schemes",
    description="Evaluates PMFBY, Disaster Relief, and Input Subsidy eligibility for the incident.",
)
async def get_case_gov_support(incident_id: str):
    try:
        return get_government_support_options(incident_id)
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"success": False, "message": str(ve)})
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail={"success": False, "message": str(e)})


# ==========================================
# Phase 19: Outbreak Cluster Details
# ==========================================

@router.get(
    "/clusters/{cluster_id}/details",
    summary="Get Outbreak Cluster Details",
    description="Returns spatial-temporal spread, member cases, affected villages, and cluster advisory.",
)
async def get_outbreak_cluster(cluster_id: str):
    try:
        return get_cluster_details(cluster_id)
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"success": False, "message": str(ve)})
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail={"success": False, "message": str(e)})


# ==========================================
# Phase 20: AEO Analytics & Operational KPIs
# ==========================================

@router.get(
    "/aeo/analytics",
    summary="Get AEO Operational Analytics & Area Health",
    description="Computes real resolution rate, Area Health Index, village distribution, and crop breakdowns.",
)
async def get_aeo_analytics_overview(
    assigned_area: Optional[str] = Query(None),
):
    return get_aeo_analytics(officer_assigned_area=assigned_area)


@router.get(
    "/aeo/notifications",
    summary="Get AEO Action Notifications",
    description="Returns real notifications for visits today, outbreaks, and high priority cases.",
)
async def get_officer_notifications(
    officer_id: Optional[str] = Query(None),
):
    notifs = get_aeo_notifications(officer_id=officer_id)
    return {"success": True, "notifications": notifs, "count": len(notifs)}


# ==========================================
# Phase 21: Farmer Complaint History
# ==========================================

@router.get(
    "/farmers/{farmer_id}/history",
    summary="Get Farmer Historical Complaint Profile",
    description="Returns past complaints submitted by this farmer to identify recurring pest/disease patterns.",
)
async def get_farmer_history(farmer_id: str):
    return get_farmer_incident_history(farmer_id)


# ==========================================
# Phase 22: Officer Authentication
# ==========================================

@router.post(
    "/officers/login",
    summary="Officer Authentication",
    description="Authenticates agricultural extension officers and returns role and assigned area.",
)
async def officer_login(payload: Dict[str, Any] = Body(...)):
    credential = payload.get("phone") or payload.get("email") or payload.get("officer_id") or ""
    return officer_login_auth(credential)


# ==========================================
# Phase 23: Similar Issues Check
# ==========================================

@router.get(
    "/incidents/{incident_id}/similar-issues",
    summary="Similar Issues Check",
    description="Retrieves real historical similar cases for an incident using PostGIS distance and Featherless Qwen3-VL reasoning.",
)
async def get_similar_issues(
    incident_id: str,
    language: Optional[str] = Query("Telugu", description="Farmer's selected language"),
    limit: Optional[int] = Query(4, ge=1, le=4, description="Max similar matches to return (max 4)"),
):
    try:
        res = await find_similar_issues(incident_id=incident_id, max_results=limit, language=language)
        return res
    except Exception as exc:
        # Crucial product rule: Never block the complaint flow on similarity check errors
        return {
            "success": True,
            "incident_id": incident_id,
            "similar_issues": [],
            "error_note": "Similarity check unavailable"
        }


@router.post(
    "/incidents/{incident_id}/confirm-similar",
    summary="Confirm Similar Previous Cases",
    description="Stores farmer confirmation of similar previous cases against the existing incident without creating duplicates.",
)
async def confirm_similar(
    incident_id: str,
    payload: Dict[str, Any] = Body(...),
):
    matched_ids = payload.get("matched_incident_ids") or []
    single_id = payload.get("matched_incident_id")
    if single_id and single_id not in matched_ids:
        matched_ids.append(single_id)

    farmer_phone = payload.get("farmer_phone")
    farmer_name = payload.get("farmer_name")

    try:
        return confirm_similar_issues(
            current_incident_id=incident_id,
            matched_incident_ids=matched_ids,
            farmer_phone=farmer_phone,
            farmer_name=farmer_name,
        )
    except ValueError as val_err:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(val_err))
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc))






